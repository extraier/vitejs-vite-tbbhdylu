// 2026-08-19 — Manus P1.4.a unit tests for the storage-quota
// policy. Pins:
//   - wouldUploadExceedQuota math (boundary, drift, degenerate)
//   - assertWithinQuota error message shape
//   - buildStorageIncrement idempotency
//   - checkUploadAgainstEntitlement routes through resolveStorageQuota

import { describe, it, expect } from 'vitest';
import {
  FREE_TIER_BASE_BYTES,
  BONUS_STORAGE_BYTES,
  wouldUploadExceedQuota,
  assertWithinQuota,
  buildStorageIncrement,
  checkUploadAgainstEntitlement,
  resolveStorageQuota,
} from '../src/storageQuota';
import { computeEntitlement } from '../src/entitlementResolver';

const EMPTY_ENTITLEMENT = computeEntitlement('couple-1', 'event-A', []);

describe('storage quota constants', () => {
  it('base = 200 MB and bonus = 500 MB (matches entitlementResolver)', () => {
    expect(FREE_TIER_BASE_BYTES).toBe(200 * 1024 * 1024);
    expect(BONUS_STORAGE_BYTES).toBe(500 * 1024 * 1024);
    expect(FREE_TIER_BASE_BYTES + BONUS_STORAGE_BYTES).toBe(700 * 1024 * 1024);
  });
});

describe('resolveStorageQuota', () => {
  it('passes through entitlement.storageLimitBytes', () => {
    expect(resolveStorageQuota(EMPTY_ENTITLEMENT)).toBe(200 * 1024 * 1024);
    const bonus = computeEntitlement('couple-1', 'event-A', [{ type: 'storage-500mb', source: 'paid' }]);
    expect(resolveStorageQuota(bonus)).toBe(700 * 1024 * 1024);
  });

  it('falls back to FREE_TIER_BASE_BYTES for a malformed entitlement', () => {
    expect(resolveStorageQuota(null)).toBe(200 * 1024 * 1024);
    expect(resolveStorageQuota(undefined)).toBe(200 * 1024 * 1024);
    expect(resolveStorageQuota({})).toBe(200 * 1024 * 1024);
    expect(resolveStorageQuota({ storageLimitBytes: 0 })).toBe(0); // explicit 0 is honored
  });
});

