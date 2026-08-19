// 2026-08-19 — Manus P1.4.a tests for useUploadPreferencesToken.
//
// The hook calls /api/firebase-proxy via callFirebaseFn to
// fetch the HMAC-signed upload-prefs token. We mock the
// helper directly and assert:
//   - the hook surfaces new quota fields (storageUsageBytes,
//     storageQuotaBytes, remainingBytes) when the CF returns
//     them;
//   - defaults hold when the legacy CF (no quota fields)
//     responds;
//   - watermarkDisabled passes through untouched;
//   - no eventId → no CF call.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { callFirebaseFnMock } = vi.hoisted(() => ({
  callFirebaseFnMock: vi.fn(),
}));

vi.mock('../lib/firebaseFn', () => ({
  callFirebaseFn: callFirebaseFnMock,
}));

const { useUploadPreferencesToken } = await import('./useUploadPreferencesToken');

describe('useUploadPreferencesToken (P1.4.a quota surfacing)', () => {
  beforeEach(() => {
    callFirebaseFnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call the CF when ownerUid or eventId is missing', async () => {
    const { result } = renderHook(() =>
      useUploadPreferencesToken({ ownerUid: null, eventId: 'event-1' }),
    );
    // First render — useEffect runs but should bail.
    await waitFor(() => {
      expect(result.current.prefsToken).toBe(null);
    });
    expect(callFirebaseFnMock).not.toHaveBeenCalled();

    const { result: result2 } = renderHook(() =>
      useUploadPreferencesToken({ ownerUid: 'couple-1', eventId: null }),
    );
    await waitFor(() => {
      expect(result2.current.prefsToken).toBe(null);
    });
    expect(callFirebaseFnMock).not.toHaveBeenCalled();
  });

  it('surfaces quota + usage fields from a current CF response', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    callFirebaseFnMock.mockResolvedValueOnce({
      token: 'mock-token',
      expiresAt,
      watermarkDisabled: true,
      // 2026-08-19 — the new fields the hook MUST propagate
      storageUsageBytes: 53 * 1024 * 1024,
      storageQuotaBytes: 200 * 1024 * 1024,
      remainingBytes: 147 * 1024 * 1024,
    });

    const { result } = renderHook(() =>
      useUploadPreferencesToken({
        ownerUid: 'couple-1',
        eventId: 'event-1',
        unlocks: ['watermark-removed'],
      }),
    );

    await waitFor(() => {
      expect(result.current.prefsToken).toBe('mock-token');
    });

    expect(result.current.watermarkDisabled).toBe(true);
    expect(result.current.storageUsageBytes).toBe(53 * 1024 * 1024);
    expect(result.current.storageQuotaBytes).toBe(200 * 1024 * 1024);
    expect(result.current.remainingBytes).toBe(147 * 1024 * 1024);

    expect(callFirebaseFnMock).toHaveBeenCalledWith(
      'getUploadPreferencesToken',
      { ownerUid: 'couple-1', eventId: 'event-1' },
    );
  });

  it('falls back to defaults when CF response is missing quota fields (legacy build)', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    // 2026-08-19 — Pretend we're talking to an old CF that
    // doesn't know about quota yet (e.g. before the deploy
    // rolled out). The hook MUST NOT crash and MUST keep
    // sensible defaults so the meter still renders.
    callFirebaseFnMock.mockResolvedValueOnce({
      token: 'legacy-token',
      expiresAt,
      watermarkDisabled: false,
    });

    const { result } = renderHook(() =>
      useUploadPreferencesToken({
        ownerUid: 'couple-1',
        eventId: 'event-1',
        unlocks: ['watermark-removed'],
      }),
    );

    await waitFor(() => {
      expect(result.current.prefsToken).toBe('legacy-token');
    });

    expect(result.current.storageUsageBytes).toBe(0);
    expect(result.current.storageQuotaBytes).toBe(200 * 1024 * 1024);
    // 0 vs 200 MB → all quota remaining
    expect(result.current.remainingBytes).toBe(200 * 1024 * 1024);
  });

  it('keeps the watermark toggle independent of quota fields', async () => {
    callFirebaseFnMock.mockResolvedValueOnce({
      token: 'tok',
      expiresAt: Date.now() + 60 * 60 * 1000,
      watermarkDisabled: false,
      storageUsageBytes: 100,
      storageQuotaBytes: 200 * 1024 * 1024,
    });

    const { result } = renderHook(() =>
      useUploadPreferencesToken({
        ownerUid: 'couple-1',
        eventId: 'event-1',
        unlocks: ['watermark-removed'],
      }),
    );
    await waitFor(() => {
      expect(result.current.prefsToken).toBe('tok');
    });
    expect(result.current.watermarkDisabled).toBe(false);
    expect(result.current.storageUsageBytes).toBe(100);
  });

  it('does not surface quota fields when CF throws — defaults hold', async () => {
    callFirebaseFnMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() =>
      useUploadPreferencesToken({
        ownerUid: 'couple-1',
        eventId: 'event-1',
        unlocks: ['watermark-removed'],
      }),
    );

    // Hook never throws; instead it leaves prefsToken null.
    await waitFor(() => {
      expect(result.current.prefsToken).toBe(null);
    });
    // 2026-08-19 — Defaults: 0 used, 200 MB free tier.
    expect(result.current.storageUsageBytes).toBe(0);
    expect(result.current.storageQuotaBytes).toBe(200 * 1024 * 1024);
    expect(result.current.remainingBytes).toBe(200 * 1024 * 1024);
  });

  it('re-fetches when the owner changes events', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    callFirebaseFnMock.mockImplementation(async (fn, args) => {
      if (args.eventId === 'event-A') {
        return {
          token: 'tok-A',
          expiresAt,
          watermarkDisabled: true,
          storageUsageBytes: 5 * 1024 * 1024,
          storageQuotaBytes: 200 * 1024 * 1024,
        };
      }
      return {
        token: 'tok-B',
        expiresAt,
        watermarkDisabled: false,
        storageUsageBytes: 80 * 1024 * 1024,
        storageQuotaBytes: 200 * 1024 * 1024,
      };
    });

    const { result, rerender } = renderHook(
      ({ ownerUid, eventId }) =>
        useUploadPreferencesToken({ ownerUid, eventId, unlocks: ['watermark-removed'] }),
      { initialProps: { ownerUid: 'couple-1', eventId: 'event-A' } },
    );

    await waitFor(() => {
      expect(result.current.prefsToken).toBe('tok-A');
    });
    expect(result.current.storageUsageBytes).toBe(5 * 1024 * 1024);

    await act(async () => {
      rerender({ ownerUid: 'couple-1', eventId: 'event-B' });
    });

    await waitFor(() => {
      expect(result.current.prefsToken).toBe('tok-B');
    });
    expect(result.current.storageUsageBytes).toBe(80 * 1024 * 1024);
    expect(callFirebaseFnMock).toHaveBeenCalledTimes(2);
  });
});