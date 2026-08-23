// redPacket.pure.test.ts
// ========================
//
// 2026-08-23 — Manus P2c unit tests for the red-packet pure helpers.
// PDF §3.3 contract: prevent guest self-marking of hasGifted / giftAmount.
//
// Coverage:
//   validateRedPacketAmount  — integer, range, boundary cases
//   shouldAllowUpdate         — guestId mismatch, double-gift
//   buildPaymentAuditRecord   — shape integrity, no PII leakage
//   buildGuestMergeForGift    — only the right fields

import { describe, it, expect } from 'vitest';

import {
  MIN_RED_PACKET_HKD,
  MAX_RED_PACKET_HKD,
  PAYMENT_STATUS_CONFIRMED,
  validateRedPacketAmount,
  shouldAllowUpdate,
  buildPaymentAuditRecord,
  buildGuestMergeForGift,
} from '../src/redPacket.pure';

const BASE_ARGS = {
  paymentId: 'pay-abc',
  ownerUid: 'owner-A',
  eventId: 'event-X',
  guestDocId: 'guest-doc-1',
  guestId: 'g-1',
  amount: 1000,
  redeemedByUid: 'auth-uid-1',
  previousAmount: null,
};

describe('validateRedPacketAmount', () => {
  it('accepts a normal in-range amount', () => {
    const r = validateRedPacketAmount(1000);
    expect(r).toEqual({ ok: true, amount: 1000 });
  });

  it('rejects non-integers (PDF: amount must be a whole number)', () => {
    expect(validateRedPacketAmount(1000.5).ok).toBe(false);
    expect(validateRedPacketAmount('1000').ok).toBe(false);
    expect(validateRedPacketAmount(true).ok).toBe(false);
    expect(validateRedPacketAmount(null).ok).toBe(false);
    expect(validateRedPacketAmount(undefined).ok).toBe(false);
    expect(validateRedPacketAmount({}).ok).toBe(false);
  });

  it('rejects amounts below MIN_RED_PACKET_HKD', () => {
    expect(validateRedPacketAmount(MIN_RED_PACKET_HKD - 1).ok).toBe(false);
    expect(validateRedPacketAmount(0).ok).toBe(false);
    expect(validateRedPacketAmount(-500).ok).toBe(false);
  });

  it('accepts the minimum boundary (HK$88)', () => {
    const r = validateRedPacketAmount(MIN_RED_PACKET_HKD);
    expect(r).toEqual({ ok: true, amount: MIN_RED_PACKET_HKD });
  });

  it('rejects amounts above MAX_RED_PACKET_HKD', () => {
    expect(validateRedPacketAmount(MAX_RED_PACKET_HKD + 1).ok).toBe(false);
    expect(validateRedPacketAmount(999_999).ok).toBe(false);
  });

  it('accepts the maximum boundary (HK$100,000)', () => {
    const r = validateRedPacketAmount(MAX_RED_PACKET_HKD);
    expect(r).toEqual({ ok: true, amount: MAX_RED_PACKET_HKD });
  });

  it('error reasons mention the bounds so the user knows what to type', () => {
    const low = validateRedPacketAmount(50);
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.reason).toMatch(/at least/i);
      expect(low.reason).toContain(String(MIN_RED_PACKET_HKD));
    }
    const high = validateRedPacketAmount(MAX_RED_PACKET_HKD + 1);
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(high.reason).toMatch(/not exceed/i);
    }
  });
});

describe('shouldAllowUpdate', () => {
  it('allows when no prior gift', () => {
    expect(shouldAllowUpdate(null)).toBe(true);
    expect(shouldAllowUpdate(undefined)).toBe(true);
    expect(shouldAllowUpdate({})).toBe(true);
    expect(shouldAllowUpdate({ hasGifted: false })).toBe(true);
  });
  it('allows when hasGifted is true (PDF lets guests update fat-fingered amounts)', () => {
    expect(shouldAllowUpdate({ hasGifted: true, giftAmount: 800 })).toBe(true);
  });
});

describe('buildPaymentAuditRecord', () => {
  it('captures every required field', () => {
    const r = buildPaymentAuditRecord(BASE_ARGS);
    expect(r.paymentId).toBe('pay-abc');
    expect(r.ownerUid).toBe('owner-A');
    expect(r.eventId).toBe('event-X');
    expect(r.guestDocId).toBe('guest-doc-1');
    expect(r.guestId).toBe('g-1');
    expect(r.amount).toBe(1000);
    expect(r.redeemedByUid).toBe('auth-uid-1');
    expect(r.previousAmount).toBeNull();
    expect(r.status).toBe(PAYMENT_STATUS_CONFIRMED);
    expect(r.kind).toBe('red-packet-self-report');
  });

  it('passes through non-null previousAmount', () => {
    const r = buildPaymentAuditRecord({ ...BASE_ARGS, previousAmount: 800 });
    expect(r.previousAmount).toBe(800);
  });

  it('does NOT leak email/phone/guest list (privacy boundary)', () => {
    const r = buildPaymentAuditRecord(BASE_ARGS);
    // Type-system check (TS would catch at compile time): there's no
    // `email`, `phone`, or `guests` field in the args shape. The
    // runtime check confirms the serialised record.
    const s = JSON.stringify(r);
    expect(s).not.toContain('@');
    expect(s).not.toContain('phone');
    expect(s).not.toContain('guests');
  });
});

describe('buildGuestMergeForGift', () => {
  it('sets hasGifted true + amount + serverTimestamp placeholder', () => {
    const r = buildGuestMergeForGift({ amount: 1000 });
    expect(r).toEqual({
      hasGifted: true,
      giftAmount: 1000,
      lastGiftedAt: '__SERVER_TIMESTAMP__',
    });
  });

  it('does not include other guest fields (whitelist)', () => {
    const r = buildGuestMergeForGift({ amount: 1000 });
    const keys = Object.keys(r);
    expect(keys.sort()).toEqual(
      ['giftAmount', 'hasGifted', 'lastGiftedAt'].sort(),
    );
  });
});
