import { describe, expect, it } from 'vitest';
import { authEntryState, parseAuthEntry, signedInVendorHashTarget } from './authEntry';

describe('parseAuthEntry', () => {
  it('opens vendor sign-up from the hash, including a slug kept inside the hash', () => {
    expect(parseAuthEntry('#signup-as-vendor')).toEqual({ kind: 'vendor', slug: '', token: '' });
    expect(parseAuthEntry('#signup-as-vendor?slug=abc-studio')).toEqual({
      kind: 'vendor',
      slug: 'abc-studio',
      token: '',
    });
    expect(parseAuthEntry('#signup-as-vendor?slug=abc-studio&token=secret')).toEqual({
      kind: 'vendor',
      slug: 'abc-studio',
      token: 'secret',
    });
  });

  it('opens couple sign-up from #signup', () => {
    expect(parseAuthEntry('#signup')).toEqual({ kind: 'signup', slug: '', token: '' });
  });

  it('leaves the sign-in card alone for an empty or unknown hash', () => {
    expect(parseAuthEntry('')).toEqual({ kind: null, slug: '', token: '' });
    expect(parseAuthEntry('#login')).toEqual({ kind: null, slug: '', token: '' });
  });
});

describe('authEntryState', () => {
  it('maps a fresh vendor hash onto the vendor card', () => {
    expect(authEntryState('#signup-as-vendor?slug=abc').signingUpAs).toBe('vendor');
  });

  it('maps a fresh #signup hash onto couple sign-up mode', () => {
    expect(authEntryState('#signup').loginMode).toBe('signup');
    expect(authEntryState('#signup').signingUpAs).toBeNull();
  });
});

describe('signedInVendorHashTarget', () => {
  it('opens onboarding for a signed-in couple and the vendor area for a vendor', () => {
    expect(signedInVendorHashTarget('vendor', false)).toBe('vendor-onboarding');
    expect(signedInVendorHashTarget('vendor', true)).toBe('vendor-dashboard');
    expect(signedInVendorHashTarget('signup', false)).toBeNull();
  });
});
