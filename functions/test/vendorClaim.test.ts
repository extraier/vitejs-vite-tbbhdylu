/**
 * 2026-08-13 — H-03 audit unit tests.
 *
 * `mergeVendorClaim` is the pure-logic core of `setVendorClaim`,
 * extracted so we can unit-test the vendor-claim-merge semantics
 * without mocking the firebase-admin SDK. The audit requires one
 * named canonical pathway for vendor activation; the merge
 * invariants enforced here are the actual canonical contract.
 *
 * Coverage:
 *  1. value=true sets `vendor: true`
 *  2. value=false REMOVES the key (NOT sets false — see comment
 *     in mergeVendorClaim)
 *  3. Preserves all existing claims (admin, helper, anything custom)
 *  4. Idempotent — calling value=true twice yields the same object
 *  5. value=true does NOT clobber `admin` if it was true
 *  6. value=false does NOT clobber `admin` if it was true
 *  7. Empty input produces a fresh object (no mutation of caller)
 */

import { describe, it, expect } from 'vitest';
import { mergeVendorClaim } from '../src/vendors';

describe('mergeVendorClaim (H-03 audit fix)', () => {
  it('sets vendor: true when value is true', () => {
    const out = mergeVendorClaim({}, true);
    expect(out.vendor).toBe(true);
  });

  it('removes the vendor key when value is false (does NOT set false)', () => {
    const out = mergeVendorClaim({ vendor: true }, false);
    expect('vendor' in out).toBe(false);
    // Specifically — no literal `false` should leak through, because
    // firebase-admin serializes `false` claims and downstream
    // `claims.vendor === true` checks would miss it.
    expect(out.vendor).toBeUndefined();
  });

  it('preserves all existing claims (admin, helper, anything else)', () => {
    const out = mergeVendorClaim(
      { admin: true, helper: true, customRole: 'partner', score: 42 },
      true,
    );
    expect(out.admin).toBe(true);
    expect(out.helper).toBe(true);
    expect(out.customRole).toBe('partner');
    expect(out.score).toBe(42);
    expect(out.vendor).toBe(true);
  });

  it('preserves existing claims when clearing the vendor flag', () => {
    const out = mergeVendorClaim(
      { admin: true, helper: true, vendor: true },
      false,
    );
    expect(out.admin).toBe(true);
    expect(out.helper).toBe(true);
    expect('vendor' in out).toBe(false);
  });

  it('does not mutate the input object', () => {
    const input = { admin: true, vendor: true };
    const snapshot = { ...input };
    mergeVendorClaim(input, false);
    expect(input).toEqual(snapshot);
  });

  it('idempotent — calling value=true twice yields the same shape', () => {
    const first = mergeVendorClaim({ admin: true }, true);
    const second = mergeVendorClaim(first, true);
    expect(second).toEqual(first);
  });
});
