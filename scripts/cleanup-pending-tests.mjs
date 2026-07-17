// One-off cleanup — remove the 4 'pending' test vendors from the
// Firestore /vendors collection that were created by earlier curl
// experiments. We delete (rather than flip to approved) since they
// have no real portfolio data and would distract curated browsing.
//
// Idempotent: re-running is safe — non-existent doc deletes no-op.
// run with:
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/savetheday-sa.json \
//     node scripts/cleanup-pending-tests.mjs

import admin from '../functions/node_modules/firebase-admin/lib/index.js';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(saPath) });
const db = admin.firestore();

const ids = [
  '0GmSzhD7HrZQdqjC41BtnBWlZE22', // Test Vendor From Curl
  'DpoMEAoEA8QGayWN3aH4aZPZecw1', // Test
  'QtM4yG8wGLOgnC7CDXuvuGVwKAk2', // Test Subcategory Vendor
  'rWRuDdE22bMhAEMHmRCCN5uyK0J3', // Test Subcategory Vendor 2
];

let deleted = 0;
for (const id of ids) {
  try {
    await db.collection('vendors').doc(id).delete();
    deleted += 1;
    console.log(`[cleanup] deleted ${id}`);
  } catch (e) {
    console.error(`[cleanup] failed on ${id}:`, e?.message || e);
  }
}
console.log(`[cleanup] done: ${deleted}/${ids.length} removed`);
process.exit(0);
