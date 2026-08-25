// 2026-08-25 — Manus P9. Tests for shouldAutoOpenManualFallback().

import { describe, expect, it } from 'vitest';
import { shouldAutoOpenManualFallback } from './manualFallback';

describe('shouldAutoOpenManualFallback', () => {
  it('opens the manual fallback for an unparseable QR', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '無效 QR Code',
        detail: '請掃描由 Save The Day 產生的嘉賓邀請 QR Code',
      }),
    ).toBe(true);
  });

  it('opens the manual fallback for an unknown guest', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '無此賓客',
        detail: 'guest-unknown',
      }),
    ).toBe(true);
  });

  it('does NOT open the manual fallback on a different wedding', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '其他婚禮的 QR Code',
        detail: '此 QR Code 不屬於目前接待處的婚禮',
      }),
    ).toBe(false);
  });

  it('does NOT open the manual fallback on a different event', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '其他活動的 QR Code',
        detail: '請確認目前已選擇正確婚禮',
      }),
    ).toBe(false);
  });

  it('does NOT open the manual fallback on a duplicate scan', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '王小明',
        detail: '已報到過 · 桌號 T1',
      }),
    ).toBe(false);
  });

  it('does NOT open the manual fallback on the loading message', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'warn',
        name: '賓客名單載入中',
        detail: '請稍候數秒後重新掃描，或使用手動搜尋',
      }),
    ).toBe(false);
  });

  it('returns false for a successful check-in result', () => {
    expect(
      shouldAutoOpenManualFallback({
        kind: 'checkin',
        guest: { id: 'g1', guestId: 'g1', name: '王小明' },
      }),
    ).toBe(false);
  });

  it('returns false for null / undefined input', () => {
    expect(shouldAutoOpenManualFallback(null)).toBe(false);
    expect(shouldAutoOpenManualFallback(undefined)).toBe(false);
  });
});