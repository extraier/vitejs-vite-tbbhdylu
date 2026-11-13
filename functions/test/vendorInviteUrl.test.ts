import { describe, expect, it } from 'vitest';
import { buildCanonicalVendorInviteUrl } from '../src/vendorInviteUrl';

describe('buildCanonicalVendorInviteUrl', () => {
  it('uses signup=1 so URLSearchParams does not see an empty flag', () => {
    const url = buildCanonicalVendorInviteUrl('https://savetheday.io', 'abc-studio', 'tok');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('signup')).toBe('1');
    expect(parsed.searchParams.get('venue')).toBe('abc-studio');
    expect(parsed.searchParams.get('token')).toBe('tok');
  });
});
