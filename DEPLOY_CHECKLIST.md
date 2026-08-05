# Deploy Checklist — savetheday.io

> Last revised: 2026-08-06 (after the photo-delete deploy-gaps incident)
> Read this BEFORE touching any production runtime. Skipping a step has cost us hours twice.

## TL;DR — what can fail silently

| Runtime | Symptom of silent failure | Detection |
|---|---|---|
| Firebase Cloud Functions | Function URL returns 404 / CORS 404 | `gcloud functions describe <fn>` → `state` + `buildConfig.runtime` |
| Firestore rules | Reads/writes return PERMISSION_DENIED | `firebase deploy --only firestore:rules` is a separate command |
| Cloudflare tunnel | Path returns CF edge 404 with no CORS | `curl -X OPTIONS https://cdn.savetheday.io/<path>` should return 204 |
| Vercel env vars | API endpoint returns "missing env var" | `vercel env ls production` + actually hit the endpoint |
| NAS Python | File ops return 401 or 500 | `ps aux | grep photo_upload_server` → check PID + file mtime |

If ANY of these is stale, the user's feature is broken. Each lives in a separate runtime. Each requires its own deploy command.

## Per-runtime deploy commands

### Cloud Functions (Firebase Gen 2)

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.firebase-keys/savetheday-2377a.json"
cd ~/projects/vitejs-vite-tbbhdylu
./scripts/deploy-functions.sh <fn-name>     # one function
./scripts/deploy-functions.sh                # all functions
```

**After deploy, ALWAYS verify:**

```bash
gcloud functions describe <fn> --region=us-central1 --gen2 --project=savetheday-2377a \
  --format='get(state,buildConfig.runtime,updateTime)'
# Expect: state=ACTIVE, runtime=nodejs20, updateTime=today
```

**If `state=ACTIVE` but `buildConfig.runtime` is empty:** half-state. Auto-recovered by the script, or manually:
```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
gcloud functions delete <fn> --gen2 --region=us-central1 --project=savetheday-2377a --quiet
# Then re-run deploy-functions.sh
```

### Firestore rules

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.firebase-keys/savetheday-2377a.json"
firebase deploy --only firestore:rules --project savetheday-2377a
```

**Why this is a separate command:** `firebase deploy --only functions` does NOT deploy rules. They are independent deploy targets. See `firebase-cf-v2-deploy-verify` skill for the full rule-deploy interaction with functions.

**Verify after deploy:**
```bash
curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token --project=savetheday-2377a)" \
  "https://firebaserules.googleapis.com/v1/projects/savetheday-2377a/releases/cloud.firestore" \
  | python3 -c "import sys,json,base64;d=json.load(sys.stdin);print(base64.b64decode(d['release']['ruleset']['source']['files'][0]['content']).decode()[:200])"
```

### Cloudflare tunnel (ingress)

The ingress config is at `~/.cloudflared/config.yml` on the NAS. **It is NOT in source control today** — every change is hand-edited on the box. This is footgun #1 from the deploy-gaps plan; the fix is to move it into `deploy/cloudflared/config.yml` (TODO).

**To check what's currently routed:**
```bash
ssh openclaw@nas "cat ~/.cloudflared/config.yml"
```

**To add a new route:**
1. Edit `~/.cloudflared/config.yml` on the NAS
2. Restart cloudflared so it picks up the new config:
   ```bash
   ssh openclaw@nas "pkill -f 'cloudflared tunnel' && sleep 5"
   # The watchdog at /tmp/ts-autostart.watchdog.log restarts it within ~60s
   sleep 70
   ssh openclaw@nas "ps aux | grep cloudflared | grep -v grep"
   ```

**Verify after change:**
```bash
curl -sS -X OPTIONS https://cdn.savetheday.io/<new-path> -i | head -5
# Expect: 204 + access-control-allow-* headers
```

### Vercel env vars

**⚠️ Critical: Vercel does NOT hot-reload env vars on existing deployments.**
After `vercel env add`, you MUST redeploy for the new value to be visible to your code.

Use the wrapper script:

```bash
cd ~/projects/vitejs-vite-tbbhdylu
./scripts/vercel-env-sync.sh HMAC_KEY '<secret-value>'
# Auto-detects if vercel env add actually succeeded (parses output for ✓ Added).
# On success: pushes an empty commit to main so Vercel rebuilds with the new env.
# On failure: prints the error and DOES NOT push an empty commit.
```

For sensitive secrets stored in the macOS keychain, prefer:
```bash
security find-generic-password -ws 'savetheday-hmac-key' | ./scripts/vercel-env-sync.sh HMAC_KEY -
```

**Verify after redeploy:**
```bash
./scripts/vercel-env-sync.sh --list
# Or hit a /api/* endpoint that reads the env var
```

### NAS Python (photo server)

The NAS runs `photo_upload_server.py` from `/home/openclaw/bin/`, supervised by a watchdog at `/tmp/ts-autostart.watchdog.log`. Deploy = rsync + kill PID.

```bash
cd ~/projects/vitejs-vite-tbbhdylu
cat deploy/photo_upload_server.py | ssh openclaw@nas \
  "cat > /home/openclaw/bin/photo_upload_server.py && chmod +x /home/openclaw/bin/photo_upload_server.py"

# Kill the current process; watchdog restarts within ~60s with new code
OLD_PID=$(ssh openclaw@nas "ps aux | grep photo_upload_server | grep -v grep | awk '{print \$2}'")
ssh openclaw@nas "kill $OLD_PID"

# Wait + verify
sleep 70
ssh openclaw@nas "ps aux | grep photo_upload_server | grep -v grep"
```

(TODO: this is footgun #4 from the deploy-gaps plan — `scripts/deploy-nas.sh` + `/version` endpoint.)

## The 2026-08-05 photo-delete incident — what NOT to repeat

This was the day the deploy checklist above was written. Here's the postmortem:

User reported "刪除失敗：internal". Diagnosis found **5 stacked silent failures**:

1. `mintPhotoDeleteToken` Cloud Function had never been deployed. The user-facing CORS error was the symptom.
2. Cloudflare tunnel config was missing the `/delete` ingress rule. Edge returned 404 with no CORS headers.
3. `HMAC_KEY` env var existed on Firebase but was missing on Vercel. Watermark feature had been silently broken for weeks.
4. `NAS_DELETE_URL` env var missing on Vercel. The proxy fell back to the upload URL.
5. NAS `_handle_delete_path` called `verify_hmac(...)` with positional arg order swapped. `int(filename)` raised ValueError → 401 "token mismatch" on every delete.

Three lessons:

1. **Symptoms are at the top of the stack, root cause at the bottom.** The user saw a CORS error. The root cause was 5 layers deep.
2. **Each runtime needs its own deploy command.** No single "deploy" exists.
3. **E2E tests against real user data destroy real user data.** My test deleted a 73423-byte user photo and we can't recover it. The NAS-side `TEST_PREFIX` guard (footgun #2 fix) is for this.

If you're about to deploy a cross-runtime feature and you haven't read this checklist in the last 30 days, re-read it. The pattern repeats.

## Cross-references

- `scripts/deploy-functions.sh` — CF deploy with half-state auto-recovery
- `scripts/deploy-cloudflared.sh` — TODO (Footgun 1 fix)
- `scripts/deploy-nas.sh` — TODO (Footgun 4 fix)
- `scripts/vercel-env-sync.sh` — Vercel env + auto-redeploy
- `scripts/ship-feature.sh` — TODO (Footgun 1 orchestrator)
- Skill `firebase-cf-v2-deploy-verify` — full CF deploy troubleshooting tree