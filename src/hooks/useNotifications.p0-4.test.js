// 2026-08-19 — Manus P0.4 unit tests for role-gated listener
// subscription in the notification hook.
//
// P0.4: vendor / helper sessions must NOT open the owner-only
// firestore listeners (proposals, tasks, helper-invites). Only
// the Big Day comment inbox (selfUid-scoped) should be open
// for these roles. The hook already exposes the right
// localStorage / Firestore contract; this test guards that the
// wiring done in P0.4 doesn't regress.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const refs = [];
  const onSnapshot = vi.fn((q, onNext) => {
    refs.push({ q, onNext });
    setTimeout(() => {
      try { onNext({ docs: [] }); } catch { /* ignore */ }
    }, 0);
    return () => {};
  });
  return { refs, onSnapshot };
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args) => ({ __isCollection: true, args })),
  doc: vi.fn((...args) => ({ __isDoc: true, args })),
  FieldValue: { serverTimestamp: () => ({ __isServerTimestamp: true }) },
  serverTimestamp: () => ({ __isServerTimestamp: true }), // 2026-08-20 — see useNotifications.js import comment
  limit: vi.fn((n) => ({ __isLimit: true, n })),
  where: vi.fn((...args) => ({ __isWhere: true, args })),
  query: vi.fn((...args) => ({ __isQuery: true, args })),
  onSnapshot: mocks.onSnapshot,
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../lib/firebase', () => ({
  db: { __isDb: true },
  appId: 'savetheday-production',
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useNotifications } from './useNotifications';

// Find a subscription whose query targets the given segment at
// index `idx` within the first collection reference. The hook
// builds queries like:
//   /proposals                         (Source 1)
//   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/tasks
//                                      (Source 2)
//   /artifacts/{appId}/users/{ownerUid}/helpers
//                                      (Source 3)
//   /artifacts/{appId}/users/{selfUid}/notifications
//                                      (Source 4)
function subscriptionsTo(path) {
  return mocks.refs.filter((r) => {
    const first = r.q?.args?.[0];
    return first?.__isCollection && first.args.includes(path);
  });
}

function notificationsSubscriptions() {
  return mocks.refs.filter((r) => {
    const first = r.q?.args?.[0];
    return (
      first?.__isCollection &&
      first.args[1] === 'artifacts' &&
      first.args[3] === 'users' &&
      first.args[5] === 'notifications'
    );
  });
}

const baseArgs = {
  ownerUid: 'couple-1',
  coupleUid: 'couple-1',
  selfUid: 'user-1',
  eventId: 'event-1',
};

describe('useNotifications — P0.4 role-gated listener subscriptions', () => {
  beforeEach(() => {
    mocks.refs.length = 0;
    mocks.onSnapshot.mockClear();
  });

  it('owner opens all four listeners (proposals, tasks, helpers, notifications)', async () => {
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'owner' }),
    );
    await waitFor(() => {
      expect(mocks.refs.length).toBeGreaterThanOrEqual(4);
    });
    expect(subscriptionsTo('proposals').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('tasks').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('helpers').length).toBeGreaterThanOrEqual(1);
    expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
  });

  it('co-owner also opens all four listeners (mirrors owner)', async () => {
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'co-owner' }),
    );
    await waitFor(() => {
      expect(mocks.refs.length).toBeGreaterThanOrEqual(4);
    });
    expect(subscriptionsTo('proposals').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('tasks').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('helpers').length).toBeGreaterThanOrEqual(1);
    expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
  });

  it('vendor does NOT open the proposals / tasks / helpers listeners', async () => {
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'vendor' }),
    );
    await waitFor(() => {
      // Wait for the comment inbox to open; that's the only one
      // vendor should have.
      expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
    });
    // The three owner-only listeners must be absent.
    expect(subscriptionsTo('proposals').length).toBe(0);
    expect(subscriptionsTo('tasks').length).toBe(0);
    expect(subscriptionsTo('helpers').length).toBe(0);
  });

  it('helper does NOT open the proposals / tasks / helpers listeners', async () => {
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'helper' }),
    );
    await waitFor(() => {
      expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
    });
    expect(subscriptionsTo('proposals').length).toBe(0);
    expect(subscriptionsTo('tasks').length).toBe(0);
    expect(subscriptionsTo('helpers').length).toBe(0);
  });

  it('vendor still opens the Big Day comment inbox (selfUid-scoped)', async () => {
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'vendor' }),
    );
    await waitFor(() => {
      expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
    });
    // The notifications subscription must target the vendor's
    // own /users/{selfUid}/notifications (not the couple's
    // collection).
    const sub = notificationsSubscriptions()[0];
    const args = sub.q.args[0].args;
    expect(args[1]).toBe('artifacts');
    expect(args[3]).toBe('users');
    expect(args[4]).toBe('user-1'); // selfUid
    expect(args[5]).toBe('notifications');
  });

  it('omitted userRole defaults to owner (back-compat)', async () => {
    renderHook(() => useNotifications({ ...baseArgs }));
    await waitFor(() => {
      expect(mocks.refs.length).toBeGreaterThanOrEqual(4);
    });
    expect(subscriptionsTo('proposals').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('tasks').length).toBeGreaterThanOrEqual(1);
    expect(subscriptionsTo('helpers').length).toBeGreaterThanOrEqual(1);
  });

  it('partner role does NOT open any owner-only sources', async () => {
    // Defensive: a future role like "partner" or "guest" should
    // fall through to the non-owner path and never open the
    // private couple-scoped collections.
    renderHook(() =>
      useNotifications({ ...baseArgs, userRole: 'partner' }),
    );
    await waitFor(() => {
      expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
    });
    expect(subscriptionsTo('proposals').length).toBe(0);
    expect(subscriptionsTo('tasks').length).toBe(0);
    expect(subscriptionsTo('helpers').length).toBe(0);
  });

  it('vendor with no coupleUid still opens the comment inbox', async () => {
    // A vendor viewing the bell isn't necessarily mapped to a
    // couple at this moment. The comment inbox should still
    // open as long as we have selfUid.
    renderHook(() =>
      useNotifications({
        ...baseArgs,
        userRole: 'vendor',
        coupleUid: null,
        ownerUid: null,
        eventId: null,
      }),
    );
    await waitFor(() => {
      expect(notificationsSubscriptions().length).toBeGreaterThanOrEqual(1);
    });
  });
});