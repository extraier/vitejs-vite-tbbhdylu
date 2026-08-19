// 2026-08-19 — Manus P1.2 unit tests for the pure entitlement
// resolver. The live CF (getEventEntitlement) is covered by
// the emulator; this file pins the policy without needing it.

import { describe, it, expect } from 'vitest';
import { computeEntitlement } from '../src/entitlementResolver';

const OWNER = 'couple-1';
const EVENT = 'event-A';

describe('computeEntitlement (P1.2 policy)', () => {
  it('returns all-false features for an empty unlocks list', () => {
    const e = computeEntitlement(OWNER, EVENT, []);
    expect(e.features).toEqual({
      customInvitation: false,
      watermarkRemoved: false,
      extraStorage: false,
      lifetimeRetention: false,
    });
    expect(e.storageLimitBytes).toBe(200 * 1024 * 1024); // base only
    expect(e.retentionClass).toBe('standard');
    expect(e.source).toBe('none');
    expect(e.receiptId).toBe(null);
    expect(e.scope).toBe('event');
    expect(e.eventId).toBe(EVENT);
    expect(e.ownerUid).toBe(OWNER);
  });

  it('custom-template unlock flips customInvitation only', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'paid' },
    ]);
    expect(e.features.customInvitation).toBe(true);
    expect(e.features.watermarkRemoved).toBe(false);
    expect(e.features.extraStorage).toBe(false);
    expect(e.features.lifetimeRetention).toBe(false);
  });

  it('watermark-removed unlock flips watermarkRemoved only', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'watermark-removed', source: 'paid' },
    ]);
    expect(e.features.watermarkRemoved).toBe(true);
    expect(e.features.customInvitation).toBe(false);
  });

  it('storage-500mb unlock flips extraStorage and bumps the quota', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'storage-500mb', source: 'referral' },
    ]);
    expect(e.features.extraStorage).toBe(true);
    expect(e.storageLimitBytes).toBe((200 + 500) * 1024 * 1024);
  });

  it('permanent-archive unlock flips lifetimeRetention and retentionClass', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'permanent-archive', source: 'paid' },
    ]);
    expect(e.features.lifetimeRetention).toBe(true);
    expect(e.retentionClass).toBe('lifetime');
  });

  it('combines multiple unlocks OR-style', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'watermark-removed', source: 'referral' },
      { type: 'storage-500mb', source: 'referral' },
      { type: 'custom-template', source: 'paid' },
    ]);
    expect(e.features.watermarkRemoved).toBe(true);
    expect(e.features.extraStorage).toBe(true);
    expect(e.features.customInvitation).toBe(true);
    expect(e.storageLimitBytes).toBe((200 + 500) * 1024 * 1024);
  });

  it('source priority: paid beats social-proof', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'social-proof' },
      { type: 'watermark-removed', source: 'paid-payme' },
    ]);
    // The most recent source-field on either winning with
    // priority > current. paid > social-proof → paid wins.
    expect(e.source).toBe('paid-payme');
  });

  it('source priority: paid > admin-grant > referral > social-proof', () => {
    const e1 = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'referral' },
    ]);
    expect(e1.source).toBe('referral');

    const e2 = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'admin-grant' },
    ]);
    expect(e2.source).toBe('admin-grant');

    const e3 = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'paid' },
    ]);
    expect(e3.source).toBe('paid');
  });

  it('receiptId tracks the most recent paid unlock for refund support', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'paid-payme', paymentId: 'rcpt-1' },
      { type: 'watermark-removed', source: 'paid-stripe', paymentId: 'rcpt-2' },
    ]);
    expect(e.receiptId).toBe('rcpt-2');
  });

  it('does NOT set receiptId for unpaid unlocks', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'social-proof' },
      { type: 'watermark-removed', source: 'referral' },
    ]);
    expect(e.receiptId).toBe(null);
  });

  it('handles missing/unknown grant types gracefully', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'unknown-future-flag', source: 'paid' },
      { type: 'watermark-removed', source: 'paid' },
    ]);
    // Unknown type doesn't flip anything, but the watermark
    // unlock still wins.
    expect(e.features.watermarkRemoved).toBe(true);
    expect(e.features.customInvitation).toBe(false);
    expect(e.features.lifetimeRetention).toBe(false);
  });

  it('handles empty / malformed grantedAt (always returns a number)', () => {
    const e = computeEntitlement(OWNER, EVENT, [
      { type: 'custom-template', source: 'paid' }, // no grantedAt
    ]);
    expect(e.computedAt).toBeGreaterThan(0);
    expect(typeof e.computedAt).toBe('number');
  });

  it('recency tie-break: most recent grantedAt wins when same priority', () => {
    const older = { type: 'custom-template', source: 'paid', paymentId: 'rcpt-1', grantedAt: 1700000000000 };
    const newer = { type: 'custom-template', source: 'paid', paymentId: 'rcpt-2', grantedAt: 1800000000000 };
    const e = computeEntitlement(OWNER, EVENT, [older, newer]);
    expect(e.receiptId).toBe('rcpt-2');
  });

  it('recency tie-break: toMillis() shape from Firestore serverTimestamp', () => {
    const older = { type: 'custom-template', source: 'paid', paymentId: 'rcpt-1', grantedAt: { toMillis: () => 1700000000000 } };
    const newer = { type: 'custom-template', source: 'paid', paymentId: 'rcpt-2', grantedAt: { toMillis: () => 1800000000000 } };
    const e = computeEntitlement(OWNER, EVENT, [older, newer]);
    expect(e.receiptId).toBe('rcpt-2');
  });

  it('storageLimitBytes is base + bonus (when extraStorage) OR base only', () => {
    const base = computeEntitlement(OWNER, EVENT, []);
    expect(base.storageLimitBytes).toBe(200 * 1024 * 1024);

    const bonus = computeEntitlement(OWNER, EVENT, [
      { type: 'storage-500mb', source: 'paid' },
    ]);
    expect(bonus.storageLimitBytes).toBe((200 + 500) * 1024 * 1024);
  });

  it('retentionClass is "lifetime" iff lifetimeRetention is true', () => {
    const e1 = computeEntitlement(OWNER, EVENT, []);
    expect(e1.retentionClass).toBe('standard');

    const e2 = computeEntitlement(OWNER, EVENT, [
      { type: 'permanent-archive', source: 'paid' },
    ]);
    expect(e2.retentionClass).toBe('lifetime');
  });

  it('scope and eventId are always set on the response', () => {
    const e = computeEntitlement('different-owner', 'different-event', []);
    expect(e.scope).toBe('event');
    expect(e.eventId).toBe('different-event');
    expect(e.ownerUid).toBe('different-owner');
  });
});
