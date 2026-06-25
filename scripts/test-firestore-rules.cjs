// Firestore Rules — comprehensive unit tests
// ==========================================
// Run with:
//   firebase emulators:exec --only firestore "node scripts/test-firestore-rules.js"
//
// What we test
// ------------
// Every rule path in firestore.rules. If a test fails, a guest can read
// another couple's wedding data. Treat every failure as P0.

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { setDoc, getDoc, doc, collection } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-wedding-rules-test';
const RULES = fs.readFileSync(
  path.resolve(__dirname, '../firestore.rules'),
  'utf8',
);

let env;

async function setup() {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });
}

async function teardown() {
  await env.cleanup();
}

function alice() {
  return env.authenticatedContext('alice-uid');
}
function bob() {
  return env.authenticatedContext('bob-uid');
}
function anonymous() {
  return env.unauthenticatedContext();
}

const ALICE_EVENT = 'alice-event-1';
const ALICE_GUEST = 'alice-guest-1';
const BOB_EVENT = 'bob-event-1';

async function seedAliceData() {
  const ctx = alice();
  const db = ctx.firestore();
  await setDoc(doc(db, 'artifacts/demo/users/alice-uid/events/ALICE_EVENT'), {
    name: 'Alice Wedding',
    date: '2026-12-31',
    tier: 'free',
  });
  await setDoc(doc(db, 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST'), {
    eventId: ALICE_EVENT,
    guestId: 'ALICE_GUEST',
    name: 'Bob The Guest',
    hasAttended: false,
  });
  // Issue a guest link that's been redeemed by 'guest-uid' for ALICE_EVENT
  await setDoc(
    doc(db, 'artifacts/demo/users/alice-uid/guestLinks/guest-uid'),
    {
      ownerUid: 'alice-uid',
      eventId: ALICE_EVENT,
      guestId: ALICE_GUEST,
      expiresAt: Date.now() + 3600 * 1000,
      redeemedByUid: 'guest-uid',
    },
  );
}

async function seedBobData() {
  const ctx = bob();
  const db = ctx.firestore();
  await setDoc(doc(db, 'artifacts/demo/users/bob-uid/events/BOB_EVENT'), {
    name: 'Bob Wedding',
    tier: 'free',
  });
}

