// 2026-08-19 — Manus P1.1 unit tests for the server-side price
// derivation helper. Pins the policy: client sends amount, the
// server rejects anything that doesn't match the SKU price
// (within ±$1 FX tolerance). The only escape is adminOverride
// with a non-empty reason.

import { describe, it, expect } from 'vitest';
import { deriveExpectedAmount } from '../src/unlocks';

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

  it('sums the four SKU prices for bundle', () => {
    const sum = 49 + 29 + 39 + 29; // 146
    expect(deriveExpectedAmount('bundle', sum, false, undefined).expectedAmount).toBe(sum);
  });

  it('sums the four SKU prices for premium (legacy compat)', () => {
    const sum = 49 + 29 + 39 + 29;
    expect(deriveExpectedAmount('premium', sum, false, undefined).expectedAmount).toBe(sum);
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
