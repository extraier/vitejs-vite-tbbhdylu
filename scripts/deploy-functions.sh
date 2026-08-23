#!/usr/bin/env bash
# deploy-functions.sh — manual Cloud Functions v2 deploy when the CI
#                   FIREBASE_TOKEN path isn't configured.
#
# Why this exists (2026-07-30): the ci.yml deploy-functions job used to
# silently `exit 0` when FIREBASE_TOKEN was missing, which hid an entire
# CF source-code omission from CI. The workflow has now been patched to
# exit 1 in that case. Use THIS script for the manual fallback.
#
# Recipe: from ~/.hermes/skills/software-development/firebase-security-gating/
# references/agent-firebase-deploy-iam-and-retry.md
#
#   1. SA `firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com`
#      already has the right IAM roles for deploy:
#        firebase.admin, cloudfunctions.admin, cloudbuild.builds.builder,
#        artifactregistry.admin, secretmanager.secretAccessor,
#        firebaseauth.admin, storage.admin.
#      Verify with: gcloud projects get-iam-policy savetheday-2377a \
#        --flatten='bindings[].members' \
#        --filter="bindings.members:firebase-adminsdk-fbsvc@..."
#
#   2. Mint a short-lived user-OAuth access token via gcloud and inject
#      it as FIREBASE_TOKEN. The Firebase CLI accepts this with a
#      deprecation warning that is informational only.
#
#   3. Run this script. Defaults to deploying EVERY function; pass a
#      function name to deploy only one.
#
# Usage:
#   ./scripts/deploy-functions.sh                           # all functions
#   ./scripts/deploy-functions.sh autoLinkVendorContactsV2  # single fn
#   PROJECT=savetheday-2377a SA=/path/to/sa.json ./scripts/deploy-functions.sh
#
# Env:
#   SA    — path to a SA key JSON. Default: ~/.firebase-keys/savetheday-2377a.json
#   PROJECT — Firebase project id. Default: savetheday-2377a
#   FIREBASE_TOKEN — short-circuit: if set, skip the gcloud mint.
#
set -euo pipefail

# Path resolution: when called via `bash scripts/deploy-functions.sh`,
# BASH_SOURCE is unset; when called directly, $0 is the script path.
# Use BASH_SOURCE[0] in priority order, with a fallback for `bash -c`.
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [[ -z "$SCRIPT_PATH" ]] || [[ "$SCRIPT_PATH" == *"/bash" ]] || [[ "$SCRIPT_PATH" == "bash" ]]; then
  # Last-ditch: resolve relative to current working directory.
  SCRIPT_PATH="scripts/deploy-functions.sh"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd || true)"
[[ -z "$SCRIPT_DIR" ]] && SCRIPT_DIR="$(pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || pwd)"
FUNCTIONS_DIR="$REPO_ROOT/functions"

PROJECT="${PROJECT:-savetheday-2377a}"
SA="${SA:-$HOME/.firebase-keys/${PROJECT}.json}"

if [[ ! -f "$SA" ]]; then
  echo "❌ SA key not found at $SA" >&2
  echo "   Set SA=/path/to/sa.json or copy the firebase-adminsdk key to the default location." >&2
  exit 1
fi

