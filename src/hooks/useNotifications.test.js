// 2026-08-09 — useNotifications.test.js
//
// Tests the multi-source bell hook. Verifies:
//   1. Each source subscription uses the right query shape
//      (no orderBy on proposals, per-event on tasks, /helpers on
//       helpers collection).
//   2. The badge counters correctly apply per-source localStorage markers.
//   3. Merge + sort + slice cap at 20 items, newest first.
//   4. Empty/disabled states don't subscribe.
//   5. markAllNotificationsSeen writes per-source keys correctly.
//
// 2026-08-09 (later) — task comments and status updates are no longer
// aggregated in the bell. The top-level collectionGroup rules for
// those collections were broken (referenced fields that don't exist on
// the comment doc). The bell now shows proposals + new tasks for the
// current event + helpers. The corresponding tests are removed.

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
    where: vi.fn((...args) => ({ __isWhere: true, args })),
    limit: vi.fn((n) => ({ __isLimit: true, n })),
    query: vi.fn((...args) => ({ __isQuery: true, args })),
    onSnapshot: mocks.onSnapshot,
  };
});

vi.mock('../lib/firebase', () => ({
  db: { __isDb: true },
  appId: 'savetheday-production',
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useNotifications, markAllNotificationsSeen, MAX_BELL_DROPDOWN_ITEMS } from './useNotifications';

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
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', eventId: 'e-1', enabled: false }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('does NOT subscribe when all of ownerUid, coupleUid, and selfUid are null', async () => {
    // 2026-08-17 (Manus step 11) — the comment-alert subscription
    // now uses selfUid (per-user inbox) instead of ownerUid
    // (per-event subcollection), so the "no recipient identity"
    // guard now requires selfUid to also be null.
    renderHook(() =>
      useNotifications({ ownerUid: null, coupleUid: null, selfUid: null, eventId: 'e-1', enabled: true }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('subscribes to proposals with coupleUid alone (no ownerUid needed)', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: null, coupleUid: 'c-1', selfUid: 's-1', eventId: 'e-1', enabled: true }),
    );
    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(1));

    const proposalSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return args && args[0] && args[0].__isCollection && Array.isArray(args[0].args) && args[0].args[1] === 'proposals';
    });
    expect(proposalSub, 'expected a /proposals subscription').toBeDefined();
  });

  it('subscribes to proposals filtered by coupleUid (no orderBy to avoid index)', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', eventId: 'e-1', enabled: true }),
    );

    // 3 subscriptions fire in parallel: proposals + tasks (per-event) + helpers.
    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(3));

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

  it('subscribes to tasks for the current event (per-event path)', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', eventId: 'e-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(3));

    const taskSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return (
        args &&
        args[0] &&
        args[0].__isCollection &&
        args[0].args &&
        args[0].args[1] === 'artifacts' &&
        args[0].args[2] === 'savetheday-production' &&
        args[0].args[3] === 'users' &&
        args[0].args[4] === 'owner-1' &&
        args[0].args[5] === 'events' &&
        args[0].args[6] === 'e-1' &&
        args[0].args[7] === 'tasks'
      );
    });
    expect(taskSub, 'expected a /artifacts/savetheday-production/users/owner-1/events/e-1/tasks subscription').toBeDefined();
  });

  it('does NOT subscribe to tasks when eventId is missing', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', eventId: null, enabled: true }),
    );

    await new Promise((r) => setTimeout(r, 10));
    const taskSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return args && args[0] && args[0].__isCollection && Array.isArray(args[0].args) && args[0].args[args[0].args.length - 1] === 'tasks';
    });
    expect(taskSub, 'no tasks subscription without eventId').toBeUndefined();
  });

  it('subscribes to helpers for the owner', async () => {
    renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 's-1', eventId: 'e-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.refs.length).toBeGreaterThanOrEqual(3));

    const helpersSub = mocks.refs.find((r) => {
      const args = r.q.args;
      return (
        args &&
        args[0] &&
        args[0].__isCollection &&
        Array.isArray(args[0].args) &&
        args[0].args[1] === 'artifacts' &&
        args[0].args[3] === 'users' &&
        args[0].args[4] === 'owner-1' &&
        args[0].args[5] === 'helpers'
      );
    });
    expect(helpersSub, 'expected a /artifacts/savetheday-production/users/owner-1/helpers subscription').toBeDefined();
  });

  it('badge counters respect per-source localStorage markers', async () => {
    try {
      window.localStorage.setItem('lastSeenTasksAt_owner-1_e-1', '1000');
      window.localStorage.setItem('lastSeenHelperAcceptAt_owner-1', '1000');
      window.localStorage.setItem('lastSeenProposalsCount_owner-1', '0');
    } catch {
      /* ignore */
    }

    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      let docs = [];
      if (qHead?.__isCollection && qHead.args[1] === 'artifacts' && qHead.args[5] === 'events' && qHead.args[7] === 'tasks') {
        docs = [
          { id: 't1', data: () => ({ title: 'pick venue', createdAt: { toMillis: () => 2000 } }) },
        ];
      } else if (qHead?.__isCollection && qHead.args[1] === 'artifacts' && qHead.args[5] === 'helpers') {
        docs = [
          { id: 'helper-1', data: () => ({ status: 'active', name: 'Tiger', acceptedAt: { toMillis: () => 2000 } }) },
        ];
      } else if (qHead?.__isCollection && qHead.args[1] === 'proposals') {
        docs = [
          { id: 'p1', data: () => ({ jobId: 'j1', vendorName: 'V1', price: '$100', message: 'm', createdAt: { toMillis: () => 2000 } }) },
        ];
      }
      setTimeout(() => onNext({ docs: docs.map((d) => ({ id: d.id, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', eventId: 'e-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    expect(result.current.badges.proposal).toBe(1);
    expect(result.current.badges.task).toBe(1);
    expect(result.current.badges.invite).toBe(1);
    expect(result.current.totalNew).toBe(3);
  });

  it('markAllNotificationsSeen writes per-source keys (with eventId)', () => {
    markAllNotificationsSeen('owner-1', {
      proposal: 5,
      task: 999,
      invite: 999,
    }, 'e-1');

    expect(window.localStorage.getItem('lastSeenProposalsCount_owner-1')).toBe('5');
    expect(window.localStorage.getItem('lastSeenTasksAt_owner-1_e-1')).toBe('999');
    expect(window.localStorage.getItem('lastSeenHelperAcceptAt_owner-1')).toBe('999');
  });

  it('recomputes badges after markAllNotificationsSeen (event flow)', async () => {
    // 1. Start: 1 unread task (createdAt > 0 marker), 1 active helper
    window.localStorage.setItem('lastSeenTasksAt_owner-1_e-1', '0');
    window.localStorage.setItem('lastSeenHelperAcceptAt_owner-1', '0');
    window.localStorage.setItem('lastSeenProposalsCount_owner-1', '0');

    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      let docs = [];
      if (qHead?.__isCollection && qHead.args[1] === 'artifacts' && qHead.args[5] === 'events' && qHead.args[7] === 'tasks') {
        docs = [{ id: 't1', data: () => ({ title: 'pick venue', createdAt: { toMillis: () => 1000 } }) }];
      } else if (qHead?.__isCollection && qHead.args[1] === 'artifacts' && qHead.args[5] === 'helpers') {
        docs = [{ id: 'h1', data: () => ({ status: 'active', name: 'Tiger', acceptedAt: { toMillis: () => 1000 } }) }];
      } else if (qHead?.__isCollection && qHead.args[1] === 'proposals') {
        docs = [{ id: 'p1', data: () => ({ vendorName: 'V1', createdAt: { toMillis: () => 1000 } }) }];
      }
      setTimeout(() => onNext({ docs: docs.map((d) => ({ id: d.id, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', eventId: 'e-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.totalNew).toBeGreaterThan(0);
    });
    expect(result.current.badges.task).toBe(1);
    expect(result.current.badges.invite).toBe(1);

    // 2. Mark all as read
    markAllNotificationsSeen('owner-1', {
      proposal: result.current.badges.proposal ?? 0,
      task: Date.now() + 1_000_000, // future timestamp so nothing is newer
      invite: Date.now() + 1_000_000,
    }, 'e-1');

    // 3. Badge counters must update via the window event listener
    await waitFor(() => {
      expect(result.current.badges.task).toBe(0);
      expect(result.current.badges.invite).toBe(0);
    });
    expect(result.current.totalNew).toBe(0);
  });

  it('returns ALL items sorted newest-first (no truncation in hook)', async () => {
    // 2026-08-09 — the hook no longer caps merged items at 20. The bell
    // dropdown truncates client-side (in BellNotifications.jsx via
    // MAX_BELL_DROPDOWN_ITEMS); the full notifications-center view
    // shows every item. Bump the docs to 50 to verify we return all.
    const docs = [];
    for (let i = 0; i < 50; i++) {
      docs.push({
        id: `p${i}`,
        data: () => ({
          jobId: 'j',
          vendorName: `V${i}`,
          price: '$100',
          message: 'm',
          createdAt: { toMillis: () => i },
        }),
      });
    }
    mocks.onSnapshot.mockImplementation((q, onNext) => {
      const qHead = q.args[0];
      const docsForQ = qHead?.__isCollection && qHead.args[1] === 'proposals' ? docs : [];
      setTimeout(() => onNext({ docs: docsForQ.map((d) => ({ id: d.id, data: d.data })) }), 0);
      return () => {};
    });

    const { result } = renderHook(() =>
      useNotifications({ ownerUid: 'owner-1', coupleUid: 'c-1', selfUid: 'owner-1', eventId: 'e-1', enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.items.length).toBe(50);
    });

    // Newest first (createdAt.toMillis() == i, highest i wins)
    expect(result.current.items[0].actorName).toBe('V49');
    expect(result.current.items[49].actorName).toBe('V0');
  });

  it('exports MAX_BELL_DROPDOWN_ITEMS so BellNotifications can slice', () => {
    expect(typeof MAX_BELL_DROPDOWN_ITEMS).toBe('number');
    expect(MAX_BELL_DROPDOWN_ITEMS).toBe(20);
  });

  // 2026-08-17 — Big Day comment alert tests.
  //
  // The new bell category is `comment`, sourced from each
  // recipient's PRIVATE inbox at
  //   /artifacts/{appId}/users/{selfUid}/notifications/
  //   where type == 'bigday-comment'
  // The CF writes via Admin SDK (deterministic doc id
  // `bigday-comment_{commentId}_{recipientUid}` so retries can't
  // duplicate — acceptance A5). These tests pin:
  //   - the subscription path (per-user inbox, type-filter)
  //   - the envelope shape (category / actor / href / sourceKey)
  //   - the per-event timestamp badge math
  //   - mark-all-seen writes the right localStorage key
  //   - the `type == bigday-comment` filter on the inbox
  describe('comment alerts (Big Day recipient-private inbox)', () => {
    function fireCommentSnapshot(docs) {
      // Push to `refs` like the default factory impl does, so tests
      // can introspect what subscriptions the hook registered.
      mocks.onSnapshot.mockImplementation((q, onNext) => {
        mocks.refs.push({ q, onNext });
        const qHead = q.args[0];
        const qWhere = q.args[1];
        let docsForQ = [];
        if (
          qHead?.__isCollection &&
          // /artifacts/{appId}/users/{selfUid}/notifications
          qHead.args[1] === 'artifacts' &&
          qHead.args[3] === 'users' &&
          qHead.args[5] === 'notifications'
        ) {
          docsForQ = docs;
        }
        void qWhere; // The where('type','==','bigday-comment') filter
                      // is exercised in a dedicated test below.
        setTimeout(
          () => onNext({ docs: docsForQ.map((d) => ({ id: d.id, data: d.data })) }),
          0,
        );
        return () => {};
      });
    }

    it('subscribes to /users/{selfUid}/notifications (per-user inbox, not per-event)', async () => {
      fireCommentSnapshot([]);

      renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'self-uid-vendor', // vendor's own UID, NOT the couple's
          eventId: 'e-1',
          enabled: true,
        }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const matched = mocks.refs.some(({ q }) => {
        const head = q.args[0];
        return (
          head?.__isCollection &&
          head.args[1] === 'artifacts' &&
          head.args[3] === 'users' &&
          // the recipient's UID is the path's {ownerUid} — for
          // vendors / helpers this is NOT the couple's UID.
          head.args[4] === 'self-uid-vendor' &&
          head.args[5] === 'notifications'
        );
      });
      expect(matched).toBe(true);
    });

    it('applies the where(type == bigday-comment) filter to the inbox subscription', async () => {
      fireCommentSnapshot([]);

      renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'self-uid',
          enabled: true,
        }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const matched = mocks.refs.some(({ q }) => {
        const head = q.args[0];
        const filter = q.args[1];
        if (
          !head?.__isCollection ||
          head.args[5] !== 'notifications'
        ) return false;
        // The filter MUST be `where('type', '==', 'bigday-comment')`.
        return filter?.__isWhere
          && filter.args[0] === 'type'
          && filter.args[1] === '=='
          && filter.args[2] === 'bigday-comment';
      });
      expect(matched).toBe(true);
    });

    it('builds the right envelope for a vendor comment on 大日流程', async () => {
      window.localStorage.setItem('lastSeenCommentsAt_owner-1_e-1', '0');
      fireCommentSnapshot([
        {
          id: 'alert-1',
          data: () => ({
            kind: 'rundown',
            parentId: 'rd-42',
            parentTitle: '兄弟姊妹集合',
            commentId: 'c-1',
            authorUid: 'vendor-uid',
            authorName: 'Tiger Florist',
            authorRole: 'vendor',
            text: '會場已準備好',
            createdAt: { toMillis: () => 5000 },
          }),
        },
      ]);

      const { result } = renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'owner-1',
          eventId: 'e-1',
          enabled: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.items.find((i) => i.category === 'comment')).toBeTruthy();
      });

      const item = result.current.items.find((i) => i.category === 'comment');
      expect(item).toMatchObject({
        id: 'comment:alert-1',
        category: 'comment',
        actorRole: 'vendor',
        actorName: 'Tiger Florist',
        sourceKey: 'comment',
        href: {
          view: 'wedding-day',
          eventId: 'e-1',
          kind: 'rundown',
          parentId: 'rd-42',
          parentTitle: '兄弟姊妹集合',
          source: 'comment',
        },
        meta: {
          alertId: 'alert-1',
          commentId: 'c-1',
          parentId: 'rd-42',
          parentTitle: '兄弟姊妹集合',
          kind: 'rundown',
          eventId: 'e-1',
        },
      });
      expect(item.title).toContain('Tiger Florist');
      expect(item.title).toContain('大日流程');
      expect(item.preview).toBe('會場已準備好');
    });

    it('builds the right envelope for a helper comment on 物資', async () => {
      window.localStorage.setItem('lastSeenCommentsAt_owner-1_e-1', '0');
      fireCommentSnapshot([
        {
          id: 'alert-2',
          data: () => ({
            kind: 'resources',
            parentId: 'rs-7',
            parentTitle: '鮮花拱門',
            authorUid: 'helper-uid',
            authorName: '阿明',
            authorRole: 'helper',
            text: '已送到場地',
            createdAt: { toMillis: () => 5000 },
          }),
        },
      ]);

      const { result } = renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'owner-1',
          eventId: 'e-1',
          enabled: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.items.find((i) => i.category === 'comment')).toBeTruthy();
      });

      const item = result.current.items.find((i) => i.category === 'comment');
      expect(item.actorRole).toBe('helper');
      expect(item.href.kind).toBe('resources');
      expect(item.href.parentId).toBe('rs-7');
      expect(item.title).toContain('物資');
    });

    it('badges.comment counts alerts newer than the localStorage marker', async () => {
      window.localStorage.setItem('lastSeenCommentsAt_owner-1_e-1', '1000');
      fireCommentSnapshot([
        { id: 'a-new', data: () => ({ kind: 'rundown', parentId: 'r1', text: 'new', createdAt: { toMillis: () => 2000 } }) },
        { id: 'a-old', data: () => ({ kind: 'rundown', parentId: 'r2', text: 'old', createdAt: { toMillis: () => 500 } }) },
      ]);

      const { result } = renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'owner-1',
          eventId: 'e-1',
          enabled: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.badges.comment).toBe(1);
      });
      expect(result.current.totalNew).toBe(1);
    });

    it('markAllNotificationsSeen writes lastSeenCommentsAt_<ownerUid>_<eventId>', () => {
      markAllNotificationsSeen('owner-1', {
        proposal: 0,
        task: 0,
        invite: 0,
        comment: 12345,
      }, 'e-99');

      expect(window.localStorage.getItem('lastSeenCommentsAt_owner-1_e-99')).toBe('12345');
    });

    it('recomputes badges.comment after markAllNotificationsSeen', async () => {
      window.localStorage.setItem('lastSeenCommentsAt_owner-1_e-1', '0');
      fireCommentSnapshot([
        { id: 'a1', data: () => ({ kind: 'rundown', parentId: 'r1', text: 'msg', createdAt: { toMillis: () => 2000 } }) },
      ]);

      const { result } = renderHook(() =>
        useNotifications({
          ownerUid: 'owner-1',
          coupleUid: 'c-1',
          selfUid: 'owner-1',
          eventId: 'e-1',
          enabled: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.badges.comment).toBe(1);
      });

      markAllNotificationsSeen('owner-1', {
        proposal: 0,
        task: 0,
        invite: 0,
        comment: Date.now() + 1_000_000, // future, so existing alerts are no longer "newer"
      }, 'e-1');

      await waitFor(() => {
        expect(result.current.badges.comment).toBe(0);
      });
    });
  });
});
