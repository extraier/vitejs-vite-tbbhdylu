/**
 * Firestore rules unit tests — Hermes P13 seating chart
 * (savetheday-2377a).
 *
 * Covers the four new match blocks added to firestore.rules on
 * 2026-09-12:
 *
 *   1. /events/{eventId}/seating/{seatingId}
 *      — floor plan meta-doc + per-event seating config.
 *      Reads: owner + co-owner + helper (with ≥1 perm) + admin.
 *      Writes: owner + co-owner only.
 *
 *   2. /events/{eventId}/tables/{tableId}
 *      — per-physical-table geometry doc.
 *      Reads: owner + co-owner + helper (with ≥1 perm) + vendor
 *      (self-assigned) + admin. Writes: owner + co-owner only,
 *      with schema invariants.
 *
 *   3. /events/{eventId}/tableAssignments/{guestId}
 *      — guest→table mapping. Read by owner/co-owner/helper/admin;
 *      write by owner/co-owner (full CRUD) or helper (create/update
 *      restricted to non-special tables: friends/kids/colleagues/
 *      other); delete = owner/co-owner only.
 *
 *   4. /events/{eventId}/floorDecor/{decorId}
 *      — walls, doors, stage, dance floor, exits.
 *      Reads: owner + co-owner + helper + admin.
 *      Writes: owner + co-owner only.
 *
 * Run:
 *   cd functions && FIRESTORE_RULES_TEST=1 npx vitest run test/seatingRules.test.ts
 *
 * Gated by the same `FIRESTORE_RULES_TEST=1` env var as the
 * existing rules test harness — a developer without a JRE can
 * still run the rest of vitest without it.
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
  updateDoc,
  deleteDoc,
  setLogLevel,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PROJECT_ID = 'savetheday-p13-rules-test';

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
  if (env) await env.cleanup();
});

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const CO_OWNER = 'co-owner-a';
const HELPER_A = 'helper-a';
const HELPER_B = 'helper-b'; // no perms
const VENDOR_X = 'vendor-x';
const VENDOR_Y = 'vendor-y'; // NOT assigned
const ADMIN = 'admin-1';
const GUEST_LINK = 'guest-link-1';
const EVENT_ID = 'event-1';

const APP_ID = 'savetheday-production';

function seatingPath(eventId: string) {
  return `artifacts/${APP_ID}/users/${OWNER_A}/events/${eventId}`;
}

/* ---------- SEED ---------- */
async function seedStandardEvent(ctx: RulesTestContext) {
  // The owner doc is required for isOwnerOrAnyCoOwner path (and
  // for hasAnyHelperViewPerm via the helpers subcollection).
  await env.withSecurityRulesDisabled(async (writerCtx) => {
    // co-owner doc
    await writerCtx.firestore().doc(
      `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/coOwners/${CO_OWNER}`,
    ).set({ status: 'active' });

    // helper A — full perms (canEditGuests is the highest)
    await writerCtx.firestore().doc(
      `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
    ).set({
      status: 'active',
      perms: {
        canScan: true,
        canViewGuestList: true,
        canViewBudget: true,
        canViewChecklist: true,
        canViewPhotos: true,
        canUploadPhotos: false,
        canEditGuests: true,
      },
    });

    // helper B — no perms but still active (cannot be a helper of event)
    await writerCtx.firestore().doc(
      `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_B}`,
    ).set({
      status: 'active',
      perms: {
        canScan: false,
        canViewGuestList: false,
        canViewBudget: false,
        canViewChecklist: false,
        canViewPhotos: false,
        canUploadPhotos: false,
        canEditGuests: false,
      },
    });
  });

  // For rules that read owners/{ownerUid}, seed with auth context.
  // (existing pattern in vendorProjectionRules.test.ts)
  void ctx;
}

async function seedAdmin(ctx: RulesTestContext) {
  await env.withSecurityRulesDisabled(async (writerCtx) => {
    // Admin claim is on the auth token directly, no doc needed.
    // But we need a user doc for owner reads — handled in
    // seedStandardEvent.
  });
  void ctx;
}

/* ============================ SEATING META ============================ */

describe('seating/{seatingId} meta-doc (P13)', () => {
  it.skipIf(skipEmulator)('OWNER can write seating style + canvas', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`;
    await assertSucceeds(
      ctx.firestore().doc(ref).set({
        style: 'chinese',
        canvasWidth: 1200,
        canvasHeight: 800,
        background: 'banquet',
        decorElements: [],
      }),
    );
  });

  it.skipIf(skipEmulator)('CO_OWNER can write seating meta', async () => {
    const ctx = env.authenticatedContext(CO_OWNER);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`;
    await assertSucceeds(
      ctx.firestore().doc(ref).set({
        style: 'western',
        canvasWidth: 1200,
        canvasHeight: 800,
        background: 'venue',
        decorElements: [],
      }),
    );
  });

  it.skipIf(skipEmulator)('HELPER (with perms) can READ seating meta', async () => {
    // seed
    const adminCtx = env.unauthenticatedContext();
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/coOwners/${CO_OWNER}`,
      ).set({ status: 'active' });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: true,
          canViewPhotos: true, canUploadPhotos: false,
          canEditGuests: false,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`,
      ).set({
        style: 'chinese', canvasWidth: 1200, canvasHeight: 800,
        background: 'banquet', decorElements: [],
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`).get(),
    );
  });

  it.skipIf(skipEmulator)('HELPER (no perms) CANNOT read seating meta', async () => {
    const adminCtx = env.unauthenticatedContext();
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`,
      ).set({
        style: 'chinese', canvasWidth: 1200, canvasHeight: 800,
        background: 'banquet', decorElements: [],
      });
    });
    const ctx = env.authenticatedContext(HELPER_B); // no perms
    await assertFails(
      ctx.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`).get(),
    );
  });

  it.skipIf(skipEmulator)('Vendor CANNOT read seating meta (sanitized projection only)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`,
      ).set({
        style: 'chinese', canvasWidth: 1200, canvasHeight: 800,
        background: 'banquet', decorElements: [],
      });
    });
    const ctx = env.authenticatedContext(VENDOR_X);
    await assertFails(
      ctx.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`).get(),
    );
  });

  it.skipIf(skipEmulator)('helper CANNOT write seating meta (style is owner territory)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: true, canViewChecklist: true,
          canViewPhotos: true, canUploadPhotos: true,
          canEditGuests: true,
        },
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seating/main`,
      ).set({ style: 'western' }),
    );
  });
});