# Pick functions to deploy: CLI args or "all functions under default codebase"
if [[ $# -gt 0 ]]; then
  ONLY_PARTS=()
  for fn in "$@"; do
    ONLY_PARTS+=("functions:${fn}")
  done
  ONLY="--only $(IFS=,; echo "${ONLY_PARTS[*]}")"
else
  ONLY="--only functions"
fi

echo "==> Project: $PROJECT"
echo "==> SA: $SA"
echo "==> Firebase CLI: $(command -v firebase || echo 'NOT FOUND — npm i -g firebase-tools')"

# Build first (deploy-functions job does this; doing locally too so the
# uploaded zip is the same as what CI would have produced).
echo "==> Building $FUNCTIONS_DIR ..."
(cd "$FUNCTIONS_DIR" && npm run build)

# Activate the SA so gcloud print-access-token returns a token bearing
# the firebase-adminsdk identity (the Compute/SA default chain would
# also work, but activating explicitly makes failures obvious).
EMAIL=$(python3 -c "import json; print(json.load(open('$SA'))['client_email'])")
echo "==> Activating $EMAIL"
gcloud auth activate-service-account "$EMAIL" --key-file="$SA" --project="$PROJECT" >/dev/null

# Mint the short-lived OAuth token (gcloud 1024-char access token).
if [[ -z "${FIREBASE_TOKEN:-}" ]]; then
  echo "==> Minting FIREBASE_TOKEN via gcloud (this is the gcloud OAuth access token, not a service-account key)"
  FIREBASE_TOKEN="$(gcloud auth print-access-token --project="$PROJECT")"
fi
echo "==> Token length: ${#FIREBASE_TOKEN}"

# Verify IAM before deploying.
echo "==> Verifying SA has Firebase admin roles ..."
gcloud projects get-iam-policy "$PROJECT" \
  --flatten='bindings[].members' \
  --filter="bindings.members:$EMAIL" \
  --format='value(bindings.role)' 2>/dev/null \
  | sort -u \
  | tee /tmp/hermes-deploy-roles.list

for need in roles/firebase.admin roles/cloudfunctions.admin roles/cloudbuild.builds.builder roles/artifactregistry.admin; do
  if ! grep -qx "$need" /tmp/hermes-deploy-roles.list; then
    echo "❌ Missing IAM role: $need" >&2
    echo "   Add it via: gcloud projects add-iam-policy-binding $PROJECT --member='serviceAccount:$EMAIL' --role='$need'" >&2
    exit 1
  fi
done
echo "==> IAM roles verified (firebase.admin, cloudfunctions.admin, cloudbuild.builds.builder, artifactregistry.admin)"

# Run the deploy.
echo "==> Running firebase deploy $ONLY ..."
FIREBASE_TOKEN="$FIREBASE_TOKEN" \
  npx --yes firebase-tools@latest deploy \
    $ONLY \
    --project "$PROJECT" --force

# Always verify with gcloud describe (per firebase-cf-v2-deploy-verify skill):
# the deploy script's "Deploy complete!" message is NOT enough; check
# that ACTIVE landed and updateTime moved.
declare -a VERIFY_TARGETS=()
if [[ $# -gt 0 ]]; then
  VERIFY_TARGETS=("$@")
else
  # When called with no args, firebase deploys every function under
  # functions/. List them via functions:config:get ... but the CLI
  # doesn't expose this; instead, parse `gcloud functions list`.
  echo "==> Listing deployed functions for ACTIVE verification ..."
  while IFS= read -r fn; do
    [[ -n "$fn" ]] && VERIFY_TARGETS+=("$fn")
  done < <(gcloud functions list --regions=us-central1 --v2 \
              --project="$PROJECT" --format='value(name)' | awk -F/ '{print $NF}')
fi

ANY_NOT_ACTIVE=0
for fn in "${VERIFY_TARGETS[@]}"; do
  echo "==> Verifying $fn ACTIVE ..."
  STATE="PENDING"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    STATE=$(gcloud functions describe "$fn" --region=us-central1 --gen2 \
              --project="$PROJECT" --format='value(state)' 2>/dev/null || echo "PENDING")
    echo "  attempt $i: state=$STATE"
    [[ "$STATE" == "ACTIVE" ]] && break
    sleep 10
  done

  # Half-state detection (2026-08-05): when a prior deploy
  # failed partway, gcloud describes the function as ACTIVE but
  # with no buildConfig.runtime field. The next `firebase deploy`
  # then returns 409 "Resource already exists" because the name
  # is already taken. Detect this and auto-recover by calling
  # gcloud functions delete --gen2, then redeploying.
  if [[ "$STATE" == "ACTIVE" ]]; then
    RUNTIME=$(gcloud functions describe "$fn" --region=us-central1 --gen2 \
                --project="$PROJECT" --format='value(buildConfig.runtime)' 2>/dev/null || echo "")
    if [[ -z "$RUNTIME" ]]; then
      echo "  ⚠ $fn is ACTIVE but buildConfig.runtime is empty (half-state from failed prior deploy)"
      echo "  → 2026-08-05 recovery: gcloud functions delete --gen2 + redeploy"
      STATE="HALF_STATE"
    fi
  fi

  if [[ "$STATE" != "ACTIVE" ]]; then
    if [[ "$STATE" == "HALF_STATE" ]]; then
      echo "  → Auto-recovering $fn from half-state ..."
      # 2026-08-05 — gcloud CLI v15+ refuses Python 3.9 (the macOS
      # system default) and exits silently. The Homebrew Python
      # 3.14 is at /opt/homebrew/bin/python3.14. Set
      # CLOUDSDK_PYTHON before calling gcloud.
      export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.14}"
      export GOOGLE_APPLICATION_CREDENTIALS="$SA"
      gcloud functions delete "$fn" --gen2 --region=us-central1 \
        --project="$PROJECT" --quiet 2>&1 | tail -3

      # Redeploy just this function. Reuse the same FIREBASE_TOKEN.
      echo "  → Redeploying $fn ..."
      FIREBASE_TOKEN="$FIREBASE_TOKEN" \
        npx --yes firebase-tools@latest deploy \
          --only "functions:${fn}" \
          --project "$PROJECT" --force 2>&1 | tail -5

      # Wait for ACTIVE again.
      RECOVERED_STATE="PENDING"
      for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        RECOVERED_STATE=$(gcloud functions describe "$fn" --region=us-central1 --gen2 \
                    --project="$PROJECT" --format='value(state)' 2>/dev/null || echo "PENDING")
        echo "  recovery attempt $i: state=$RECOVERED_STATE"
        [[ "$RECOVERED_STATE" == "ACTIVE" ]] && break
        sleep 10
      done
      if [[ "$RECOVERED_STATE" != "ACTIVE" ]]; then
        echo "  ❌ $fn still not ACTIVE after auto-recovery."
        ANY_NOT_ACTIVE=$((ANY_NOT_ACTIVE + 1))
      else
        echo "  ✓ $fn recovered and ACTIVE"
      fi
    else
      echo "  ⚠ $fn is not ACTIVE — investigate before declaring deploy successful."
      ANY_NOT_ACTIVE=$((ANY_NOT_ACTIVE + 1))
    fi
  fi
done

if [[ $ANY_NOT_ACTIVE -gt 0 ]]; then
  echo "==> ❌ $ANY_NOT_ACTIVE function(s) did not reach ACTIVE state."
  echo "    Re-run with --force, or apply 'gcloud functions delete' + redeploy."
  exit 1
fi

# ----------------------------------------------------------------------------
# Post-deploy IAM audit (2026-08-06, savetheday-2377a photo-delete incident).
#
# Symptom: CORS preflight OPTIONS to an HTTPS callable returns 403 with no
# Access-Control-Allow-Origin header, and the browser logs
#   "blocked by CORS policy: No 'Access-Control-Allow-Origin' header"
# even though `cors: true` is set in the onCall() handler in source.
#
# Cause: Cloud Functions v2 deploys each function as a Cloud Run service.
# The CORS preflight is rejected at the Cloud Run IAM layer (not by
# the function code) if no identity has roles/run.invoker for that
# service. Firebase CLI normally adds an `allUsers → roles/run.invoker`
# binding for HTTPS callables, but certain deploy paths (raw `gcloud
# functions deploy`, env-var-only updates, redeploy-via-`--gen2` flag)
# skip that step. The result is a deployed function with `cors: true`
# in source but no way for the browser's preflight to reach it.
#
# Self-heal: after every deploy, enumerate all HTTPS (callable) functions
# and re-add the allUsers invoker binding if missing. Event/Eventarc
# triggers are excluded — they MUST NOT have allUsers invoker (they
# are invoked by the Eventarc service account, and exposing them
# publicly would create a security hole).
#
# Set SKIP_IAM_AUDIT=1 to opt out (e.g. for dry-run or test deploys).
# ----------------------------------------------------------------------------
if [[ "${SKIP_IAM_AUDIT:-0}" != "1" ]]; then
  echo "==> Post-deploy IAM audit: checking allUsers invoker on HTTPS callables ..."
  export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.14}"

  IAM_FIXED=0
  IAM_SKIPPED=0
  IAM_ERRORS=0

  # Enumerate all v2 functions; skip event triggers (Firestore, Eventarc, etc.)
  while IFS= read -r fn_json; do
    [[ -z "$fn_json" ]] && continue
    # Parse: name (last segment), trigger type. Skip Eventarc/Firestore
    # triggers AND cron (onSchedule) triggers — neither should have
    # allUsers invoker. onSchedule functions don't appear in .eventTrigger
    # (that's a different field) so we explicitly check for the absence
    # of .httpsTrigger too. The Cloud Run URL still exists for cron
    # functions but only Cloud Scheduler should hit it.
    fn_name=$(echo "$fn_json" | jq -r '.name | split("/") | last')
    is_event_trigger=$(echo "$fn_json" | jq -r 'if .eventTrigger then "event" elif .httpsTrigger then "https" else "other" end')

    # Skip Eventarc/Firestore triggers AND cron (onSchedule) triggers
    if [[ "$is_event_trigger" != "https" ]]; then
      IAM_SKIPPED=$((IAM_SKIPPED + 1))
      continue
    fi

    # Cloud Run service name: same as function name but with hyphens for
    # any underscores, all lowercase. e.g.
    #   admin_deleteVendor  → admin-deletevendor
    #   submitSocialProof  → submitsocialproof
    #   admin_setDisabled  → admin-setdisabled
    cr_name=$(echo "$fn_name" | tr '_' '-' | tr '[:upper:]' '[:lower:]')

    # Check existing IAM for allUsers invoker
    HAS_ALL_USERS=$(gcloud run services get-iam-policy "$cr_name" \
      --region=us-central1 --project="$PROJECT" --format=json 2>/dev/null \
      | jq -r '[.bindings[]? | select(.role == "roles/run.invoker") | .members[]] | any(. == "allUsers")')

    if [[ "$HAS_ALL_USERS" == "true" ]]; then
      continue
    fi

    # Missing — self-heal
    echo "  🔧 $fn_name (CR: $cr_name) missing allUsers invoker — adding ..."
    if gcloud run services add-iam-policy-binding "$cr_name" \
        --region=us-central1 --project="$PROJECT" \
        --member=allUsers --role=roles/run.invoker >/dev/null 2>&1; then
      IAM_FIXED=$((IAM_FIXED + 1))
      echo "    ✓ fixed"
    else
      IAM_ERRORS=$((IAM_ERRORS + 1))
      echo "    ✗ failed (function may not exist yet — skip if just-deployed revision is still propagating)"
    fi
  done < <(gcloud functions list --v2 --regions=us-central1 \
              --project="$PROJECT" --format=json 2>/dev/null \
            | jq -c '.[]?')

  echo "==> IAM audit: $IAM_FIXED fixed, $IAM_SKIPPED event triggers (correctly skipped), $IAM_ERRORS errors"
fi

# ----------------------------------------------------------------------------
# Post-deploy IAM self-heal: just-deployed callables
# (2026-08-23, publishGuestExperience parallel-CREATE race).
#
# The broad sweep above (Post-deploy IAM audit) enumerates ALL v2
# functions in us-central1 and is the right long-term safety net.
# But for the just-deployed set, we explicitly self-heal even if
# propagation hasn't reached `gcloud functions list` yet — that's
# the race where firebase-tools drops an `allUsers →
# roles/run.invoker` binding during a parallel CREATE.
#
# Each iteration is wrapped in `set +e`/`set -e` so a single
# function's IAM failure does NOT abort the rest of the script.
#
# Uses CLOUDSDK_PYTHON so gcloud finds Python 3.14 (gcloud no
# longer supports the macOS Python 3.9 system default).
#
# Set SKIP_DEPLOYED_IAM=1 to opt out.
# ----------------------------------------------------------------------------
if [[ "${SKIP_DEPLOYED_IAM:-0}" != "1" ]]; then
  echo "==> Self-healing allUsers invoker on every callable this run deployed ..."
  export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.14}"

  # Build the target list.
  # - With CLI args, the just-deployed set is exactly "$@".
  # - Without CLI args (deploy-all), enumerate v2 HTTPS callables via
  #   the same `gcloud functions list --v2` source the broad audit
  #   uses, filtering out event triggers (those MUST NOT get allUsers).
  declare -a IAM_TARGETS=()
  if [[ $# -gt 0 ]]; then
    IAM_TARGETS=("$@")
  else
    while IFS= read -r fn; do
      [[ -n "$fn" ]] && IAM_TARGETS+=("$fn")
    done < <(gcloud functions list --v2 --regions=us-central1 \
                --project="$PROJECT" --format=json 2>/dev/null \
              | jq -r '.[] | select(.eventTrigger | not) | (.name | split("/") | last)')
  fi

  if [[ ${#IAM_TARGETS[@]} -eq 0 ]]; then
    echo "  (no callable targets discovered — nothing to self-heal)"
  else
    # `set +e` so a failing `add-iam-policy-binding` for one function
    # does NOT abort the rest of the loop (or the script).
    set +e
    for fn in "${IAM_TARGETS[@]}"; do
      [[ -z "$fn" ]] && continue

      # Cloud Run service name: lowercase, with underscores converted
      # to hyphens (Cloud Run rejects underscores in service names).
      #   publishGuestExperience → publishguestexperience
      #   admin_setDisabled      → admin-setdisabled
      cr_name=$(printf '%s' "$fn" | tr '_' '-' | tr '[:upper:]' '[:lower:]')

      # Check existing IAM. `get-iam-policy` may fail if the Cloud Run
      # service hasn't been observed yet (parallel-CREATE race) — treat
      # that as "not bound" and attempt the add.
      POLICY_JSON=$(gcloud run services get-iam-policy "$cr_name" \
          --region=us-central1 --project="$PROJECT" --format=json 2>/dev/null \
          || echo '{}')
      HAS_ALL_USERS=$(printf '%s' "$POLICY_JSON" | jq -r \
          '[.bindings[]? | select(.role == "roles/run.invoker") | .members[]] | any(. == "allUsers")')

      if [[ "$HAS_ALL_USERS" == "true" ]]; then
        echo "⏭ IAM: function $fn already bound"
        continue
      fi

      if gcloud run services add-iam-policy-binding "$cr_name" \
          --region=us-central1 --project="$PROJECT" \
          --member=allUsers --role=roles/run.invoker >/dev/null 2>&1; then
        echo "✅ IAM: function $fn bound to allUsers"
      else
        echo "❌ IAM: function $fn add-iam-policy-binding FAILED"
        echo "    (service may still be propagating from the parallel deploy — retry in ~30s if needed)"
      fi
    done
    set -e
  fi
fi

echo "==> Done."
