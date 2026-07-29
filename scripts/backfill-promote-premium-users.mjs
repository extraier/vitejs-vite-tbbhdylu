// One-shot backfill — promote every user who already has any unlock
// to tier='premium'. Mirrors the auto-promotion that
// grantUnlock() now performs (Phase 4 of premium-user-build).
//
// Idempotent: re-running is safe (writes the same field).
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./secrets/sa.json \
//     node scripts/backfill-promote-premium-users.mjs \
//     --project=savetheday-2377a [--dry-run]

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const project = (() => {
  const hit = [...args].find((a) => a.startsWith('--project='));
  return hit ? hit.split('=')[1] : process.env.GCP_PROJECT_ID || 'savetheday-2377a';
})();

// ---- Service account resolution ----
// Match the cleanup-pending-tests.mjs pattern: read from
// GOOGLE_APPLICATION_CREDENTIALS env var, never hardcode absolute paths.
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error(
    '[backfill] GOOGLE_APPLICATION_CREDENTIALS env var is not set.\n' +
    '  Set it to your service account JSON, e.g.:\n' +
    '  export GOOGLE_APPLICATION_CREDENTIALS=./secrets/savetheday-2377a-firebase-adminsdk.json',
  );
  process.exit(1);
}
const absPath = resolve(saPath);
if (!existsSync(absPath)) {
  console.error(`[backfill] Service account file not found: ${absPath}`);
  process.exit(1);
}

initializeApp({
  credential: applicationDefault(),
  projectId: project,
});
const db = getFirestore();

const USERS = 'users';
const batchSize = 200;

async function backfill() {
  console.log(`[backfill] project=${project} dryRun=${dryRun}`);
  let scanned = 0;
  let promoted = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchCount = 0;

  // 1. Scan all users
  const usersSnap = await db.collectionGroup('unlocks').get().catch(() => null);
  // collectionGroup query above gives us each unlock doc; better
  // to walk per-user because we need the parent uid doc anyway.
  const allUsers = await db.collection(USERS).listDocuments();
  console.log(`[backfill] scanning ${allUsers.length} user docs...`);

  for (const userDocRef of allUsers) {
    scanned++;
    const unlocksSnap = await userDocRef.collection('unlocks').limit(1).get();
    if (unlocksSnap.empty) {
      skipped++;
      continue;
    }
    const userDoc = await userDocRef.get();
    const existingTier = userDoc.exists ? userDoc.get('tier') : null;
    if (existingTier === 'premium') {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[backfill] [dry-run] would promote ${userDocRef.id} (currently tier=${existingTier})`);
      promoted++;
      continue;
    }

    batch.set(
      userDocRef,
      { tier: 'premium', promotedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    batchCount++;
    promoted++;

    if (batchCount >= batchSize) {
      await batch.commit();
      console.log(`[backfill] committed ${batchCount} promotions (scanned ${scanned})`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0 && !dryRun) {
    await batch.commit();
    console.log(`[backfill] committed final ${batchCount} promotions`);
  }

  console.log(`[backfill] done — scanned=${scanned} promoted=${promoted} skipped=${skipped}`);
}

backfill().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