/* ============================ TABLES ============================ */

describe('tables/{tableId} (P13)', () => {
  const VALID_TABLE = {
    label: 'T-01',
    shape: 'round',
    capacity: 10,
    tableCategory: 'friends',
    x: 100,
    y: 200,
    rotation: 0,
    source: 'manual',
  };

  it.skipIf(skipEmulator)('owner creates a valid table', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`;
    await assertSucceeds(ctx.firestore().doc(ref).set(VALID_TABLE));
  });

  it.skipIf(skipEmulator)('owner rejects capacity=0', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t2`;
    await assertFails(
      ctx.firestore().doc(ref).set({ ...VALID_TABLE, capacity: 0 }),
    );
  });

  it.skipIf(skipEmulator)('owner rejects capacity=41 (over cap)', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t3`;
    await assertFails(
      ctx.firestore().doc(ref).set({ ...VALID_TABLE, capacity: 41 }),
    );
  });

  it.skipIf(skipEmulator)('owner rejects shape="pentagon" (not in enum)', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t4`;
    await assertFails(
      ctx.firestore().doc(ref).set({ ...VALID_TABLE, shape: 'pentagon' }),
    );
  });

  it.skipIf(skipEmulator)('owner rejects tableCategory="random" (not in enum)', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t5`;
    await assertFails(
      ctx.firestore().doc(ref).set({ ...VALID_TABLE, tableCategory: 'random' }),
    );
  });

  it.skipIf(skipEmulator)('owner rejects rotation=271 (> 270)', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t6`;
    await assertFails(
      ctx.firestore().doc(ref).set({ ...VALID_TABLE, rotation: 271 }),
    );
  });

  it.skipIf(skipEmulator)('co-owner creates a valid table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/coOwners/${CO_OWNER}`,
      ).set({ status: 'active' });
    });
    const ctx = env.authenticatedContext(CO_OWNER);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-co`;
    await assertSucceeds(ctx.firestore().doc(ref).set(VALID_TABLE));
  });

  it.skipIf(skipEmulator)('helper CANNOT create a table (owner/co-owner only)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: true, canViewChecklist: true,
          canViewPhotos: true, canUploadPhotos: true,
          canEditGuests: true,
        },
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    const ref = `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-helper`;
    await assertFails(ctx.firestore().doc(ref).set(VALID_TABLE));
  });

  it.skipIf(skipEmulator)('helper CAN read tables (for drag-drop view)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: true,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: false,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-r`,
      ).set(VALID_TABLE);
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-r`).get(),
    );
  });
});

/* ============================ tableAssignments ============================ */

describe('tableAssignments/{guestId} (P13)', () => {
  const VALID_ASSIGNMENT = {
    guestId: 'guest-1',
    guestName: '張小明',
    tableId: 't1',
    seatLabel: 'A1',
    assignedBy: OWNER_A,
    assignedByRole: 'owner' as const,
    updatedAt: 1700000000000,
  };

  it.skipIf(skipEmulator)('owner creates an assignment', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`,
      ).set({
        label: 'T-01', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(OWNER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-1`,
      ).set(VALID_ASSIGNMENT),
    );
  });

  it.skipIf(skipEmulator)('co-owner creates an assignment', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/coOwners/${CO_OWNER}`,
      ).set({ status: 'active' });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`,
      ).set({
        label: 'T-01', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(CO_OWNER);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-2`,
      ).set({ ...VALID_ASSIGNMENT, guestId: 'guest-2', assignedBy: CO_OWNER, assignedByRole: 'coOwner' }),
    );
  });

  it.skipIf(skipEmulator)('helper creates an assignment on a friends table (allowed)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: false,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: false,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-friends`,
      ).set({
        label: 'T-F', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-h1`,
      ).set({
        ...VALID_ASSIGNMENT,
        guestId: 'guest-h1',
        assignedBy: HELPER_A,
        assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper DENIED to create an assignment on a bride_groom table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: false,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: false,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t-bride`,
      ).set({
        label: '主家席', shape: 'round', capacity: 12,
        tableCategory: 'bride_groom', x: 0, y: 0, rotation: 0,
        source: 'preset',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-h-bride`,
      ).set({
        ...VALID_ASSIGNMENT,
        guestId: 'guest-h-bride',
        tableId: 't-bride',
        assignedBy: HELPER_A,
        assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper DENIED to update an assignment the OWNER created', async () => {
    // owner pre-creates the assignment
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: false,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: true,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`,
      ).set({
        label: 'T-01', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-x`,
      ).set(VALID_ASSIGNMENT);
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-x`,
      ).update({ tableId: 't2' }),
    );
  });

  it.skipIf(skipEmulator)('helper DENIED to delete an assignment', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: false,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: true,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`,
      ).set({
        label: 'T-01', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-y`,
      ).set(VALID_ASSIGNMENT);
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-y`,
      ).delete(),
    );
  });
});

/* ============================ floorDecor ============================ */

describe('floorDecor/{decorId} (P13)', () => {
  it.skipIf(skipEmulator)('owner creates decor; helper reads; vendor denied', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: true,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: false,
        },
      });
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/floorDecor/d-1`,
      ).set({
        kind: 'danceFloor',
        x: 0, y: 0, width: 200, height: 200, rotation: 0,
      });
    });
    // owner can read
    const ctxOwner = env.authenticatedContext(OWNER_A);
    await assertSucceeds(
      ctxOwner.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/floorDecor/d-1`).get(),
    );
    // helper can read
    const ctxHelper = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctxHelper.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/floorDecor/d-1`).get(),
    );
    // vendor cannot
    const ctxVendor = env.authenticatedContext(VENDOR_X);
    await assertFails(
      ctxVendor.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/floorDecor/d-1`).get(),
    );
  });

  it.skipIf(skipEmulator)('helper CANNOT write floorDecor', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/helpers/${HELPER_A}`,
      ).set({
        status: 'active',
        perms: {
          canScan: true, canViewGuestList: true,
          canViewBudget: false, canViewChecklist: true,
          canViewPhotos: false, canUploadPhotos: false,
          canEditGuests: true,
        },
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/floorDecor/d-2`,
      ).set({ kind: 'wall', x: 0, y: 0, width: 100, height: 10, rotation: 0 }),
    );
  });
});

/* ============================ Cross-owner isolation ============================ */

describe('cross-owner isolation (P13)', () => {
  it.skipIf(skipEmulator)('owner-of-event-B has no read access to owner-A tables', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`,
      ).set({
        label: 'T-01', shape: 'round', capacity: 10,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(OWNER_B);
    await assertFails(
      ctx.firestore().doc(`artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/t1`).get(),
    );
  });
});

