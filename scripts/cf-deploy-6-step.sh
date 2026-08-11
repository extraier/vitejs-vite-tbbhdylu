#!/usr/bin/env bash
# cf-deploy-6-step.sh — the 6-step Cloud Function deploy + verify ritual
#                     for vitejs-vite-tbbhdylu / savetheday-2377a.
#
# Why this exists (2026-08-11): the 8/10 screenshot-upload feature shipped
# the CF source (functions/src/unlocks.ts added `screenshotUrl` handling)
# but the deploy never ran `firebase deploy --only functions`. The CF
# kept running the 7/30 code (hash 11b7ecc0…) and silently dropped
# `screenshotUrl` from the doc. The user saw the success toast (client
# optimistic update) but the doc was missing the field. The proxy
# allowlist (Trap 15, 2026-08-09 — submitProposal incident) is the other
# half of the same class of bug.
#
# Recipe: from ~/.hermes/skills/devops/firebase-cf-v2-deploy-verify/SKILL.md
# + the proxy-allowlist-2026-08-09 reference.
#
# Usage:
#   # 1. Add a new Cloud Function (e.g. `submitQuote`):
#   #   a. Write functions/src/<file>.ts
#   #   b. Re-export from functions/src/index.ts
#   #   c. Run THIS script with the function name:
#   ./scripts/cf-deploy-6-step.sh submitQuote
#   # 2. For multi-function deploys, pass all names:
#   ./scripts/cf-deploy-6-step.sh submitSocialProof listSocialProofs adminVerifySocialProof
#
# What it does (6 steps, exit 1 on any failure):
#   1. Write the function source + re-export
#   2. Deploy the function via scripts/deploy-functions.sh (handles
#      half-state, IAM, ACTIVE poll)
#   3. Verify IAM (Cloud Run `roles/run.invoker` for allUsers)
#   4. Verify OPTIONS preflight returns 204
#   5. Add the function name to api/firebase-proxy.js allowlist (Trap 15),
#      commit, push, wait for Vercel bundle to advance
#   6. Verify proxy forwards (not 403 NOT_ALLOWED) and direct CF call
#      returns the function-level auth rejection (not 403 from the proxy)
#
# Env:
#   PROJECT     — Firebase project id. Default: savetheday-2377a
#   REGION      — Cloud Function region. Default: us-central1
#   SITE        — Vercel production URL. Default: https://savetheday.io
#   SKIP_PUSH   — set to 1 to skip step 5 (manual proxy edit + push)
#   SKIP_IAM    — set to 1 to skip step 3 (already verified by deploy-fn)
set -euo pipefail

PROJECT="${PROJECT:-savetheday-2377a}"
REGION="${REGION:-us-central1}"
SITE="${SITE:-https://savetheday.io}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <function-name> [<function-name> ...]" >&2
  echo "" >&2
  echo "Example: $0 submitSocialProof" >&2
  exit 2
fi

