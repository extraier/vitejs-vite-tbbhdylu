import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUEST_LINK_TTL_HOURS,
  MAX_GUEST_LINK_TTL_HOURS,
  resolveGuestLinkTtlHours,
} from '../src/guestLinkTtl';

describe('resolveGuestLinkTtlHours', () => {
  it('defaults when the caller omits ttlHours', () => {
    expect(resolveGuestLinkTtlHours(undefined)).toBe(DEFAULT_GUEST_LINK_TTL_HOURS);
    expect(resolveGuestLinkTtlHours(null)).toBe(72);
    expect(resolveGuestLinkTtlHours('')).toBe(72);
  });

  it('rejects non-finite, zero, and negative values', () => {
    expect(() => resolveGuestLinkTtlHours(Number.NaN)).toThrow(/finite/);
    expect(() => resolveGuestLinkTtlHours(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => resolveGuestLinkTtlHours(0)).toThrow(/finite/);
    expect(() => resolveGuestLinkTtlHours(-4)).toThrow(/finite/);
    expect(() => resolveGuestLinkTtlHours('nope')).toThrow(/finite/);
  });

  it('clamps to 30 days', () => {
    expect(MAX_GUEST_LINK_TTL_HOURS).toBe(720);
    expect(resolveGuestLinkTtlHours(24)).toBe(24);
    expect(resolveGuestLinkTtlHours(10_000)).toBe(720);
    expect(resolveGuestLinkTtlHours('48')).toBe(48);
  });
});