/* ============================ Helper category-scope (P13.2) ============================ */

describe('helper category-scope enforcement (P13.2)', () => {
  // P13.2 lets helpers do live seating edits — but ONLY for tables in
  // the lower-tier categories (friends / kids / colleagues / other).
  // Family tables (bride_groom / elder_family / groomsmen / bridesmaid)
  // and the ceremony table are owner-only. This validates the rule.
  //
  // To test this we need to seed a `tables/{id}` doc with the
  // target category FIRST, then attempt the assignment write as the
  // helper. The rule reads from the existing table doc.

  it.skipIf(skipEmulator)('helper CAN write assignment for a friends table', async () => {
    // seed table category=friends
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/friends-t`,
      ).set({
        label: 'T-F', shape: 'round', capacity: 8,
        tableCategory: 'friends', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-x`,
      ).set({
        guestId: 'guest-x', tableId: 'friends-t', assignedAt: 1700000000000,
        assignedBy: HELPER_A, assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper CAN write assignment for a kids table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/kids-t`,
      ).set({
        label: 'T-K', shape: 'round', capacity: 6,
        tableCategory: 'kids', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-y`,
      ).set({
        guestId: 'guest-y', tableId: 'kids-t', assignedAt: 1700000000000,
        assignedBy: HELPER_A, assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper CANNOT write assignment for an elder_family table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/elder-t`,
      ).set({
        label: 'T-E', shape: 'round', capacity: 8,
        tableCategory: 'elder_family', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-z`,
      ).set({
        guestId: 'guest-z', tableId: 'elder-t', assignedAt: 1700000000000,
        assignedBy: HELPER_A, assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper CANNOT write assignment for a bride_groom table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/bg-t`,
      ).set({
        label: 'T-BG', shape: 'round', capacity: 2,
        tableCategory: 'bride_groom', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-bg`,
      ).set({
        guestId: 'guest-bg', tableId: 'bg-t', assignedAt: 1700000000000,
        assignedBy: HELPER_A, assignedByRole: 'helper',
      }),
    );
  });

  it.skipIf(skipEmulator)('helper CANNOT write assignment for a ceremony table', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tables/cer-t`,
      ).set({
        label: 'T-Cer', shape: 'rect', capacity: 4,
        tableCategory: 'ceremony', x: 0, y: 0, rotation: 0,
        source: 'manual',
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/tableAssignments/guest-cer`,
      ).set({
        guestId: 'guest-cer', tableId: 'cer-t', assignedAt: 1700000000000,
        assignedBy: HELPER_A, assignedByRole: 'helper',
      }),
    );
  });
});

