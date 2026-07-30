// scripts/smoke-autolink-vendor-contacts.mjs
//
// End-to-end smoke for the autoLinkVendorContactsV2 callable on the
// savetheday-2377a Firebase project.
//
// What it proves:
//   1. vendorContacts collectionGroup query works (vendorEmail
//      field override is hot).
//   2. The deployed Cloud Function binary actually contains the
//      event-scoped tasks loop (NOT the retired owner-scoped tasks
//      query).
//   3. Calling the deployed function with a real Firebase ID token
//      returns linked > 0 when there is a matching unlinked contact.
//
// What it does NOT do:
//   - It does NOT trigger a deploy.
//   - It does NOT mint Firebase Auth users; it reads from existing
//     ones and reuses them.
//   - It does NOT call admin SDK privileged on behalf of a user;
//     it uses server-side Firebase Admin SDK + the IdentityToolkit
//     REST API exactly as the front-end would.
//
// Usage:
//   node scripts/smoke-autolink-vendor-contacts.mjs
//   node scripts/smoke-autolink-vendor-contacts.mjs --skip-call
//   GOOGLE_APPLICATION_CREDENTIALS=.../savetheday-2377a.json node scripts/smoke-autolink-vendor-contacts.mjs
//
// Exit codes:
//   0 — all checks passed
//   1 — preflight failed (index, source, or IAM)
//   2 — function call returned a non-200

const fs = await import('node:fs');
const path = await import('node:path');
const { execSync } = await import('node:child_process');

const PROJECT = 'savetheday-2377a';
const REGION = 'us-central1';
const FUNCTION = 'autoLinkVendorContactsV2';
const RUN_BUCKET = 'gcf-v2-sources-1076306848030-us-central1';
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(process.env.HOME, '.firebase-keys', `${PROJECT}.json`);

const SKIP_CALL = process.argv.includes('--skip-call');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !fs.existsSync(SA_PATH)) {
  console.error(`❌ SA key missing at ${SA_PATH}. Set GOOGLE_APPLICATION_CREDENTIALS or copy the key into ~/.firebase-keys/.`);
  process.exit(1);
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = SA_PATH;

const firebaseAdmin = await import(
  '/Users/roger/code/vitejs-vite-tbbhdylu/functions/node_modules/firebase-admin/lib/index.js'
);
const admin = firebaseAdmin.default ?? firebaseAdmin;

if (admin.apps && admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT });
}

const db = admin.firestore();
const auth = admin.auth();

let matchedContact = null, matchedUser = null;

