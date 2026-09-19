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

// ---------- budget ----------

/**
 * 2026-09-18 — P13.4.1: Budget optimizer.
 *
 * Default per-head cost for a HK wedding banquet in HKD. Operators
 * can override via the seating meta doc (`/events/{eventId}/seating/main`
 * → `costPerHead`). Default budget cap of 0 means "no cap" (operators
 * haven't set one yet).
 */
export const DEFAULT_COST_PER_HEAD = 800;
export const DEFAULT_BUDGET_CAP = 0;

export interface BudgetConfig {
  /** Cost per person in HKD. */
  costPerHead: number;
  /** Total budget cap in HKD. 0 = no cap. */
  budgetCap: number;
}

export interface BudgetSummary {
  totalFilled: number;
  totalCapacity: number;
  projectedCost: number;
  /** budgetCap - projectedCost. Negative when over budget. 0 when no cap. */
  remaining: number;
  /** projectedCost > budgetCap && budgetCap > 0 */
  overBudget: boolean;
  /** Percentage 0..100 of budget used. 0 when no cap. */
  percentUsed: number;
}

/**
 * Compute the current budget summary from filled seats across all
 * tables. Unfilled seats are not counted (the operator only pays
 * for guests who actually show up, modulo the contract — operators
 * can dial costPerHead to whatever the contract calls "per pax").
 *
 * Tables with capacity=0 (dance floor, decoration) are excluded.
 */
export function computeBudget(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  cfg: BudgetConfig,
): BudgetSummary {
  const filledByTable: Record<string, number> = {};
  for (const t of tables) {
    if (t.capacity <= 0) continue; // skip non-tables
    filledByTable[t.id] = 0;
  }
  for (const a of assignments) {
    if (filledByTable[a.tableId] === undefined) continue; // orphan assignment
    filledByTable[a.tableId] += 1;
  }
  let totalFilled = 0;
  let totalCapacity = 0;
  for (const t of tables) {
    if (t.capacity <= 0) continue;
    totalFilled += filledByTable[t.id] ?? 0;
    totalCapacity += t.capacity;
  }
  const projectedCost = totalFilled * cfg.costPerHead;
  const remaining = cfg.budgetCap > 0 ? cfg.budgetCap - projectedCost : 0;
  const overBudget = cfg.budgetCap > 0 && projectedCost > cfg.budgetCap;
  const percentUsed = cfg.budgetCap > 0
    ? Math.min(100, Math.round((projectedCost / cfg.budgetCap) * 100))
    : 0;
  return {
    totalFilled,
    totalCapacity,
    projectedCost,
    remaining,
    overBudget,
    percentUsed,
  };
}

/**
 * Project the budget delta when one table's capacity changes. Used
 * for the "T-03 加位至 12 人 = 預算 +$800" toast / live preview.
 *
 * If `newCapacity` is HIGHER than current, the delta is 0 (cost
 * scales with filled guests, not capacity — the budget only grows
 * when the operator adds new guests, not when they add empty
 * seats). This matches typical banquet contracts where you pay
 * per-pax confirmed.
 *
 * If `newCapacity` is LOWER than current and filled > newCapacity,
 * the function flags `overCapacityAfter` so the UI can warn.
 */
export function projectBudgetDelta(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  tableId: string,
  newCapacity: number,
  cfg: BudgetConfig,
): {
  delta: number;          // 0 for capacity changes; reserved for future
  newProjectedCost: number;
  newRemaining: number;
  overCapacityAfter: boolean; // true if filled > newCapacity
} {
  // For now, capacity changes don't directly affect cost (only
  // adding guests does). Return the current cost + flag the
  // over-capacity case.
  const current = computeBudget(tables, assignments, cfg);
  const filledHere = assignments.filter((a) => a.tableId === tableId).length;
  const overCapacityAfter = filledHere > newCapacity;
  return {
    delta: 0,
    newProjectedCost: current.projectedCost,
    newRemaining: current.remaining,
    overCapacityAfter,
  };
}

/**
 * Format a HKD amount for display. Uses thin-space thousands
 * separator (e.g. "$144k" or "$144,800") and trims trailing zeros.
 */
