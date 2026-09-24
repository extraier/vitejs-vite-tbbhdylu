import { describe, it, expect } from 'vitest';
import {
  isVendorVisible,
  normalizeLiveVendor,
  mergeVendors,
} from './vendorPure';

// ---------- isVendorVisible ----------
describe('isVendorVisible', () => {
  it('returns true when status is missing (legacy docs default to approved)', () => {
    expect(isVendorVisible({})).toBe(true);
    expect(isVendorVisible(null)).toBe(true);
    expect(isVendorVisible(undefined)).toBe(true);
  });

  it('returns true for approved', () => {
    expect(isVendorVisible({ status: 'approved' })).toBe(true);
  });

  it('returns false for rejected', () => {
    expect(isVendorVisible({ status: 'rejected' })).toBe(false);
  });

  it('returns false for suspended', () => {
    expect(isVendorVisible({ status: 'suspended' })).toBe(false);
  });
});

// ---------- normalizeLiveVendor ----------
describe('normalizeLiveVendor', () => {
  it('returns null for null/undefined raw input', () => {
    expect(normalizeLiveVendor('doc-1', null)).toBeNull();
    expect(normalizeLiveVendor('doc-1', undefined)).toBeNull();
  });

  it('returns null for rejected vendors', () => {
    const result = normalizeLiveVendor('doc-1', { status: 'rejected', name: 'X' });
    expect(result).toBeNull();
  });

  it('returns null for suspended vendors', () => {
    const result = normalizeLiveVendor('doc-1', { status: 'suspended', name: 'X' });
    expect(result).toBeNull();
  });

  it('normalizes a fully-populated doc', () => {
    const raw = {
      name: 'Studio A',
      category: 'photography',
      subcategory: 'pre_wedding',
      rating: 4.7,
      price: '$3000',
      tags: ['outdoor', 'drone'],
      description: 'Award-winning outdoor photographer',
      portfolio: ['a.jpg', 'b.jpg'],
      portfolioCount: 12,
      featured: true,
      serviceAreaCity: 'Hong Kong',
      serviceAreaDistrict: 'Central',
      popularity: { viewCount7d: 50, viewCount30d: 200, viewCountTotal: 1000 },
      createdAt: { toMillis: () => 1700000000000 },
      signupStatus: 'invited',
      source: 'heychoices',
    };
    const result = normalizeLiveVendor('studio-a', raw);
    expect(result).toEqual({
      id: 'studio-a',
      vendorUid: 'studio-a',
      name: 'Studio A',
      category: 'photography',
      subcategory: 'pre_wedding',
      rating: 4.7,
      price: '$3000',
      tags: ['outdoor', 'drone'],
      description: 'Award-winning outdoor photographer',
      portfolio: ['a.jpg', 'b.jpg'],
      portfolioCount: 12,
      featured: true,
      serviceAreaCity: 'Hong Kong',
      serviceAreaDistrict: 'Central',
      popularity: { viewCount7d: 50, viewCount30d: 200, viewCountTotal: 1000 },
      viewCount: 50, // 7d wins
      createdAt: 1700000000000,
      signupStatus: 'invited',
      source: 'heychoices',
      isLive: true,
    });
  });

  it('falls back name → doc id when name is missing', () => {
    const result = normalizeLiveVendor('doc-42', {});
    expect(result?.name).toBe('doc-42');
  });

  it('defaults rating to 0 when not a number', () => {
    expect(normalizeLiveVendor('x', { rating: '4.5' })?.rating).toBe(0);
    expect(normalizeLiveVendor('x', { rating: null })?.rating).toBe(0);
  });

  it('falls back price → 請查詢 when missing', () => {
    expect(normalizeLiveVendor('x', {})?.price).toBe('請查詢');
  });

  it('defaults category → other when missing', () => {
    expect(normalizeLiveVendor('x', {})?.category).toBe('other');
  });

  it('defaults tags → [] when not an array', () => {
    expect(normalizeLiveVendor('x', { tags: 'not-an-array' })?.tags).toEqual([]);
  });

  it('defaults portfolio → [] when not an array', () => {
    expect(normalizeLiveVendor('x', { portfolio: null })?.portfolio).toEqual([]);
  });

  it('prefers explicit portfolioCount over portfolio.length', () => {
    const result = normalizeLiveVendor('x', {
      portfolio: ['a', 'b', 'c'],
      portfolioCount: 99,
    });
    expect(result?.portfolioCount).toBe(99);
  });

  it('falls back portfolioCount → portfolio.length when missing', () => {
    const result = normalizeLiveVendor('x', { portfolio: ['a', 'b'] });
    expect(result?.portfolioCount).toBe(2);
  });

  it('falls back portfolioCount → 0 when both missing', () => {
    expect(normalizeLiveVendor('x', {})?.portfolioCount).toBe(0);
  });

  it('viewCount prefers 7d, falls back to 30d, then total', () => {
    expect(normalizeLiveVendor('x', {
      popularity: { viewCount7d: 10, viewCount30d: 50, viewCountTotal: 1000 },
    })?.viewCount).toBe(10);
    expect(normalizeLiveVendor('x', {
      popularity: { viewCount30d: 50, viewCountTotal: 1000 },
    })?.viewCount).toBe(50);
    expect(normalizeLiveVendor('x', {
      popularity: { viewCountTotal: 1000 },
    })?.viewCount).toBe(1000);
    expect(normalizeLiveVendor('x', {})?.viewCount).toBe(0);
  });

  it('createdAt handles Firestore Timestamp with toMillis()', () => {
    const result = normalizeLiveVendor('x', {
      createdAt: { toMillis: () => 1700000000000 },
    });
    expect(result?.createdAt).toBe(1700000000000);
  });

  it('createdAt handles ISO string', () => {
    const iso = '2024-01-15T10:00:00.000Z';
    const result = normalizeLiveVendor('x', { createdAt: iso });
    expect(result?.createdAt).toBe(Date.parse(iso));
  });

  it('createdAt handles raw number', () => {
    expect(normalizeLiveVendor('x', { createdAt: 1700000000000 })?.createdAt)
      .toBe(1700000000000);
  });

  it('createdAt falls back to 0 when missing or invalid', () => {
    expect(normalizeLiveVendor('x', {})?.createdAt).toBe(0);
    expect(normalizeLiveVendor('x', { createdAt: 'not-a-date' })?.createdAt).toBe(0);
    // Timestamp.toMillis() throwing also falls back to 0
    expect(normalizeLiveVendor('x', {
      createdAt: { toMillis: () => { throw new Error('boom'); } },
    })?.createdAt).toBe(0);
  });

  it('flags featured as boolean', () => {
    expect(normalizeLiveVendor('x', { featured: 1 })?.featured).toBe(true);
    expect(normalizeLiveVendor('x', { featured: 0 })?.featured).toBe(false);
  });

  it('defaults signupStatus → uninvited', () => {
    expect(normalizeLiveVendor('x', {})?.signupStatus).toBe('uninvited');
  });

  it('marks normalized live vendors with isLive: true', () => {
    expect(normalizeLiveVendor('x', {})?.isLive).toBe(true);
  });
});

