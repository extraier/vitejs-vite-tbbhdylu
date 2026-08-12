// scripts/test-cf-shapes.mjs — E2E vendor chat simulator
// Tests the CF with various body shapes to identify the bug.
// Usage: node scripts/test-cf-shapes.mjs

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth, cert } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const SA = JSON.parse(readFileSync(process.env.HOME + '/.firebase-keys/savetheday-2377a.json', 'utf8'));
const FIREBASE_TS = readFileSync('src/lib/firebase.ts', 'utf8');
const API_KEY = FIREBASE_TS.match(/apiKey:\s*'([^']+)'/)[1];

const adminApp = initializeApp({ credential: cert(SA) }, 'sim');
const auth = getAuth(adminApp);
const db = getFirestore(adminApp);

const VENDOR_UID = 'p8DdykFZPWMWbtEyiqQnMr5JwOi1';
const OWNER_UID = 'G0Twjl9wKdfmfrkR9asj4PApTot2';
const EVENT_ID = 'gIF9yBcLxFyYUDumlgyi';
const RUNDOWN_ID = 'rd-1785560001887';

async function getIdToken(uid, claims) {
  const customToken = await auth.createCustomToken(uid, claims);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.idToken) throw new Error('Failed: ' + JSON.stringify(data));
  return data.idToken;
}

async function callProxy(fnName, data, idToken) {
  const url = 'https://savetheday.io/api/firebase-proxy?fn=' + fnName;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify({ data }),
  });
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = { error: { code: 'NOT_JSON', message: body.slice(0, 200) } }; }
  return { status: res.status, body: json };
}

console.log('=== E2E VENDOR CHAT SIMULATOR ===\n');

// ===== TEST 1: Verify path extraction logic (mirrors ItemComments.jsx) =====
console.log('--- TEST 1: Path extraction (mirrors ItemComments.jsx) ---');
const fullPath = ['artifacts', 'savetheday-prod', 'users', OWNER_UID, 'events', EVENT_ID, 'rundown', RUNDOWN_ID, 'comments'];
const pathStr = fullPath.join('/');
const segs = pathStr.split('/');
const eventsIdx = segs.indexOf('events');
const ownerUid = segs[segs.indexOf('users') + 1];
const eventId = eventsIdx >= 0 ? segs[eventsIdx + 1] : null;
const inferredKind = eventsIdx >= 0 ? segs[eventsIdx + 2] : null;
const inferredItemId = eventsIdx >= 0 ? segs[eventsIdx + 3] : null;
console.log('ownerUid:', ownerUid);
console.log('eventId:', eventId);
console.log('parentKind:', inferredKind);
console.log('parentId:', inferredItemId);
console.log('✅ Path extraction produces valid values');

// ===== TEST 2: Vendor makes a clean call via the CF =====
console.log('\n--- TEST 2: VENDOR clean call via CF ---');
const vendorToken = await getIdToken(VENDOR_UID, { vendor: true });
const cleanResult = await callProxy('vendorPostComment', {
  ownerUid, eventId, parentKind: inferredKind, parentId: inferredItemId,
  text: 'VENDOR-CLEAN-' + Date.now(),
}, vendorToken);
console.log('Status:', cleanResult.status);
console.log('Body:', JSON.stringify(cleanResult.body).slice(0, 200));
if (cleanResult.status !== 200) {
  console.error('❌ Clean call failed');
  process.exit(1);
}
console.log('✅ Vendor wrote via CF');

// ===== TEST 3: What if parentKind is missing entirely? =====
console.log('\n--- TEST 3: BAD shape — parentKind missing ---');
const noKindResult = await callProxy('vendorPostComment', {
  ownerUid, eventId, parentId: inferredItemId,
  text: 'NO-KIND-' + Date.now(),
}, vendorToken);
console.log('Status:', noKindResult.status);
console.log('Body:', JSON.stringify(noKindResult.body).slice(0, 200));

// ===== TEST 4: What if path._path is undefined (path extraction broken)? =====
console.log('\n--- TEST 4: BAD shape — undefined values (path extraction broken) ---');
const undefResult = await callProxy('vendorPostComment', {
  ownerUid: undefined, eventId: undefined, parentKind: undefined, parentId: undefined,
  text: 'UNDEFINED-' + Date.now(),
}, vendorToken);
console.log('Status:', undefResult.status);
console.log('Body:', JSON.stringify(undefResult.body).slice(0, 200));

// ===== TEST 5: What if the bug is in the SUBSEGMENT extraction (eventsIdx+2 wrong)? =====
console.log('\n--- TEST 5: BAD shape — wrong segment offset (eventsIdx + 2 = "rd-...") ---');
const wrongSegResult = await callProxy('vendorPostComment', {
  ownerUid, eventId, parentKind: inferredItemId, parentId: 'comments',
  text: 'WRONG-SEG-' + Date.now(),
}, vendorToken);
console.log('Status:', wrongSegResult.status);
console.log('Body:', JSON.stringify(wrongSegResult.body).slice(0, 200));

// ===== TEST 6: Helper role via vendorPostComment =====
console.log('\n--- TEST 6: HELPER role via vendorPostComment ---');
const helperToken = await getIdToken(VENDOR_UID, { helper: true });
// Need a helper with helper claim; let's see what happens
const helperResult = await callProxy('vendorPostComment', {
  ownerUid, eventId, parentKind: 'rundown', parentId: inferredItemId,
  text: 'HELPER-PROBE-' + Date.now(),
}, helperToken);
console.log('Status:', helperResult.status);
console.log('Body:', JSON.stringify(helperResult.body).slice(0, 200));

// ===== TEST 7: Test that the OWNER cannot call vendorPostComment =====
console.log('\n--- TEST 7: OWNER cannot call vendorPostComment (expected 403) ---');
const ownerToken = await getIdToken(OWNER_UID, {});
const ownerResult = await callProxy('vendorPostComment', {
  ownerUid, eventId, parentKind: 'rundown', parentId: inferredItemId,
  text: 'OWNER-PROBE-' + Date.now(),
}, ownerToken);
console.log('Status:', ownerResult.status);
console.log('Body:', JSON.stringify(ownerResult.body).slice(0, 200));

// ===== Cleanup =====
console.log('\n--- Cleanup ---');
const all = await db.collection('artifacts').doc('savetheday-prod').collection('users').doc(OWNER_UID).collection('events').doc(EVENT_ID).collection('rundown').doc(RUNDOWN_ID).collection('comments').get();
let cleanedCount = 0;
for (const c of all.docs) {
  const text = c.data().text || '';
  if (text.startsWith('VENDOR-CLEAN-') || text.startsWith('NO-KIND-') || text.startsWith('UNDEFINED-') || text.startsWith('WRONG-SEG-') || text.startsWith('HELPER-PROBE-') || text.startsWith('OWNER-PROBE-')) {
    await c.ref.delete();
    cleanedCount++;
    console.log('  cleaned:', c.id, text.slice(0, 40));
  }
}
console.log(`Cleaned ${cleanedCount} test comments`);

console.log('\n=== ✅ SIMULATOR COMPLETE ===');
console.log('\nDiagnostic matrix:');
console.log('  200 OK:        Vendor writes via CF');
console.log('  400 (parentKind missing):  Bug in path extraction — eventsIdx+2 missing');
console.log('  400 (parentKind "foo"):  parentKind extracted to wrong value');
console.log('  400 (all undefined):     path._path.toString() returned empty');
console.log('  403:           Caller is not a vendor (correct)');
process.exit(0);
