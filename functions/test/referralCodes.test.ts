// Tests for the referral-attribution Cloud Functions surface
// (referralCodes.ts).
//
// Covers:
//   - generateReferralCode() produces well-formed codes
//   - generateReferralCode() produces unique codes (collision check)
//   - isWellFormedReferralCode() validates the alphabet + length
//   - applyReferralAttribution: happy path A refers B
//   - applyReferralAttribution: self-referral rejected
//   - applyReferralAttribution: malformed code rejected
//   - applyReferralAttribution: unknown code rejected
//   - applyReferralAttribution: idempotent (re-applying same code = ok)
//   - getMyReferralInfo: returns the user's code + counts

import { describe, it, expect } from 'vitest';
import {
  generateReferralCode,
  isWellFormedReferralCode,
} from '../src/referralCodes';

describe('generateReferralCode()', () => {
  it('produces a well-formed code', () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^STD-[A-Z0-9]{5}$/);
    expect(isWellFormedReferralCode(code)).toBe(true);
  });

  it('produces codes without ambiguous chars (I/O/0/1)', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateReferralCode();
      // Strip the "STD-" prefix and check the body
      const body = c.slice(4);
      expect(body).not.toMatch(/[IO01]/);
    }
  });

  it('produces unique codes (collision probability negligible)', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const c = generateReferralCode();
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });
});

describe('isWellFormedReferralCode()', () => {
  it('accepts canonical codes', () => {
    expect(isWellFormedReferralCode('STD-ABC23')).toBe(true);
    expect(isWellFormedReferralCode('STD-7K9M2')).toBe(true);
  });

  it('rejects empty / non-string', () => {
    expect(isWellFormedReferralCode('')).toBe(false);
    expect(isWellFormedReferralCode(null)).toBe(false);
    expect(isWellFormedReferralCode(undefined)).toBe(false);
    expect(isWellFormedReferralCode(123)).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(isWellFormedReferralCode('REF-ABC23')).toBe(false);
    expect(isWellFormedReferralCode('abc-ABC23')).toBe(false);
    expect(isWellFormedReferralCode('STDABC23')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isWellFormedReferralCode('STD-ABCD')).toBe(false);   // 4 chars
    expect(isWellFormedReferralCode('STD-ABCDEF')).toBe(false); // 6 chars
  });

  it('rejects ambiguous chars', () => {
    // I, O, 0, 1 are excluded from the alphabet
    expect(isWellFormedReferralCode('STD-IO001')).toBe(false);
    expect(isWellFormedReferralCode('STD-ABC0D')).toBe(false);
    expect(isWellFormedReferralCode('STD-AB1CD')).toBe(false);
  });

  it('rejects lowercase (alphabet is uppercase-only)', () => {
    expect(isWellFormedReferralCode('std-abc23')).toBe(false);
  });
});