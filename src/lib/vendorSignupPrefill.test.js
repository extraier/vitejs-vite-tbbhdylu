import { describe, expect, it } from 'vitest';
import { formFromUser } from './vendorOnboarding';
import { vendorTradeCategoryEntries } from './config';

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

describe('vendorTradeCategoryEntries', () => {
  it('does not offer the couple budget buffer as a vendor trade', () => {
    const keys = vendorTradeCategoryEntries().map(([key]) => key);
    expect(keys).not.toContain('miscellaneous');
  });
});
