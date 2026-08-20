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

  // ---- 2026-08-20 — Manus P1.1 audit §4.1: eventId filtering.
  // Each unlock may carry an eventId. Only unlocks whose
  // eventId matches the requested eventId (or whose eventId
  // is null — legacy owner-wide) contribute to the entitlement.
  // A customer who paid for watermark removal on event A must
  // NOT get it on event B.
  describe('eventId filtering (audit §4.1)', () => {
    it('event-scoped unlock applies ONLY to its own event', () => {
      // Same customer has TWO events. They paid for
      // watermark removal ONLY on event-A. Event-B has no
      // unlock.
      const unlocks = [
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-A', grantedAt: 1 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.features.watermarkRemoved).toBe(true);
      expect(eB.features.watermarkRemoved).toBe(false);
    });

    it('legacy owner-wide unlock (eventId null) satisfies ANY event', () => {
      // Backwards compat: pre-audit unlocks had no eventId.
      // Those still apply to every event so existing
      // customers keep their paid features.
      const unlocks = [
        { type: 'watermark-removed', source: 'paid-payme', eventId: null, grantedAt: 1 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.features.watermarkRemoved).toBe(true);
      expect(eB.features.watermarkRemoved).toBe(true);
    });

    it('mix of legacy (eventId null) + per-event unlocks: legacy satisfies any, per-event only its own', () => {
      const unlocks = [
        // Legacy: applies to every event
        { type: 'custom-template', source: 'social-proof', eventId: null, grantedAt: 1 },
        // Event-scoped: only event-A
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-A', grantedAt: 2 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      // Both events get custom-template (legacy).
      expect(eA.features.customInvitation).toBe(true);
      expect(eB.features.customInvitation).toBe(true);
      // Only event-A gets watermark-removed.
      expect(eA.features.watermarkRemoved).toBe(true);
      expect(eB.features.watermarkRemoved).toBe(false);
    });

    it('two per-event unlocks of the same type on different events: each only satisfies its own event', () => {
      // Customer buys watermark-removed TWICE — once for
      // event-A, once for event-B. Each grant is scoped to
      // its own event.
      const unlocks = [
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-A', grantedAt: 1 },
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-B', grantedAt: 2 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.features.watermarkRemoved).toBe(true);
      expect(eB.features.watermarkRemoved).toBe(true);
      // A third event with no unlock is unaffected.
      const eC = computeEntitlement('owner-1', 'event-C', unlocks);
      expect(eC.features.watermarkRemoved).toBe(false);
    });

    it('per-event unlock for a different event is NOT counted (storage quota leak guard)', () => {
      // Customer paid for storage-500mb on event-A. Event-B
      // should NOT inherit the bonus — its storage limit
      // must stay at base. This is the audit §5.1 row 5
      // acceptance scenario ("Free event reaches capacity:
      // purchased storage raises only that event's server
      // limit").
      const unlocks = [
        { type: 'storage-500mb', source: 'paid-payme', eventId: 'event-A', grantedAt: 1 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.storageLimitBytes).toBe(700 * 1024 * 1024); // 200 base + 500 bonus
      expect(eB.storageLimitBytes).toBe(200 * 1024 * 1024); // base only
    });

    it('retentionClass is per-event (lifetime on event-A does NOT make event-B lifetime)', () => {
      const unlocks = [
        { type: 'permanent-archive', source: 'paid-payme', eventId: 'event-A', grantedAt: 1 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.retentionClass).toBe('lifetime');
      expect(eB.retentionClass).toBe('standard');
    });

    it('source + receiptId are computed from per-event unlocks only (not other events)', () => {
      const unlocks = [
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-A', paymentId: 'rcpt-A', grantedAt: 1 },
        { type: 'watermark-removed', source: 'paid-payme', eventId: 'event-B', paymentId: 'rcpt-B', grantedAt: 2 },
      ];
      const eA = computeEntitlement('owner-1', 'event-A', unlocks);
      const eB = computeEntitlement('owner-1', 'event-B', unlocks);
      expect(eA.receiptId).toBe('rcpt-A');
      expect(eB.receiptId).toBe('rcpt-B');
    });
  });
});
