/**
 * 2026-09-11 — Manus P12.1d. Callable-level integration tests
 * for `reportVendorDelay` + `approveVendorDelay`.
 *
 * Strategy: drive each callable by importing it and calling
 * the underlying Cloud Function `run()` method directly with
 * synthetic `{ auth, data }` req objects. We mock
 * `firebase-admin/firestore` with a tiny in-memory fake so
 * that the writes the callables issue land in a Map we can
 * inspect.
 *
 * What we assert:
 *   - reportVendorDelay rejects unauthenticated callers.
 *   - reportVendorDelay rejects callers who aren't the assigned vendor.
 *   - reportVendorDelay rejects invalid delayMinutes / note values.
 *   - reportVendorDelay writes a vendorDelayReports/{id} doc
 *     AND updates the projection on success.
 *   - approveVendorDelay rejects non-owner / non-co-owner callers.
 *   - approveVendorDelay on APPROVE merges
 *     `approvedDelayMinutes` + `operationalStatus='delayed'`
 *     onto the projection doc.
 *   - approveVendorDelay on REJECT records the decision but
 *     does NOT modify the projection.
 *
 * Why in-memory fake instead of @firebase/rules-unit-testing
 * or a real Firestore emulator?
 *   - The rules emulator needs a JRE (gated behind
 *     FIRESTORE_RULES_TEST=1).
 *   - We're testing the WRITER (the callable), not the rules.
 *     Admin writes always succeed on the real emulator; the
 *     in-memory fake gives equivalent coverage.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// vi.hoisted ensures the state is initialized BEFORE the
// vi.mock factory runs (vitest hoists factory calls to the
// top of the file).
interface SetOp {
  kind: 'set';
  path: string;
  data: Record<string, unknown>;
  merge: boolean;
}
interface DeleteOp {
  kind: 'delete';
  path: string;
}
type Op = SetOp | DeleteOp;
interface FakeState {
  docs: Map<string, Record<string, unknown>>;
  ops: Op[];
  /** Paths that were created via `.doc(id)` and represent a document leaf. */
  docPaths: Set<string>;
}

const { state } = vi.hoisted(() => {
  const initial: FakeState = {
    docs: new Map(),
    ops: [],
    docPaths: new Set<string>(),
  };
  return { state: initial };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: () => ({ name: 'fake-test-app' }),
}));

