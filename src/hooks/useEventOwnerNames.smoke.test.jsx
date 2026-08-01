// Smoke tests for useEventOwnerNames.
//
// Covers:
//   1. Initial loading state → resolves to false after first snapshot
//   2. Reads boyName / girlName from event doc snapshot
//   3. Falls back to user-level names when event has neither
//      (Commit-1 deprecation window; removed in Commit 2 migration)
//   4. saveOwnerNames calls updateOwnerNames CF with {eventId, ...}
//   5. Optimistic state updates after save
//
// 2026-08-01 — Initial release. Per-event hook subscribes to
// users/{uid}/events/{eventId} for the couple's display names.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEventOwnerNames } from './useEventOwnerNames';

vi.mock('../lib/firebase', () => ({
  db: {},
  functions: {},
  appId: 'savetheday-production',
}));

// Mutable snapshot state so each test can set up its own data.
let snapshotData = { boyName: '志明', girlName: '春嬌' };
const mockUnsub = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...path) => ({ _path: path })),
  onSnapshot: (_ref, onNext) => {
    onNext({ data: () => snapshotData });
    return mockUnsub;
  },
}));

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

describe('useEventOwnerNames', () => {
  beforeEach(() => {
    snapshotData = { boyName: '志明', girlName: '春嬌' };
    mockCallable.mockReset();
    mockUnsub.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes ownerNames from initial snapshot', async () => {
    const { result } = renderHook(() =>
      useEventOwnerNames('evt-1', 'uid-1'),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ownerNames).toEqual({ boyName: '志明', girlName: '春嬌' });
  });

  it('exposes empty names when no uid', async () => {
    const { result } = renderHook(() => useEventOwnerNames('evt-1', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ownerNames).toEqual({ boyName: '', girlName: '' });
  });

  it('falls back to user-level names when event has neither', async () => {
    snapshotData = { boyName: '', girlName: '' };
    const { result } = renderHook(() =>
      useEventOwnerNames('evt-1', 'uid-1', { boyName: '舊名', girlName: '' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ownerNames).toEqual({ boyName: '舊名', girlName: '' });
  });

  it('saveOwnerNames calls CF with eventId + names', async () => {
    mockCallable.mockResolvedValue({
      data: { ok: true, eventId: 'evt-1', boyName: 'A', girlName: 'B' },
    });
    const { result } = renderHook(() => useEventOwnerNames('evt-1', 'uid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveOwnerNames({ boyName: 'A', girlName: 'B' });
    });
    expect(mockCallable).toHaveBeenCalledWith({
      eventId: 'evt-1',
      boyName: 'A',
      girlName: 'B',
    });
  });

  it('updates optimistic state from CF return value', async () => {
    mockCallable.mockResolvedValue({
      data: { ok: true, eventId: 'evt-1', boyName: 'SERVER', girlName: '' },
    });
    const { result } = renderHook(() => useEventOwnerNames('evt-1', 'uid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveOwnerNames({ boyName: 'CLIENT', girlName: '' });
    });
    expect(result.current.ownerNames).toEqual({ boyName: 'SERVER', girlName: '' });
  });

  it('falls back to client values when CF return is missing fields', async () => {
    mockCallable.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useEventOwnerNames('evt-1', 'uid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveOwnerNames({ boyName: 'CLIENT_B', girlName: 'CLIENT_G' });
    });
    expect(result.current.ownerNames).toEqual({ boyName: 'CLIENT_B', girlName: 'CLIENT_G' });
  });
});
