/**
 * src/lib/seatingPure.ts
 *
 * 2026-09-17 — Hermes P13.2 (seating chart: guest→table drag-drop).
 *
 * Pure helpers for the CoupleSeating drag-drop panel. No Firestore,
 * no React — everything here is fully testable in vitest without
 * mocking. The split between this file and CoupleSeating.jsx mirrors
 * the existing vendorDelayReportPure / vendorProjectionPure pattern:
 * keep the math here, keep the rendering there.
 *
 * Contents (all exported):
 *   - normalizeTableAssignment(...) — schema-coerce raw Firestore row
 *     into the canonical TableAssignment shape used by the canvas.
 *   - occupancy(...) — count of seats filled per table (vs capacity).
 *   - guestTableFit(...) — does a guest fit in this table's capacity
 *     and category tier? Centralised so the rules + UI agree.
 *   - dietaryAllergens(...) — flatten a guest's allergen tags, handling
 *     the legacy "allergies" string + the modern "allergyTags" array.
 *   - suggestTableForCategory(...) — given a free table count and the
 *     guest's category, return the smallest table with room left.
 *   - validateAssignment(...) — defensive guard against assigning a
 *     guest to a table that would exceed capacity. Returns the table
 *     but flags a warning if it would overflow (callers decide whether
 *     to honor or reject).
 *   - buildAssignmentDocId(...) — stable doc id for /tableAssignments/
 *     = guestId (the collection docId is the guestId by schema).
 *   - emptyAssignment(...) — new blank assignment record.
 *   - summarizeDietaryAcrossTables(...) — for the dietary chip badge,
 *     return allergen counts per table.
 */

export const SEATING_TABLE_CATEGORIES = [
  'bride_groom',
  'groomsmen',
  'bridesmaid',
  'elder_family',
  'friends',
  'kids',
  'colleagues',
  'ceremony',
  'other',
] as const;

export type TableCategory = (typeof SEATING_TABLE_CATEGORIES)[number];

export const HELPER_WRITABLE_TABLE_CATEGORIES: ReadonlyArray<TableCategory> = [
  'friends',
  'kids',
  'colleagues',
  'other',
];

export type TableShape = 'round' | 'rect' | 'long';

export const TABLE_SHAPES: ReadonlyArray<TableShape> = ['round', 'rect', 'long'];

export const SEATING_SOURCE_VALUES = ['preset', 'manual'] as const;
export type SeatingSource = (typeof SEATING_SOURCE_VALUES)[number];

/**
 * Canonical table shape used by the canvas. The Firestore doc is
 * broader (string x/y, optional rotation, optional source); this is
 * the post-coercion in-memory representation.
 */
export interface SeatingTable {
  id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  tableCategory: TableCategory;
  x: number;
  y: number;
  rotation: number;
  source?: SeatingSource;
  updatedAt?: number;
}

/**
 * Canonical assignment record at /events/{eventId}/tableAssignments/{guestId}.
 * Doc id == guestId by schema (1:1 mapping), so re-writing the doc
 * atomically swaps guest to a new table.
 */
export interface TableAssignment {
  guestId: string;
  tableId: string;
  guestName?: string;
  assignedAt: number; // Date.now() at write time
  assignedBy?: string; // uid (owner / co-owner / helper)
  assignedByRole?: 'owner' | 'coOwner' | 'helper';
}

export interface GuestLite {
  id: string;
  name: string;
  side?: 'bride' | 'groom' | 'both';
  relation?: string;
  isChild?: boolean;
  /**
   * Accept either a string ("nuts, shellfish") or an array (["nuts",
   * "shellfish"]); both are flattened by dietaryAllergens().
   */
  allergies?: string | string[];
  allergyTags?: string[];
}

// ---------- normalization ----------

/**
 * Coerce a Firestore doc (or a draft form-state object) into a
 * canonical SeatingTable. Defensive: never throws on missing fields;
 * returns null if the row is so broken it cannot be used.
 */
