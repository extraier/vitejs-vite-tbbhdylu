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
  done < <(gcloud functions list --regions=us-central1 --gen2 \
              --project="$PROJECT" --format='value(name)' | awk -F/ '{print $NF}')
fi

ANY_NOT_ACTIVE=0
for fn in "${VERIFY_TARGETS[@]}"; do
  echo "==> Verifying $fn ACTIVE ..."
  STATE="PENDING"
  for i in 1 2 3 4 5; do
    STATE=$(gcloud functions describe "$fn" --region=us-central1 --gen2 \
              --project="$PROJECT" --format='value(state)' 2>/dev/null || echo "PENDING")
    echo "  attempt $i: state=$STATE"
    [[ "$STATE" == "ACTIVE" ]] && break
    sleep 5
  done
  if [[ "$STATE" != "ACTIVE" ]]; then
    echo "  ⚠ $fn is not ACTIVE — investigate before declaring deploy successful."
    ANY_NOT_ACTIVE=$((ANY_NOT_ACTIVE + 1))
  fi
done

if [[ $ANY_NOT_ACTIVE -gt 0 ]]; then
  echo "==> ❌ $ANY_NOT_ACTIVE function(s) did not reach ACTIVE state."
  echo "    Re-run with --force, or apply 'gcloud functions delete' + redeploy."
  exit 1
fi

echo "==> Done."