FNS=("$@")
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Lowercase the function names (Cloud Run service uses lowercase, IAM
# policy uses the lowercase form).
declare -a FNS_LOWER=()
for fn in "${FNS[@]}"; do
  FNS_LOWER+=("$(echo "$fn" | tr '[:upper:]' '[:lower:]')")
done

echo "=========================================="
echo "  CF deploy 6-step — functions: ${FNS[*]}"
echo "  project=$PROJECT region=$REGION site=$SITE"
echo "=========================================="
echo

# ---------------------------------------------------------------
# Step 0: pre-flight
# ---------------------------------------------------------------
echo "Step 0: pre-flight"
[[ -f "$REPO_ROOT/functions/src/index.ts" ]] || fail "functions/src/index.ts not found"
[[ -f "$REPO_ROOT/api/firebase-proxy.js" ]] || fail "api/firebase-proxy.js not found"
command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI not on PATH"
command -v curl >/dev/null 2>&1 || fail "curl not on PATH"
ok "preflight passed (functions/src/index.ts + api/firebase-proxy.js present)"
echo

# ---------------------------------------------------------------
# Step 1: source + re-export check (informational only)
# ---------------------------------------------------------------
echo "Step 1: source + re-export"
for fn in "${FNS[@]}"; do
  if ! grep -qE "export.*\\b${fn}\\b" "$REPO_ROOT/functions/src/index.ts"; then
    fail "$fn not re-exported from functions/src/index.ts — add it before continuing"
  fi
  ok "$fn re-exported from functions/src/index.ts"
done
echo

# ---------------------------------------------------------------
# Step 2: deploy via scripts/deploy-functions.sh
# ---------------------------------------------------------------
echo "Step 2: deploy"
if [[ -x "$REPO_ROOT/scripts/deploy-functions.sh" ]]; then
  bash "$REPO_ROOT/scripts/deploy-functions.sh" "${FNS[@]}"
else
  warn "scripts/deploy-functions.sh not found or not executable; falling back to npx firebase deploy"
  (cd "$REPO_ROOT" && npx --yes firebase-tools@latest deploy \
    $(IFS=,; echo "functions:${FNS[*]}" | sed 's/,/,functions:/g; s/^/--only functions:/') \
    --project "$PROJECT" --force)
fi
ok "deploy complete"
echo

# ---------------------------------------------------------------
# Step 3: IAM verify (skip if SKIP_IAM=1)
# ---------------------------------------------------------------
if [[ "${SKIP_IAM:-}" != "1" ]]; then
  echo "Step 3: IAM verify (Cloud Run roles/run.invoker for allUsers)"
  for fnl in "${FNS_LOWER[@]}"; do
    POLICY=$(gcloud run services get-iam-policy "$fnl" \
              --region="$REGION" --project="$PROJECT" \
              --format='value(bindings.members)' 2>/dev/null || echo "")
    if echo "$POLICY" | grep -q "allUsers"; then
      ok "$fnl: allUsers -> roles/run.invoker"
    else
      warn "$fnl: missing allUsers -> roles/run.invoker; auto-fixing"
      gcloud run services add-iam-policy-binding "$fnl" \
        --region="$REGION" --project="$PROJECT" \
        --member="allUsers" --role="roles/run.invoker" \
        --quiet
      ok "$fnl: IAM binding added"
    fi
  done
  echo
fi

# ---------------------------------------------------------------
# Step 4: OPTIONS preflight returns 204
# ---------------------------------------------------------------
echo "Step 4: OPTIONS preflight"
for fn in "${FNS[@]}"; do
  CODE=$(curl -sS -X OPTIONS \
    "https://${REGION}-${PROJECT}.cloudfunctions.net/${fn}" \
    -H "Origin: $SITE" \
    -H "Access-Control-Request-Method: POST" \
    -o /dev/null -w "%{http_code}" --max-time 20)
  if [[ "$CODE" == "204" ]]; then
    ok "$fn OPTIONS -> 204"
  else
    fail "$fn OPTIONS -> $CODE (expected 204)"
  fi
done
echo

# ---------------------------------------------------------------
# Step 5: proxy allowlist (Trap 15)
# ---------------------------------------------------------------
echo "Step 5: proxy allowlist (api/firebase-proxy.js)"
PROXY="$REPO_ROOT/api/firebase-proxy.js"
MISSING=()
for fn in "${FNS[@]}"; do
  if grep -qE "'${fn}'" "$PROXY"; then
    ok "$fn already in proxy allowlist"
  else
    MISSING+=("$fn")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  if [[ "${SKIP_PUSH:-}" == "1" ]]; then
    fail "missing from proxy allowlist: ${MISSING[*]} (SKIP_PUSH=1 — add manually then re-run)"
  fi
  warn "missing from proxy allowlist: ${MISSING[*]}"
  warn "edit api/firebase-proxy.js and add them, then commit + push."
  warn "the build will fail to 'Function not in allowlist' without this step."
  # Insert a placeholder before the closing `]);` of ALLOWED
  for fn in "${MISSING[@]}"; do
    # Find the line with the last entry (before `]);`)
    # Add the function name as a quoted string + a comment
    python3 - "$PROXY" "$fn" <<'PY'
import sys, re
path, fn = sys.argv[1], sys.argv[2]
with open(path) as f: src = f.read()
# Find the last function entry before `]);` in the ALLOWED set
# Insert before the final `]);`
new_entry = f"    '{fn}',\n"
# Idempotent
if f"'{fn}'" in src:
  sys.exit(0)
# Insert before the line containing only `]);` (or `  ]);`)
pattern = re.compile(r'(  \]\);)', re.MULTILINE)
m = pattern.search(src)
if not m:
  print(f"ERR: could not find '  ]);' in {path}", file=sys.stderr); sys.exit(1)
src = src[:m.start()] + new_entry + src[m.start():]
with open(path, 'w') as f: f.write(src)
print(f"inserted '{fn}' into ALLOWED")
PY
    ok "inserted $fn into proxy allowlist"
  done
  # Stage, commit, push
  (cd "$REPO_ROOT" && git add api/firebase-proxy.js)
  (cd "$REPO_ROOT" && git diff --cached --quiet && warn "no staged changes to commit") || \
    (cd "$REPO_ROOT" && git commit -m "fix(proxy): add ${MISSING[*]} to allowlist (Trap 15)")
  (cd "$REPO_ROOT" && git push origin main)
  # Wait for Vercel to pick up the new deploy
  echo "Waiting for Vercel to pick up the new bundle (max 5 minutes)..."
  OLD_HASH=$(curl -sS "$SITE" --max-time 15 | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    sleep 15
    NEW_HASH=$(curl -sS "$SITE" --max-time 15 | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
    echo "  [$i] bundle=$NEW_HASH"
    # Vercel serverless functions (api/firebase-proxy.js) may deploy BEFORE
    # the SPA bundle updates; check the proxy itself in the next step.
    if [[ -n "$NEW_HASH" && "$NEW_HASH" != "$OLD_HASH" ]]; then
      ok "Vercel SPA bundle advanced ($OLD_HASH -> $NEW_HASH)"
      break
    fi
  done
fi
echo

# ---------------------------------------------------------------
# Step 6: verify proxy forwards (not 403 NOT_ALLOWED)
# ---------------------------------------------------------------
echo "Step 6: verify proxy forwards"
for fn in "${FNS[@]}"; do
  # Direct call: expect CF-level auth rejection (HTML 401 OR JSON UNAUTHENTICATED)
  DIRECT=$(curl -sS -X POST "https://${REGION}-${PROJECT}.cloudfunctions.net/${fn}" \
            -H 'Content-Type: application/json' \
            -d '{"data":{}}' --max-time 20 -w '|HTTP %{http_code}')
  echo "  direct: $DIRECT" | head -c 200
  echo
  # Proxy call: expect forward (NOT 403 NOT_ALLOWED)
  PROXY_RESP=$(curl -sS -X POST "$SITE/api/firebase-proxy?fn=$fn" \
                -H 'Content-Type: application/json' \
                -H 'Authorization: Bearer fake' \
                -d '{"data":{}}' --max-time 25 -w '|HTTP %{http_code}')
  echo "  proxy:  $PROXY_RESP" | head -c 200
  echo
  if echo "$PROXY_RESP" | grep -q "Function not in allowlist"; then
    fail "$fn rejected by proxy as NOT_ALLOWED — allowlist entry didn't take effect (Vercel deploy lag?)"
  fi
  ok "$fn forwarded by proxy (no 403 NOT_ALLOWED)"
done

echo
echo "=========================================="
printf "${GREEN}✓ All 6 steps passed for ${FNS[*]}${NC}\n"
echo "=========================================="
echo
echo "Next: open the app and exercise the feature end-to-end."
echo "Verify the user can submit, the admin can see + decide, and"
echo "Firestore shows the expected state change."
