#!/usr/bin/env bash
# One-shot deploy for the 電子人情 storage rule + functions retry.
#
# Run this in a fresh terminal after `firebase login`:
#   cd /Users/roger/projects/vitejs-vite-tbbhdylu
#   ./scripts/deploy-redpacket-rules.sh
#
# The deploy-rules.sh script in this same directory does all of
# this PLUS the emulator-based test. This file is the "minimum
# viable" deploy when the emulator test would just be skipped
# locally because Java isn't installed.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3 Deploy Storage rules (so QR image uploads work)..."
firebase deploy --only storage --project savetheday-2377a

echo ""
echo "==> 2/3 Retry Cloud Functions deploy (--force avoids 409 races)..."
firebase deploy --only functions --force --project savetheday-2377a

echo ""
echo "==> 3/3 Confirm everything is live..."
firebase firestore:rules:get --project savetheday-2377a > /tmp/firestore-rules-current.txt
if grep -q "match /redPackets" /tmp/firestore-rules-current.txt; then
  echo "✅ Firestore redPackets rule is live"
else
  echo "⚠️  Firestore redPackets rule NOT FOUND in deployed rules"
  echo "   Re-run: firebase deploy --only firestore:rules --project savetheday-2377a"
fi

echo ""
echo "==> Done. Hard-refresh the browser and the 電子人情 tab should work."
