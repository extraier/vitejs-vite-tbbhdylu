import { describe, expect, it } from 'vitest';
import { mergeAdminClaim, pageHasAdmin } from '../src/adminClaims';

describe('mergeAdminClaim', () => {
  it('sets admin without dropping vendor', () => {
    expect(mergeAdminClaim({ vendor: true }, true)).toEqual({
      vendor: true,
      admin: true,
    });
  });

  it('removes admin and keeps vendor', () => {
    expect(mergeAdminClaim({ vendor: true, admin: true }, false)).toEqual({
      vendor: true,
    });
  });

  it('treats a missing claim map as empty', () => {
    expect(mergeAdminClaim(null, true)).toEqual({ admin: true });
  });
});

describe('pageHasAdmin', () => {
  it('is false when this page has no admin', () => {
    expect(pageHasAdmin([
      { customClaims: { vendor: true } },
      { customClaims: null },
    ])).toBe(false);
  });

  it('is true when any user on the page is admin', () => {
    expect(pageHasAdmin([
      { customClaims: { vendor: true } },
      { customClaims: { admin: true } },
    ])).toBe(true);
  });
});