export function normalizeTable(row: unknown, idHint?: string): SeatingTable | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = (r.id as string) || idHint || '';
  if (!id) return null;
  const shape = (r.shape as TableShape) || (r.shape === 'long' ? 'long' : 'round');
  if (!TABLE_SHAPES.includes(shape)) return null;
  const tableCategory = (r.tableCategory as TableCategory) || 'other';
  if (!SEATING_TABLE_CATEGORIES.includes(tableCategory)) return null;
  const capacity = Number(r.capacity);
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 40) return null;
  const x = Number(r.x);
  const y = Number(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rotation = Number(r.rotation ?? 0);
  const source = r.source as SeatingSource | undefined;
  const updatedAtRaw = r.updatedAt;
  const updatedAt =
    typeof updatedAtRaw === 'number'
      ? updatedAtRaw
      : typeof updatedAtRaw === 'object' && updatedAtRaw && 'toMillis' in (updatedAtRaw as Record<string, unknown>)
        ? ((updatedAtRaw as { toMillis: () => number }).toMillis())
        : undefined;
  return {
    id,
    label: String(r.label ?? id),
    shape,
    capacity,
    tableCategory,
    x,
    y,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    source: source && SEATING_SOURCE_VALUES.includes(source) ? source : undefined,
    updatedAt,
  };
}

export function emptyAssignment(guestId: string, tableId: string, assignedBy?: string): TableAssignment {
  return {
    guestId,
    tableId,
    assignedAt: Date.now(),
    ...(assignedBy ? { assignedBy } : {}),
  };
}

// ---------- occupancy ----------

/**
 * Given a list of tables + assignments, return occupancy summary.
 * Exported separately so the canvas can render badges without
 * recomputing per render.
 */
export interface TableOccupancy {
  tableId: string;
  capacity: number;
  filled: number;
  guests: string[]; // guestIds
  remaining: number;
  overflow: number; // filled - capacity, clamped to 0 minimum
  dietary: Record<string, number>; // allergen -> count
}

export function occupancy(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  guestsById: Readonly<Record<string, GuestLite>>,
): Record<string, TableOccupancy> {
  const out: Record<string, TableOccupancy> = {};
  for (const t of tables) {
    out[t.id] = {
      tableId: t.id,
      capacity: t.capacity,
      filled: 0,
      guests: [],
      remaining: t.capacity,
      overflow: 0,
      dietary: {},
    };
  }
  for (const a of assignments) {
    const slot = out[a.tableId];
    if (!slot) continue; // assignment points to a deleted table — silently ignored
    slot.filled += 1;
    slot.guests.push(a.guestId);
    slot.remaining = Math.max(0, slot.capacity - slot.filled);
    slot.overflow = Math.max(0, slot.filled - slot.capacity);
    const guest = guestsById[a.guestId];
    if (guest) {
      const tags = dietaryAllergens(guest);
      for (const tag of tags) {
        slot.dietary[tag] = (slot.dietary[tag] || 0) + 1;
      }
    }
  }
  return out;
}

// ---------- fit validation ----------

export interface GuestTableFit {
  fits: boolean;
  reason?: 'no_table' | 'wrong_category' | 'at_capacity' | 'same_table';
}

/**
 * Should this guest be allowed to be assigned to this table? Used
 * both for the drag-drop live preview (grey-out invalid targets)
 * and for the actual write (refuse in flight if invalid).
 */
export function guestTableFit(
  guest: GuestLite,
  table: SeatingTable,
  currentAssignments: ReadonlyArray<TableAssignment>,
): GuestTableFit {
  if (!table) return { fits: false, reason: 'no_table' };
  if (table.tableCategory !== categoryForGuest(guest)) {
    // Tables aren't strictly tied to a single category, but in the
    // Banquet preset (中式), the main family tables map directly.
    // For friends/kids/colleagues/other the rule is looser; we
    // permit if either side is "other".
    if (table.tableCategory !== 'other' && categoryForGuest(guest) !== 'other') {
      return { fits: false, reason: 'wrong_category' };
    }
  }
  const existing = currentAssignments.find((a) => a.guestId === guest.id);
  if (existing && existing.tableId === table.id) {
    return { fits: false, reason: 'same_table' };
  }
  const filled = currentAssignments.filter((a) => a.tableId === table.id).length;
  if (filled >= table.capacity) {
    return { fits: false, reason: 'at_capacity' };
  }
  return { fits: true };
}

