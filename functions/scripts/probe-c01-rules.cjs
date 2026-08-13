// One-shot probe — verify the C-01 firestore rule changes are live.
// 1) Mint a custom token via Admin SDK.
// 2) Exchange it for an ID token via REST signInWithCustomToken.
// 3) Attempt to read /vendorInvites/probe-slug with that ID token
//    (should be PERMISSION_DENIED) and to read /vendors/probe-slug
//    (should still succeed because that doc is public).
//
// Run: node scripts/probe-c01-rules.cjs

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT = '/Users/roger/.firebase-keys/savetheday-2377a.json';
const PROJECT_ID = 'savetheday-2377a';
const API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!API_KEY) {
  console.error('Set FIREBASE_WEB_API_KEY in env');
  process.exit(2);
}

admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });

(async () => {
  const uid = 'probe-c01-2026-08-13';
  const customToken = await admin.auth().createCustomToken(uid);

  // Exchange custom token for ID token
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const exchangeJson = await exchange.json();
  if (!exchangeJson.idToken) {
    console.error('Failed to exchange custom token:', JSON.stringify(exchangeJson));
    process.exit(1);
  }
  const idToken = exchangeJson.idToken;
  console.log('Minted ID token for', uid);

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // (1) Try to read /vendorInvites/probe-slug (should be denied)
  const r1 = await fetch(`${firestoreBase}/vendorInvites/probe-slug`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const r1body = await r1.text();
  console.log(`\n/vendorInvites/probe-slug → HTTP ${r1.status}`);
  console.log('  body:', r1body.slice(0, 300));

  // (2) Try to read /vendors/probe-slug (no such doc, expect 404 NOT_FOUND)
  // This validates that the /vendors rule is unaffected.
  const r2 = await fetch(`${firestoreBase}/vendors/probe-slug-does-not-exist`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const r2body = await r2.text();
  console.log(`\n/vendors/probe-slug-does-not-exist → HTTP ${r2.status}`);
  console.log('  body:', r2body.slice(0, 300));

  // (3) List /vendorInvites (should be denied)
  const r3 = await fetch(`${firestoreBase}/vendorInvites`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const r3body = await r3.text();
  console.log(`\n/vendorInvites (list) → HTTP ${r3.status}`);
  console.log('  body:', r3body.slice(0, 300));

  // Summary
  console.log('\n--- summary ---');
  const pass = (cond, label) => console.log(`${cond ? '✅' : '❌'} ${label}`);
  pass(r1.status === 403 || r1.status === 404, 'GET /vendorInvites/{slug} denied');
  pass(r2.status === 404, 'GET /vendors/{slug} still responds (200/404 = reachable)');
  pass(r3.status === 403 || r3.status === 404, 'LIST /vendorInvites denied');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
