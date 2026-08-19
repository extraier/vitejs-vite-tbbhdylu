// 2026-08-19 — Manus P1.2 client hook tests.
//
// The hook wraps the canonical getEventEntitlement CF in a
// thin React adapter. We mock httpsCallable so we can control
// the response shape and assert the hook's loading / error /
// refresh semantics.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { callableMock } = vi.hoisted(() => ({
  callableMock: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => callableMock),
}));

vi.mock('../lib/firebase', () => ({
  functions: { __isFunctions: true },
}));

const { useEventEntitlement } = await import('./useEventEntitlement');

const baseEntitlement = {
  scope: 'event',
  eventId: 'event-1',
  ownerUid: 'couple-1',
  features: {
    customInvitation: false,
    watermarkRemoved: false,
    extraStorage: false,
    lifetimeRetention: false,
  },
  storageLimitBytes: 200 * 1024 * 1024,
  retentionClass: 'standard',
  source: 'none',
  receiptId: null,
  computedAt: 1700000000000,
};

describe('useEventEntitlement (P1.2 client adapter)', () => {
  beforeEach(() => {
    callableMock.mockReset();
    callableMock.mockResolvedValue({ data: { ...baseEntitlement } });
  });

  it('returns default state when eventId is null', async () => {
    const { result } = renderHook(() => useEventEntitlement(null));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.features).toEqual({
      customInvitation: false,
      watermarkRemoved: false,
      extraStorage: false,
      lifetimeRetention: false,
    });
    expect(result.current.isPremium).toBe(false);
    expect(callableMock).not.toHaveBeenCalled();
  });

  it('fetches the entitlement on mount and surfaces the response', async () => {
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(callableMock).toHaveBeenCalledWith({ eventId: 'event-1' });
    expect(result.current.eventId).toBe('event-1');
    expect(result.current.storageLimitBytes).toBe(200 * 1024 * 1024);
    expect(result.current.isPremium).toBe(false);
  });

  it('isPremium is true when any feature is enabled', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        ...baseEntitlement,
        features: { ...baseEntitlement.features, customInvitation: true },
      },
    });
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isPremium).toBe(true);
    expect(result.current.features.customInvitation).toBe(true);
  });

  it('isPremium is true when lifetimeRetention is enabled', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        ...baseEntitlement,
        features: { ...baseEntitlement.features, lifetimeRetention: true },
        retentionClass: 'lifetime',
      },
    });
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isPremium).toBe(true);
    expect(result.current.retentionClass).toBe('lifetime');
  });

  it('returns 700MB storageLimitBytes when extraStorage is unlocked', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        ...baseEntitlement,
        features: { ...baseEntitlement.features, extraStorage: true },
        storageLimitBytes: 700 * 1024 * 1024,
      },
    });
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.storageLimitBytes).toBe(700 * 1024 * 1024);
  });

  it('falls back to default state when the callable throws', async () => {
    callableMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // 2026-08-19 — Defensive: errors collapse to the default
    // state so the screen doesn't render nothing. The error
    // message is surfaced for the caller to alert on.
    expect(result.current.features.customInvitation).toBe(false);
    expect(result.current.isPremium).toBe(false);
    expect(result.current.error).toBe('network down');
  });

  it('refresh() re-fetches the entitlement', async () => {
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(callableMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(callableMock).toHaveBeenCalledTimes(2);
  });

  it('refetches when the eventId changes', async () => {
    const { result, rerender } = renderHook(
      ({ eventId }) => useEventEntitlement(eventId),
      { initialProps: { eventId: 'event-1' } },
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(callableMock).toHaveBeenCalledWith({ eventId: 'event-1' });

    rerender({ eventId: 'event-2' });
    await waitFor(() => {
      expect(callableMock).toHaveBeenCalledWith({ eventId: 'event-2' });
    });
  });

  it('refetches when refreshKey prop changes', async () => {
    const { result, rerender } = renderHook(
      ({ rid }) => useEventEntitlement('event-1', { refreshKey: rid }),
      { initialProps: { rid: 0 } },
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(callableMock).toHaveBeenCalledTimes(1);

    // Simulate a payment approval — caller bumps refreshKey to
    // tell the hook to re-fetch.
    rerender({ rid: 1 });
    await waitFor(() => {
      expect(callableMock).toHaveBeenCalledTimes(2);
    });
  });

  it('surfaces storageLimitBytes / retentionClass / source / receiptId', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        ...baseEntitlement,
        source: 'paid-payme',
        receiptId: 'rcpt-42',
        retentionClass: 'lifetime',
        storageLimitBytes: 700 * 1024 * 1024,
      },
    });
    const { result } = renderHook(() => useEventEntitlement('event-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.source).toBe('paid-payme');
    expect(result.current.receiptId).toBe('rcpt-42');
    expect(result.current.retentionClass).toBe('lifetime');
    expect(result.current.storageLimitBytes).toBe(700 * 1024 * 1024);
  });
});
