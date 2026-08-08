// 2026-08-09 — useRecentProposals.test.js
//
// Regression: the Aug 7 bell bug. The hook used `orderBy('createdAt', 'desc')`
// in the Firestore query, which requires a composite index on
// (coupleUid ASC, createdAt DESC) on /proposals. Without that index, the
// Firestore SDK throws `FirebaseError: The query requires an index`.
//
// This test enforces the fix: the hook must NOT use orderBy in its
// query, and must sort client-side via toMillis() on the createdAt
// timestamp. If someone reverts the fix, the test fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted above all top-level imports/declarations, so we
// use vi.hoisted() to make the mock instance available from inside the
// hoisted factory (which is the only place vi.mock can run).
const mocks = vi.hoisted(() => {
  const ref = { current: null };
  const onSnapshot = vi.fn((q, onNext, onError) => {
    ref.current = q;
    setTimeout(() => onNext({ docs: [] }), 0);
    return () => {};
  });
  return { ref, onSnapshot };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((db, name) => ({ __isCollection: true, db, name })),
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
import { useRecentProposals } from './useRecentProposals';

describe('useRecentProposals', () => {
  beforeEach(() => {
    mocks.ref.current = null;
    mocks.onSnapshot.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT use orderBy in the Firestore query (avoids the index requirement)', async () => {
    renderHook(() =>
      useRecentProposals({ coupleUid: 'couple-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.ref.current).not.toBeNull());

    // Inspect the query args: the hook must pass only collection + where.
    // If someone re-adds orderBy, this test fails.
    const queryArgs = mocks.ref.current.args;
    const hasOrderBy = queryArgs.some(
      (a) => a && a.__isOrderBy === true,
    );
    expect(hasOrderBy).toBe(false);
  });

  it('does NOT use limit in the Firestore query (sort+slice happens client-side)', async () => {
    renderHook(() =>
      useRecentProposals({ coupleUid: 'couple-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.ref.current).not.toBeNull());

    const queryArgs = mocks.ref.current.args;
    const hasLimit = queryArgs.some(
      (a) => a && a.__isLimit === true,
    );
    expect(hasLimit).toBe(false);
  });

  it('filters by coupleUid', async () => {
    renderHook(() =>
      useRecentProposals({ coupleUid: 'couple-1', enabled: true }),
    );

    await waitFor(() => expect(mocks.ref.current).not.toBeNull());

    const queryArgs = mocks.ref.current.args;
    const whereClause = queryArgs.find((a) => a && a.__isWhere);
    expect(whereClause).toBeDefined();
    expect(whereClause.args).toEqual(['coupleUid', '==', 'couple-1']);
  });

  it('does NOT subscribe when disabled', async () => {
    renderHook(() => useRecentProposals({ coupleUid: 'couple-1', enabled: false }));

    // Give it a tick to (not) call onSnapshot
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('does NOT subscribe without coupleUid', async () => {
    renderHook(() => useRecentProposals({ coupleUid: null, enabled: true }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });
});
