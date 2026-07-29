// One-shot backfill — assign a referralCode to every existing user
// doc that doesn't have one. Idempotent: re-running is safe.
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./secrets/sa.json \
//     node scripts/backfill-referral-codes.mjs
//
// Optional flags:
//   --dry-run    Print what would happen without writing.
//   --limit=N    Only process N users (for spot-checks).

import admin from '../functions/node_modules/firebase-admin/lib/index.js';
import crypto from 'crypto';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON.');
  process.exit(1);
}

const appId = 'savetheday-production';
const REFERRAL_PREFIX = 'STD';
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LEN = 5;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

function generateReferralCode() {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LEN);
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    out += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return `${REFERRAL_PREFIX}-${out}`;
}

admin.initializeApp({ credential: admin.credential.cert(saPath) });
const db = admin.firestore();

async function isUnique(code) {
  const dupes = await db
    .collection('artifacts').doc(appId)
    .collection('users')
    .where('referralCode', '==', code)
    .limit(1)
    .get();
  return dupes.empty;
}

async function mintUnique() {
  for (let i = 0; i < 10; i++) {
    const candidate = generateReferralCode();
    if (await isUnique(candidate)) return candidate;
  }
  throw new Error('Could not generate unique code after 10 tries');
}

(async () => {
  console.log(`[backfill] project=${admin.instanceId().appId || 'unknown'} appId=${appId}`);
  console.log(`[backfill] mode=${dryRun ? 'dry-run' : 'live'} limit=${limit === Infinity ? 'none' : limit}`);

  const usersSnap = await db
    .collection('artifacts').doc(appId)
    .collection('users')
    .get();

  let scanned = 0;
  let skipped = 0;
  let written = 0;
  let failed = 0;

  for (const userDoc of usersSnap.docs) {
    if (scanned >= limit) break;
    scanned++;
    const data = userDoc.data() || {};
    if (data.referralCode) {
      skipped++;
      continue;
    }
    try {
      const code = await mintUnique();
      if (dryRun) {
        console.log(`  [dry-run] ${userDoc.id} ← ${code}`);
      } else {
        await userDoc.ref.set(
          { referralCode: code, referralCodeCreatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
        written++;
        console.log(`  ${userDoc.id} ← ${code}`);
      }
    } catch (e) {
      failed++;
      console.error(`  ✗ ${userDoc.id}: ${e.message}`);
    }
  }

  console.log(`\n[backfill] DONE — scanned=${scanned} skipped(already had code)=${skipped} written=${written} failed=${failed}`);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});