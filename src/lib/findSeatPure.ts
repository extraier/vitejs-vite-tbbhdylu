// 2026-09-18 — P13.4.4: Public Find-Seat QR (V1).
// 2026-09-20 — P13.4.5 V2: redacted assignments + name-search.
//
// The owner stamps a snapshot of the seating chart under
// /publicSeating/{token} when they generate a public QR. Guests
// scan the QR with their phones, the browser opens the
// /find-seat?token=X page, and the page reads the snapshot (no
// auth required, token is the sole gate).
//
// V1 ships the chart-only experience: visible seating canvas
// with table labels + capacities. Guests eyeball the chart the
// way they'd eyeball a printed one in the lobby.
//
//
// V2 (this file's `buildRedactedAssignments` + `matchGuestName`)
// adds a name-search field. The owner ALSO stamps a redacted
// copy of each assigned guest (only name + tableId + tableLabel,
// no phone/email/audit-trail) into /findSeatAssignments/{token}/
// {guestId}. The public page reads this collection group, filters
// by the typed name, and highlights the matching table on the
// canvas.
//
// V3 (cacheRedactedAssignments + readRedactedAssignmentsCache):
// sessionStorage cache so one scan session = one Firestore read.
// Real-world impact: a guest who reloads the page (drops signal,
// fat-fingers the QR twice, hits refresh) doesn't re-trigger the
// collectionGroup query. TTL defaults to 30 min — bounded by the
// publicSeating expiresAt, but a short cache TTL also means
// last-minute seat reassignments propagate reasonably fast.

/**
 * Token generator. Returns a 32-char URL-safe base64 string
 * sourced from crypto.getRandomValues when available,
 * Math.random otherwise (the latter is fine for a single-day
 * wedding QR — guests don't have time to brute-force 32 chars
 * over a 12-hour window).
 */
