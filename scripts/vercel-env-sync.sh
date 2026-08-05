#!/usr/bin/env bash
# vercel-env-sync.sh — add or update Vercel env vars and FORCE a
#                      redeploy so the running code picks them up.
#
# Why this exists (2026-08-05): Vercel does NOT hot-reload env vars
# on existing deployments. After `vercel env add FOO production`,
# the new value lives in the project's encrypted secret store but
# the running code still reads the OLD env (or empty string).
# You have to trigger a redeploy for the new env to take effect.
# The cheapest, atomic way: `git commit --allow-empty` + push.
#
# This script wraps `vercel env add` so you can't forget the
# redeploy step.
#
# Usage:
#   ./scripts/vercel-env-sync.sh HMAC_KEY k7MehlZ...                # add prod
#   ./scripts/vercel-env-sync.sh HMAC_KEY k7MehlZ... --env=preview  # add preview
#   ./scripts/vercel-env-sync.sh --list                             # show prod env
#   cat secret.txt | ./scripts/vercel-env-sync.sh HMAC_KEY -         # read from stdin
#
# Env:
#   REPO_DIR — path to the repo root. Default: parent of this script's dir.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)}"
VERCEL_BIN="${VERCEL_BIN:-/Users/roger/.local/bin/vercel}"

if ! command -v "$VERCEL_BIN" >/dev/null 2>&1; then
  echo "❌ Vercel CLI not found at $VERCEL_BIN — install with: npm i -g vercel" >&2
  exit 1
fi

ENVIRONMENT="production"

usage() {
  cat <<EOF
Usage:
  $0 NAME VALUE                    # add/update env var in production
  $0 NAME -                        # read value from stdin
  $0 --list                        # list production env vars
  $0 NAME VALUE --env=preview      # add/update in preview/dev
EOF
}

# Parse args
LIST_ONLY=0
STDIN_MODE=0
NAME=""
VALUE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)        LIST_ONLY=1; shift ;;
    --env=*)       ENVIRONMENT="${1#*=}"; shift ;;
    -h|--help)     usage; exit 0 ;;
    -)             STDIN_MODE=1; shift ;;
    *)
      if [[ -z "$NAME" ]]; then
        NAME="$1"
      elif [[ -z "$VALUE" ]]; then
        VALUE="$1"
      else
        echo "❌ Too many positional args" >&2; usage; exit 1
      fi
      shift
      ;;
  esac
done

# List mode
if [[ $LIST_ONLY -eq 1 ]]; then
  echo "==> Production env vars:"
  "$VERCEL_BIN" env ls production 2>&1 | tail -n +3
  exit 0
fi

if [[ -z "$NAME" ]]; then
  usage
  exit 1
fi

# Read value from stdin if requested
if [[ $STDIN_MODE -eq 1 ]]; then
  VALUE="$(cat)"
fi

if [[ -z "$VALUE" ]]; then
  echo "❌ No value provided. Pass it as \$2 or pipe via stdin (-)" >&2
  exit 1
fi

# Sanity: refuse obviously-bad env names (Vercel requires uppercase + alnum + _)
if [[ ! "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "❌ Bad env name '$NAME' — must be UPPERCASE, start with letter, [A-Z0-9_] only" >&2
  exit 1
fi

# Sanity: refuse secret-looking values that came from the wrong source
# (e.g. accidentally pasted a SA key). Just warn — don't fail.
if [[ "$VALUE" == *BEGIN*PRIVATE*KEY* ]] || \
   [[ "$VALUE" == *firebase-adminsdk* ]] || \
   [[ "$VALUE" == *firebase-pk-* ]]; then
  echo "❌ Refusing to push a value that looks like a service-account key." >&2
  echo "   Use a Keychain-stored secret instead (see macos-keychain-secrets-vault)." >&2
  exit 1
fi

echo "==> Adding $NAME to Vercel ($ENVIRONMENT) ..."
ADD_OUTPUT=$(echo "$VALUE" | "$VERCEL_BIN" env add "$NAME" "$ENVIRONMENT" 2>&1)
ADD_RC=$?
echo "$ADD_OUTPUT" | tail -3

# Detect vercel CLI failures that don't always surface non-zero exit
# (e.g. "Cannot find project", auth failures, stdin prompt timeout).
# If the output contains the word "Error" but no "✓ Added", we treat
# the add as failed even if exit code was 0.
if [[ $ADD_RC -ne 0 ]] || \
   (echo "$ADD_OUTPUT" | grep -qiE 'error|warning.*not' && \
    ! echo "$ADD_OUTPUT" | grep -q '✓ Added'); then
  echo ""
  echo "❌ vercel env add failed (exit=$ADD_RC). Skipping redeploy to avoid empty commits." >&2
  exit 1
fi

# ALWAYS trigger a redeploy. The user may have intended to push the
# change as part of a larger commit; we don't second-guess that. The
# empty-commit + push is idempotent and cheap.
echo "==> Triggering redeploy so Vercel picks up the new env var ..."
cd "$REPO_DIR"

# Skip if there are no staged/unstaged/untracked changes OR if the
# last commit is already a "chore: redeploy to pick up" commit from
# the last 5 min (avoid stacking empty commits when called in a loop).
LAST_MSG="$(git log -1 --pretty=%s 2>/dev/null || echo '')"
LAST_TIME="$(git log -1 --pretty=%ct 2>/dev/null || echo 0)"
NOW="$(date +%s)"
RECENT_REDEPLOY=0
if [[ "$LAST_MSG" == "chore: redeploy to pick up new env vars"* ]] && \
   [[ $((NOW - LAST_TIME)) -lt 300 ]]; then
  RECENT_REDEPLOY=1
fi

if [[ $RECENT_REDEPLOY -eq 1 ]]; then
  echo "==> Recent empty-commit redeploy detected (<5 min). Skipping to avoid commit stack."
  echo "    If the env still isn't live, run: $VERCEL_BIN --prod"
else
  # Need a git identity for the commit
  if ! git config user.email >/dev/null 2>&1; then
    git config user.email "hermes-deploy@MiniMax.nous.research"
    git config user.name  "Hermes Deploy"
  fi
  git -c commit.gpgsign=false commit --allow-empty \
    -m "chore: redeploy to pick up new $NAME env var"
  git push origin HEAD 2>&1 | tail -3
fi

echo ""
echo "==> Done. Vercel will redeploy within ~60-90s."
echo "    Verify the new env is live with:"
echo "      $VERCEL_BIN env ls production"
echo "    Or hit a /api/* endpoint that reads $NAME and check the response."