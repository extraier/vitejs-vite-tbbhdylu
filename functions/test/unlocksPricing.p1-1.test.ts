// 2026-08-19 — Manus P1.1 unit tests for the server-side price
// derivation helper. Pins the policy: client sends amount, the
// server rejects anything that doesn't match the SKU price
// (within ±$1 FX tolerance). The only escape is adminOverride
// with a non-empty reason.

import { describe, it, expect } from 'vitest';
import { deriveExpectedAmount, PREMIUM_BUNDLE_PRICE } from '../src/unlocks';

describe('deriveExpectedAmount (P1.1 server-side price derivation)', () => {
  it('returns 49 for custom-template at exact price', () => {
    expect(deriveExpectedAmount('custom-template', 49, false, undefined).expectedAmount).toBe(49);
  });

  it('returns 29 for storage-500mb', () => {
    expect(deriveExpectedAmount('storage-500mb', 29, false, undefined).expectedAmount).toBe(29);
  });

  it('returns 39 for permanent-archive', () => {
    expect(deriveExpectedAmount('permanent-archive', 39, false, undefined).expectedAmount).toBe(39);
  });

  it('returns 29 for watermark-removed', () => {
    expect(deriveExpectedAmount('watermark-removed', 29, false, undefined).expectedAmount).toBe(29);
  });

  // 2026-08-23 — Manus P4.2 (PDF Patch 4): Premium bundle is now
  // the named HK$99 constant, not the sum of individual SKUs
  // (49+29+39+29 = 146). The UI has rendered HK$99 since
  // 2026-07-30; the server now matches.
  it('returns PREMIUM_BUNDLE_PRICE for bundle', () => {
    expect(deriveExpectedAmount('bundle', PREMIUM_BUNDLE_PRICE, false, undefined).expectedAmount).toBe(PREMIUM_BUNDLE_PRICE);
    expect(PREMIUM_BUNDLE_PRICE).toBe(99);
  });

  it('returns PREMIUM_BUNDLE_PRICE for premium (legacy compat)', () => {
    expect(deriveExpectedAmount('premium', PREMIUM_BUNDLE_PRICE, false, undefined).expectedAmount).toBe(PREMIUM_BUNDLE_PRICE);
  });

  // 2026-08-23 — Manus P4.2: explicit rejection of the legacy
  // 146-sum amount. If anyone re-introduces the sum-based path
  // (e.g. a refactor that loses the named constant), the server
  // must still reject paying HK$146 — that's no longer the
  // advertised price. Without this test, an old client or a
  // cached receipt for HK$146 would silently slip through.
  it('rejects the legacy 146 sum (PDF Patch 4 regression guard)', () => {
    const legacySum = 49 + 29 + 39 + 29; // 146
    expect(() => deriveExpectedAmount('bundle', legacySum, false, undefined)).toThrow(/does not match/);
    expect(() => deriveExpectedAmount('premium', legacySum, false, undefined)).toThrow(/does not match/);
    // The error message should reference the new expected amount (99),
    // not 146 — so the operator sees the right number in the error log.
    expect(() => deriveExpectedAmount('bundle', legacySum, false, undefined)).toThrow(/expected 99/);
  });

  it('tolerates ±$1 FX noise', () => {
    expect(deriveExpectedAmount('custom-template', 50, false, undefined).expectedAmount).toBe(49);
    expect(deriveExpectedAmount('custom-template', 48, false, undefined).expectedAmount).toBe(49);
  });

  it('rejects $2+ mismatch without adminOverride', () => {
    expect(() => deriveExpectedAmount('custom-template', 49 + 2, false, undefined)).toThrow(/does not match/);
    expect(() => deriveExpectedAmount('custom-template', 49 - 2, false, undefined)).toThrow(/does not match/);
  });

  it('rejects wildly wrong amount (e.g. paying 1 for a 49 USD SKU)', () => {
    // 2026-08-19 — This is the exact bug Manus flagged: a
    // customer submitting a PayMe receipt for the wrong amount
    // (or someone posting a random value) used to be accepted.
    expect(() => deriveExpectedAmount('custom-template', 1, false, undefined)).toThrow(/does not match/);
    expect(() => deriveExpectedAmount('custom-template', 999, false, undefined)).toThrow(/does not match/);
  });

  it('adminOverride=true bypasses the price check', () => {
    expect(deriveExpectedAmount('custom-template', 0, true, 'comp account for friend').expectedAmount).toBe(49);
    expect(deriveExpectedAmount('custom-template', 999, true, 'partial refund for downtime').expectedAmount).toBe(49);
  });

  it('adminOverride=true requires a non-empty overrideReason', () => {
    expect(() => deriveExpectedAmount('custom-template', 0, true, '')).toThrow(/overrideReason is required/);
    expect(() => deriveExpectedAmount('custom-template', 0, true, undefined)).toThrow(/overrideReason is required/);
    expect(() => deriveExpectedAmount('custom-template', 0, true, '   ')).toThrow(/overrideReason is required/);
  });

  it('exact match with adminOverride does not require the price diff to be 0', () => {
    // Sanity: exact match + adminOverride is allowed (admin
    // might still want an audit trail of the approval).
    expect(deriveExpectedAmount('custom-template', 49, true, 'admin approval - exact match').expectedAmount).toBe(49);
  });

  it('a refund-style mismatch (lower than expected) is rejected without adminOverride', () => {
    // 2026-08-19 — Refund audit case: the customer paid 49 but
    // submits a receipt for 0 (refund form). The server must
    // NOT auto-approve; the admin path is required.
    expect(() => deriveExpectedAmount('custom-template', 0, false, undefined)).toThrow(/does not match/);
  });

  it('adminOverride=true with non-empty reason accepts any amount', () => {
    // Document the contract: adminOverride with a reason is the
    // universal escape. Refunds, comps, partial refunds, FX
    // mismatches — all go through admin.
    const r = deriveExpectedAmount('storage-500mb', 14.5, true, 'partial refund, $14.50 returned');
    expect(r.expectedAmount).toBe(29);
  });
});
