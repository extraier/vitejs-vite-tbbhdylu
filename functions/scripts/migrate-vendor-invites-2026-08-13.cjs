// scripts/migrate-vendor-invites-2026-08-13.cjs
//
// 2026-08-13 — C-01 one-shot migration. Runs after the rules change
// and the function deploy. Scans /vendors/{slug} for any docs that
// still carry the (now-banned) invitation fields, mirrors them into
// /vendorInvites/{slug}, then strips them from the public doc.
//
// Run modes:
//   node scripts/migrate-vendor-invites-2026-08-13.cjs --dry-run
//     Print what would change, but write nothing.
//   node scripts/migrate-vendor-invites-2026-08-13.cjs
//     Apply changes. Idempotent — re-running after a successful
//     migration is a no-op (no doc has those fields anymore).
//
// What it does, per slug:
//   1. Read /vendors/{slug}.
//   2. If no invitationToken → skip.
//   3. Write /vendorInvites/{slug} with {slug, invitationToken,
//      invitationExpiresAt, signupStatus, invitedAt?, invitedEmail?,
//      invitedBy?, source?: 'migrated_2026-08-13'}.
//   4. Update /vendors/{slug} with FieldValue.delete() for each
//      invitation field.
//   5. Record a single admin-side audit event in
//      /vendorMigrationLog/{slug} so we have a permanent record of
//      which docs were touched.
//
// Why also write /vendorMigrationLog/{slug}: the standard
// /vendors/{slug}/vendorActivationLogs is keyed per-vendor and not
// designed for migration events; we want a separate durable trail.
//
// NOTE: any vendor with signupStatus === 'claimed' is also processed
// (their /vendorInvites doc would be deleted on a successful claim,
// but stale 'claimed' docs in the wild have no functional effect —
// we still strip the fields for cleanliness).

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  '/Users/roger/.firebase-keys/savetheday-2377a.json';
const PROJECT_ID = 'savetheday-2377a';

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
});

const db = admin.firestore();

const INVITE_FIELDS = [
  'invitationToken',
  'invitationExpiresAt',
  'signupStatus',
  'invitedAt',
  'invitedEmail',
  'invitedBy',
  'claimedByUid',
  'claimedAt',
  'source',
];

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(
    `[migrate] ${dryRun ? 'DRY RUN — no writes' : 'LIVE — will write Firestore'} — project=${PROJECT_ID}`,
  );

  const vendorsSnap = await db.collection('vendors').get();
  console.log(`[migrate] scanned ${vendorsSnap.size} vendor docs`);

  let toProcess = 0;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const touched = [];

  for (const doc of vendorsSnap.docs) {
    const data = doc.data();
    if (!data || !data.invitationToken) {
      skipped++;
      continue;
    }
    toProcess++;
    const slug = doc.id;
    const invitePayload = {
      slug,
      invitationToken: data.invitationToken,
      invitationExpiresAt: data.invitationExpiresAt || null,
      signupStatus: data.signupStatus || 'invited',
      invitedAt: data.invitedAt || null,
      invitedEmail: data.invitedEmail ?? null,
      invitedBy: data.invitedBy ?? null,
      source: 'migrated_2026-08-13',
    };

    try {
      if (dryRun) {
        console.log(
          `[migrate] [DRY] would mirror /vendors/${slug} → /vendorInvites/${slug}`,
        );
      } else {
        // 1) Mirror into /vendorInvites/{slug} (merge — preserves any
        //    already-correct future doc if one was created concurrently).
        await db
          .collection('vendorInvites')
          .doc(slug)
          .set(invitePayload, { merge: true });

        // 2) Strip the fields from the public doc.
        const stripUpdate = {};
        for (const f of INVITE_FIELDS) stripUpdate[f] = admin.firestore.FieldValue.delete();
        await doc.ref.update(stripUpdate);

        // 3) Audit trail.
        await db.collection('vendorMigrationLog').doc(slug).set({
          slug,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          priorSignupStatus: data.signupStatus || null,
          priorInvitedEmail: data.invitedEmail || null,
          priorInvitedBy: data.invitedBy || null,
          // Intentionally do NOT persist the actual token here —
          // audit trail should not echo the secret it just moved.
        });

        touched.push(slug);
        console.log(
          `[migrate] ✅ mirrored + stripped /vendors/${slug} (signupStatus=${data.signupStatus})`,
        );
      }
      processed++;
    } catch (e) {
      errors++;
      console.error(`[migrate] ❌ ${slug}: ${e.message}`);
    }
  }

  console.log('--- summary ---');
  console.log(`scanned: ${vendorsSnap.size}`);
  console.log(`skipped (no token): ${skipped}`);
  console.log(`processed: ${processed} (dryRun=${dryRun})`);
  console.log(`errors: ${errors}`);
  if (touched.length) {
    console.log(`touched slugs: ${touched.slice(0, 25).join(', ')}${touched.length > 25 ? ' …' : ''}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
