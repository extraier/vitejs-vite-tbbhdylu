import { describe, expect, it } from 'vitest';
import {
  collectVendorNameHits,
  normalizeVendorSearchCap,
  vendorSearchDenial,
} from '../src/vendorSearch.pure';

describe('vendorSearchDenial', () => {
  it('requires a signed-in non-anonymous caller', () => {
    expect(vendorSearchDenial(null)).toBe('unauthenticated');
    expect(vendorSearchDenial({})).toBe('unauthenticated');
    expect(vendorSearchDenial({
      uid: 'guest',
      token: { firebase: { sign_in_provider: 'anonymous' } },
    })).toBe('permission-denied');
    expect(vendorSearchDenial({
      uid: 'owner',
      token: { firebase: { sign_in_provider: 'password' } },
    })).toBeNull();
  });
});

describe('collectVendorNameHits', () => {
  const vendors = [
    { id: 'a', name: 'Alpha Studio', category: 'photo', serviceAreaCity: 'HK' },
    { id: 'b', name: 'Beta Florist', category: 'flower', serviceAreaCity: 'HK' },
    { id: 'c', name: 'Alpha Annex', category: 'photo', serviceAreaCity: 'KL' },
    { id: 'd', name: 'Gamma', category: 'photo', serviceAreaCity: 'HK' },
  ];

  function pagesOf<T>(rows: T[], pageSize: number) {
    return async (cursor: number | null, size: number) => {
      const start = cursor ?? 0;
      const slice = rows.slice(start, start + size);
      return {
        rows: slice.map((row, i) => ({ ...row, cursor: start + i + 1 })),
        exhausted: start + size >= rows.length,
      };
    };
  }

  it('keeps paging until the name cap is filled past the first page', async () => {
    const hits = await collectVendorNameHits({
      cap: 2,
      needle: 'alpha',
      pageSize: 1,
      maxScan: 10,
      fetchPage: pagesOf(vendors, 1),
    });
    expect(hits.map((h) => h.uid)).toEqual(['a', 'c']);
    expect(normalizeVendorSearchCap(999)).toBe(50);
  });

  it('applies category while still reaching a later name match', async () => {
    const hits = await collectVendorNameHits({
      cap: 5,
      needle: 'alpha',
      category: 'photo',
      pageSize: 2,
      maxScan: 10,
      fetchPage: pagesOf(vendors, 2),
    });
    expect(hits.map((h) => h.uid)).toEqual(['a', 'c']);
  });

  it('stops at the scan bound when nothing matches', async () => {
    let calls = 0;
    const hits = await collectVendorNameHits({
      cap: 5,
      needle: 'missing',
      pageSize: 2,
      maxScan: 3,
      fetchPage: async (cursor) => {
        calls += 1;
        const start = cursor ?? 0;
        return {
          rows: [0, 1].map((offset) => ({
            id: `v${start + offset}`,
            name: 'Other',
            category: '',
            serviceAreaCity: '',
            cursor: start + offset + 1,
          })),
          exhausted: false,
        };
      },
    });
    expect(hits).toEqual([]);
    expect(calls).toBeGreaterThan(1);
  });
});
