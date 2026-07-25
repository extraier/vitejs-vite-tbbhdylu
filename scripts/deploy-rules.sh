#!/usr/bin/env bash
# Deploy Firestore + Storage rules + Cloud Functions to production.
#
# Prerequisites:
#   npm install -g firebase-tools
#   firebase login
#   firebase use savetheday-2377a
#   firebase functions:secrets:set LINK_SECRET   # paste the same secret
#                                                  # used by the photo_upload_server.py HMAC
#
# This script NEVER touches the photo_upload_server.py or Vercel deploy —
# those are managed by separate pipelines.
#
# 2026-07-24 — added storage deploy. Previously the script only
# deployed firestore:rules, but new features (e.g. 電子人情 QR codes)
# also need storage rules. Both deployments are safe to re-run;
# they only push deltas.
#
# 2026-07-24 — fixed the local rules-test path. Was
# `node scripts/test-firestore-rules.js` but the file is .cjs.
# Without the fix, every deploy ended with a confusing
# "MODULE_NOT_FOUND" error and a `0/0 passed, 0 failed` report
# that hid whether the deploy actually succeeded.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Deploying Firestore rules..."
firebase deploy --only firestore:rules --project savetheday-2377a

echo "==> Deploying Storage rules..."
firebase deploy --only storage --project savetheday-2377a

echo "==> Deploying Cloud Functions (issueGuestLink, redeemGuestLink, revokeGuestLink)..."
cd functions
npm ci
npm run build
cd ..

# 2026-07-24 — use --force to work around the Cloud Functions v2
# 409 "unable to queue the operation" race when multiple functions
# are being updated simultaneously. The --force flag serializes the
# updates server-side.
firebase deploy --only functions --force --project savetheday-2377a

echo "==> Running rules tests against emulator..."
# 2026-07-24 — the local emulator requires Java 11+ on the PATH.
# If you're on macOS: `brew install openjdk@11` (or `@17`). The
# test step is informational only — Firebase already compiled and
# deployed the rules before this — so a missing Java runtime just
# skips the test, it does NOT fail the deploy.
if command -v java >/dev/null 2>&1; then
  firebase emulators:exec --only firestore \
    "node scripts/test-firestore-rules.cjs" \
    --project savetheday-2377a
else
  echo "::warning::java not found on PATH — skipping local rules test."
  echo "  Install with: brew install openjdk@11"
  echo "  Then re-run: firebase emulators:exec --only firestore \\"
  echo "    \"node scripts/test-firestore-rules.cjs\""
fi

echo "==> Done."