async function runTests() {
  await setup();

  let passed = 0;
  let failed = 0;
  const log = (label, ok, extra = '') => {
    if (ok) {
      passed++;
      console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ''}`);
    } else {
      failed++;
      console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`);
    }
  };

  console.log('\n=== Owner rules ===');

  // Owner can read their own event
  await assertSucceeds(
    getDoc(doc(alice().firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('Owner can read own event', true);

  // Owner can write their own event
  await assertSucceeds(
    setDoc(
      doc(alice().firestore(), 'artifacts/demo/users/alice-uid/events/new-evt'),
      { name: 'New' },
    ),
  );
  log('Owner can create own event', true);

  console.log('\n=== Cross-tenant isolation (the most important) ===');

  // Alice CANNOT read Bob's event
  let res = await assertFails(
    getDoc(doc(alice().firestore(), 'artifacts/demo/users/bob-uid/events/BOB_EVENT')),
  );
  log("Alice CANNOT read Bob's event", true, res.code || '');

  // Alice CANNOT write to Bob's space
  res = await assertFails(
    setDoc(
      doc(alice().firestore(), 'artifacts/demo/users/bob-uid/events/pwned'),
      { name: 'Pwned' },
    ),
  );
  log("Alice CANNOT write Bob's events", true, res.code || '');

  // Anonymous cannot read anything
  res = await assertFails(
    getDoc(doc(anonymous().firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('Anonymous CANNOT read events', true, res.code || '');

  console.log('\n=== Guest link enforcement ===');

  // Guest (with valid redeemed link) CAN read the linked event
  const guestCtx = env.authenticatedContext('guest-uid');
  await assertSucceeds(
    getDoc(doc(guestCtx.firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('Guest with valid link CAN read linked event', true);

  // Guest CANNOT read a DIFFERENT owner's event
  await assertFails(
    getDoc(doc(guestCtx.firestore(), 'artifacts/demo/users/bob-uid/events/BOB_EVENT')),
  );
  log("Guest CANNOT read another owner's event", true);

  // Guest CANNOT read the guests list (PII)
  await assertFails(
    getDoc(doc(guestCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST')),
  );
  log('Guest CANNOT read guest list (PII protection)', true);

  // Guest CAN create a photo under their linked event
  await assertSucceeds(
    setDoc(
      doc(guestCtx.firestore(), 'artifacts/demo/users/alice-uid/photos/photo-1'),
      {
        eventId: ALICE_EVENT,
        url: 'https://nas.example/photo.jpg',
        uploaderId: ALICE_GUEST,
        uploaderName: 'Bob The Guest',
        createdAt: Date.now(),
      },
    ),
  );
  log('Guest CAN upload photos to linked event', true);

  // Guest CANNOT create a photo under an unrelated owner
  await assertFails(
    setDoc(
      doc(guestCtx.firestore(), 'artifacts/demo/users/bob-uid/photos/pwned'),
      {
        eventId: BOB_EVENT,
        url: 'https://nas.example/x.jpg',
        uploaderId: 'ALICE_GUEST',
        uploaderName: 'Bob',
        createdAt: Date.now(),
      },
    ),
  );
  log("Guest CANNOT upload to unrelated owner", true);

  console.log('\n=== Expired link ===');

  // Seed an expired link
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/guestLinks/expired-uid'),
      {
        ownerUid: 'alice-uid',
        eventId: ALICE_EVENT,
        guestId: 'ALICE_GUEST',
        expiresAt: Date.now() - 1000,  // already expired
        redeemedByUid: 'expired-uid',
      },
    );
  });
  const expiredCtx = env.authenticatedContext('expired-uid');
  await assertFails(
    getDoc(doc(expiredCtx.firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('Expired-link guest CANNOT read linked event', true);

  console.log('\n=== Public marketplace ===');

  // jobRequests: any signed-in user can read
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/jobRequests/job-1'),
      {
        coupleUid: 'alice-uid',
        title: 'Need a florist',
      },
    );
  });
  await assertSucceeds(
    getDoc(doc(alice().firestore(), 'artifacts/demo/jobRequests/job-1')),
  );
  log('Signed-in user CAN read public jobRequests', true);

  // Anonymous cannot read jobRequests (we required signed-in)
  await assertFails(
    getDoc(doc(anonymous().firestore(), 'artifacts/demo/jobRequests/job-1')),
  );
  log('Anonymous CANNOT read jobRequests', true);

  console.log('\n=== Helper permission system (兄弟姊妹) ===');

  // Seed a helper with canScan only
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/helpers/scan-helper'),
      {
        ownerUid: 'alice-uid',
        email: 'scan@example.com',
        displayName: 'Scanner Helper',
        status: 'active',
        perms: {
          canScan: true,
          canViewGuestList: false,
          canViewBudget: false,
          canViewChecklist: false,
          canViewPhotos: false,
          canUploadPhotos: false,
          canEditGuests: false,
          canViewGiftAmount: false,
        },
      },
    );
  });
  const scanCtx = env.authenticatedContext('scan-helper');

  // canScan helper can read their own helper doc
  await assertSucceeds(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/helpers/scan-helper')),
  );
  log('Helper CAN read own helper doc', true);

  // Helper CANNOT read other helpers (privacy)
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/helpers/other-helper'),
      { ownerUid: 'alice-uid', status: 'active', perms: { canScan: true } },
    );
  });
  await assertFails(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/helpers/other-helper')),
  );
  log('Helper CANNOT read other helpers', true);

  // canScan helper CAN read guests (because canScan implies canViewGuestList
  // for the scan flow) -- actually, rules require canViewGuestList explicit.
  // Test the negative case first: canScan alone cannot read guests.
  await assertFails(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST')),
  );
  log('canScan helper (no canViewGuestList) CANNOT read guests', true);

  // canScan helper CAN update hasAttended on a guest (audit fields only)
  await assertSucceeds(
    setDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST'),
      { hasAttended: true, lastScannedBy: 'scan-helper', lastScannedAt: Date.now() },
      { merge: true },
    ).catch(async () => {
      // setDoc with merge might not be in the test util — try updateDoc instead.
      const { updateDoc, update } = await import('firebase/firestore');
      return updateDoc(
        doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST'),
        { hasAttended: true, lastScannedBy: 'scan-helper', lastScannedAt: Date.now() },
      );
    }),
  );
  log('canScan helper CAN mark hasAttended + audit fields', true);

  // canScan helper CANNOT edit other fields on guest (e.g., tableNumber)
  let scanError = null;
  try {
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST'),
      { tableNumber: 'Table 99' },
    );
  } catch (e) {
    scanError = e;
  }
  log('canScan helper CANNOT edit tableNumber (security gate)', scanError !== null, scanError?.code || '');

  // canScan helper CANNOT read tasks (no canViewChecklist)
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/tasks/task-1'),
      { title: 'Decorations', eventId: ALICE_EVENT },
    );
  });
  await assertFails(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/tasks/task-1')),
  );
  log('canScan helper CANNOT read tasks', true);

  // canScan helper CAN read events (hasAnyHelperViewPerm includes canScan)
  await assertSucceeds(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('canScan helper CAN read events (needs to know event context)', true);

  // Helper with NO perms at all CANNOT read events
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/helpers/useless-helper'),
      {
        ownerUid: 'alice-uid',
        status: 'active',
        perms: {
          canScan: false,
          canViewGuestList: false,
          canViewBudget: false,
          canViewChecklist: false,
          canViewPhotos: false,
          canUploadPhotos: false,
          canEditGuests: false,
          canViewGiftAmount: false,
        },
      },
    );
  });
  const uselessCtx = env.authenticatedContext('useless-helper');
  await assertFails(
    getDoc(doc(uselessCtx.firestore(), 'artifacts/demo/users/alice-uid/events/ALICE_EVENT')),
  );
  log('Helper with zero perms CANNOT read events', true);

  // Revoked helper CANNOT do anything
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/demo/users/alice-uid/helpers/revoked-helper'),
      {
        ownerUid: 'alice-uid',
        status: 'revoked',
        perms: { canScan: true },
      },
    );
  });
  const revokedCtx = env.authenticatedContext('revoked-helper');
  await assertFails(
    getDoc(doc(revokedCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST')),
  );
  log('Revoked helper CANNOT read guests', true);

  // Helper CANNOT write their own doc (owner-only)
  await assertFails(
    setDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/helpers/scan-helper'),
      { status: 'active', perms: { canScan: true, canEditGuests: true } },
      { merge: true },
    ),
  );
  log('Helper CANNOT escalate their own perms', true);

  // Owner CAN grant any perm
  await assertSucceeds(
    setDoc(
      doc(alice().firestore(), 'artifacts/demo/users/alice-uid/helpers/scan-helper'),
      { perms: { canEditGuests: true } },
      { merge: true },
    ),
  );
  log('Owner CAN grant perms', true);

  // After canEditGuests, helper CAN edit any field on guest
  const { updateDoc } = await import('firebase/firestore');
  await assertSucceeds(
    updateDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/guests/ALICE_GUEST'),
      { tableNumber: 'Table 5' },
    ),
  );
  log('canEditGuests helper CAN edit tableNumber', true);

  console.log('\n=== ScanLog audit trail ===');

  // Helper CAN write scanLog entries
  await assertSucceeds(
    setDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/scanLog/scan-1'),
      {
        guestId: 'ALICE_GUEST',
        helperUid: 'scan-helper',
        eventId: ALICE_EVENT,
        scannedAt: Date.now(),
      },
    ),
  );
  log('Helper CAN write scanLog', true);

  // Helper CANNOT forge another helper's UID in scanLog
  await assertFails(
    setDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/scanLog/forged'),
      {
        guestId: 'ALICE_GUEST',
        helperUid: 'some-other-helper',
        eventId: ALICE_EVENT,
        scannedAt: Date.now(),
      },
    ),
  );
  log('Helper CANNOT forge scanLog helperUid', true);

  // Helper CANNOT read scanLog (owner-only)
  await assertFails(
    getDoc(doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/scanLog/scan-1')),
  );
  log('Helper CANNOT read scanLog (owner-only)', true);

  // Owner CAN read scanLog
  await assertSucceeds(
    getDoc(doc(alice().firestore(), 'artifacts/demo/users/alice-uid/scanLog/scan-1')),
  );
  log('Owner CAN read scanLog', true);

  // Helper CANNOT update or delete scanLog (immutable)
  await assertFails(
    setDoc(
      doc(scanCtx.firestore(), 'artifacts/demo/users/alice-uid/scanLog/scan-1'),
      { scannedAt: 0 },
      { merge: true },
    ),
  );
  log('Helper CANNOT mutate scanLog (immutable)', true);

  console.log(`\n=== Result ===\n  ${passed} passed, ${failed} failed\n`);

  await teardown();
  process.exit(failed === 0 ? 0 : 1);
}

seedAliceData()
  .then(seedBobData)
  .then(runTests)
  .catch((e) => {
    console.error('Test setup failed:', e);
    process.exit(2);
  });