/**
 * Default category mapping. The wedding-app's `/guests` collection
 * is sparse on tableCategory — guests without a hint default to
 * "other". This matches the rules-engine fallback in the
 * seat-assignment write rule.
 */
export function categoryForGuest(guest: GuestLite): TableCategory {
  if (guest.isChild) return 'kids';
  const side = guest.side;
  if (side === 'bride') return 'bridesmaid';
  if (side === 'groom') return 'groomsmen';
  return 'other';
}

// ---------- dietary flattening ----------

const DIETARY_KEY_NORMALIZER = (s: string): string => s.trim().toLowerCase();

/**
 * Flatten a guest's allergens into a normalised string array.
 * Accepts either a comma-separated string (legacy) or a string[]
 * (modern). Empty / null returns [].
 */
export function dietaryAllergens(guest: GuestLite): string[] {
  const out = new Set<string>();
  const raw: string[] = [];
  if (typeof guest.allergies === 'string') raw.push(...guest.allergies.split(','));
  if (Array.isArray(guest.allergies)) raw.push(...guest.allergies);
  if (Array.isArray(guest.allergyTags)) raw.push(...guest.allergyTags);
  for (const r of raw) {
    const norm = DIETARY_KEY_NORMALIZER(String(r));
    if (norm) out.add(norm);
  }
  return Array.from(out);
}

/**
 * Aggregate dietary across all tables. Returns map of tableId →
 * sorted allergen count list (top entries first). Used by the
 * dietary chip badge.
 */
export function summarizeDietaryAcrossTables(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  guestsById: Readonly<Record<string, GuestLite>>,
): Record<string, Array<{ tag: string; count: number }>> {
  const occ = occupancy(tables, assignments, guestsById);
  const out: Record<string, Array<{ tag: string; count: number }>> = {};
  for (const t of tables) {
    const slot = occ[t.id];
    const entries = Object.entries(slot.dietary)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    out[t.id] = entries;
  }
  return out;
}

// ---------- suggestions ----------

/**
 * Given a guest, find the smallest table (by capacity) with room
 * left. Returns null if no table fits. Ties are broken by table id
 * for determinism (so the helper-suggest flow is reproducible in
 * tests).
 */
export function suggestTableForCategory(
  guest: GuestLite,
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
): SeatingTable | null {
  const category = categoryForGuest(guest);
  const candidates = tables
    .filter((t) => {
      if (t.tableCategory !== category && t.tableCategory !== 'other' && category !== 'other') {
        return false;
      }
      const filled = assignments.filter((a) => a.tableId === t.id).length;
      return filled < t.capacity;
    })
    .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  return candidates[0] || null;
}

// ---------- assignment validation ----------

/**
 * If you write this assignment, would it overflow the table? Used
 * by the UI to warn before commit. The write itself is allowed
 * (the rules don't reject over-fill; P13.2 doesn't enforce it on
 * the server because some weddings genuinely need a +1 squeeze),
 * but the caller decides whether to block in UI.
 */
export function validateAssignment(
  guestId: string,
  tableId: string,
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
): { ok: boolean; table?: SeatingTable; wouldOverflow: boolean; alreadyAssigned?: string } {
  const table = tables.find((t) => t.id === tableId);
  if (!table) return { ok: false, wouldOverflow: false };
  const existing = assignments.find((a) => a.guestId === guestId);
  const filled = assignments.filter((a) => a.tableId === tableId).length - (existing && existing.tableId === tableId ? 1 : 0);
  const wouldOverflow = filled + 1 > table.capacity;
  return {
    ok: true,
    table,
    wouldOverflow,
    // Only surface "already assigned" when the guest is on a DIFFERENT
    // table — same-table reassignments aren't a user-facing concern.
    alreadyAssigned: existing && existing.tableId !== tableId ? existing.tableId : undefined,
  };
}

