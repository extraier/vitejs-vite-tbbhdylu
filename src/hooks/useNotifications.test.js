// 2026-08-09 — useNotifications.test.js
//
// Tests the multi-source bell hook. Verifies:
//   1. Each source subscription uses the right query shape
//      (no orderBy on proposals, collectionGroup on comments/statusUpdates,
//       party-to-party query on helpers).
//   2. The badge counters correctly apply per-source "last seen" markers.
//   3. Authoring filter excludes the owner's own comments/status updates.
//   4. Merge + sort + slice cap at 20 items, newest first.
//   5. Empty/disabled states don't subscribe.
//   6. markAllNotificationsSeen writes per-source keys correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so the mock state references survive the vi.mock
// hoist (factory runs before top-level imports).
const mocks = vi.hoisted(() => {
  const ref = { current: null };
  const refs = []; // collected onSnapshot calls in order
  const onSnapshot = vi.fn((q, onNext, onError) => {
    ref.current = q;
    refs.push({ q, onNext, onError });
    // Fire an empty snapshot so hooks resolve to non-loading
    setTimeout(() => {
      try { onNext({ docs: [] }); } catch { /* ignore */ }
    }, 0);
    return () => {};
  });
  return { ref, refs, onSnapshot };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((...args) => ({ __isCollection: true, args })),
    collectionGroup: vi.fn((db, name) => ({ __isCollectionGroup: true, db, name })),
    where: vi.fn((...args) => ({ __isWhere: true, args })),
    orderBy: vi.fn((...args) => ({ __isOrderBy: true, args })),
    limit: vi.fn((n) => ({ __isLimit: true, n })),
    query: vi.fn((...args) => ({ __isQuery: true, args })),
    onSnapshot: mocks.onSnapshot,
  };
});

