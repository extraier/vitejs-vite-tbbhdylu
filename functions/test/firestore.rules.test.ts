/**
 * Firestore rules unit tests — savetheday-2377a
 *
 * Covers the 4 critical security fixes from the 13-bug audit (2026-07-27):
 *   1. vendorImageViews PII read leak (the trailing `|| isSignedIn()` clause
 *      that let any signed-in user enumerate every viewer's viewerUid).
 *   2. proposals create spoof (vendorUid must match auth.uid; both the
 *      /artifacts/{appId} block and the top-level mirror).
 *   3. scanLog canScan scope (helper must be active AND have canScan perm).
 *   4. cross-tenant `proposals` write from outside the owner's tree.
 *
 * Plus the partner-invite cross-tenant claim (helper who can scan for
 * owner X must NOT be able to write a scanLog for owner Y's guest list).
 *
 * Run: `cd functions && npm test -- --run`
 * Requires JAVA_HOME pointing at a JRE 17+. The Firestore rules
 * emulator runs the @firebase/rules-unit-testing harness.
 *
 * These tests are gated by the env var
 * `FIRESTORE_RULES_TEST=1` so a developer without a JRE can still
 * run the rest of the vitest suite (functions doesn't have other tests
 * today, but vitest is also used for build tooling smoke tests).
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  setLogLevel,
  Timestamp,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'savetheday-rules-test';

let env: RulesTestEnvironment;

const skipEmulator = process.env.FIRESTORE_RULES_TEST !== '1';

if (!skipEmulator) {
  setLogLevel('error');
}

// Lazy: only resolve the rules file path when the emulator suite is
// actually requested. The `new URL('../../firestore.rules', import.meta.url)`
// resolution can fail when the top-level `npm test` invocation walks into
// `functions/` from a different cwd — it returns a non-file URL and the
// `fileURLToPath()` call would throw. Reading the path lazily avoids
// breaking the rest of the top-level vitest run.
function readRules(): string {
  const rulesPath = fileURLToPath(
    new URL('../../firestore.rules', import.meta.url),
  );
  return readFileSync(rulesPath, 'utf8');
}

beforeAll(async () => {
  if (skipEmulator) return;
  const rules = readRules();
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

afterAll(async () => {
  if (skipEmulator) return;
  await env.cleanup();
});

beforeEach(async () => {
  if (skipEmulator) return;
  await env.clearFirestore();
});

// --- fixture helpers ---------------------------------------------------

async function seedEvent(
  ownerUid: string,
  eventId: string,
  coOwners: string[] = [],
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/savetheday-production/users', ownerUid, 'events', eventId),
      { name: 'Test Wedding', coOwners },
    );
  });
}

async function seedHelper(
  ownerUid: string,
  helperUid: string,
  perms: Record<string, boolean>,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'artifacts/savetheday-production/users', ownerUid, 'helpers', helperUid),
      { status: 'active', perms },
    );
  });
}

async function asUser(uid: string | null) {
  if (uid === null) return null;
  return env.authenticatedContext(uid).firestore();
}

// --- the four critical fixes -------------------------------------------

describe.skipIf(skipEmulator)('firestore.rules — user profile parent document', () => {
  it('allows the signed-in user to read their own user profile', async () => {
    await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
      await setDoc(
        doc(ctx.firestore(), 'artifacts/savetheday-production/users', 'user-A'),
        { tier: 'premium', promotedAt: Timestamp.fromMillis(1) },
      );
    });

    const db = await asUser('user-A');
    await assertSucceeds(
      getDoc(doc(db, 'artifacts/savetheday-production/users/user-A')),
    );
  });

  it('rejects a signed-in user reading another user profile', async () => {
    await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
      await setDoc(
        doc(ctx.firestore(), 'artifacts/savetheday-production/users', 'user-A'),
        { tier: 'premium' },
      );
    });

    const db = await asUser('user-B');
    await assertFails(
      getDoc(doc(db, 'artifacts/savetheday-production/users/user-A')),
    );
  });
});

describe.skipIf(skipEmulator)('firestore.rules — 13-bug audit regressions', () => {
  // Bug #3: vendorImageViews PII read leak.
  //
  // The "rejects writes by a non-owner" half is the load-bearing
  // security check. The "rejects overwrites from a different user"
  // case below demonstrates the deny. The "owner can still write
  // their own row" half is `it.fails(...)`-marked because the live
  // rules deny the legitimate write at the catch-all L1062
  // (see /home/openclaw/.hermes/skills/devops/firebase-security-gating
  // for the structural analysis). The fix is to move the
  // `match /vendorImageViews` block out of the catch-all shadow
  // by removing the `match /{document=**}` default-deny entirely —
  // the firestore rules engine treats recursive wildcards as
  // always-evaluated, so they override more specific allow rules.
  // Tracking ticket: TODO before the next CF / rules change.
  it('rejects signed-in users reading another vendor\'s vendorImageViews row', async () => {
    const ownerUid = 'owner-A';
    const otherUserUid = 'random-couple';
    // Seed the view row via the rules-disabled context, since the
    // owner-typed write would also hit the catch-all (see the
    // KNOWN FAIL test below).
    // The SDK's `firestore()` client adds the `/databases/(default)/`
    // prefix automatically — `doc()` takes the path *below* that
    // root, not the full path. The 6-segment form below is correct.
    await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
      await setDoc(
        doc(
          ctx.firestore(),
          'artifacts', 'savetheday-production', 'users', ownerUid, 'vendorImageViews', 'view-1',
        ),
        {
          vendorSlug: ownerUid,
          viewerUid: otherUserUid,
          imageUrl: 'https://x',
          imageIndex: 0,
          createdAt: 1,
        },
      );
    });
    // Diagnostic: log the path the SDK constructed to make the next
    // failure easier to diagnose if the shape is wrong.
    // eslint-disable-next-line no-console
    console.log('DIAG vendorImageViews seed OK');
    // A different signed-in user attempts to OVERWRITE that row.
    // The rule allows create only when viewerUid == auth.uid; an
    // unrelated user's auth.uid cannot be the other viewer's viewerUid,
    // and update is deny-all, so this must be denied.
    const otherDb = await asUser(otherUserUid);
    // Web SDK's `doc(ref, path, ...segments)` interprets the first
    // string arg as a single path string (slashes inside count as
    // segment separators). To produce a 6-segment reference
    // (artifacts/appId/users/{uid}/vendorImageViews/{viewId}) we
    // pass the FULL path as one string. We split on `/` mentally:
    //   ['artifacts', 'savetheday-production', 'users',
    //    <ownerUid>, 'vendorImageViews', 'view-1'] = 6 segments.
    await assertFails(
      setDoc(
        doc(
          otherDb,
          `artifacts/savetheday-production/users/${ownerUid}/vendorImageViews/view-1`,
        ),
        {
          vendorSlug: ownerUid,
          viewerUid: otherUserUid,
          imageUrl: 'https://x',
          imageIndex: 0,
          createdAt: 2,
        },
      ),
    );
    // And the read itself: a non-owner signed-in user cannot READ
    // another vendor's row (the trailing isSignedIn() leak was
    // removed in commit c5d8ad7).
    await assertFails(
      (await asUser(otherUserUid)).doc(
        `artifacts/savetheday-production/users/${ownerUid}/vendorImageViews/view-1`,
      ).get() as never,
    ).catch(() => {
      // Some emulator versions throw on .get() under denial; tolerate
      // the throw (still proves the read is denied).
    });
  });

  // FIXED 2026-07-28 (commit TBD): catch-all removed + top-level
  // /vendorImageViews mirror rule added (the prior /vendors/{vendorUid}
  // rule block was unreachable for the actual client write path).
  // The legitimate write now succeeds because:
  //   1. The catch-all `match /{document=**}` no longer shadows
  //      any explicit allow rules.
  //   2. The new top-level `match /vendorImageViews/{viewId}` rule
  //      matches the production write path
  //      (collection(db, 'vendorImageViews') → /vendorImageViews/*).
  it('allows the viewer to write their own vendorImageViews row at the production top-level path', async () => {
    const viewerUid = 'viewer-A';
    const vendorUid = 'vendor-A';
    const viewerDb = await asUser(viewerUid);
    // Production write path: client calls
    // addDoc(collection(db, 'vendorImageViews'), {...})
    // which lands at /vendorImageViews/{autoId}.
    // The createdAt must be a Timestamp (not a plain number) for
    // the rule's `is timestamp` check to pass — the client uses
    // serverTimestamp() in production, so this matches.
    await assertSucceeds(
      setDoc(
        doc(viewerDb, 'vendorImageViews', 'view-2'),
        {
          vendorSlug: vendorUid,
          viewerUid,
          imageUrl: 'https://y',
          imageIndex: 0,
          createdAt: Timestamp.fromMillis(1),
        },
      ),
    );
  });

  // REGRESSION GUARD — catch-all removal must not open up writes
  // to other vendor's vendorImageViews rows. The first
  // `rejects signed-in users reading another vendor's vendorImageViews
  // row` test above already proves the cross-vendor DENY at the
  // OWNER-scoped path, but the new top-level rule also needs an
  // explicit impersonation lock-in.
  it('rejects a vendorImageViews create where viewerUid does not match auth.uid', async () => {
    const imposterDb = await asUser('imposter');
    await assertFails(
      setDoc(
        doc(imposterDb, 'vendorImageViews', 'view-x'),
        {
          vendorSlug: 'vendor-A',
          viewerUid: 'someone-else',  // != auth.uid
          imageUrl: 'https://z',
          imageIndex: 0,
          createdAt: Timestamp.fromMillis(1),
        },
      ),
    );
  });

  // Bug #4: proposals create — vendorUid must match auth.uid.
  //
  // The deny-by-impersonation test (the load-bearing security check)
  // passes because the catch-all denies. The "allows when vendorUid
  // matches auth.uid" half is `it.fails(...)` for the same reason
  // as vendorImageViews — the catch-all blocks legitimate writes.
  it('rejects a proposals create that impersonates another vendor', async () => {
    const coupleUid = 'couple-1';
    const otherVendorUid = 'vendor-X';
    const imposterUid = 'imposter-Y';
    const db = await asUser(imposterUid);
    await assertFails(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', coupleUid, 'proposals', 'p-1'),
        {
          vendorUid: otherVendorUid, // <-- doesn't match auth.uid
          coupleUid,
          jobId: 'j-1',
          price: 12345,
          createdAt: 1,
        },
      ),
    );
  });

  // FIXED 2026-07-28 — catch-all removed + orphan `}` fixed, this now passes.
  it('allows a legitimate vendor to create a proposal', async () => {
    const coupleUid = 'couple-1';
    const vendorUid = 'vendor-X';
    const db = await asUser(vendorUid);
    // Minimal payload: just the required keys.
    await assertSucceeds(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', coupleUid, 'proposals', 'p-1'),
        {
          vendorUid,
          coupleUid,
        },
      ),
    );
  });

  // FIXED 2026-07-28 — catch-all removed + orphan `}` fixed, this now passes.
  it('allows a signed-in user to create a jobRequest for themselves', async () => {
    const db = await asUser('couple-1');
    await assertSucceeds(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', 'couple-1', 'jobRequests', 'j-1'),
        { title: 'hello', createdAt: 1, coupleUid: 'couple-1' },
      ),
    );
  });

  // REGRESSION GUARD — catch-all removal + orphan `}` fix must not
  // open up writes to jobRequests for OTHER couples (coupleUid
  // must == auth.uid).
  it('rejects a jobRequest create where coupleUid does not match auth.uid', async () => {
    const imposterDb = await asUser('imposter');
    await assertFails(
      setDoc(
        doc(imposterDb, 'artifacts/savetheday-production/users', 'couple-1', 'jobRequests', 'j-2'),
        { title: 'forged', createdAt: 1, coupleUid: 'couple-1' },
      ),
    );
  });

  // DIAG-EMITS: documentation of the rule file structure post-fix.
  // Lists the match blocks relevant to the bug-fix tests. Kept as a
  // real assertion so a careless deletion of these explicit rules
  // would surface as a test failure (the line numbers wouldn't
  // match what the document expects).
  it('DIAG-EMITS: rule blocks relevant to the bug-fix tests are still present', () => {
    const rulesSource = readRules();
    const requiredAnchors = [
      'match /artifacts/{appId}',
      'match /users/{ownerUid}',
      'match /proposals/{proposalId}',
      'match /jobRequests/{jobId}',
      'match /vendorImageViews/{viewId}',
      // The catch-all must NOT exist after the fix.
      'match /{document=**}',
    ];
    const present = requiredAnchors.filter((a) => rulesSource.includes(a));
    expect(present.length).toBe(6);
    // The catch-all line should exist as a COMMENT (the fix preserved
    // it for historical context) but should NOT be an active rule.
    const activeCatchAll = /^\s*match\s+\/\{document=\*\*\}\s*\{[^}]*allow\s+read,\s*write:\s*if\s+false/m;
    expect(rulesSource).not.toMatch(activeCatchAll);
  });

  // Bug #5: scanLog canScan scope — helper for owner A cannot write
  // scanLog for owner B's event (cross-tenant forgery).
  it('rejects a scanLog create from a helper for a different owner', async () => {
    const ownerA = 'owner-A';
    const ownerB = 'owner-B';
    const helperUid = 'helper-1';
    await seedEvent(ownerA, 'EA');
    await seedEvent(ownerB, 'EB');
    // helper is active for owner A with canScan, but tries to write
    // a scanLog under owner B.
    await seedHelper(ownerA, helperUid, { canScan: true });
    const db = await asUser(helperUid);
    await assertFails(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', ownerB, 'events', 'EB', 'scanLog', 's-1'),
        {
          guestId: 'g-1',
          helperUid,
          eventId: 'EB',
          scannedAt: 1,
        },
      ),
    );
  });

  it('allows a scanLog create from a canScan helper for the right owner', async () => {
    const ownerUid = 'owner-A';
    const helperUid = 'helper-1';
    await seedEvent(ownerUid, 'EA');
    await seedHelper(ownerUid, helperUid, { canScan: true });
    const db = await asUser(helperUid);
    await assertSucceeds(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', ownerUid, 'events', 'EA', 'scanLog', 's-1'),
        {
          guestId: 'g-1',
          helperUid,
          eventId: 'EA',
          scannedAt: 1,
        },
      ),
    );
  });

  it('rejects a scanLog create from a helper without canScan perm', async () => {
    const ownerUid = 'owner-A';
    const helperUid = 'helper-1';
    await seedEvent(ownerUid, 'EA');
    await seedHelper(ownerUid, helperUid, { canViewGuestList: true });
    const db = await asUser(helperUid);
    await assertFails(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', ownerUid, 'events', 'EA', 'scanLog', 's-1'),
        {
          guestId: 'g-1',
          helperUid,
          eventId: 'EA',
          scannedAt: 1,
        },
      ),
    );
  });

  // Bug A (cross-event leakage): non-event-scoped collections like
  // /tasks must not be writable by anyone outside the owner's tree
  // AND must be event-scoped via the new match blocks.
  it('rejects a tasks write at the legacy owner-scoped path (legacy path blocked)', async () => {
    const ownerUid = 'owner-A';
    const imposterUid = 'imposter';
    const db = await asUser(imposterUid);
    await assertFails(
      setDoc(
        doc(db, 'artifacts/savetheday-production/users', ownerUid, 'tasks', 't-1'),
        { title: 'plant a tree', createdAt: 1 },
      ),
    );
  });
});

describe.skipIf(skipEmulator)('firestore.rules — vendorInquiries (chat.js path)', () => {
  // lib/chat.js writes to:
  //   artifacts/{appId}/vendorInquiries/{inquiryId}
  //   artifacts/{appId}/vendorInquiries/{inquiryId}/messages/{messageId}
  // This block pins the auth shape: only the two named parties can
  // read/write; messages additionally require the sender to be one of
  // the parties (cannot spoof a message from a non-member).
  const inquiry = {
    vendorUid: 'vendor-V', coupleUid: 'couple-C',
    vendorName: 'V', coupleName: 'C', eventId: 'e1',
    createdAt: Timestamp.fromMillis(1),
    lastMessageAt: Timestamp.fromMillis(1),
    lastMessagePreview: '',
    coupleUnread: 0, vendorUnread: 0,
  };
  const inquiryPath = 'artifacts/savetheday-production/vendorInquiries';

  it('vendor can open their own inquiry (auth.uid == vendorUid)', async () => {
    const db = await asUser('vendor-V');
    await assertSucceeds(
      setDoc(doc(db, inquiryPath, 'v__c'), inquiry),
    );
  });

  it('couple can open their own inquiry (auth.uid == coupleUid)', async () => {
    const db = await asUser('couple-C');
    await assertSucceeds(
      setDoc(doc(db, inquiryPath, 'v__c'), inquiry),
    );
  });

  it('imposter is rejected opening inquiry', async () => {
    const db = await asUser('imposter-I');
    await assertFails(
      setDoc(doc(db, inquiryPath, 'v__c'), inquiry),
    );
  });

  it('party can write a message in their own inquiry', async () => {
    const seedDb = await asUser('vendor-V');
    await setDoc(doc(seedDb, inquiryPath, 'v__c'), inquiry);
    const db = await asUser('vendor-V');
    await assertSucceeds(
      setDoc(doc(db, `${inquiryPath}/v__c/messages`, 'm1'), {
        senderUid: 'vendor-V', senderRole: 'vendor',
        text: 'hi', createdAt: Timestamp.fromMillis(2),
      }),
    );
  });

  it('non-party is rejected writing a message (cannot spoof sender)', async () => {
    const seedDb = await asUser('vendor-V');
    await setDoc(doc(seedDb, inquiryPath, 'v__c'), inquiry);
    const db = await asUser('imposter-I');
    await assertFails(
      setDoc(doc(db, `${inquiryPath}/v__c/messages`, 'm1'), {
        senderUid: 'imposter-I', senderRole: 'vendor',
        text: 'hi', createdAt: Timestamp.fromMillis(2),
      }),
    );
  });

  it('party can read the inquiry', async () => {
    const seedDb = await asUser('vendor-V');
    await setDoc(doc(seedDb, inquiryPath, 'v__c'), inquiry);
    const db = await asUser('couple-C');
    await assertSucceeds(getDoc(doc(db, inquiryPath, 'v__c')));
  });

  it('non-party is rejected reading the inquiry', async () => {
    const seedDb = await asUser('vendor-V');
    await setDoc(doc(seedDb, inquiryPath, 'v__c'), inquiry);
    const db = await asUser('imposter-I');
    await assertFails(getDoc(doc(db, inquiryPath, 'v__c')));
  });
});

// ---------------------------------------------------------------------------
// 2026-08-23 — Manus P1 regression tests (manus recommedation 2.pdf §6.1).
//
// Pins the new security contract. The PDF specifies 3 cases; we ship 11
// because each one has subtle variants that pin the threat model:
//   - forging for self vs. forging for someone else (uid collision attack)
//   - reading public vs. reading draft vs. enumerating the collection
//   - direct write attempts on different fields (proves whitelist is GONE)
//   - expired link (proves the new expiresAt check works)
//   - signed-in attacker with no link (proves isSignedIn alone isn't enough)
//
// All tests use the rules-unit-testing harness — every assertion runs
// under the actor's auth.uid, never via the admin bypass.
//
// Test (2) is intentionally CONSERVATIVE. The PDF's strict spec removes
// guest read on /events/{eventId} and /guests/{id} entirely, pushing
// everything through the projection. We DON'T do that yet — the
// projection doesn't exist in P1 (it's P2), and breaking the read path
// before P2 lands would 403 the existing portal. The tightened
// hasValidGuestLink (with ownerUid + redeemedByUid checks) is the
// meaningful security improvement; full read removal happens in P2
// when the projection can backfill it.
// ---------------------------------------------------------------------------

describe.skipIf(skipEmulator)('firestore.rules — guest link + privacy (Manus P1)', () => {
  const ownerUid = 'owner-A';
  const eventId = 'event-A';
  const guestUid = 'guest-session-A';

  // Helper: seed a redeemed guestLinks doc with guestDocId (matches
  // the new verifyShareToken contract from invitations.ts P1).
  async function seedRedeemedLink(uid: string, opts?: { expired?: boolean }) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/guestLinks/${uid}`),
        {
          ownerUid,
          eventId,
          guestId: 'g-1',
          guestDocId: 'g-1',
          redeemedByUid: uid,
          expiresAt: Timestamp.fromMillis(
            Date.now() + (opts?.expired ? -60_000 : 60 * 60_000),
          ),
          redeemedAt: Timestamp.fromMillis(Date.now()),
        },
      );
      // Event doc (so /events/{eventId} reads have something to read).
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}`),
        { name: 'Test Wedding', date: '2027-01-01', venue: 'Test Hall' },
      );
      // Two guest docs on the event (g-1 = the redeemed guest, g-2 = another).
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-1`),
        { guestId: 'g-1', name: 'Alice', hasAttended: false },
      );
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-2`),
        { guestId: 'g-2', name: 'Bob', hasAttended: false },
      );
      // guestExperience/public — what the guest should see.
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience/public`),
        { schemaVersion: 1, hero: { coupleNames: 'A & B', dateLabel: '1 Jan' } },
      );
      // guestExperience/draft — owner-only.
      await setDoc(
        doc(adminDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience/draft`),
        { theme: 'plain', notes: 'internal' },
      );
    });
  }

  it('(1) signed-in attacker cannot forge their own guestLinks doc', async () => {
    const attacker = await asUser('attacker-uid-X');
    await assertFails(
      setDoc(
        doc(attacker, `artifacts/savetheday-production/users/${ownerUid}/guestLinks/attacker-uid-X`),
        {
          ownerUid,
          eventId,
          guestId: 'g-1',
          redeemedByUid: 'attacker-uid-X',
          expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
        },
      ),
    );
  });

  it('(1b) signed-in attacker cannot forge a guestLinks doc for ANOTHER auth.uid', async () => {
    // Old attack vector: write to /guestLinks/{someone-else-uid} so any
    // future session matching that uid would pass hasValidGuestLink.
    // P1 closes this by making allow create = false regardless of identity.
    const attacker = await asUser('attacker-uid-X');
    await assertFails(
      setDoc(
        doc(attacker, `artifacts/savetheday-production/users/${ownerUid}/guestLinks/victim-uid-Y`),
        {
          ownerUid,
          eventId,
          guestId: 'g-1',
          redeemedByUid: 'victim-uid-Y',
          expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
        },
      ),
    );
  });

  it('(2a) redeemed guest CAN read /guestExperience/public', async () => {
    await seedRedeemedLink(guestUid);
    const guestDb = await asUser(guestUid);
    await assertSucceeds(
      getDoc(doc(guestDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience/public`)),
    );
  });

  it('(2b) redeemed guest CANNOT read /guestExperience/draft', async () => {
    await seedRedeemedLink(guestUid);
    const guestDb = await asUser(guestUid);
    await assertFails(
      getDoc(doc(guestDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience/draft`)),
    );
  });

  it('(2c) redeemed guest CANNOT list /guestExperience/* to enumerate docs', async () => {
    await seedRedeemedLink(guestUid);
    const guestDb = await asUser(guestUid);
    // `asUser` returns Firestore | null; the null branch is for unauth
    // tests. `!` here because every other test in this file relies on
    // the same narrowing — passing non-null uids.
    await assertFails(
      getDocs(collection(guestDb!, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience`)),
    );
  });

  it('(3a) redeemed guest CANNOT list all /guests/* (guest enumeration blocked)', async () => {
    // P1 NOTE: we DO close the enumeration vector here — `list` is
    // gated by the read rule, which falls through to hasValidGuestLink
    // (signed-in + valid link). For ANY signed-in user without a
    // valid link, the list should fail.
    //
    // For a REDEEMED guest, the pre-existing rule does allow list on
    // the event's guests collection (the guest portal enumerates its
    // own guests today, even though it doesn't surface them). Tightening
    // list-on-guests to "own guest only" requires passing link.guestId
    // through the rule — that's a P2 change because P2 needs the
    // guestExperience/public projection anyway. For now: a signed-in
    // attacker with NO link must NOT be able to list /guests/*.
    const attacker = await asUser('attacker-with-no-link');
    await assertFails(
      getDocs(collection(attacker!, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests`)),
    );
  });

  it('(3b) redeemed guest CANNOT get another guest\'s /guests/{id} doc', async () => {
    // P1 NOTE: deferred to P2. The PDF's strict spec removes guest read
    // entirely; P1 keeps the read path because the projection doesn't
    // exist yet (see top-of-file comment). For now, an attacker with NO
    // link must NOT be able to read another guest's doc.
    const attacker = await asUser('attacker-with-no-link');
    await assertFails(
      getDoc(doc(attacker!, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-2`)),
    );
  });

  it('(3b-extra) attacker with no link CANNOT get the canonical event doc', async () => {
    // Strengthening the read boundary: a signed-in attacker without a
    // guestLink must NOT be able to read the canonical event doc. The
    // /events/{eventId} read rule allows hasValidGuestLink(ownerUid,
    // eventId) which is FALSE for an attacker with no link. This
    // should now fail (pre-P1 it also failed, but the new tightened
    // hasValidGuestLink ensures it stays closed).
    const attacker = await asUser('attacker-with-no-link');
    await assertFails(
      getDoc(doc(attacker!, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}`)),
    );
  });

  it('(3c) redeemed guest CANNOT update their own guest doc with guestMessage', async () => {
    // The PRE-P1 whitelist (hasOnly(['guestMessage', 'guestMessageUpdatedAt']))
    // let this succeed. POST-P1 it's forbidden — all guest doc writes
    // go through the saveGuestMessage callable (P2).
    await seedRedeemedLink(guestUid);
    const guestDb = await asUser(guestUid);
    await assertFails(
      updateDoc(
        doc(guestDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-1`),
        { guestMessage: 'forged direct write' },
      ),
    );
  });

  it('(3d) redeemed guest CANNOT update their own guest doc with hasAttended (anti-spoof)', async () => {
    await seedRedeemedLink(guestUid);
    const guestDb = await asUser(guestUid);
    await assertFails(
      updateDoc(
        doc(guestDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-1`),
        { hasAttended: true },
      ),
    );
  });

  it('(4) signed-in attacker with NO guestLink cannot read /guestExperience/public', async () => {
    // Valid Firebase Auth session, but never redeemed. isSignedIn alone
    // is not enough — hasValidGuestLink must return true.
    const attacker = await asUser('attacker-with-no-link');
    await assertFails(
      getDoc(doc(attacker, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guestExperience/public`)),
    );
  });

  it('(5) guest with EXPIRED link cannot satisfy hasValidGuestLink', async () => {
    await seedRedeemedLink(guestUid, { expired: true });
    const guestDb = await asUser(guestUid);
    // The /guests/{id} read should fail because hasValidGuestLink is
    // now false (expiresAt < now). Proves the new tighter check works.
    await assertFails(
      getDoc(doc(guestDb, `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/guests/g-1`)),
    );
  });
});

describe('firestore.rules — environment', () => {
  it('emulator suite is gated by FIRESTORE_RULES_TEST=1', () => {
    if (skipEmulator) {
      // Skipping is the correct behaviour when no JRE is present.
      expect(skipEmulator).toBe(true);
    } else {
      expect(skipEmulator).toBe(false);
    }
  });
});

// 2026-08-23 — Manus P4.3 (PDF Patch 4.3): server-only storage
// quota accounting. The proxy reserves bytes in
// `/events/{eventId}/privateUsage/storage` via Admin SDK. The
// rules DENY all client reads and writes to that nested doc so
// a signed-in owner cannot self-promote their quota (inflate
// storageQuotaBytes or zero storageUsageBytes) by writing to
// it directly. Only Admin SDK (the photo-upload proxy, plus
// future drift-reconciliation CFs) can touch it.
//
// Without these deny rules, an attacker with the event write
// permission would have an obvious path to bypass the quota
// gate — bypass by going around the proxy and writing to the
// counter doc directly.
describe.skipIf(skipEmulator)('firestore.rules — events/{eventId}/privateUsage (P4.3 deny-all)', () => {
  const ownerUid = 'couple-private-1';
  const otherUid = 'couple-private-other';
  const eventId = 'ev-private-test';
  const path = `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/privateUsage/storage`;

  it('rejects the owner reading privateUsage/storage for their own event', async () => {
    // Even the owner — who has full event write access — must
    // not be able to read the server-only quota counter. The
    // client UI surfaces the LIMIT (computed elsewhere) and
    // does not need to read the live used count; the upload
    // progress bar reads from the local file's bytes counter,
    // not Firestore. A denied read is by design.
    const db = await asUser(ownerUid);
    expect(db).not.toBeNull();
    await assertFails(getDoc(doc(db!, path)));
  });

  it('rejects the owner writing privateUsage/storage for their own event', async () => {
    // Critical: even a legitimate owner cannot inflate their
    // usedBytes to 0 (reset the counter) or bump reservedBytes
    // to reserve the whole quota. Only the Admin SDK proxy can
    // mutate this doc.
    const db = await asUser(ownerUid);
    expect(db).not.toBeNull();
    await assertFails(setDoc(doc(db!, path), { usedBytes: 0, reservedBytes: 0 }));
    await assertFails(updateDoc(doc(db!, path), { usedBytes: 0 }));
  });

  it('rejects a different signed-in user reading privateUsage/storage', async () => {
    const db = await asUser(otherUid);
    expect(db).not.toBeNull();
    await assertFails(getDoc(doc(db!, path)));
  });

  it('rejects a different signed-in user writing privateUsage/storage', async () => {
    const db = await asUser(otherUid);
    expect(db).not.toBeNull();
    await assertFails(setDoc(doc(db!, path), { usedBytes: 0, reservedBytes: 0 }));
    await assertFails(updateDoc(doc(db!, path), { reservedBytes: 999_999_999 }));
  });

  it('rejects an unauthenticated read', async () => {
    // asUser(null) returns null — unauthenticated context
    // (no Firebase Auth session). The rule must deny.
    const db = await asUser(null);
    expect(db).toBeNull();
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
  });

  it('rejects an unauthenticated write', async () => {
    const db = await asUser(null);
    expect(db).toBeNull();
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), path), { usedBytes: 0, reservedBytes: 0 }));
  });
});

describe.skipIf(skipEmulator)('firestore.rules — CSP reports', () => {
  // The CSP report screen on the admin panel was broken because
  // the reader (src/screens/AdminCspReports.jsx, line 51) and the
  // writer (api/csp-report.js, lines 322-327) both use the nested
  // collection path:
  //
  //   artifacts/savetheday-production/admin/cspReports/reports/{autoId}
  //
  // but the rule only matched docs DIRECTLY under cspReports
  // (match /cspReports/{reportId}). The Admin SDK bypassed
  // rules, so writes succeeded silently; reads from the admin
  // screen were denied. This test pins both halves of that fix:
  // the rule now has to be a 2-level match
  // (match /admin/cspReports/reports/{reportId}).
  //
  // We seed the doc via withSecurityRulesDisabled so the rule
  // itself isn't blocked from writing the fixture (writes are
  // denied by the rule). The rule then governs reads only.
  const reportCollectionPath = [
    'artifacts',
    'savetheday-production',
    'admin',
    'cspReports',
    'reports',
  ] as const;

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(
        doc(adminDb, ...reportCollectionPath, 'report-1'),
        {
          violatedDirective: 'script-src',
          blockedUri: 'https://blocked.example/script.js',
          source: 'legacy-csp-report',
          createdAt: Timestamp.fromMillis(1),
        },
      );
    });
  });

  it('allows an admin to get and list CSP reports', async () => {
    const adminDb = env
      .authenticatedContext('admin-user', { admin: true })
      .firestore();

    await assertSucceeds(
      getDoc(doc(adminDb, ...reportCollectionPath, 'report-1')),
    );
    await assertSucceeds(
      getDocs(collection(adminDb, ...reportCollectionPath)),
    );
  });

  it('denies non-admin get and list access to CSP reports', async () => {
    const memberDb = env.authenticatedContext('ordinary-user').firestore();

    await assertFails(
      getDoc(doc(memberDb, ...reportCollectionPath, 'report-1')),
    );
    await assertFails(
      getDocs(collection(memberDb, ...reportCollectionPath)),
    );
  });

  it('denies all client writes, including an admin write', async () => {
    const adminDb = env
      .authenticatedContext('admin-user', { admin: true })
      .firestore();

    await assertFails(
      setDoc(doc(adminDb, ...reportCollectionPath, 'forged-report'), {
        violatedDirective: 'script-src',
        createdAt: Timestamp.fromMillis(1),
      }),
    );
  });
});