// ---------- doc id ----------

/**
 * The Firestore rule "doc id = guestId" makes this trivial. Kept as
 * a named helper so callers don't accidentally use the tableId as
 * a doc id (a tempting-but-wrong refactor that breaks reassignment).
 */
export function buildAssignmentDocId(guestId: string): string {
  if (!guestId) throw new Error('buildAssignmentDocId: empty guestId');
  return guestId;
}

// ---------- P13.3 — scanner hook + live badge ----------

/**
 * Type for a single check-in record. Pulled from
 * /seatingCheckIns/{guestId} (one doc per checked-in guest) — created
 * in P13.3 by extending handleSimulateReceptionScan. tableId is
 * denormalized so we can aggregate to per-table counts without a
 * second query to /tableAssignments.
 */
export interface SeatingCheckIn {
  guestId: string;
  tableId: string | null;
  scannedAt: number;
  helperUid?: string;
}

/**
 * Compact live-pill shape: only the fields the floor-plan renderer
 * needs to draw the "T-03 已入座 7/12" badge. Built by
 * `liveSeatingBadges`.
 */
export interface LiveSeatingBadge {
  tableId: string;
  filled: number;
  capacity: number;
  overflow: number;
  checkedIn: number;
}

/**
 * Bulk-error shape for the "auto-assign orphans" flow. Each row says
 * which guest failed and why. Reason is bucketed by `categorizeErrors`.
 */
export interface AssignmentError {
  guestId: string;
  reason: 'overflow' | 'invalidTable' | 'duplicate' | 'unknown';
  detail?: string;
}

/**
 * Phase 2.6 (P13.3) — live occupancy badge data.
 *
 * Given the same inputs as `occupancy`, project down to the minimal shape the
 * floor-plan renderer needs to draw the "T-03 已入座 7/12" pill on each table.
 *
 * Pure: same inputs as `occupancy`, returns an array keyed by tableId.
 * No Firestore, no React. Trivially memoizable on (tables, assignments,
 * guestsById, checkIns).
 *
 * `checkIns` is an array of `{ guestId, tableId, scannedAt }` records pulled
 * from `/seatingCheckIns/{guestId}` (one doc per checked-in guest). We
 * aggregate to a per-table count for the live pill. Guests not in any
 * table assignment are bucketed under `tableId === '__unmatched__'`.
 */
export function liveSeatingBadges(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  guestsById: Readonly<Record<string, GuestLite>>,
  checkIns?: ReadonlyArray<SeatingCheckIn>,
): LiveSeatingBadge[] {
  const occ = occupancy(tables, assignments, guestsById);
  const checkInsByTable: Record<string, number> = {};
  let unmatchedCheckIns = 0;
  if (Array.isArray(checkIns)) {
    for (const ci of checkIns) {
      const tableId = ci && ci.tableId;
      if (tableId) {
        checkInsByTable[tableId] = (checkInsByTable[tableId] || 0) + 1;
      } else {
        unmatchedCheckIns += 1;
      }
    }
  }
  const badges: LiveSeatingBadge[] = Object.entries(occ).map(
    ([tableId, row]) => ({
      tableId,
      filled: row.filled,
      capacity: row.capacity,
      overflow: row.overflow,
      checkedIn: checkInsByTable[tableId] || 0,
    }),
  );
  if (unmatchedCheckIns > 0) {
    badges.push({
      tableId: '__unmatched__',
      filled: unmatchedCheckIns,
      capacity: 0,
      overflow: 0,
      checkedIn: unmatchedCheckIns,
    });
  }
  return badges;
}

