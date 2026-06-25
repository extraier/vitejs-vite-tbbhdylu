// Unit tests for the helpers.ts library
// =====================================
// Pure logic — no Firebase calls. Tests the perm matrix + gift-amount
// sanitization.

import { describe, it, expect } from 'vitest';
import {
  defaultHelperPerms,
  HELPER_PERMS,
  sanitizeGuestForHelper,
} from './helpers';

describe('defaultHelperPerms', () => {
  it('returns all-false perms', () => {
    const perms = defaultHelperPerms();
    for (const key of HELPER_PERMS) {
      expect(perms[key]).toBe(false);
    }
  });

  it('returns a fresh object each call (no shared mutation)', () => {
    const a = defaultHelperPerms();
    const b = defaultHelperPerms();
    a.canScan = true;
    expect(b.canScan).toBe(false);
  });
});

describe('HELPER_PERMS', () => {
  it('contains the 8 expected perm flags', () => {
    expect(HELPER_PERMS).toEqual([
      'canScan',
      'canViewGuestList',
      'canViewBudget',
      'canViewChecklist',
      'canViewPhotos',
      'canUploadPhotos',
      'canEditGuests',
      'canViewGiftAmount',
    ]);
  });
});

describe('sanitizeGuestForHelper', () => {
  const guestWithGift = {
    id: 'g1',
    name: 'Uncle Wai',
    hasGifted: true,
    giftAmount: 5000,
    tableNumber: 'T3',
  };

  it('returns guest unchanged when helper has canViewGiftAmount', () => {
    const perms = { ...defaultHelperPerms(), canViewGiftAmount: true };
    expect(sanitizeGuestForHelper(guestWithGift, perms)).toEqual(guestWithGift);
  });

  it('strips giftAmount + resets hasGifted=false when helper lacks canViewGiftAmount', () => {
    const perms = { ...defaultHelperPerms(), canScan: true };
    const sanitized = sanitizeGuestForHelper(guestWithGift, perms);
    expect(sanitized.hasGifted).toBe(false);
    expect(sanitized.giftAmount).toBe(0);
    // Other fields preserved
    expect(sanitized.name).toBe('Uncle Wai');
    expect(sanitized.tableNumber).toBe('T3');
  });

  it('preserves all non-gift fields', () => {
    const guest = { id: 'g2', name: 'Auntie Mei', tableNumber: 'T7', headCount: 2 };
    const perms = defaultHelperPerms();
    expect(sanitizeGuestForHelper(guest, perms)).toEqual({
      ...guest,
      hasGifted: false,
      giftAmount: 0,
    });
  });
});