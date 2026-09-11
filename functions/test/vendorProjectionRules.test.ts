/**
 * Firestore rules unit tests — Manus P12 vendor projection + delay
 * reports (savetheday-2377a).
 *
 * Covers the three new match blocks added to firestore.rules on
 * 2026-09-11:
 *
 *   1. /events/{eventId}/vendorViews/{vendorUid}/rundown/{entryId}
 *      — the per-vendor projection fanned out by
 *      helperAssignmentTrigger. Reads gated on path binding AND a
 *      vendorAccess marker. Writes denied.
 *
 *   2. /events/{eventId}/vendorAccess/{vendorUid}
 *      — the per-(owner, event, vendor) grant marker. Read by the
 *      vendor themselves; writes denied (Admin SDK only).
 *
 *   3. /events/{eventId}/rundown/{entryId}/vendorDelayReports/{reportId}
 *      — delay reports written by the reportVendorDelay /
 *      approveVendorDelay callables (Admin SDK). Client writes
 *      denied. Reads allowed to the owner/co-owner OR the vendor
 *      currently assigned to the parent rundown entry.
 *
 * Run alongside the rest of the rules suite:
 *   cd functions && FIRESTORE_RULES_TEST=1 npx vitest run test/vendorProjectionRules.test.ts
 *
 * Or via the existing convenience script:
 *   cd functions && npm run test:rules  (re-runs firestore.rules.test.ts only)
 *
 * Gated by `FIRESTORE_RULES_TEST=1` (same env var as the existing
 * firestore.rules.test.ts harness) so a developer without a JRE can
 * still run the rest of the vitest suite.
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
  deleteDoc,
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
  await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
    await setDoc(
      doc(
        ctx.firestore(),
        'artifacts/savetheday-production/users',
        ownerUid,
        'events',
        eventId,
      ),
      { name: 'Test Wedding', coOwners },
    );
  });
}

async function seedRundownEntry(
  ownerUid: string,
  eventId: string,
  entryId: string,
  data: Record<string, unknown>,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(
        ctx.firestore(),
        'artifacts/savetheday-production/users',
        ownerUid,
        'events',
        eventId,
        'rundown',
        entryId,
      ),
      data,
    );
  });
}

async function seedVendorAccess(
  ownerUid: string,
  eventId: string,
  vendorUid: string,
) {
  // Trigger-only write; bypass rules for fixture setup.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(
        ctx.firestore(),
        'artifacts/savetheday-production/users',
        ownerUid,
        'events',
        eventId,
        'vendorAccess',
        vendorUid,
      ),
      { grantedAt: Timestamp.fromMillis(1) },
    );
  });
}

async function seedCoOwnerMarker(
  ownerUid: string,
  coOwnerUid: string,
) {
  // Matches the production /coOwners/{coOwnerUid} grant doc —
  // the authoritative source for isCoOwnerOfAnyEvent. Seed via
  // withSecurityRulesDisabled because production grants happen
  // through the redeemPartnerInviteV2 Admin SDK callable.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(
        ctx.firestore(),
        'artifacts/savetheday-production/users',
        ownerUid,
        'coOwners',
        coOwnerUid,
      ),
      { status: 'active', grantedAt: Timestamp.fromMillis(1) },
    );
  });
}

async function seedProjection(
  ownerUid: string,
  eventId: string,
  vendorUid: string,
  entryId: string,
  data: Record<string, unknown>,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(
        ctx.firestore(),
        'artifacts/savetheday-production/users',
        ownerUid,
        'events',
        eventId,
        'vendorViews',
        vendorUid,
        'rundown',
        entryId,
      ),
      data,
    );
  });
}

async function asUser(uid: string | null) {
  if (uid === null) return null;
  return env.authenticatedContext(uid).firestore();
}

// --- paths reused across tests ----------------------------------------

function vendorProjectionPath(
  ownerUid: string,
  eventId: string,
  vendorUid: string,
  entryId: string,
) {
  return `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/vendorViews/${vendorUid}/rundown/${entryId}`;
}

function vendorAccessPath(ownerUid: string, eventId: string, vendorUid: string) {
  return `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/vendorAccess/${vendorUid}`;
}

function vendorProjectionListPath(
  ownerUid: string,
  eventId: string,
  vendorUid: string,
) {
  return `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/vendorViews/${vendorUid}/rundown`;
}

function delayReportsListPath(
  ownerUid: string,
  eventId: string,
  entryId: string,
) {
  return `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/rundown/${entryId}/vendorDelayReports`;
}

// =========================================================================
// 1. Vendor projection subtree
// =========================================================================

describe.skipIf(skipEmulator)(
  'firestore.rules — vendorViews/{vendorUid}/rundown/{entryId} (P12)',
  () => {
    const ownerUid = 'couple-A';
    const eventId = 'ev-p12';
    const vendorUid = 'vendor-V';
    const otherVendorUid = 'vendor-OTHER';
    const entryId = 'entry-1';

    beforeEach(async () => {
      await seedEvent(ownerUid, eventId);
      await seedVendorAccess(ownerUid, eventId, vendorUid);
      await seedProjection(ownerUid, eventId, vendorUid, entryId, {
        ownerUid,
        eventId,
        vendorUid,
        title: 'Photographer arrives',
        startTime: '10:00',
      });
    });

    it('allows the assigned vendor to read their own projection', async () => {
      const db = (await asUser(vendorUid))!;
      await assertSucceeds(
        getDoc(doc(db, vendorProjectionPath(ownerUid, eventId, vendorUid, entryId))),
      );
      await assertSucceeds(
        getDocs(collection(db, vendorProjectionListPath(ownerUid, eventId, vendorUid))),
      );
    });

    it('denies a vendor whose vendorAccess marker is missing', async () => {
      // Seed a projection for otherVendorUid WITHOUT a vendorAccess marker.
      const otherEntryId = 'entry-markerless';
      await seedProjection(ownerUid, eventId, otherVendorUid, otherEntryId, {
        ownerUid,
        eventId,
        vendorUid: otherVendorUid,
        title: 'Cake tasting',
      });

      const db = (await asUser(otherVendorUid))!;
      await assertFails(
        getDoc(
          doc(
            db,
            vendorProjectionPath(ownerUid, eventId, otherVendorUid, otherEntryId),
          ),
        ),
      );
      await assertFails(
        getDocs(
          collection(
            db,
            vendorProjectionListPath(ownerUid, eventId, otherVendorUid),
          ),
        ),
      );
    });

    it('denies cross-vendor reads of another vendor\'s projection', async () => {
      // otherVendorUid has an access marker, but for a DIFFERENT entry.
      // When reading vendorUid's entry, the path binding fails.
      await seedVendorAccess(ownerUid, eventId, otherVendorUid);

      // otherVendorUid reading vendorUid's projection doc — wrong vendor
      // in URL → request.auth.uid != vendorUid → deny.
      const db = (await asUser(otherVendorUid))!;
      await assertFails(
        getDoc(
          doc(
            db,
            vendorProjectionPath(ownerUid, eventId, vendorUid, entryId),
          ),
        ),
      );
    });

    it('denies a vendor that updates their own projection', async () => {
      const db = (await asUser(vendorUid))!;
      await assertFails(
        updateDoc(
          doc(db, vendorProjectionPath(ownerUid, eventId, vendorUid, entryId)),
          { title: 'tampered' },
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            vendorProjectionPath(ownerUid, eventId, vendorUid, 'entry-fresh'),
          ),
          { ownerUid, eventId, vendorUid, title: 'forged' },
        ),
      );
      await assertFails(
        deleteDoc(
          doc(db, vendorProjectionPath(ownerUid, eventId, vendorUid, entryId)),
        ),
      );
    });

    it('denies the owner from writing to the projection subtree', async () => {
      // Projection is a derived view, written only by helperAssignmentTrigger
      // via Admin SDK. Even the owner cannot mutate it from the client.
      const db = (await asUser(ownerUid))!;
      await assertFails(
        updateDoc(
          doc(db, vendorProjectionPath(ownerUid, eventId, vendorUid, entryId)),
          { title: 'owner-tamper' },
        ),
      );
    });

    it('denies an unauthenticated read of the projection', async () => {
      await assertFails(
        getDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            vendorProjectionPath(ownerUid, eventId, vendorUid, entryId),
          ),
        ),
      );
    });
  },
);

// =========================================================================
// 2. Vendor access marker (server-only writes)
// =========================================================================

describe.skipIf(skipEmulator)(
  'firestore.rules — vendorAccess/{vendorUid} (P12)',
  () => {
    const ownerUid = 'couple-A';
    const eventId = 'ev-p12';
    const vendorUid = 'vendor-V';

    beforeEach(async () => {
      await seedEvent(ownerUid, eventId);
      await seedVendorAccess(ownerUid, eventId, vendorUid);
    });

    it('allows the vendor themselves to read their own access marker', async () => {
      const db = (await asUser(vendorUid))!;
      await assertSucceeds(
        getDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid))),
      );
    });

    it('denies a different vendor from reading the marker', async () => {
      const db = (await asUser('vendor-OTHER'))!;
      await assertFails(
        getDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid))),
      );
    });

    it('denies the owner from writing the access marker', async () => {
      // Owner grants / revokes vendorAccess must run via Admin SDK,
      // not directly from the client SDK. Even the owner can't write
      // from the client side.
      const db = (await asUser(ownerUid))!;
      await assertFails(
        setDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid)), {
          grantedAt: Timestamp.fromMillis(1),
        }),
      );
      await assertFails(
        updateDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid)), {
          revoked: true,
        }),
      );
      await assertFails(
        deleteDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid))),
      );
    });

    it('denies the vendor from writing their own access marker', async () => {
      const db = (await asUser(vendorUid))!;
      await assertFails(
        updateDoc(doc(db, vendorAccessPath(ownerUid, eventId, vendorUid)), {
          addOns: 'free-champagne',
        }),
      );
    });
  },
);

// =========================================================================
// 3. Vendor delay reports subcollection under /rundown/{entryId}
// =========================================================================

describe.skipIf(skipEmulator)(
  'firestore.rules — vendorDelayReports/{reportId} (P12)',
  () => {
    const ownerUid = 'couple-A';
    const coOwnerUid = 'couple-B';
    const eventId = 'ev-p12';
    const entryId = 'entry-1';
    const vendorUid = 'vendor-V';
    const unassignedVendorUid = 'vendor-UNASSIGNED';

    const delayReportPath = (
      ownerUid: string,
      eventId: string,
      entryId: string,
      reportId: string,
    ) =>
      `artifacts/savetheday-production/users/${ownerUid}/events/${eventId}/rundown/${entryId}/vendorDelayReports/${reportId}`;

    beforeEach(async () => {
      await seedEvent(ownerUid, eventId, [coOwnerUid]);
      await seedRundownEntry(ownerUid, eventId, entryId, {
        ownerUid,
        eventId,
        title: 'Photo session',
        assignedVendorUid: vendorUid,
      });
    });

    it('allows the owner to read their own delay reports', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            reportedAt: Timestamp.fromMillis(1),
            status: 'pending',
          },
        );
      });

      const db = (await asUser(ownerUid))!;
      await assertSucceeds(
        getDoc(doc(db, delayReportPath(ownerUid, eventId, entryId, 'r-1'))),
      );
      await assertSucceeds(
        getDocs(
          collection(db, delayReportsListPath(ownerUid, eventId, entryId)),
        ),
      );
    });

    it('allows a co-owner to read delay reports', async () => {
      await seedCoOwnerMarker(ownerUid, coOwnerUid);
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        );
      });

      const db = (await asUser(coOwnerUid))!;
      await assertSucceeds(
        getDoc(doc(db, delayReportPath(ownerUid, eventId, entryId, 'r-1'))),
      );
    });

    it('allows the assigned vendor to read their own delay reports', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        );
      });

      const db = (await asUser(vendorUid))!;
      await assertSucceeds(
        getDoc(doc(db, delayReportPath(ownerUid, eventId, entryId, 'r-1'))),
      );
      await assertSucceeds(
        getDocs(
          collection(db, delayReportsListPath(ownerUid, eventId, entryId)),
        ),
      );
    });

    it('denies an unassigned vendor from reading the delay reports', async () => {
      // The parent rundown entry is assigned to vendorUid, NOT to
      // unassignedVendorUid. The latter's read must fail.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        );
      });

      const db = (await asUser(unassignedVendorUid))!;
      await assertFails(
        getDoc(
          doc(db, delayReportPath(ownerUid, eventId, entryId, 'r-1')),
        ),
      );
    });

    it('denies a client trying to create a delay report directly', async () => {
      // Both the vendor and the owner must call
      // reportVendorDelay / approveVendorDelay via Admin SDK.
      // The client SDK must NOT be able to write this path.
      const vendorDb = (await asUser(vendorUid))!;
      await assertFails(
        setDoc(
          doc(
            vendorDb,
            delayReportPath(ownerUid, eventId, entryId, 'r-direct-vendor'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        ),
      );

      const ownerDb = (await asUser(ownerUid))!;
      await assertFails(
        setDoc(
          doc(
            ownerDb,
            delayReportPath(ownerUid, eventId, entryId, 'r-direct-owner'),
          ),
          {
            approvedBy: ownerUid,
            status: 'approved',
          },
        ),
      );
    });

    it('denies the owner trying to delete a delay report directly', async () => {
      // Approvals + revocations must go through approveVendorDelay (which
      // sets status + approvedAt fields, doesn't delete). The client
      // should never be able to remove the doc — only the Admin SDK can,
      // and only in rare ops paths. Even the owner cannot delete.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        );
      });

      const ownerDb = (await asUser(ownerUid))!;
      await assertFails(
        deleteDoc(
          doc(ownerDb, delayReportPath(ownerUid, eventId, entryId, 'r-1')),
        ),
      );
      await assertFails(
        updateDoc(
          doc(ownerDb, delayReportPath(ownerUid, eventId, entryId, 'r-1')),
          { status: 'tampered' },
        ),
      );
    });

    it('denies a non-owner signed-in user from reading delay reports', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(
            ctx.firestore(),
            ...delayReportPath(ownerUid, eventId, entryId, 'r-1').split('/'),
          ),
          {
            reportedBy: vendorUid,
            status: 'pending',
          },
        );
      });

      const bystanderDb = (await asUser('random-bystander'))!;
      await assertFails(
        getDoc(
          doc(bystanderDb, delayReportPath(ownerUid, eventId, entryId, 'r-1')),
        ),
      );
    });
  },
);
