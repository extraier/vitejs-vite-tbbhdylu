import { describe, expect, it } from 'vitest';
import {
  buildCanonicalVendorInviteUrl,
  captureVendorInvite,
  pendingInviteRecord,
  shouldClaimSeededVendor,
} from './vendorInviteLink';

describe('vendor invite capture', () => {
  it('accepts the official bare signup flag and strips the token', () => {
    const captured = captureVendorInvite({
      search: '?signup&venue=abc-studio&token=secret-token',
      hash: '',
    });
    expect(captured.invite).toEqual({
      slug: 'abc-studio',
      token: 'secret-token',
      source: 'search',
    });
    expect(captured.nextSearch).not.toContain('token');
    expect(captured.nextSearch).not.toContain('venue');
    expect(shouldClaimSeededVendor(pendingInviteRecord(captured.invite))).toBe(true);
  });

  it('accepts signup=1 the same way', () => {
    const captured = captureVendorInvite({
      search: '?signup=1&venue=abc-studio&token=secret-token',
    });
    expect(captured.invite.slug).toBe('abc-studio');
    expect(captured.invite.token).toBe('secret-token');
    expect(shouldClaimSeededVendor(pendingInviteRecord(captured.invite))).toBe(true);
  });

  it('keeps a hash slug (and token) for the signup card and claim', () => {
    const slugOnly = captureVendorInvite({
      hash: '#signup-as-vendor?slug=abc-studio',
    });
    expect(slugOnly.invite).toMatchObject({ slug: 'abc-studio', token: '', source: 'hash' });
    expect(slugOnly.nextHash).toBe('#signup-as-vendor?slug=abc-studio');
    expect(shouldClaimSeededVendor(pendingInviteRecord(slugOnly.invite))).toBe(false);

    const withToken = captureVendorInvite({
      hash: '#signup-as-vendor?slug=abc-studio&token=secret-token',
    });
    expect(withToken.invite.token).toBe('secret-token');
    expect(withToken.nextHash).toBe('#signup-as-vendor?slug=abc-studio');
    expect(withToken.nextHash).not.toContain('token');
    expect(shouldClaimSeededVendor(pendingInviteRecord(withToken.invite))).toBe(true);
  });

  it('builds one canonical invite URL', () => {
    expect(buildCanonicalVendorInviteUrl('https://savetheday.io', {
      slug: 'abc studio',
      token: 'a&b',
    })).toBe('https://savetheday.io/?signup=1&venue=abc+studio&token=a%26b');
  });
});