vi.mock('../lib/firebase', () => ({
  db: { __isDb: true },
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useNotifications, markAllNotificationsSeen } from './useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    mocks.ref.current = null;
    mocks.refs.length = 0;
    mocks.onSnapshot.mockClear();
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT subscribe when enabled=false', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', enabled: false }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('does NOT subscribe when both ownerUid and coupleUid are null', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: null, coupleUid: null, selfUid: 's-1', enabled: true }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('subscribes to proposals with coupleUid alone (no ownerUid needed)', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: null, coupleUid: 'c-1', selfUid: 's-1', enabled: true }),
    );
    // Only the proposals subscription fires when ownerUid is null.
    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(1));

    // /proposals only needs coupleUid — owner/co-owner identity is
    // embedded in the proposal's coupleUid field, not on the path.
    const proposalSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return args && args[0] && args[0].__isCollection && Array.isArray(args[0].args) && args[0].args[1] === 'proposals';
    });
    expect(proposalSub, 'expected a /proposals subscription').toBeDefined();
  });

  it('subscribes to proposals filtered by coupleUid (no orderBy to avoid index)', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', enabled: true }),
    );

    // 4 subscriptions fire in parallel: proposals, comments, statusUpdates, helpers.
    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(4));

    // Find the proposals query (where coupleUid == c-1 on /proposals)
    const proposalSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return (
        args &&
        args[0] &&
        args[0].__isCollection &&
        args[0].args &&
        args[0].args[1] === 'proposals'
      );
    });
    expect(proposalSub, 'expected to find a /proposals subscription').toBeDefined();

    const queryArgs = proposalSub.q.args;
    const hasOrderBy = queryArgs.some((a) => a && a.__isOrderBy === true);
    expect(hasOrderBy, 'proposals query must NOT use orderBy (per fix 14b2a5c)').toBe(false);

    const whereClause = queryArgs.find((a) => a && a.__isWhere);
    expect(whereClause).toBeDefined();
    expect(whereClause.args).toEqual(['coupleUid', '==', 'c-1']);
  });

  it('subscribes to comments and statusUpdates via collectionGroup', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', enabled: true }),
    );

    // 4 subscriptions fire in parallel: proposals, comments, statusUpdates, helpers.
    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(4));

    const commentSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return args && args[0] && args[0].__isCollectionGroup && args[0].name === 'comments';
    });
    expect(commentSub, 'expected a collectionGroup(comments) subscription').toBeDefined();

    const statusSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return args && args[0] && args[0].__isCollectionGroup && args[0].name === 'statusUpdates';
    });
    expect(statusSub, 'expected a collectionGroup(statusUpdates) subscription').toBeDefined();
  });

  it('subscribes to helpers for the owner', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(4));

    const helpersSub = mocks.refs.find((r) => {
      const args = r.q.args;
      // hook calls: collection(db, 'users', 'owner-1', 'helpers')
      return (
        args &&
        args[0] &&
        args[0].__isCollection &&
        Array.isArray(args[0].args) &&
        args[0].args[1] === 'users' &&
        args[0].args[2] === 'owner-1' &&
        args[0].args[3] === 'helpers'
      );
    });
    expect(helpersSub, 'expected a /users/owner-1/helpers subscription').toBeDefined();
  });

  it('badge counters respect per-source localStorage markers', async () => {
    // Seed: comment marker = 1000 ms epoch, status marker = 1000,
    // invite marker = 1000, proposal marker = count 0.
    try {
      window.localStorage.setItem('lastSeenCommentsAt_owner-1', '1000');
      window.localStorage.setItem('lastSeenStatusAt_owner-1', '1000');
      window.localStorage.setItem('lastSeenHelperAcceptAt_owner-1', '1000');
      window.localStorage.setItem('lastSeenProposalsCount_owner-1', '0');
    } catch {
      /* ignore */
    }

    // Snapshot-factory: replace the default onSnapshot impl for this
    // test so we can hand back known docs.
    mocks.onSnapshot.mockImplementation((q, onNext, onError) => {
      const qHead = q.args[0];
      let docs = [];
      if (qHead?.__isCollection && qHead.args[1] === 'proposals') {
        docs = [
          { id: 'p1', data: () => ({ jobId: 'j1', vendorName: 'V1', price: '$100', message: 'm', createdAt: { toMillis: () => 2000 } }) },
        ];
      } else if (qHead?.__isCollectionGroup && qHead.name === 'comments') {
        docs = [
          { id: 'c1', ref: { path: 'artifacts/a/users/owner-1/events/e1/tasks/t1/comments/c1' }, data: () => ({ authorUid: 'helper-1', authorRole: 'helper', authorName: 'H1', text: 'note', createdAt: { toMillis: () => 2000 } }) },
        ];
      } else if (qHead?.__isCollectionGroup && qHead.name === 'statusUpdates') {
        docs = [
          { id: 's1', ref: { path: 'artifacts/a/users/owner-1/events/e1/tasks/t1/statusUpdates/s1' }, data: () => ({ authorUid: 'helper-1', authorRole: 'helper', authorName: 'H1', newStatus: 'done', createdAt: { toMillis: () => 2000 } }) },
        ];
      } else if (qHead?.__isCollection && qHead.args[3] === 'helpers') {
        docs = [
          { id: 'helper-1', data: () => ({ status: 'active', name: 'Tiger', acceptedAt: { toMillis: () => 2000 } }) },
        ];
      }
      setTimeout(() => onNext({ docs: docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    // Each source returns 1 item, each createdAt = 2000 > lastSeen = 1000
    expect(result.current.badges.proposal).toBe(1);
    expect(result.current.badges.comment).toBe(1);
    expect(result.current.badges.status).toBe(1);
    expect(result.current.badges.invite).toBe(1);
    expect(result.current.totalNew).toBe(4);
  });

  it('filters out comments authored by the owner herself', async () => {
    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      let docs = [];
      if (qHead?.__isCollectionGroup && qHead.name === 'comments') {
        // Owner authored one — should be filtered out
        docs = [
          { id: 'c1', ref: { path: 'artifacts/a/users/owner-1/events/e1/tasks/t1/comments/c1' }, data: () => ({ authorUid: 'owner-1', authorRole: 'owner', authorName: 'Me', text: 'self', createdAt: { toMillis: () => 2000 } }) },
          { id: 'c2', ref: { path: 'artifacts/a/users/owner-1/events/e1/tasks/t2/comments/c2' }, data: () => ({ authorUid: 'helper-1', authorRole: 'helper', authorName: 'Helper', text: 'their note', createdAt: { toMillis: () => 3000 } }) },
        ];
      }
      setTimeout(() => onNext({ docs: docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.find((it) => it.category === 'comment')).toBeDefined();
    });

    const comments = result.current.items.filter((it) => it.category === 'comment');
    expect(comments.length).toBe(1);
    expect(comments[0].actorName).toBe('Helper');
  });

  it('filters out comments on tasks belonging to OTHER owners', async () => {
    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      let docs = [];
      if (qHead?.__isCollectionGroup && qHead.name === 'comments') {
        docs = [
          // Different owner — should be filtered out
          { id: 'c1', ref: { path: 'artifacts/a/users/OTHER/events/e1/tasks/t1/comments/c1' }, data: () => ({ authorUid: 'helper-1', authorRole: 'helper', authorName: 'H1', text: 'note', createdAt: { toMillis: () => 2000 } }) },
          // Our owner — should be kept
          { id: 'c2', ref: { path: 'artifacts/a/users/owner-1/events/e1/tasks/t2/comments/c2' }, data: () => ({ authorUid: 'helper-1', authorRole: 'helper', authorName: 'H2', text: 'note2', createdAt: { toMillis: () => 3000 } }) },
        ];
      }
      setTimeout(() => onNext({ docs: docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.find((it) => it.category === 'comment')).toBeDefined();
    });

    const comments = result.current.items.filter((it) => it.category === 'comment');
    expect(comments.length).toBe(1);
    expect(comments[0].actorName).toBe('H2');
  });

  it('markAllNotificationsSeen writes per-source keys', () => {
    markAllNotificationsSeen('owner-1', {
      proposal: 5,
      comment: 999,
      status: 999,
      invite: 999,
    });

    expect(window.localStorage.getItem('lastSeenProposalsCount_owner-1')).toBe('5');
    expect(window.localStorage.getItem('lastSeenCommentsAt_owner-1')).toBe('999');
    expect(window.localStorage.getItem('lastSeenStatusAt_owner-1')).toBe('999');
    expect(window.localStorage.getItem('lastSeenHelperAcceptAt_owner-1')).toBe('999');
  });

  it('caps merged items at 20 sorted newest-first', async () => {
    // Build 30 docs across comments
    const docs = [];
    for (let i = 0; i < 30; i++) {
      docs.push({
        id: `c${i}`,
        ref: { path: `artifacts/a/users/owner-1/events/e1/tasks/t1/comments/c${i}` },
        data: () => ({
          authorUid: 'helper-1',
          authorRole: 'helper',
          authorName: `H${i}`,
          text: `note ${i}`,
          createdAt: { toMillis: () => i }, // increasing
        }),
      });
    }
    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      const docsForQ = qHead?.__isCollectionGroup && qHead.name === 'comments' ? docs : [];
      setTimeout(() => onNext({ docs: docsForQ.map((d) => ({ id: d.id, ref: d.ref, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.length).toBe(20);
    });

    // Newest first
    expect(result.current.items[0].actorName).toBe('H29');
    expect(result.current.items[19].actorName).toBe('H10');
  });
});