/**
 * Phase 2.1 (P13.3) — look up the tableAssignments doc for a guestId.
 * Returns the assignment (with the tableId) or null if unassigned.
 *
 * Pure linear scan. For events ≤1k guests this is O(n) per call but
 * memoizable on `assignments`. If you need O(1) lookup, build a Map
 * once outside this helper.
 */
export function findAssignmentForGuest(
  guestId: string | null | undefined,
  assignments: ReadonlyArray<TableAssignment> | null | undefined,
): TableAssignment | null {
  if (!guestId || !Array.isArray(assignments)) return null;
  return assignments.find((a) => a && a.guestId === guestId) || null;
}

/**
 * Phase 2.1 (P13.3) — resolve a guest's table LABEL (not just id) by
 * joining assignments ↔ tables. Returns null if unassigned. If the
 * table was deleted but the assignment lingers, returns the tableId
 * as a fallback (a stale-but-visible state worth surfacing).
 */
export function tableLabelForGuest(
  guestId: string | null | undefined,
  assignments: ReadonlyArray<TableAssignment>,
  tables: ReadonlyArray<SeatingTable>,
): string | null {
  const a = findAssignmentForGuest(guestId, assignments);
  if (!a) return null;
  if (!Array.isArray(tables)) return a.tableId;
  const t = tables.find(
    (tt) => tt && (tt.id === a.tableId || tt.tableId === a.tableId),
  );
  if (!t) return a.tableId;
  return t.label || t.id || a.tableId;
}

/**
 * Phase 2.6 (P13.3) — format the "7/8/12" live pill text shown on each
 * table. Returns null when there's nothing meaningful to show.
 *
 * Format: `<checkedIn>/<filled>/<capacity>`. e.g. "7/8/12" means
 * 7 checked in, 8 assigned, 12 seats total. The 3-segment display
 * makes the at-event-vs-expected gap obvious.
 */
export function formatLivePill(badge: Partial<LiveSeatingBadge> | null): string | null {
  if (!badge || !badge.capacity || badge.tableId === '__unmatched__') return null;
  const checkedIn = badge.checkedIn || 0;
  const filled = badge.filled || 0;
  return `${checkedIn}/${filled}/${badge.capacity}`;
}

/**
 * Phase 2.6 (P13.3) — bucket a list of errors by reason. Used by the
 * bulk "auto-assign" UI to surface one toast per bucket instead of one
 * per guest. Pure pass-through.
 */
export function categorizeErrors(
  errors: ReadonlyArray<AssignmentError | null | undefined>,
): { overflow: AssignmentError[]; invalidTable: AssignmentError[]; duplicate: AssignmentError[]; unknown: AssignmentError[] } {
  const buckets: { overflow: AssignmentError[]; invalidTable: AssignmentError[]; duplicate: AssignmentError[]; unknown: AssignmentError[] } = {
    overflow: [],
    invalidTable: [],
    duplicate: [],
    unknown: [],
  };
  if (!Array.isArray(errors)) return buckets;
  for (const e of errors) {
    if (!e) continue;
    const reason = e.reason || 'unknown';
    if (reason in buckets && Array.isArray(buckets[reason as keyof typeof buckets])) {
      (buckets[reason as keyof typeof buckets] as AssignmentError[]).push(e);
    } else {
      buckets.unknown.push(e);
    }
  }
  return buckets;
}

export default {
  SEATING_TABLE_CATEGORIES,
  HELPER_WRITABLE_TABLE_CATEGORIES,
  TABLE_SHAPES,
  normalizeTable,
  emptyAssignment,
  buildAssignmentDocId,
  occupancy,
  guestTableFit,
  categoryForGuest,
  dietaryAllergens,
  summarizeDietaryAcrossTables,
  suggestTableForCategory,
  validateAssignment,
  liveSeatingBadges,
  findAssignmentForGuest,
  tableLabelForGuest,
  formatLivePill,
  categorizeErrors,
};