export function generateFindSeatToken(): string {
  const bytes = new Uint8Array(18); // 18 bytes → 24 base64 chars
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // base64url encoding (no padding, +→-, /→_)
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Compute the default expiry for a QR token. Default: 11:59 PM
 * local time on `now` (HK weddings typically end by 22:30 and
 * the seating chart stays useful for latecomers until just
 * before midnight). If `now` is already past 11:59 PM, the
 * expiry rolls forward to 11:59 PM the next day.
 */
export function defaultTokenExpiry(now: Date = new Date()): Date {
  const expiry = new Date(now);
  expiry.setHours(23, 59, 59, 999);
  if (expiry.getTime() <= now.getTime()) {
    // Already past 11:59 PM (e.g. midnight-event wedding). Push
    // expiry to the next day so the token is at least useful for
    // late-risers.
    expiry.setDate(expiry.getDate() + 1);
  }
  return expiry;
}

/** Format a Date as `11:59 PM HKT` for display. */
export function formatTokenExpiry(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${period}`;
}

/**
 * Countdown string like "5h 23m" or "12m" — for showing how
 * long the QR stays active. Returns "expired" if the deadline
 * has passed.
 */
export function tokenTimeRemaining(
  expiresAt: number | Date,
  now: number = Date.now(),
): string {
  const deadline = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime();
  const diff = deadline - now;
  if (diff <= 0) return '已過期';
  const totalMin = Math.floor(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Snapshot shape stamped into the publicSeating doc. Mirrors
 * the seating canvas but excludes individual guest→table
 * assignments (those stay private; the public chart only shows
 * positions + labels + capacities so guests can find their
 * table visually).
 */
export interface PublicSeatingSnapshot {
  eventId: string;
  ownerUid: string;
  expiresAt: number; // ms epoch
  canvas: {
    width: number;
    height: number;
    background?: string;
  };
  tables: ReadonlyArray<PublicTableSnapshot>;
}

export interface PublicTableSnapshot {
  id: string;
  label: string;
  shape: 'round' | 'rect' | 'long';
  capacity: number;
  x: number;
  y: number;
  rotation: number;
  tableCategory: string;
}

/** Build a public snapshot from the owner's raw seating state. */
export function buildPublicSnapshot(
  eventId: string,
  ownerUid: string,
  meta: { canvasWidth?: number; canvasHeight?: number; background?: string },
  tables: ReadonlyArray<{
    id: string;
    label?: string;
    shape?: string;
    capacity?: number;
    x?: number;
    y?: number;
    rotation?: number;
    tableCategory?: string;
  }>,
  expiresAt: Date,
): PublicSeatingSnapshot {
  return {
    eventId,
    ownerUid,
    expiresAt: expiresAt.getTime(),
    canvas: {
      width: meta.canvasWidth ?? 1200,
      height: meta.canvasHeight ?? 800,
      background: meta.background ?? undefined as unknown as string,
    },
    tables: tables.map((t) => ({
      id: t.id,
      label: t.label ?? 'T-01',
      shape: (t.shape as PublicTableSnapshot['shape']) ?? 'round',
      capacity: t.capacity ?? 10,
      x: t.x ?? 0,
      y: t.y ?? 0,
      rotation: t.rotation ?? 0,
      tableCategory: t.tableCategory ?? 'friends',
    })),
  };
}

/**
 * Is a public-snapshot URL valid right now? Returns null if yes,
 * or a string error reason if no. Used by FindSeatPage to render
 * a friendly fallback before doing the Firestore read (e.g. URL
 * missing token).
 */
export function validatePublicUrl(url: string | undefined): string | null {
  if (!url) return 'missing-url';
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  const token = params.get('find-seat');
  if (!token) return 'missing-token';
  if (token.length < 16) return 'malformed-token';
  return null;
}

/**
 * Find-Seat deep-link URL builder. Pin to the production domain
 * (savetheday.io) so QR codes work cross-device; uses the
 * supplied base to support `?find-seat=` discovery.
 */
export function buildFindSeatUrl(base: string, token: string): string {
  const u = new URL(base);
  u.searchParams.set('find-seat', token);
  return u.toString();
}

// ---- rendering -------------------------------------------------------

/**
 * Drop-in async fetch helper for the public page. Returns
 * { ok: true, snap } on success or { ok: false, reason }.
 * Reads publicSeating/{token}, checking that expiresAt is
 * still in the future (Firestore rules already enforce this,
 * but a client-side check avoids extra reads on expired links).
 */
export async function fetchPublicSnapshot(
  db: { doc: (path: string) => { get: () => Promise<{ exists: boolean; data: () => unknown }> } },
  token: string,
  now: number = Date.now(),
): Promise<
  | { ok: true; snap: PublicSeatingSnapshot }
  | { ok: false; reason: 'not_found' | 'expired' | 'malformed_token' }
> {
  if (!token || token.length < 16) return { ok: false, reason: 'malformed_token' };
  const ref = db.doc(`publicSeating/${token}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not_found' };
  const data = snap.data() as PublicSeatingSnapshot;
  if (data.expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, snap: data };
}

// ---- V2: redacted assignments + name-search --------------------------
// (2026-09-20 — P13.4.5 V2)

/**
 * Shape of one redacted assignment row stamped to
 * /findSeatAssignments/{token}/{guestId}. The minimum the
 * public page needs to answer "where do I sit?".
 */
export interface RedactedAssignment {
  guestId: string;
  name: string;
  tableId: string;
  tableLabel: string;
}

/**
 * Strip assignments down to {guestId, name, tableId, tableLabel}
 * and join with the table label so the public page can show
 * "你嘅枱係 T-03 (主家席)" without round-tripping to the
 * snapshot doc.
 *
 * Drops unassigned guests and guests whose table is missing
 * from the snapshot — those wouldn't be searchable anyway.
 */
export function buildRedactedAssignments(
  assignments: Array<{ guestId: string; tableId: string }>,
  guestsById: Record<string, { name: string } | undefined>,
  tablesById: Record<string, { label?: string } | undefined>,
): RedactedAssignment[] {
  const out: RedactedAssignment[] = [];
  for (const a of assignments) {
    const guest = guestsById[a.guestId];
    const table = tablesById[a.tableId];
    const name = guest?.name?.trim() ?? '';
    if (!name || !table) continue;
    out.push({
      guestId: a.guestId,
      name,
      tableId: a.tableId,
      tableLabel: table.label || a.tableId,
    });
  }
  return out;
}

/**
 * Filter a redacted-assignments list by a typed name string.
 *
 * Matching rules:
 *  - case-insensitive
 *  - whitespace-collapsed (the typed query and the stored
 *    name both get collapsed before compare, so "  chan   "
 *    matches "Chan Tai Man")
 *  - substring (typing "Chan" returns all matches containing
 *    "chan" anywhere — including middle-of-name matches
 *    for bilingual cases like "Chan 大文")
 *
 * Hard-capped at `limit` results to avoid runaway UI lists on
 * a 500-guest wedding. Sorted by name length ascending so the
 * shortest (most-specific) name shows up first when there's a
 * tie — "Chan Tai Man" sorts before "Chan Tai Man Wong".
 */
export function matchGuestName(
  rows: RedactedAssignment[],
  query: string,
  limit: number = 5,
): RedactedAssignment[] {
  const q = (query || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!q) return [];
  const matches = rows.filter((r) => {
    const n = (r.name || '').replace(/\s+/g, ' ').toLowerCase();
    return n.includes(q);
  });
  matches.sort((a, b) => a.name.length - b.name.length);
  return matches.slice(0, limit);
}

// ---- V3: sessionStorage cache for the public assignments ----
// (2026-09-20 — P13.4.5 V2 follow-up)
//
// Cache shape:
//   key  = `findSeat:assignments:v1:${token}`
//   val  = JSON.stringify({ ts, rows })
//   ttl  = 30 minutes (default; operator-side regen bumps
//          the token so the cache key naturally rotates)

/** Default cache TTL — 30 minutes. */
export const ASSIGNMENTS_CACHE_TTL_MS = 30 * 60 * 1000;

/** Stable, namespaced cache key for a given token. */
export function assignmentsCacheKey(token: string): string {
  return `findSeat:assignments:v1:${token}`;
}

/**
 * Read the cached rows for a token. Returns:
 *   { ok: true, rows } on cache hit (within TTL)
 *   { ok: false, reason: 'miss' | 'expired' | 'malformed' | 'no_storage' }
 *     otherwise
 *
 * Pure (no side effects); takes `storage` as a parameter so the
 * function can be unit-tested without a DOM. Pass `null` to
 * simulate SSR/no-storage environments.
 */
export function readRedactedAssignmentsCache(
  storage: Storage | null,
  token: string,
  now: number = Date.now(),
  ttl: number = ASSIGNMENTS_CACHE_TTL_MS,
): { ok: true; rows: RedactedAssignment[] } | { ok: false; reason: string } {
  if (!storage) return { ok: false, reason: 'no_storage' };
  if (!token || token.length < 16) return { ok: false, reason: 'malformed' };
  let raw: string | null = null;
  try {
    raw = storage.getItem(assignmentsCacheKey(token));
  } catch (e) {
    return { ok: false, reason: 'no_storage' };
  }
  if (!raw) return { ok: false, reason: 'miss' };
  let parsed: { ts?: number; rows?: RedactedAssignment[] };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'malformed' };
  }
  if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.rows)) {
    return { ok: false, reason: 'malformed' };
  }
  if (now - parsed.ts > ttl) return { ok: false, reason: 'expired' };
  return { ok: true, rows: parsed.rows };
}

/**
 * Write the rows to the cache. Silently no-ops when storage
 * is unavailable (Safari private mode, quota exceeded, etc.) —
 * the public page falls through to the Firestore read.
 *
 * Pure (no return value); takes `storage` as a parameter so the
 * function can be unit-tested without a DOM.
 */
export function cacheRedactedAssignments(
  storage: Storage | null,
  token: string,
  rows: RedactedAssignment[],
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  if (!token || token.length < 16) return false;
  try {
    storage.setItem(
      assignmentsCacheKey(token),
      JSON.stringify({ ts: now, rows }),
    );
    return true;
  } catch (e) {
    // Quota exceeded, disabled storage, etc. — silent fall-through.
    return false;
  }
}
