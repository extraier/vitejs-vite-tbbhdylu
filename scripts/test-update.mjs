// One-off debug — read the v0001 vendor doc and print its current state.
// Used during vendor-profile refactors to confirm subcategory hasn't drifted.
// run with:
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/savetheday-sa.json \
//     node scripts/test-update.mjs

import admin from '../functions/node_modules/firebase-admin/lib/index.js';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(saPath) });
const db = admin.firestore();
// Reset v0001 to its original canonical subcategory
const ref = db.collection('vendors').doc('v0001_visionary_capture');
const snap = await ref.get();
console.log('BEFORE:', JSON.stringify(snap.data(), null, 2));
process.exit(0);
