#!/usr/bin/env bash
# Deploy Firestore rules + Cloud Functions to production.
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

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Deploying Firestore rules..."
firebase deploy --only firestore:rules

echo "==> Deploying Cloud Functions (issueGuestLink, redeemGuestLink, revokeGuestLink)..."
cd functions
npm ci
npm run build
cd ..
firebase deploy --only functions

echo "==> Running rules tests against emulator..."
firebase emulators:exec --only firestore "node scripts/test-firestore-rules.js"

echo "==> Done."