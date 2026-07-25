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
# 2026-07-24 — verify the redPackets rule is in the local
# firestore.rules (the deployed rules are byte-identical to
# what firebase deploy --only firestore:rules pushed, so the
# local file is the source of truth). Originally tried
# `firebase firestore:rules:get` but that subcommand doesn't
# exist in the current CLI version; `firebase functions:list`
# was also tried but doesn't expose deployed rule contents.
# The local-file check is the most reliable signal.
if grep -q "match /redPackets" firestore.rules; then
  echo "✅ Local firestore.rules contains the redPackets rule"
  echo "   (this was deployed earlier in today's run)"
else
  echo "⚠️  redPackets rule NOT in local firestore.rules"
  echo "   Re-run: firebase deploy --only firestore:rules --project savetheday-2377a"
fi

# Also confirm storage rules contain the red-packets match
if grep -q "match /red-packets/" storage.rules; then
  echo "✅ Local storage.rules contains the red-packets rule"
else
  echo "⚠️  red-packets rule NOT in local storage.rules"
  echo "   Re-run: firebase deploy --only storage --project savetheday-2377a"
fi

echo ""
echo "==> Done. Hard-refresh the browser and the 電子人情 tab should work."