/* ============================ seatingCheckIns (P13.3) ============================ */

describe('seatingCheckIns collection (P13.3)', () => {
  // ReceptionScanner writes one doc per checked-in guest at
  // /events/{eventId}/seatingCheckIns/{guestId}. Helpers + owners
  // can scan (create+update). Only owners/co-owners can delete.
  // Vendors do NOT get read access — this is operator-only data.

  it.skipIf(skipEmulator)('OWNER can write a seatingCheckIns doc', async () => {
    const ctx = env.authenticatedContext(OWNER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-x`,
      ).set({
        guestId: 'g-x', tableId: 'friends-t', scannedAt: 1700000000000,
        helperUid: OWNER_A,
      }),
    );
  });

  it.skipIf(skipEmulator)('HELPER can write a seatingCheckIns doc', async () => {
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-y`,
      ).set({
        guestId: 'g-y', tableId: null, scannedAt: 1700000000000,
        helperUid: HELPER_A,
      }),
    );
  });

  it.skipIf(skipEmulator)('HELPER can update a seatingCheckIns doc', async () => {
    // Seed as owner, then update timestamp as helper.
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-z`,
      ).set({
        guestId: 'g-z', tableId: null, scannedAt: 1700000000000,
        helperUid: OWNER_A,
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-z`,
      ).update({ scannedAt: 1700000001000 }),
    );
  });

  it.skipIf(skipEmulator)('HELPER can READ seatingCheckIns (live badge)', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-r`,
      ).set({
        guestId: 'g-r', tableId: 'friends-t', scannedAt: 1700000000000,
        helperUid: OWNER_A,
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertSucceeds(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-r`,
      ).get(),
    );
  });

  it.skipIf(skipEmulator)('HELPER cannot DELETE a seatingCheckIns doc', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-d`,
      ).set({
        guestId: 'g-d', tableId: null, scannedAt: 1700000000000,
        helperUid: OWNER_A,
      });
    });
    const ctx = env.authenticatedContext(HELPER_A);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-d`,
      ).delete(),
    );
  });

  it.skipIf(skipEmulator)('UNAUTHENTICATED cannot read seatingCheckIns', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-n`,
      ).set({
        guestId: 'g-n', tableId: null, scannedAt: 1700000000000,
        helperUid: OWNER_A,
      });
    });
    const ctx = env.unauthenticatedContext();
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-n`,
      ).get(),
    );
  });

  it.skipIf(skipEmulator)('OWNER of event-B has no read access to owner-A seatingCheckIns', async () => {
    await env.withSecurityRulesDisabled(async (writerCtx) => {
      await writerCtx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-xo`,
      ).set({
        guestId: 'g-xo', tableId: null, scannedAt: 1700000000000,
        helperUid: OWNER_A,
      });
    });
    const ctx = env.authenticatedContext(OWNER_B);
    await assertFails(
      ctx.firestore().doc(
        `artifacts/${APP_ID}/users/${OWNER_A}/events/${EVENT_ID}/seatingCheckIns/g-xo`,
      ).get(),
    );
  });
});
