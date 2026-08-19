#!/usr/bin/env node
// 2026-08-19 — SDK-based smoke test for the P1.4.a deploy.
// Uses the real Firebase JS SDK (not curl) to authenticate as a real
// user and call each of the 5 deployed functions. This is what the
// frontend does in production (minus the Vercel proxy hop — the SDK
// path goes directly to Cloud Functions, which is what the proxy
// does on the server side anyway).
//
// Requires:
//   - functions/node_modules/firebase + firebase-admin installed
//   - ~/.firebase-keys/savetheday-2377a.json readable

const fs = require('node:fs');

const SA_PATH = '/Users/roger/.firebase-keys/savetheday-2377a.json';
const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const fb = fs.readFileSync(
  '/Users/roger/projects/vitejs-vite-tbbhdylu/src/lib/firebase.ts',
  'utf8'
);
const apiKey = fb.match(/apiKey:\s*["']([^"']+)["']/)[1];

// Resolve firebase + firebase-admin from functions/node_modules regardless
// of where the script is invoked from. (The script lives in scripts/ but
// the deps live in functions/node_modules for the Cloud Functions runtime.)
const FUNCTIONS_NODE_MODULES = '/Users/roger/projects/vitejs-vite-tbbhdylu/functions/node_modules';
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_NODE_MODULES] }));
const { initializeApp } = require(require.resolve('firebase/app', { paths: [FUNCTIONS_NODE_MODULES] }));
const { getAuth, signInWithCustomToken } = require(require.resolve('firebase/auth', { paths: [FUNCTIONS_NODE_MODULES] }));
const { getFunctions, httpsCallable } = require(require.resolve('firebase/functions', { paths: [FUNCTIONS_NODE_MODULES] }));

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });

const TEST_UID = '0ODvTD1gZvXamZnR2KLKuWLwre63';
const TEST_EVENT_ID = 'TF9yalLdcR4INx8cKduA';

(async () => {
  const app = initializeApp({ apiKey, projectId: 'savetheday-2377a' }, 'smoke');
  const auth = getAuth(app);
  const custom = await admin.auth().createCustomToken(TEST_UID, { probe: true });
  const cred = await signInWithCustomToken(auth, custom);
  console.log(`Signed in: ${cred.user.uid}\n`);

  const fns = getFunctions(app, 'us-central1');
  let pass = 0, fail = 0;

  async function call(name, data) {
    try {
      const fn = httpsCallable(fns, name);
      const r = await fn(data || {});
      return { ok: true, data: r.data };
    } catch (e) {
      return { ok: false, code: e.code, msg: e.message };
    }
  }

  // 1) getEventEntitlement
  let r = await call('getEventEntitlement', { eventId: TEST_EVENT_ID });
  const hint1 = r.ok ? JSON.stringify(r.data).slice(0, 200) : `${r.code}: ${r.msg}`;
  console.log(`${r.ok ? '✓' : '✗'} getEventEntitlement: ${hint1}`);
  if (r.ok) pass++; else fail++;

  // 2) getUploadPreferencesToken
  r = await call('getUploadPreferencesToken', { ownerUid: TEST_UID, eventId: TEST_EVENT_ID });
  const ok2 = r.ok && typeof r.data?.token === 'string'
    && typeof r.data?.storageQuotaBytes === 'number'
    && r.data.storageQuotaBytes > 0;
  const hint2 = r.ok
    ? `quota=${r.data.storageQuotaBytes} used=${r.data.storageUsageBytes}`
    : `${r.code}: ${r.msg}`;
  console.log(`${ok2 ? '✓' : '✗'} getUploadPreferencesToken: ${hint2}`);
  if (ok2) pass++; else fail++;

  // 3) listPaymentReceipts
  r = await call('listPaymentReceipts', undefined);
  const ok3 = r.ok && Array.isArray(r.data);
  const hint3 = r.ok ? `count=${r.data.length}` : `${r.code}: ${r.msg}`;
  console.log(`${ok3 ? '✓' : '✗'} listPaymentReceipts: ${hint3}`);
  if (ok3) pass++; else fail++;

  // 4) submitPaymentReceipt — mismatched amount must be rejected.
  // Need the right sku name and feature. Look up UNLOCK_TYPES.
  r = await call('submitPaymentReceipt', {
    ownerUid: TEST_UID,
    eventId: TEST_EVENT_ID,
    unlockType: 'watermark-removed',
    amount: 1, // intentionally wrong — UNLOCK_PRICING watermark-removed is much larger
    paymentMethod: 'payme',
  });
  const ok4 = !r.ok && (r.code === 'functions/failed-precondition'
    || (r.msg || '').toLowerCase().includes('price')
    || (r.msg || '').toLowerCase().includes('amount'));
  const hint4 = r.ok ? 'WRONGLY ACCEPTED' : `${r.code}: ${(r.msg || '').slice(0, 80)}`;
  console.log(`${ok4 ? '✓' : '✗'} submitPaymentReceipt rejects price mismatch: ${hint4}`);
  if (ok4) pass++; else fail++;

  // 5) recordUploadBytesUsed
  r = await call('recordUploadBytesUsed', { ownerUid: TEST_UID, eventId: TEST_EVENT_ID, addBytes: 1024 * 1024 });
  const ok5 = r.ok;
  const hint5 = r.ok ? JSON.stringify(r.data).slice(0, 150) : `${r.code}: ${r.msg}`;
  console.log(`${ok5 ? '✓' : '✗'} recordUploadBytesUsed: ${hint5}`);
  if (ok5) pass++; else fail++;

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});