/**
 * submitProposal must not create a second proposal or bump
 * proposalsCount when the vendor already proposed on that job.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface DocData {
  [key: string]: unknown;
}

const { state } = vi.hoisted(() => ({
  state: { docs: new Map<string, DocData>() },
}));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path: string) {
    const id = path.split('/').pop() || '';
    return {
      id,
      path,
      get: async () => {
        const data = state.docs.get(path);
        return {
          exists: data !== undefined,
          id,
          data: () => data,
        };
      },
      set: (data: DocData) => {
        state.docs.set(path, { ...data });
      },
      update: (data: DocData) => {
        const prev = { ...(state.docs.get(path) || {}) };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && '__increment' in (value as object)) {
            const inc = (value as { __increment: number }).__increment;
            const current = typeof prev[key] === 'number' ? (prev[key] as number) : 0;
            prev[key] = current + inc;
          } else {
            prev[key] = value;
          }
        }
        state.docs.set(path, prev);
      },
    };
  }

  function collectionRef(path: string) {
    return {
      doc: (id?: string) => docRef(id ? `${path}/${id}` : `${path}/auto`),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => {
          const prefix = `${path}/`;
          const docs = [...state.docs.entries()]
            .filter(([docPath, data]) => {
              if (!docPath.startsWith(prefix) || docPath.slice(prefix.length).includes('/')) {
                return false;
              }
              return data[field] === value;
            })
            .map(([docPath, data]) => ({
              id: docPath.slice(prefix.length),
              data: () => data,
            }));
          return { empty: docs.length === 0, docs, size: docs.length };
        },
      }),
    };
  }

  return {
    getFirestore: () => ({
      collection: (name: string) => collectionRef(name),
      runTransaction: async (fn: (tx: {
        get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (ref: { set: (data: DocData) => Promise<void> }, data: DocData) => void;
        update: (ref: { update: (data: DocData) => Promise<void> }, data: DocData) => void;
      }) => Promise<void>) => {
        const tx = {
          get: (ref: { get: () => Promise<unknown> }) => ref.get(),
          set: (ref: { set: (data: DocData) => void }, data: DocData) => {
            ref.set(data);
          },
          update: (ref: { update: (data: DocData) => void }, data: DocData) => {
            ref.update(data);
          },
        };
        await fn(tx);
      },
    }),
    FieldValue: {
      serverTimestamp: () => ({ __serverTimestamp: true }),
      increment: (n: number) => ({ __increment: n }),
    },
  };
});

let jobBoard: typeof import('../src/jobBoard');

beforeAll(async () => {
  jobBoard = await import('../src/jobBoard');
});

beforeEach(() => {
  state.docs.clear();
});

function seedVendor(uid = 'vendor-1') {
  state.docs.set(`vendors/${uid}`, { name: 'Sky Photo', rating: 4 });
}

function seedJob(opts: { id?: string; status?: string; proposalsCount?: number; withBoard?: boolean } = {}) {
  const id = opts.id || 'job-1';
  state.docs.set(`jobRequests/${id}`, {
    coupleUid: 'couple-1',
    status: opts.status || 'open',
    proposalsCount: opts.proposalsCount ?? 0,
  });
  if (opts.withBoard !== false) {
    state.docs.set(`jobBoard/${id}`, {
      status: opts.status || 'open',
      proposalsCount: opts.proposalsCount ?? 0,
    });
  }
}

async function submit(uid = 'vendor-1', jobId = 'job-1') {
  const fn = jobBoard.submitProposal as unknown as {
    run: (req: unknown) => Promise<{ id: string; proposalsCount: number }>;
  };
  return fn.run({
    auth: { uid },
    data: { jobId, price: 'HK$1000', message: '可以承接' },
  });
}

describe('submitProposal duplicate guard', () => {
  it('creates one proposal and increments both counters', async () => {
    seedVendor();
    seedJob();
    const result = await submit();
    expect(result.id).toBe('job-1__vendor-1');
    expect(result.proposalsCount).toBe(1);
    expect(state.docs.get('proposals/job-1__vendor-1')?.vendorUid).toBe('vendor-1');
    expect(state.docs.get('jobRequests/job-1')?.proposalsCount).toBe(1);
    expect(state.docs.get('jobBoard/job-1')?.proposalsCount).toBe(1);
  });

  it('rejects a second proposal from the same vendor without incrementing', async () => {
    seedVendor();
    seedJob();
    await submit();
    await expect(submit()).rejects.toMatchObject({ code: 'already-exists' });
    expect(state.docs.get('jobRequests/job-1')?.proposalsCount).toBe(1);
    expect(state.docs.get('jobBoard/job-1')?.proposalsCount).toBe(1);
    const proposals = [...state.docs.keys()].filter((path) => path.startsWith('proposals/'));
    expect(proposals).toEqual(['proposals/job-1__vendor-1']);
  });

  it('rejects when an older auto-id proposal from this vendor already exists', async () => {
    seedVendor();
    seedJob({ proposalsCount: 1 });
    state.docs.set('proposals/legacy-auto', {
      jobId: 'job-1',
      vendorUid: 'vendor-1',
      coupleUid: 'couple-1',
    });
    await expect(submit()).rejects.toMatchObject({ code: 'already-exists' });
    expect(state.docs.has('proposals/job-1__vendor-1')).toBe(false);
    expect(state.docs.get('jobRequests/job-1')?.proposalsCount).toBe(1);
  });

  it('still accepts a different vendor on the same job', async () => {
    seedVendor();
    seedVendor('vendor-2');
    seedJob();
    await submit('vendor-1');
    const second = await submit('vendor-2');
    expect(second.id).toBe('job-1__vendor-2');
    expect(state.docs.get('jobRequests/job-1')?.proposalsCount).toBe(2);
  });

  it('does not increment when the job is closed', async () => {
    seedVendor();
    seedJob({ status: 'closed', proposalsCount: 3 });
    await expect(submit()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.docs.get('jobRequests/job-1')?.proposalsCount).toBe(3);
    expect([...state.docs.keys()].some((path) => path.startsWith('proposals/'))).toBe(false);
  });
});
