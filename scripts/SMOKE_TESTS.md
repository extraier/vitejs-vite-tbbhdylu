# Smoke tests

This directory contains smoke tests that exercise the deployed Firebase
Functions + Vercel proxy against production. These are NOT unit tests —
they hit the real live endpoints and require:

1. `~/.firebase-keys/savetheday-2377a.json` (Firebase admin SDK key)
2. `src/lib/firebase.ts` to exist (for the Web API key)
3. The functions to be deployed (`firebase deploy --only functions`)
4. The Vercel proxy to be deployed (`vercel deploy --prod`)

## Usage

```bash
# Run from the project root (npm script not needed; Node module
# resolution requires running from a dir that has functions/node_modules)
cd functions
node ../scripts/_smoke-p1-4-a.cjs
```

Tests:
1. `getEventEntitlement` — full entitlement shape for FREE-tier event
2. `getUploadPreferencesToken` — quota fields present (200 MiB free)
3. `listPaymentReceipts` — empty array for new test user
4. `submitPaymentReceipt` — price-derivation rejection with mismatched amount
5. `recordUploadBytesUsed` — atomic counter increment

Test fixtures:
- UID: `0ODvTD1gZvXamZnR2KLKuWLwre63` (real test couple from Firestore)
- Event: `TF9yalLdcR4INx8cKduA` (their test event, tier=free)

If the fixture user/event is ever deleted from Firestore, update
`TEST_UID` + `TEST_EVENT_ID` at the top of the script.