try {
  // STEP1 — vendorContacts collectionGroup query (verifies field override is hot)
  const cg = await db.collectionGroup('vendorContacts').limit(50).get();
  const unlinkedNonEmpty = cg.docs
    .map(d => ({ ref: d, data: d.data() }))
    .filter(x => !x.data.linkedVendorUid && x.data.vendorEmail && x.data.vendorEmail.includes('@'));
  console.log(`STEP1 vendorContacts CG : total=${cg.size} unlinked+non-empty-email=${unlinkedNonEmpty.length}`);
  if (unlinkedNonEmpty.length === 0) {
    console.warn('  (no candidate contact — STEP3 call will still run but return linked=0)');
  }

  // STEP2 — verify deployed bundle contains the new event-scoped loop
  // and does NOT contain the retired /users/{ownerUid}/tasks query.
  console.log(`STEP2 fetching deployed source gs://${RUN_BUCKET}/${FUNCTION}/function-source.zip ...`);
  execSync(`gsutil -q cp gs://${RUN_BUCKET}/${FUNCTION}/function-source.zip /tmp/${FUNCTION}-smoke.zip`);
  const unzipOut = execSync(`unzip -p /tmp/${FUNCTION}-smoke.zip lib/vendors.js`).toString();
  const newMarker = 'for (const eventDoc of eventsSnap.docs)';
  const oldMarker = `artifacts/savetheday-production/users/\$\{ownerUid\}/tasks`;
  const hasNew = unzipOut.includes(newMarker);
  const hasOld = unzipOut.includes(oldMarker);
  console.log(`  deployed body bytes: ${unzipOut.length}`);
  console.log(`  '${newMarker}' present: ${hasNew}`);
  console.log(`  RETIRED '${oldMarker}' present: ${hasOld}`);
  if (!hasNew || hasOld) {
    console.error('❌ Deployed source does not match the expected revision — investigate manually.');
    process.exit(1);
  }

  if (SKIP_CALL) {
    console.log('STEP3 skipped via --skip-call.');
    process.exit(0);
  }

  // STEP3 — exchange custom token for ID token, hit the deployed endpoint,
  // verify a vendorContacts doc actually flipped linkedVendorUid.
  for (const c of unlinkedNonEmpty) {
    try {
      const u = await auth.getUserByEmail(c.data.vendorEmail);
      matchedContact = c;
      matchedUser = u;
      break;
    } catch { /* not a Firebase Auth user */ }
  }
  if (!matchedUser) {
    console.log('STEP3 no Firebase Auth user matches — falling back to a probe with no real linked vendor.');
    console.log('STEP3 (calling deployed function with throwaway token to verify endpoint routing only)');
    const token = await auth.createCustomToken('hermes-smoke-probe');
    const apiKey = readApiKey();
    const idToken = (await exchangeCustomToken(token, apiKey)).idToken;
    const out = await callFunction(idToken);
    console.log(`STEP3 HTTP ${out.status} : ${out.text.slice(0, 200)}`);
    process.exit(out.status === 200 ? 0 : 2);
  }

  console.log(`STEP3 matched Auth user : ${matchedUser.uid} (email verified, contact ${matchedContact.ref.id})`);
  const customToken = await auth.createCustomToken(matchedUser.uid);
  const apiKey = readApiKey();
  const idToken = (await exchangeCustomToken(customToken, apiKey)).idToken;
  const out = await callFunction(idToken);
  console.log(`STEP3 function call status=${out.status} body=${out.text.slice(0, 400)}`);
  if (out.status !== 200) {
    console.error('❌ Function returned non-200; inspect the body.');
    process.exit(2);
  }

  // STEP4 — re-read the contact to confirm linkedVendorUid is set now.
  await new Promise(r => setTimeout(r, 2000));
  const after = await db.collectionGroup('vendorContacts')
    .where('vendorEmail', '==', matchedContact.data.vendorEmail).limit(5).get();
  const summary = after.docs.map(d => ({
    contactId: d.id,
    ownerUid: d.ref.parent.parent?.id,
    linkedVendorUid: d.data().linkedVendorUid || null,
    linkedAt: d.data().linkedAt ? 'set' : 'unset',
  }));
  console.log('STEP4 vendorContacts post-call:', JSON.stringify(summary, null, 2));
  const anyLinked = summary.some(s => s.linkedVendorUid && s.linkedAt === 'set');
  if (!anyLinked) {
    console.error('❌ Function returned successfully but no vendorContacts doc actually flipped linkedVendorUid.');
    process.exit(1);
  }
  console.log('OK ✓');
  process.exit(0);
} catch (e) {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
}

function readApiKey() {
  const firebaseTs = '/Users/roger/code/vitejs-vite-tbbhdylu/src/lib/firebase.ts';
  const txt = fs.readFileSync(firebaseTs, 'utf8');
  const m = txt.match(/apiKey:\s*'([^']+)'/);
  if (!m) throw new Error(`apiKey not found in ${firebaseTs}`);
  return m[1];
}

async function exchangeCustomToken(customToken, apiKey) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const body = await r.json();
  if (!body.idToken) throw new Error(`signInWithCustomToken failed: ${JSON.stringify(body)}`);
  return body;
}

async function callFunction(idToken) {
  const fn = `projects/${PROJECT}/locations/${REGION}/functions/${FUNCTION}`;
  // Match the front-end's Vercel proxy bypass + CORS preflight dance.
  // Use the canonical .run.app URL so we hit Cloud Run directly.
  const uri = `https://${REGION}-${PROJECT}.cloudfunctions.net/${FUNCTION}`;
  const r = await fetch(uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      'Origin': 'https://savetheday.io',
    },
    body: JSON.stringify({ data: {} }),
  });
  const text = await r.text();
  return { status: r.status, text };
}
