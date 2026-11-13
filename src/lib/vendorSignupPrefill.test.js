import { describe, expect, it } from 'vitest';
import { formFromUser } from './vendorOnboarding';
import { vendorTradeCategoryEntries } from './config';
import { captureVendorInvite, pendingInviteRecord, shouldClaimSeededVendor } from './vendorInviteLink';

describe('formFromUser', () => {
  it('prefers the business name captured at vendor sign-up over an empty auth profile', () => {
    const form = formFromUser(
      { email: 'studio@example.com', displayName: '' },
      'E2E Test Studio (do not use)',
    );
    expect(form.email).toBe('studio@example.com');
    expect(form.displayName).toBe('E2E Test Studio (do not use)');
    expect(form.name).toBe('E2E Test Studio (do not use)');
  });
});

describe('vendor invite reaches claim or prefill', () => {
  it('turns the hash slug and the query claim link into a pending invite', () => {
    const fromHash = pendingInviteRecord(captureVendorInvite({
      hash: '#signup-as-vendor?slug=abc-studio',
    }).invite, 1);
    expect(fromHash).toEqual({ slug: 'abc-studio', token: '', capturedAt: 1 });
    expect(shouldClaimSeededVendor(fromHash)).toBe(false);

    const fromQuery = pendingInviteRecord(captureVendorInvite({
      search: '?signup&venue=abc-studio&token=invite-token',
    }).invite, 2);
    expect(fromQuery.slug).toBe('abc-studio');
    expect(fromQuery.token).toBe('invite-token');
    expect(shouldClaimSeededVendor(fromQuery)).toBe(true);
  });
});

describe('vendorTradeCategoryEntries', () => {
  it('does not offer the couple budget buffer as a vendor trade', () => {
    const keys = vendorTradeCategoryEntries().map(([key]) => key);
    expect(keys).not.toContain('miscellaneous');
  });
});
