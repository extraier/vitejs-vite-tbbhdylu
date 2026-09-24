// Pure helpers for the vendor catalog.
//
// The discover / catalog UI combines TWO sources:
//   1. The live /vendors Firestore collection — couples
//      see admin-curated vendors here.
//   2. The hardcoded DEFAULT_VENDORS in src/lib/config —
//      these ship with the bundle as the demo fallback.
//
// The merge dedupes by id and prefers live docs. Vendors
// with status == 'rejected' / 'suspended' are filtered out
// of the live list before the merge. Live docs are mapped
// to the same Vendor shape used everywhere in the app.
//
// All functions here are pure — no React, no Firebase.
// That makes them straightforward to unit test (see
// vendorPure.test.ts).
//
// Naming
//   - normalizeLiveVendor  → raw Firestore doc → Vendor
//   - isVendorVisible      → status filter
//   - mergeVendors         → live + static → final catalog
//
// These are deliberately named with the `vendor` prefix so
// `import { mergeVendors } from './vendorPure'` reads as
// "merge vendors" at the call site, not just "merge" which
// is ambiguous in a 60K-LOC codebase.

// Firestore Timestamp shape — we only read toMillis().
// Any object that conforms works; loose typing avoids the
// firebase-admin `Timestamp` import here.
interface FirestoreTimestampLike {
  toMillis(): number;
}

// The Vendor shape returned by normalizeLiveVendor.
// (Deliberately NOT importing the strict Vendor type from
// config.ts — live vendors use string ids, static vendors
// use numeric ids, and the merged catalog is heterogeneous.
// Consumers must tolerate both. Pinning to the strict
// numeric Vendor type would force an unsafe cast.)
export interface MergedVendor {
  id: string | number;
  vendorUid?: string;
  name: string;
  category: string;
  subcategory?: string | null;
  rating: number;
  price: string;
  tags: string[];
  description: string;
  portfolio: string[];
  portfolioCount: number;
  featured?: boolean;
  serviceAreaCity?: string | null;
  serviceAreaDistrict?: string | null;
  popularity?: unknown;
  viewCount?: number;
  createdAt?: number;
  signupStatus?: string;
  source?: string | null;
  isLive?: boolean;
}

// A live Firestore vendor doc — only the fields we read
// here. Other fields may exist on the doc; we ignore them.
export function normalizeLiveVendor(
  docId: string,
  raw: Record<string, unknown> | null | undefined,
): MergedVendor | null {
  if (!raw) return null;
  // Filter out rejected/suspended vendors — they shouldn't
  // appear in the public catalog. Default to 'approved' for
  // legacy docs (pre-onboarding vendors without a status
  // field are treated as approved per existing
  // AdminVendors logic).
  if (!isVendorVisible(raw)) return null;
  return {
    // doc id (vendorUid/slug) — also used as numeric fallback
    // for sorting when createdAt is missing.
    id: docId,
    vendorUid: docId,
    name: (raw.name as string) || docId,
    category: (raw.category as string) || 'other',
    subcategory: (raw.subcategory as string) || null,
    rating: typeof raw.rating === 'number' ? raw.rating : 0,
    // Imported vendors don't carry price — show a friendly
    // placeholder so the UI doesn't render empty cells.
    price: (raw.price as string) || '請查詢',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    description: (raw.description as string) || '',
    portfolio: Array.isArray(raw.portfolio) ? raw.portfolio : [],
    portfolioCount:
      typeof raw.portfolioCount === 'number'
        ? raw.portfolioCount
        : Array.isArray(raw.portfolio)
          ? raw.portfolio.length
          : 0,
    featured: !!raw.featured,
    // 2026-07-21 — city enrichment. The
    // scripts/enrich-vendor-cities.cjs script derives these
    // from name/description/address for any imported vendor
    // and writes them back. Live vendors may also set
    // serviceAreaCity manually.
    serviceAreaCity: (raw.serviceAreaCity as string) || null,
    serviceAreaDistrict: (raw.serviceAreaDistrict as string) || null,
    // 2026-07-20 — popularity counter, maintained by the
    // onVendorImageViewCreated cloud function + daily sweep.
    // We prefer the 7d count as the default 'popularity'
    // metric — it smooths out daily noise while staying fresh
    // enough to highlight trending vendors. Falls back to 30d
    // if 7d is missing.
    popularity: raw.popularity ?? null,
    viewCount:
      ((raw.popularity as Record<string, number>)?.viewCount7d ?? 0) ||
      ((raw.popularity as Record<string, number>)?.viewCount30d ?? 0) ||
      ((raw.popularity as Record<string, number>)?.viewCountTotal ?? 0),
    // Firestore timestamp → epoch millis (with safe fallback
    // for ISO strings and missing fields).
    createdAt: createdAtToMillis(raw.createdAt),
    signupStatus: (raw.signupStatus as string) || 'uninvited',
    source: (raw.source as string) || null,
    isLive: true,
  };
}

// Status filter — exposed for callers that want to count
// or surface rejected vendors separately (e.g. admin
// dashboards) without re-implementing the rule.
export function isVendorVisible(
  raw: Record<string, unknown> | null | undefined,
): boolean {
  const status = (raw?.status as string) || 'approved';
  return status !== 'rejected' && status !== 'suspended';
}

// Merge live vendors with the hardcoded demo set.
// Live vendors come first (newest at top by createdAt, then
// featured flag), then any static entries that aren't
// already represented in the live set. Dedup by id — if the
// same vendor exists in both, the live doc wins because it
// is added first and we filter static by `liveIds.has(id)`.
//
// `staticVendors` is the DEFAULT_VENDORS array from
// src/lib/config.ts. Its entries use numeric `id`s and a
// slightly different shape (no `vendorUid`, no `isLive`);
// the merge preserves their shape and just adds
// `isLive: false` so consumers can tell the two groups
// apart if they care.
//
// `live` must already be filtered through normalizeLiveVendor.
export function mergeVendors<T extends { id: unknown }>(
  live: readonly T[],
  staticVendors: readonly T[] = [],
): T[] {
  const liveIds = new Set(live.map((v) => v.id));
  return [
    ...live,
    ...staticVendors
      .filter((v) => !liveIds.has(v.id))
      .map((v) => ({ ...v, isLive: false } as T)),
  ];
}

// --- internals ---

// Firestore writes createdAt as either a Timestamp (has
// .toMillis()), an ISO string, or a raw number (millis).
// Older DEFAULT_VENDORS entries have no createdAt at all.
// Fall back to 0 — that puts them at the bottom of any
// "newest first" sort, which matches the pre-pivot
// behavior (where DEFAULT_VENDORS were a constant set).
function createdAtToMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null) {
    const ts = value as Partial<FirestoreTimestampLike>;
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch {
        return 0;
      }
    }
  }
  // ISO string or anything Date.parse-able.
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}