vi.mock('firebase-admin/firestore', () => {
  function joinPath(parent: string, child: string): string {
    if (!parent) return child;
    if (parent.endsWith('/')) return parent + child;
    return `${parent}/${child}`;
  }

  type LeafRef = {
    get?: () => Promise<unknown>;
    set?: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
    delete?: () => Promise<void>;
    doc?: (id: string) => LeafRef;
    collection?: (name: string) => LeafRef;
    where?: (field: string, op: string, value: unknown) => WhereChain;
    limit?: (n: number) => WhereChain;
  };
  type WhereChain = {
    where: (field: string, op: string, value: unknown) => WhereChain;
    limit: (n: number) => WhereChain;
    get: () => Promise<{
      empty: boolean;
      docs: Array<{ id: string; data: () => Record<string, unknown> }>;
    }>;
  };

  function makeRef(path: string): LeafRef {
    return {
      get: async () => {
        if (state.docPaths.has(path)) {
          const snap = state.docs.get(path);
          return {
            exists: !!snap,
            data: () => snap || {},
          };
        }
        // Collection-level get — return direct children.
        const directChildren = Array.from(state.docs.entries()).filter(
          ([p]) =>
            p.startsWith(path + '/') &&
            p.split('/').length === path.split('/').length + 1,
        );
        return {
          empty: directChildren.length === 0,
          docs: directChildren.map(([p, d]) => ({
            id: p.split('/').pop() || '',
            data: () => d,
          })),
        };
      },
      set: async (data, opts) => {
        const merge = !!(opts && opts.merge);
        state.ops.push({ kind: 'set', path, data, merge });
        if (merge) {
          const prev = state.docs.get(path) || {};
          state.docs.set(path, { ...prev, ...data });
        } else {
          state.docs.set(path, { ...data });
        }
      },
      delete: async () => {
        state.ops.push({ kind: 'delete', path });
        state.docs.delete(path);
      },
      doc: (id) => {
        const child = joinPath(path, id);
        state.docPaths.add(child);
        return makeRef(child);
      },
      collection: (name) => {
        const child = joinPath(path, name);
        state.docPaths.delete(child);
        return makeRef(child);
      },
      where: (field, _op, value) => makeWhere(path, field, value),
      limit: (n) => makeWhere(path, '*', '*', n),
    };
  }

  function makeWhere(
    collectionPath: string,
    _field: string,
    _value: unknown,
    _limit = 50,
  ): WhereChain {
    const chain: WhereChain = {
      where: (f, o, v) => makeWhere(collectionPath, f, v, _limit),
      limit: (n) => makeWhere(collectionPath, _field, _value, n),
      get: async () => {
        const directChildren = Array.from(state.docs.entries()).filter(
          ([p]) =>
            p.startsWith(collectionPath + '/') &&
            p.split('/').length === collectionPath.split('/').length + 1,
        );
        const docs = directChildren
          .map(([p, d]) => ({ id: p.split('/').pop() || '', data: d }))
          .filter((d) => {
            if (_field === 'status' && _value && _value !== '*') {
              return (d.data as Record<string, unknown>).status === _value;
            }
            return true;
          })
          .filter((d) => {
            if (_field === 'vendorUid' && _value && _value !== '*') {
              return (d.data as Record<string, unknown>).vendorUid === _value;
            }
            return true;
          })
          .filter((d) => {
            if (_field === 'assignedVendorUid' && _value && _value !== '*') {
              return (d.data as Record<string, unknown>).assignedVendorUid === _value;
            }
            return true;
          });
        return {
          empty: docs.length === 0,
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data as Record<string, unknown>,
          })),
        };
      },
    };
    return chain;
  }

  return {
    getFirestore: () => makeRef(''),
    FieldValue: {
      serverTimestamp: () => ({ __isServerTimestamp: true, _millis: Date.now() }),
    },
    Timestamp: {
      fromMillis: (m: number) => ({
        _seconds: Math.floor(m / 1000),
        _millis: m,
        toMillis: () => m,
      }),
    },
  };
});

// ---- import callables AFTER mocks ----

let reportModule: typeof import('../src/vendorDelayReport');

beforeAll(async () => {
  reportModule = await import('../src/vendorDelayReport');
});