describe('wouldUploadExceedQuota (pure math)', () => {
  it('withinQuota = true when used + add <= limit', () => {
    const r = wouldUploadExceedQuota(0, 25 * 1024 * 1024, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(true);
    expect(r.projectedUsedBytes).toBe(25 * 1024 * 1024);
    expect(r.remainingBytes).toBe(200 * 1024 * 1024);
    expect(r.overageBytes).toBe(0);
  });

  it('withinQuota = false when used + add > limit', () => {
    const r = wouldUploadExceedQuota(199 * 1024 * 1024, 25 * 1024 * 1024, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(false);
    // 199 + 25 = 224 MB; limit = 200 MB; overage = 24 MB
    expect(r.overageBytes).toBe(24 * 1024 * 1024);
    expect(r.projectedUsedBytes).toBe(224 * 1024 * 1024);
  });

  it('withinQuota = true for an empty no-op upload (add = 0)', () => {
    const r = wouldUploadExceedQuota(200 * 1024 * 1024, 0, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(true);
    expect(r.overageBytes).toBe(0);
  });

  it('withinQuota = false for any upload when already at the limit', () => {
    const r = wouldUploadExceedQuota(200 * 1024 * 1024, 1, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(false);
    expect(r.overageBytes).toBe(1);
  });

  it('withinQuota = false when already OVER the limit (drift case)', () => {
    // 2026-08-19 — Defensive: the counter can drift above the
    // limit if (a) a reservation fails to release, (b) the
    // limit is reduced (storage-500mb unlocked is later
    // removed by an admin refund). In either case, no further
    // uploads must succeed until the counter is reconciled.
    const r = wouldUploadExceedQuota(200 * 1024 * 1024 + 1, 0, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(false);
    expect(r.overageBytes).toBe(1);
  });

  it('limit = 0: any non-zero add fails (degenerate config)', () => {
    const r = wouldUploadExceedQuota(0, 1, 0);
    expect(r.withinQuota).toBe(false);
    expect(r.overageBytes).toBe(1);
  });

  it('limit = 0: empty add still passes (no harm in a no-op)', () => {
    const r = wouldUploadExceedQuota(0, 0, 0);
    expect(r.withinQuota).toBe(true);
  });

  it('normalizes negative inputs to 0 (defensive)', () => {
    const r = wouldUploadExceedQuota(-100, -50, 0);
    expect(r.usedBytes).toBe(0);
    expect(r.addBytes).toBe(0);
    expect(r.limitBytes).toBe(0);
    expect(r.withinQuota).toBe(true);
  });

  it('normalizes NaN inputs to 0 (defensive)', () => {
    const r = wouldUploadExceedQuota(NaN, NaN, NaN);
    expect(r.usedBytes).toBe(0);
    expect(r.addBytes).toBe(0);
    expect(r.limitBytes).toBe(0);
    expect(r.withinQuota).toBe(true);
  });
});

describe('assertWithinQuota', () => {
  it('does NOT throw when within quota', () => {
    const r = assertWithinQuota(0, 25 * 1024 * 1024, 200 * 1024 * 1024);
    expect(r.withinQuota).toBe(true);
  });

  it('throws Error with precise message containing MB figures', () => {
    let caught: Error | null = null;
    try {
      assertWithinQuota(199 * 1024 * 1024, 25 * 1024 * 1024, 200 * 1024 * 1024);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/storage quota exceeded/);
    expect(caught!.message).toMatch(/199\.[0-9] MB/);
    expect(caught!.message).toMatch(/25\.[0-9] MB/);
    expect(caught!.message).toMatch(/200\.[0-9] MB/);
    expect(caught!.message).toMatch(/over by 24\.[0-9] MB/);
  });

  it('already-over case is reported as "0 MB this upload" with overage', () => {
    // 2026-08-19 — drift case message: when the used count
    // already exceeds the limit and the new upload is 0-bytes
    // (somehow), the message must still mention the overage
    // so the support team can see why the upload was blocked.
    let caught: Error | null = null;
    try {
      assertWithinQuota(200 * 1024 * 1024 + 1024, 0, 200 * 1024 * 1024);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/0\.0 MB/);
    expect(caught!.message).toMatch(/over by 0\.0 MB/);
  });
});

describe('buildStorageIncrement', () => {
  it('returns a positive integer for the increment field', () => {
    const r = buildStorageIncrement(15 * 1024 * 1024);
    expect(r.storageUsageBytes).toBe(15 * 1024 * 1024);
    expect(r.storageQuotaBytes).toBeUndefined();
  });

  it('floors fractional addBytes (sub-byte precision is meaningless)', () => {
    const r = buildStorageIncrement(15 * 1024 * 1024 + 0.7);
    expect(r.storageUsageBytes).toBe(15 * 1024 * 1024);
  });

  it('normalizes negative / NaN to 0', () => {
    expect(buildStorageIncrement(-100).storageUsageBytes).toBe(0);
    expect(buildStorageIncrement(NaN).storageUsageBytes).toBe(0);
    expect(buildStorageIncrement(0).storageUsageBytes).toBe(0);
  });

  it('seeds the quota when quotaBytes is provided', () => {
    const r = buildStorageIncrement(15 * 1024 * 1024, 700 * 1024 * 1024);
    expect(r.storageQuotaBytes).toBe(700 * 1024 * 1024);
  });

  it('omits the quota field when quotaBytes is missing', () => {
    const r = buildStorageIncrement(15 * 1024 * 1024, undefined);
    expect(r.storageQuotaBytes).toBeUndefined();
  });

  it('omits the quota field when quotaBytes is zero or invalid', () => {
    expect(buildStorageIncrement(1024, 0).storageQuotaBytes).toBeUndefined();
    expect(buildStorageIncrement(1024, -5).storageQuotaBytes).toBeUndefined();
    expect(buildStorageIncrement(1024, NaN).storageQuotaBytes).toBeUndefined();
  });
});

describe('checkUploadAgainstEntitlement (composite)', () => {
  it('uses 200 MB limit for the empty entitlement', () => {
    const r = checkUploadAgainstEntitlement(EMPTY_ENTITLEMENT, 0, 25 * 1024 * 1024);
    expect(r.withinQuota).toBe(true);
    expect(r.limitBytes).toBe(200 * 1024 * 1024);
  });

  it('uses 700 MB limit when storage-500mb is unlocked', () => {
    const bonus = computeEntitlement('couple-1', 'event-A', [
      { type: 'storage-500mb', source: 'paid' },
    ]);
    const r = checkUploadAgainstEntitlement(bonus, 200 * 1024 * 1024, 1);
    // 200 + 1 = 200000001; limit = 700000000 → within
    expect(r.withinQuota).toBe(true);
    expect(r.limitBytes).toBe(700 * 1024 * 1024);
  });

  it('rejects when the upload would exceed the bonus limit', () => {
    const bonus = computeEntitlement('couple-1', 'event-A', [
      { type: 'storage-500mb', source: 'paid' },
    ]);
    const r = checkUploadAgainstEntitlement(bonus, 700 * 1024 * 1024, 25 * 1024 * 1024);
    expect(r.withinQuota).toBe(false);
    expect(r.overageBytes).toBe(25 * 1024 * 1024);
  });

  it('returns the same QuotaCheck on rejection (no throw — caller decides)', () => {
    // 2026-08-19 — The composite returns a structured check
    // (withinQuota=false) so the caller can decide whether
    // to throw, return 413, or render an upgrade upsell.
    // assertWithinQuota is the throwing variant for callers
    // who want the immediate error.
    const bonus = computeEntitlement('couple-1', 'event-A', []);
    const r = checkUploadAgainstEntitlement(bonus, 200 * 1024 * 1024, 1);
    expect(r.withinQuota).toBe(false);
    expect(r.overageBytes).toBe(1);
  });
});
