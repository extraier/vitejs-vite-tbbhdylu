/**
 * Vendor-name search.
 *
 * /vendors is world-readable directory data. This callable is not an
 * owner-data boundary — linkVendorContact is, because it only writes
 * the caller's own vendorContacts doc. Anonymous guest sessions are
 * rejected so a QR guest cannot use the couple's search API.
 *
 * Firestore has no contains() filter. Page by document id and match
 * names in memory until `cap` hits or the scan bound is reached.
 */

export const VENDOR_SEARCH_DEFAULT_CAP = 20;
export const VENDOR_SEARCH_MAX_CAP = 50;
export const VENDOR_SEARCH_PAGE_SIZE = 80;
export const VENDOR_SEARCH_MAX_SCAN = 1000;

export interface VendorSearchAuth {
  uid?: string;
  token?: { firebase?: { sign_in_provider?: string } };
}

export interface VendorHit {
  uid: string;
  name: string;
  category: string;
  serviceAreaCity: string;
}

export interface VendorSearchRow<C> {
  id: string;
  name: unknown;
  category: unknown;
  serviceAreaCity: unknown;
  cursor: C;
}

export function vendorSearchDenial(
  auth: VendorSearchAuth | null | undefined,
): 'unauthenticated' | 'permission-denied' | null {
  if (!auth?.uid) return 'unauthenticated';
  if (auth.token?.firebase?.sign_in_provider === 'anonymous') return 'permission-denied';
  return null;
}

export function normalizeVendorSearchCap(limit: unknown): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n) || n <= 0) return VENDOR_SEARCH_DEFAULT_CAP;
  return Math.min(Math.floor(n), VENDOR_SEARCH_MAX_CAP);
}

export function vendorNameMatches(name: unknown, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return String(name ?? '').toLowerCase().includes(n);
}

export async function collectVendorNameHits<C>(args: {
  cap: number;
  needle: string;
  category?: string;
  maxScan?: number;
  pageSize?: number;
  fetchPage: (cursor: C | null, pageSize: number) => Promise<{
    rows: Array<VendorSearchRow<C>>;
    exhausted: boolean;
  }>;
}): Promise<VendorHit[]> {
  const cap = normalizeVendorSearchCap(args.cap);
  const maxScan = args.maxScan ?? VENDOR_SEARCH_MAX_SCAN;
  const pageSize = args.pageSize ?? VENDOR_SEARCH_PAGE_SIZE;
  const category = typeof args.category === 'string' ? args.category.trim() : '';
  const hits: VendorHit[] = [];
  let scanned = 0;
  let cursor: C | null = null;

  while (hits.length < cap && scanned < maxScan) {
    const page = await args.fetchPage(cursor, pageSize);
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      scanned += 1;
      cursor = row.cursor;
      if (scanned > maxScan) break;
      const rowCategory = typeof row.category === 'string' ? row.category : '';
      if (category && rowCategory !== category) continue;
      if (!vendorNameMatches(row.name, args.needle)) continue;
      hits.push({
        uid: row.id,
        name: typeof row.name === 'string' && row.name ? row.name : row.id,
        category: rowCategory,
        serviceAreaCity: typeof row.serviceAreaCity === 'string' ? row.serviceAreaCity : '',
      });
      if (hits.length >= cap) break;
    }
    if (page.exhausted) break;
  }

  return hits;
}