// ---------- mergeVendors ----------
describe('mergeVendors', () => {
  it('returns live vendors first when no static set', () => {
    const live = [
      { id: 'a', name: 'A', isLive: true },
      { id: 'b', name: 'B', isLive: true },
    ];
    expect(mergeVendors(live, [])).toEqual(live);
  });

  it('returns static vendors when no live set', () => {
    const staticVendors = [
      { id: 1, name: 'X' },
      { id: 2, name: 'Y' },
    ];
    const result = mergeVendors([], staticVendors);
    expect(result).toHaveLength(2);
    expect(result[0].isLive).toBe(false);
    expect(result[1].isLive).toBe(false);
  });

  it('dedupes by id — live wins', () => {
    const live = [{ id: 'a', name: 'A (live)', isLive: true }];
    const staticVendors = [
      { id: 'a', name: 'A (static)' }, // same id as live — must be dropped
      { id: 'b', name: 'B' },
    ];
    const result = mergeVendors(live, staticVendors);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'a', name: 'A (live)', isLive: true });
    expect(result[1]).toMatchObject({ id: 'b', name: 'B', isLive: false });
  });

  it('preserves static vendor fields when adding isLive: false', () => {
    const staticVendors = [
      { id: 1, name: 'Static 1', category: 'venue', rating: 4.0 },
    ];
    const result = mergeVendors([], staticVendors);
    expect(result[0]).toEqual({
      id: 1,
      name: 'Static 1',
      category: 'venue',
      rating: 4.0,
      isLive: false,
    });
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeVendors([], [])).toEqual([]);
  });

  it('does not mutate the input arrays', () => {
    const live = [{ id: 'a', isLive: true }];
    const staticVendors = [{ id: 'b' }];
    const liveCopy = JSON.parse(JSON.stringify(live));
    const staticCopy = JSON.parse(JSON.stringify(staticVendors));
    mergeVendors(live, staticVendors);
    expect(live).toEqual(liveCopy);
    expect(staticVendors).toEqual(staticCopy);
  });
});
