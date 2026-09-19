/**
 * src/lib/scannerTablesCache.ts
 *
 * 2026-09-17 — Hermes P13.3 follow-up.
 *
 * Module-scoped in-memory cache for the /tables list, keyed by
 * (ownerUid, eventId). The ReceptionScanner hook in App.jsx reads
 * /tables on every scan to resolve a human table label; on a busy
 * reception (200+ scans/hr) that's 200 extra Firestore reads per
 * event. This cache drops that to 1 read per (event, 5min) window.
 *
 * CoupleSeating writes invalidate the cache when a table is
 * created / moved / renamed, so the next scanner read sees the
 * fresh data without waiting for the TTL to expire.
 *
 * Cache resets on full page reload (intentional — kept simple,
 * no localStorage). For the busy-reception use case the operator
 * keeps the app open anyway.
 *
 * Lives in its own file (not in seatingPure.ts) to avoid pulling
 * firebase/firestore into the pure-logic layer, and to give the
 * cache-invalidation call site a one-line import that doesn't
 * require App.jsx ↔ CoupleSeating.jsx cross-references.
 */

const SCANNER_TABLES_TTL_MS = 5 * 60 * 1000;
const cache: Map<string, { tables: any[]; fetchedAt: number }> = new Map();

function key(ownerUid: string, eventId: string): string {
  return `${ownerUid}/${eventId}`;
}

export function getCachedTables(ownerUid: string, eventId: string): any[] | null {
  const entry = cache.get(key(ownerUid, eventId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SCANNER_TABLES_TTL_MS) {
    cache.delete(key(ownerUid, eventId));
    return null;
  }
  return entry.tables;
}

export function setCachedTables(
  ownerUid: string,
  eventId: string,
  tables: any[],
): void {
  cache.set(key(ownerUid, eventId), { tables, fetchedAt: Date.now() });
}

export function invalidateScannerTablesCache(
  ownerUid: string,
  eventId: string,
): void {
  cache.delete(key(ownerUid, eventId));
}

/** Test-only — clears the entire cache. Don't call from app code. */
export function __resetScannerTablesCacheForTests() {
  cache.clear();
}

export default {
  getCachedTables,
  setCachedTables,
  invalidateScannerTablesCache,
  __resetScannerTablesCacheForTests,
};