export function formatHKD(n: number, opts: { short?: boolean } = {}): string {
  if (opts.short && n >= 1000) {
    const k = n / 1000;
    if (k >= 100) return `$${Math.round(k)}k`;
    return `$${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `$${n.toLocaleString('en-HK')}`;
}

// ---------- auto-layout ----------

/**
 * 2026-09-18 — P13.4.2: Auto-layout optimizer.
 *
 * Two pure helpers:
 *
 * 1) suggestTargetTables — given the current tables+assignments
 *    state, return the best-fit tables for an "I want to add N
 *    guests" query. Used both for inline suggestions next to an
 *    unassigned guest AND as the candidate picker for the
 *    batch "auto-assign" flow.
 *
 * 2) autoAssignGuests — greedy bin-packing of unassigned guests
 *    into the best-fit tables. Never mutates the input array;
 *    returns a new assignments array + the orphans that didn't
 *    fit anywhere.
 *
 * The "best-fit" rule honors category match first (never put a
 * groomsmen in a friends table), then prefers the table that
 * ends up "tightest" so we don't waste a 10-seat table on 2
 * guests when a 6-seat half-full table is right there.
 */

/** Options for suggestTargetTables and autoAssignGuests. */
export interface AutoAssignOptions {
  /** If set, prefer tables whose tableCategory equals this. */
  category?: TableCategory;
  /** Tables to skip (e.g. already excluded by the operator). */
  excludeTableIds?: ReadonlyArray<string>;
  /** Fill small gaps first ('tightest') or leave them open ('loosest').
   * Default: 'tightest' — operators running the auto-assigner
   * want to minimize orphans, not maximize empty seats. */
  prefer?: 'tightest' | 'loosest';
}

/** A single candidate returned by suggestTargetTables. */
export interface ScoredTable {
  table: SeatingTable;
  filled: number;
  remaining: number;
  /** Lower = better candidate. Same-category tables rank above
      mismatched. Same category ranking: tightest remaining first
      (or loosest, per opts.prefer). */
  score: number;
  /** Why this table got the score it did (for UI surfacing). */
  reasons: {
    categoryMatch: boolean;
    capacityFull: boolean;
  };
}

/**
 * Suggest candidate tables for an upcoming assignment. Excludes
 * full tables, tables the operator excluded, and tables with
 * capacity=0 (dance floor, decoration). Surviving tables are
 * ranked by score:
 *
 *   category-mismatch:  +100 penalty (or skip category-less guests)
 *   capacity-full:      excluded
 *   prefer='tightest':  score = remaining (smallest remaining wins)
 *   prefer='loosest':   score = -remaining (most remaining wins)
 *
 * Returns an empty array if no candidate has room.
 */
export function suggestTargetTables(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  opts: AutoAssignOptions = {},
): ScoredTable[] {
  const { category, excludeTableIds = [], prefer = 'tightest' } = opts;
  const excluded = new Set(excludeTableIds);

  // Count filled seats per table (same algorithm as occupancy()).
  const filled: Record<string, number> = {};
  for (const t of tables) {
    if (t.capacity <= 0) continue; // skip dance floor etc.
    if (excluded.has(t.id)) continue; // skip operator-excluded
    filled[t.id] = 0;
  }
  for (const a of assignments) {
    if (filled[a.tableId] === undefined) continue;
    filled[a.tableId] += 1;
  }

  const candidates: ScoredTable[] = [];
  for (const t of tables) {
    if (filled[t.id] === undefined) continue;
    const f = filled[t.id];
    const remaining = t.capacity - f;
    if (remaining <= 0) continue; // full — skip
    const categoryMatch = !category || t.tableCategory === category;
    let score: number;
    if (!categoryMatch) {
      score = 100 + (prefer === 'tightest' ? remaining : -remaining);
    } else {
      score = prefer === 'tightest' ? remaining : -remaining;
    }
    candidates.push({
      table: t,
      filled: f,
      remaining,
      score,
      reasons: { categoryMatch, capacityFull: false },
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

/** A guest waiting to be placed (no current tableId). */
export interface UnassignedGuest {
  id: string;
  name?: string;
  category?: TableCategory;
  /** Group-key for keeping couples/families together. Two guests
   *  with the same groupKey are assigned to the same table when
   *  possible (couples policy). Optional. */
  groupKey?: string;
}

export interface AutoAssignResult {
  /** New assignments to write. Empty if there were no orphans. */
  newAssignments: TableAssignment[];
  /** Guests that couldn't fit anywhere (orphan list). */
  remainingOrphans: UnassignedGuest[];
  /** Top-level count for the success toast. */
  stats: {
    placed: number;
    orphan: number;
    skipped: number; // guests with no valid table
  };
}

/**
 * Greedy bin-pack unassigned guests into existing tables. The
 * algorithm is O(G × T) where G is the number of orphans and T
 * is the number of tables. Wedding banquets are small (G < 200,
 * T < 30) so this is fine to run synchronously.
 *
 * Algorithm:
 *   1. For each guest (sorted by groupKey so couples stay together):
 *      a. Compute candidate tables via suggestTargetTables filtered
 *         by the guest's category.
 *      b. If category-less, prefer same-table-for-group: try the
 *         table where the group already has a member (if any
 *         candidate).
 *      c. Otherwise pick the candidate ranked #1.
 *      d. If no candidate has room, add the guest to remainingOrphans.
 *   2. Append all chosen assignments to the input (immutable copy).
 *   3. Skip guests with both invalid category + no candidates.
 */
export function autoAssignGuests(
  tables: ReadonlyArray<SeatingTable>,
  assignments: ReadonlyArray<TableAssignment>,
  guests: ReadonlyArray<UnassignedGuest>,
  opts: AutoAssignOptions = {},
): AutoAssignResult {
  // Sort guests so same-group guests are adjacent. Couples policy
  // (groupKey) is "assign all to the same table if possible".
  const sortedGuests = [...guests].sort((a, b) => {
    const ag = a.groupKey ?? '';
    const bg = b.groupKey ?? '';
    if (ag !== bg) return ag < bg ? -1 : 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  // Start from a shallow copy so we never mutate caller state.
  const next: TableAssignment[] = [...assignments];
  const orphans: UnassignedGuest[] = [];
  let placed = 0;

  // Per-group target table to keep couples together.
  const groupTarget: Record<string, string> = {};

  // Recompute filled as we go (incremental O(1) update per write).
  const filled: Record<string, number> = {};
  for (const t of tables) {
    if (t.capacity <= 0) continue;
    filled[t.id] = 0;
  }
  for (const a of next) {
    if (filled[a.tableId] === undefined) continue;
    filled[a.tableId] += 1;
  }

  // Pre-compute full set so we can mark them once and skip fast.
  const skipId = new Set(opts.excludeTableIds ?? []);

  for (const g of sortedGuests) {
    // Skip guests with no id (caller should always provide one).
    if (!g.id) {
      orphans.push(g);
      continue;
    }

    // Couple-policy: keep groups together by targeting the same
    // table as the prior group member when possible.
    let preferredId: string | undefined;
    const priorTarget = g.groupKey ? groupTarget[g.groupKey] : undefined;
    if (priorTarget) {
      const t = tables.find((tt) => tt.id === priorTarget);
      if (t && t.capacity > filled[t.id] && !skipId.has(t.id)) {
        preferredId = t.id;
      }
    }

    // Compute fresh candidates (table fills change as we go).
    // Note: when a category is specified (the common case —
    // friend → friends, groomsmen → groomsmen), we filter out
    // mismatched tables entirely. This protects fixed-slot
    // categories (bride_groom, ceremony, elder_family) and
    // other special-purpose tables from being overflow targets.
    // Without this, after friends tables fill, the auto-assigner
    // would spill into groomsmen or 主家席.
    const candidates = suggestTargetTables(
      tables,
      next,
      {
        category: g.category,
        excludeTableIds: [
          ...(opts.excludeTableIds ?? []),
          ...(g.category
            ? tables
                .filter((tt) => tt.tableCategory !== g.category)
                .map((tt) => tt.id)
            : []),
        ],
        prefer: opts.prefer,
      },
    );

    let pickId: string | undefined = preferredId;
    if (!pickId) {
      const top = candidates[0];
      if (!top) {
        // No table has room — this guest is an orphan.
        orphans.push(g);
        continue;
      }
      pickId = top.table.id;
    }

    // Commit.
    next.push({
      guestId: g.id,
      tableId: pickId,
      guestName: g.name,
      assignedAt: 0, // overwritten by caller when written
      assignedByRole: 'owner',
    });
    filled[pickId] += 1;
    if (g.groupKey) groupTarget[g.groupKey] = pickId;
    placed += 1;
  }

  // Strip the freshly-added ones from the input (they were only
  // emitted for the loop's bookkeeping). The caller wants ONLY the
  // new assignments, not the original list.
  const newAssignments = next.slice(assignments.length);

  return {
    newAssignments,
    remainingOrphans: orphans,
    stats: { placed, orphan: orphans.length, skipped: 0 },
  };
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

/**
 * 2026-09-18 — P13.4.3: 中式 preset refinements.
 *
 * Standard 圍枱 sizes in HK wedding banquets (10-12 people per
 * 圍 is most common, 8 for tighter family-style). Operators can
 * pick a size when applying the preset.
 */
export const CHINESE_ROUND_CAPACITY_OPTIONS = [8, 10, 12] as const;
export type ChineseRoundCapacity = (typeof CHINESE_ROUND_CAPACITY_OPTIONS)[number];

/**
 * Standard 圍數 (number of 圍) for HK wedding banquets. 10-15 is
 * typical (100-180 guests at 10/圍, 80-120 at 12/圍).
 */
export const CHINESE_ROUND_COUNT_OPTIONS = [8, 10, 12, 15, 18, 20] as const;
export type ChineseRoundCount = (typeof CHINESE_ROUND_COUNT_OPTIONS)[number];

export interface ChinesePresetOptions {
  /** Capacity per 圍枱 (default 10). */
  roundCapacity?: ChineseRoundCapacity;
  /** Number of 圍 to lay out (default 12). */
  roundCount?: ChineseRoundCount;
}

/**
 * Categories considered "fixed slots" — visually distinct on the
 * canvas, not writable by helpers. 主家席 = bride_groom, 證婚席
 * = ceremony, 兄弟 = groomsmen, 姐妹 = bridesmaid, 長輩 =
 * elder_family. Used by the canvas to draw a dashed border +
 * "主家" / "證婚" / "兄弟" / "姐妹" / "長輩" badge.
 */
export const FIXED_SLOT_CATEGORIES = new Set<TableCategory>([
  'bride_groom',
  'ceremony',
  'groomsmen',
  'bridesmaid',
  'elder_family',
]);

export interface FixedSlotBadge {
  text: string; // 2-3 char zh-HK label
  color: string; // text color
  bg: string;   // background color
}

const FIXED_SLOT_BADGES: Record<TableCategory, FixedSlotBadge> = {
  bride_groom:  { text: '主家', color: '#9D174D', bg: '#FCE7F3' }, // pink
  ceremony:     { text: '證婚', color: '#92400E', bg: '#FEF3C7' }, // amber
  groomsmen:    { text: '兄弟', color: '#1E3A8A', bg: '#DBEAFE' }, // blue
  bridesmaid:   { text: '姐妹', color: '#9D174D', bg: '#FCE7F3' }, // pink
  elder_family: { text: '長輩', color: '#7C2D12', bg: '#FED7AA' }, // orange
  friends:      { text: '',     color: '',        bg: '' },
  kids:         { text: '',     color: '',        bg: '' },
  colleagues:   { text: '',     color: '',        bg: '' },
  other:        { text: '',     color: '',        bg: '' },
};

/**
 * Look up the fixed-slot badge for a category. Returns null if
 * the category is NOT a fixed slot.
 */
export function fixedSlotBadge(category: TableCategory): FixedSlotBadge | null {
  if (!FIXED_SLOT_CATEGORIES.has(category)) return null;
  return FIXED_SLOT_BADGES[category];
}

/**
 * Build the Chinese preset (中式 banquet). Generates a 主家席 at
 * the top, a 證婚席 below it, then a ring of N 圍 around a
 * central dance floor (or just blank space if N is small).
 *
 * The returned tables all have source='preset' and are safe to
 * bulk-write via batch.set().
 */
export function chinesePreset(opts: ChinesePresetOptions = {}): SeatingTable[] {
  const roundCapacity = opts.roundCapacity ?? 10;
  const roundCount = opts.roundCount ?? 12;
  const rows: SeatingTable[] = [];
  // 主家席 (small long rect at top — bride + groom + parents)
  rows.push({
    id: 'p-c-bride',
    label: '主家席',
    shape: 'long',
    capacity: 12,
    tableCategory: 'bride_groom',
    x: 500, y: 80, rotation: 0,
    source: 'preset',
  });
  // 證婚席 (smaller rect below — MC + witnesses + ring bearer)
  rows.push({
    id: 'p-c-ceremony',
    label: '證婚席',
    shape: 'rect',
    capacity: 8,
    tableCategory: 'ceremony',
    x: 540, y: 200, rotation: 0,
    source: 'preset',
  });
  // N 圍 around the dance floor. cx=600, cy=500. ring=240
  // horizontal, 0.7 vertical squash so it fits a wide canvas.
  const cx = 600, cy = 500;
  const ring = 240;
  for (let i = 0; i < roundCount; i++) {
    const angle = (i / roundCount) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * ring - 40;
    const y = cy + Math.sin(angle) * ring * 0.7 - 40;
    rows.push({
      id: `p-c-${i + 1}`,
      label: `第${chineseNumber(i + 1)}圍`,
      shape: 'round',
      capacity: roundCapacity,
      tableCategory: 'friends',
      x: Math.round(x),
      y: Math.round(y),
      rotation: 0,
      source: 'preset',
    });
  }
  return rows;
}

/**
 * Convert 1..20 to traditional Chinese numerals (一, 二, 三 …
 * 二十) for 圍枱 labels. Operators see "第三圍" not "第 3 圍".
 */
export function chineseNumber(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + digits[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + '十' + (ones ? digits[ones] : '');
  }
  return String(n); // fall back to arabic for n >= 100
}

export default {
  SEATING_TABLE_CATEGORIES,
  HELPER_WRITABLE_TABLE_CATEGORIES,
  FIXED_SLOT_CATEGORIES,
  CHINESE_ROUND_CAPACITY_OPTIONS,
  CHINESE_ROUND_COUNT_OPTIONS,
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
  chineseNumber,
  chinesePreset,
  fixedSlotBadge,
  DEFAULT_COST_PER_HEAD,
  DEFAULT_BUDGET_CAP,
  computeBudget,
  projectBudgetDelta,
  formatHKD,
  suggestTargetTables,
  autoAssignGuests,
};