beforeEach(() => {
  state.docs.clear();
  state.ops.length = 0;
  state.docPaths.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- helpers ----

const APP_ID = 'savetheday-production';
const ROOT = `artifacts/${APP_ID}/users/owner-1/events/event-1`;

interface CallableReq {
  auth: { uid: string; token?: Record<string, unknown> } | null;
  data: unknown;
}

async function runReport(req: CallableReq): Promise<unknown> {
  const fn = reportModule.reportVendorDelay as unknown as {
    run: (r: unknown) => Promise<unknown>;
  };
  return fn.run(req);
}
async function runApprove(req: CallableReq): Promise<unknown> {
  const fn = reportModule.approveVendorDelay as unknown as {
    run: (r: unknown) => Promise<unknown>;
  };
  return fn.run(req);
}

function setOps(): SetOp[] {
  return state.ops.filter((o): o is SetOp => o.kind === 'set');
}

function markPathAsDoc(path: string): void {
  state.docPaths.add(path);
}

function seedRundownEntry(opts: {
  assignedVendorUid?: string;
  approvedDelayMinutes?: number;
} = {}) {
  const path = `${ROOT}/rundown/entry-1`;
  state.docs.set(path, {
    title: '流程',
    assignedVendorUid: opts.assignedVendorUid ?? 'vendor-1',
    approvedDelayMinutes: opts.approvedDelayMinutes,
  });
  markPathAsDoc(path);
}

function seedEvent(opts: { ownerUid?: string; coOwners?: string[] } = {}) {
  const path = `${ROOT}`;
  state.docs.set(path, {
    ownerUid: opts.ownerUid ?? 'owner-1',
    coOwners: opts.coOwners ?? [],
  });
  markPathAsDoc(path);
}

function seedReport(opts: {
  reportId: string;
  status?: 'pending' | 'approved' | 'rejected';
  delayMinutes?: number;
  vendorUid?: string;
  ownerUid?: string;
  createdAt?: number;
}) {
  const path = `${ROOT}/rundown/entry-1/vendorDelayReports/${opts.reportId}`;
  state.docs.set(path, {
    id: opts.reportId,
    status: opts.status ?? 'pending',
    delayMinutes: opts.delayMinutes ?? 30,
    vendorUid: opts.vendorUid ?? 'vendor-1',
    ownerUid: opts.ownerUid ?? 'owner-1',
    eventId: 'event-1',
    entryId: 'entry-1',
    note: '',
    createdAt: { toMillis: () => opts.createdAt ?? 1700000000000 },
    updatedAt: { toMillis: () => opts.createdAt ?? 1700000000000 },
  });
  markPathAsDoc(path);
}

// ---- tests ----

describe('reportVendorDelay — auth + validation', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      runReport({
        auth: null,
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'entry-1',
          delayMinutes: 15,
          note: '',
        },
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects callers who are not the assigned vendor', async () => {
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    await expect(
      runReport({
        auth: { uid: 'someone-else' },
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'entry-1',
          delayMinutes: 15,
          note: '',
        },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects invalid delay values (negative, fractional, > 720)', async () => {
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    for (const bad of [-5, 15.5, 9999]) {
      await expect(
        runReport({
          auth: { uid: 'vendor-1' },
          data: {
            ownerUid: 'owner-1',
            eventId: 'event-1',
            parentKind: 'rundown',
            entryId: 'entry-1',
            delayMinutes: bad,
            note: '',
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  it('rejects when the parent entry does not exist (not-found before the auth check)', async () => {
    // No seedRundownEntry call → the parent entry is missing.
    await expect(
      runReport({
        auth: { uid: 'vendor-1' },
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'missing-entry',
          delayMinutes: 15,
          note: '',
        },
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('accepts a valid report from the assigned vendor and writes both the report doc AND the projection', async () => {
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    const result = await runReport({
      auth: { uid: 'vendor-1' },
      data: {
        ownerUid: 'owner-1',
        eventId: 'event-1',
        parentKind: 'rundown',
        entryId: 'entry-1',
        delayMinutes: 30,
        note: 'traffic',
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect((result as { reportId: string }).reportId).toMatch(/^vendor-1_/);

    // 1) The report doc was written.
    const reportWrite = setOps().find(
      (o) =>
        o.path.startsWith(`${ROOT}/rundown/entry-1/vendorDelayReports/`) &&
        o.data.status === 'pending',
    );
    expect(reportWrite).toBeDefined();
    expect(reportWrite!.data.delayMinutes).toBe(30);
    expect(reportWrite!.data.vendorUid).toBe('vendor-1');

    // 2) The projection's reportedDelayMinutes was merged.
    const projectionWrite = setOps().find(
      (o) => o.path === `${ROOT}/vendorViews/vendor-1/rundown/entry-1`,
    );
    expect(projectionWrite).toBeDefined();
    expect(projectionWrite!.data.reportedDelayMinutes).toBe(30);
  });
});

describe('approveVendorDelay — auth + projection merge', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      runApprove({
        auth: null,
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'entry-1',
          reportId: 'rpt-1',
          decision: 'approve',
        },
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects non-owner / non-co-owner callers', async () => {
    seedEvent({ ownerUid: 'owner-1', coOwners: [] });
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    seedReport({ reportId: 'rpt-1', status: 'pending', delayMinutes: 30 });
    await expect(
      runApprove({
        auth: { uid: 'random-person' },
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'entry-1',
          reportId: 'rpt-1',
          decision: 'approve',
        },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects invalid decision values', async () => {
    seedEvent({ ownerUid: 'owner-1' });
    await expect(
      runApprove({
        auth: { uid: 'owner-1' },
        data: {
          ownerUid: 'owner-1',
          eventId: 'event-1',
          parentKind: 'rundown',
          entryId: 'entry-1',
          reportId: 'rpt-1',
          decision: 'maybe',
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('on APPROVE, writes approvedDelayMinutes + operationalStatus onto the projection', async () => {
    seedEvent({ ownerUid: 'owner-1' });
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    seedReport({ reportId: 'rpt-1', status: 'pending', delayMinutes: 45 });

    const result = await runApprove({
      auth: { uid: 'owner-1' },
      data: {
        ownerUid: 'owner-1',
        eventId: 'event-1',
        parentKind: 'rundown',
        entryId: 'entry-1',
        reportId: 'rpt-1',
        decision: 'approve',
      },
    });
    expect(result).toMatchObject({ ok: true, status: 'approved' });

    const projectionWrite = setOps().find(
      (o) => o.path === `${ROOT}/vendorViews/vendor-1/rundown/entry-1`,
    );
    expect(projectionWrite).toBeDefined();
    expect(projectionWrite!.data.approvedDelayMinutes).toBe(45);
    expect(projectionWrite!.data.operationalStatus).toBe('delayed');

    const reportWrite = setOps().find(
      (o) =>
        o.path === `${ROOT}/rundown/entry-1/vendorDelayReports/rpt-1` &&
        o.data.status === 'approved',
    );
    expect(reportWrite).toBeDefined();
    expect(reportWrite!.data.approvedBy).toBe('owner-1');
  });

  it('on REJECT, the projection is NOT modified; the report records the decision', async () => {
    seedEvent({ ownerUid: 'owner-1' });
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    seedReport({ reportId: 'rpt-1', status: 'pending', delayMinutes: 30 });

    const result = await runApprove({
      auth: { uid: 'owner-1' },
      data: {
        ownerUid: 'owner-1',
        eventId: 'event-1',
        parentKind: 'rundown',
        entryId: 'entry-1',
        reportId: 'rpt-1',
        decision: 'reject',
        reason: '備註時間不對',
      },
    });
    expect(result).toMatchObject({ ok: true, status: 'rejected' });

    const projectionWrite = setOps().find(
      (o) => o.path === `${ROOT}/vendorViews/vendor-1/rundown/entry-1`,
    );
    // No projection write on reject.
    expect(projectionWrite).toBeUndefined();
    const reportWrite = setOps().find(
      (o) => o.path === `${ROOT}/rundown/entry-1/vendorDelayReports/rpt-1`,
    );
    expect(reportWrite).toBeDefined();
    expect(reportWrite!.data.status).toBe('rejected');
    expect(reportWrite!.data.rejectionReason).toBe('備註時間不對');
  });

  it('co-owners can also approve', async () => {
    seedEvent({ ownerUid: 'owner-1', coOwners: ['co-owner-1'] });
    seedRundownEntry({ assignedVendorUid: 'vendor-1' });
    seedReport({ reportId: 'rpt-1', status: 'pending', delayMinutes: 20 });

    const result = await runApprove({
      auth: { uid: 'co-owner-1' },
      data: {
        ownerUid: 'owner-1',
        eventId: 'event-1',
        parentKind: 'rundown',
        entryId: 'entry-1',
        reportId: 'rpt-1',
        decision: 'approve',
      },
    });
    expect(result).toMatchObject({ ok: true, status: 'approved' });
  });
});
