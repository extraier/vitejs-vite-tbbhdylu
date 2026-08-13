
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: applicationDefault(),
});
const db = getFirestore();

(async () => {
  console.log('Starting backfill...');
  const snap = await db.collectionGroup('vendorContacts').get();
  console.log(`Found ${snap.size} vendorContacts docs`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let batch = db.batch();
  let batchSize = 0;
  const BATCH_LIMIT = 400;

  for (const doc of snap.docs) {
    const ownerUid = doc.ref.parent.parent && doc.ref.parent.parent.id;
    if (!ownerUid) {
      console.warn(`Skipping doc with no ownerUid in path: ${doc.ref.path}`);
      errors++;
      continue;
    }
    const current = doc.data().ownerUid;
    if (current === ownerUid) {
      skipped++;
      continue;
    }
    batch.update(doc.ref, { ownerUid });
    updated++;
    batchSize++;
    if (batchSize >= BATCH_LIMIT) {
      await batch.commit();
      console.log(`Committed batch of ${batchSize} (running total: ${updated})`);
      batch = db.batch();
      batchSize = 0;
    }
  }
  if (batchSize > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchSize}`);
  }

  console.log('--- Summary ---');
  console.log(`Total docs:    ${snap.size}`);
  console.log(`Updated:       ${updated}`);
  console.log(`Skipped (already correct): ${skipped}`);
  console.log(`Errors (no path ownerUid): ${errors}`);
  process.exit(0);
})().catch(err => {
  console.error('Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
