import { describe, it, expect } from 'vitest';
import {
  // constants
  SEATING_TABLE_CATEGORIES,
  HELPER_WRITABLE_TABLE_CATEGORIES,
  TABLE_SHAPES,
  // types
  // (exported for ts inference; not directly referenced in tests)
  // core
  normalizeTable,
  emptyAssignment,
  occupancy,
  guestTableFit,
  categoryForGuest,
  dietaryAllergens,
  summarizeDietaryAcrossTables,
  suggestTableForCategory,
  validateAssignment,
  buildAssignmentDocId,
} from './seatingPure';
import type { SeatingTable, TableAssignment, GuestLite } from './seatingPure';

// ---------- helpers for tests ----------
function t(overrides: Partial<SeatingTable> = {}): SeatingTable {
  return {
    id: 'T-01',
    label: 'T-01',
    shape: 'round',
    capacity: 8,
    tableCategory: 'friends',
    x: 0,
    y: 0,
    rotation: 0,
    ...overrides,
  };
}

function g(overrides: Partial<GuestLite> = {}): GuestLite {
  return {
    id: 'G-01',
    name: '張小明',
    ...overrides,
  };
}

function a(guestId: string, tableId: string, extras: Partial<TableAssignment> = {}): TableAssignment {
  return {
    guestId,
    tableId,
    assignedAt: 1700000000000,
    ...extras,
  };
}

// ---------- constants ----------
describe('seatingPure constants', () => {
  it('SEATING_TABLE_CATEGORIES has 9 entries', () => {
    expect(SEATING_TABLE_CATEGORIES).toHaveLength(9);
    expect(SEATING_TABLE_CATEGORIES).toContain('bride_groom');
    expect(SEATING_TABLE_CATEGORIES).toContain('other');
  });

  it('HELPER_WRITABLE_TABLE_CATEGORIES is the 4-cat subset', () => {
    expect(HELPER_WRITABLE_TABLE_CATEGORIES).toEqual(['friends', 'kids', 'colleagues', 'other']);
  });

  it('TABLE_SHAPES has round/rect/long', () => {
    expect(TABLE_SHAPES).toEqual(['round', 'rect', 'long']);
  });
});

// ---------- normalizeTable ----------
describe('normalizeTable', () => {
  it('coerces a complete row', () => {
    const out = normalizeTable({
      id: 'T-01',
      label: '第 1 圍',
      shape: 'round',
      capacity: 10,
      tableCategory: 'friends',
      x: 100,
      y: 200,
      rotation: 0,
      source: 'preset',
      updatedAt: 1700000000000,
    });
    expect(out).toEqual({
      id: 'T-01',
      label: '第 1 圍',
      shape: 'round',
      capacity: 10,
      tableCategory: 'friends',
      x: 100,
      y: 200,
      rotation: 0,
      source: 'preset',
      updatedAt: 1700000000000,
    });
  });

  it('falls back to idHint when row has no id', () => {
    const out = normalizeTable(
      { label: 'X', shape: 'round', capacity: 8, tableCategory: 'other', x: 0, y: 0 },
      'from-hint',
    );
    expect(out?.id).toBe('from-hint');
  });

  it('returns null when capacity is out of range', () => {
    expect(
      normalizeTable({ id: 'T', label: 'T', shape: 'round', capacity: 0, tableCategory: 'other', x: 0, y: 0 }),
    ).toBeNull();
    expect(
      normalizeTable({ id: 'T', label: 'T', shape: 'round', capacity: 99, tableCategory: 'other', x: 0, y: 0 }),
    ).toBeNull();
  });

  it('returns null when shape is unknown', () => {
    expect(
      normalizeTable({ id: 'T', label: 'T', shape: 'octagon', capacity: 8, tableCategory: 'other', x: 0, y: 0 }),
    ).toBeNull();
  });

  it('returns null when tableCategory is not in enum', () => {
    expect(
      normalizeTable({ id: 'T', label: 'T', shape: 'round', capacity: 8, tableCategory: 'random', x: 0, y: 0 }),
    ).toBeNull();
  });

  it('returns null when x or y is NaN', () => {
    expect(
      normalizeTable({ id: 'T', label: 'T', shape: 'round', capacity: 8, tableCategory: 'other', x: 'oops', y: 0 }),
    ).toBeNull();
  });

  it('handles firestore Timestamp-like updatedAt', () => {
    const fakeTs = { toMillis: () => 1700000000000 };
    const out = normalizeTable({
      id: 'T', label: 'T', shape: 'round', capacity: 8, tableCategory: 'other',
      x: 0, y: 0, updatedAt: fakeTs,
    });
    expect(out?.updatedAt).toBe(1700000000000);
  });

  it('defaults rotation to 0 when missing', () => {
    const out = normalizeTable({
      id: 'T', label: 'T', shape: 'round', capacity: 8, tableCategory: 'other', x: 0, y: 0,
    });
    expect(out?.rotation).toBe(0);
  });

  it('rejects bogus source values', () => {
    const out = normalizeTable({
      id: 'T', label: 'T', shape: 'round', capacity: 8, tableCategory: 'other',
      x: 0, y: 0, source: 'magic',
    });
    expect(out?.source).toBeUndefined();
  });
});

// ---------- emptyAssignment / buildAssignmentDocId ----------
describe('assignment doc helpers', () => {
  it('emptyAssignment has all required fields', () => {
    const out = emptyAssignment('G-01', 'T-01', 'user-123');
    expect(out).toMatchObject({ guestId: 'G-01', tableId: 'T-01', assignedBy: 'user-123' });
    expect(typeof out.assignedAt).toBe('number');
  });

  it('emptyAssignment omits assignedBy when not provided', () => {
    const out = emptyAssignment('G', 'T');
    expect('assignedBy' in out).toBe(false);
  });

  it('buildAssignmentDocId throws on empty guestId', () => {
    expect(() => buildAssignmentDocId('')).toThrow();
  });

  it('buildAssignmentDocId returns the guestId verbatim', () => {
    expect(buildAssignmentDocId('G-42')).toBe('G-42');
  });
});

// ---------- occupancy ----------
describe('occupancy', () => {
  it('reports empty occupancy when no assignments', () => {
    const tables = [t({ id: 'A', capacity: 8 }), t({ id: 'B', capacity: 10 })];
    const occ = occupancy(tables, [], {});
    expect(occ.A.filled).toBe(0);
    expect(occ.A.remaining).toBe(8);
    expect(occ.B.capacity).toBe(10);
  });

  it('counts filled and remaining correctly', () => {
    const tables = [t({ id: 'A', capacity: 4 })];
    const assignments = [a('G1', 'A'), a('G2', 'A'), a('G3', 'A')];
    const occ = occupancy(tables, assignments, {});
    expect(occ.A.filled).toBe(3);
    expect(occ.A.remaining).toBe(1);
    expect(occ.A.guests).toEqual(['G1', 'G2', 'G3']);
  });

  it('flags overflow when filled > capacity', () => {
    const tables = [t({ id: 'A', capacity: 2 })];
    const assignments = [a('G1', 'A'), a('G2', 'A'), a('G3', 'A')];
    const occ = occupancy(tables, assignments, {});
    expect(occ.A.overflow).toBe(1);
    expect(occ.A.remaining).toBe(0);
  });

  it('aggregates dietary allergens per table', () => {
    const tables = [t({ id: 'A', capacity: 10 })];
    const guests = {
      G1: g({ id: 'G1', allergies: ['nuts', 'shellfish'] }),
      G2: g({ id: 'G2', allergies: 'nuts, dairy' }),
      G3: g({ id: 'G3', allergyTags: ['Shellfish'] }), // case insensitive
    };
    const assignments = [a('G1', 'A'), a('G2', 'A'), a('G3', 'A')];
    const occ = occupancy(tables, assignments, guests);
    expect(occ.A.dietary).toEqual({ nuts: 2, shellfish: 2, dairy: 1 });
  });

  it('silently ignores assignments pointing to deleted tables', () => {
    const tables = [t({ id: 'A', capacity: 8 })];
    const assignments = [a('G1', 'A'), a('G2', 'DELETED')];
    const occ = occupancy(tables, assignments, {});
    expect(occ.A.filled).toBe(1);
    expect(occ.DELETED).toBeUndefined();
  });
});

// ---------- guestTableFit ----------
describe('guestTableFit', () => {
  it('fits when table is empty and category matches', () => {
    expect(guestTableFit(g(), t(), [])).toEqual({ fits: true });
  });

  it('rejects when at capacity', () => {
    const guest = g();
    const table = t({ capacity: 2 });
    const assignments = [a('X', 'T-01'), a('Y', 'T-01')];
    expect(guestTableFit(guest, table, assignments)).toEqual({
      fits: false, reason: 'at_capacity',
    });
  });

  it('rejects same-table reassignment', () => {
    const guest = g({ id: 'G-01' });
    const assignments = [a('G-01', 'T-01')];
    expect(guestTableFit(guest, t(), assignments)).toEqual({
      fits: false, reason: 'same_table',
    });
  });

  it('permits cross-category assignment to "other" tables', () => {
    const guest = g({ side: 'bride' }); // → bridesmaid category
    const other = t({ tableCategory: 'other', capacity: 8 });
    expect(guestTableFit(guest, other, []).fits).toBe(true);
  });

  it('rejects cross-category between non-other tiers', () => {
    const guest = g({ side: 'bride' }); // → bridesmaid
    const friends = t({ tableCategory: 'friends', capacity: 8 });
    expect(guestTableFit(guest, friends, []).reason).toBe('wrong_category');
  });
});

// ---------- categoryForGuest ----------
describe('categoryForGuest', () => {
  it('isChild → kids', () => {
    expect(categoryForGuest(g({ isChild: true }))).toBe('kids');
  });
  it('side bride → bridesmaid', () => {
    expect(categoryForGuest(g({ side: 'bride' }))).toBe('bridesmaid');
  });
  it('side groom → groomsmen', () => {
    expect(categoryForGuest(g({ side: 'groom' }))).toBe('groomsmen');
  });
  it('no fields → other', () => {
    expect(categoryForGuest(g())).toBe('other');
  });
});

// ---------- dietaryAllergens ----------
describe('dietaryAllergens', () => {
  it('returns empty for unset guest', () => {
    expect(dietaryAllergens(g())).toEqual([]);
  });

  it('splits a comma-separated string', () => {
    expect(dietaryAllergens(g({ allergies: 'nuts, dairy, shellfish' }))).toEqual([
      'nuts', 'dairy', 'shellfish',
    ]);
  });

  it('accepts an array value', () => {
    expect(dietaryAllergens(g({ allergies: ['nuts', 'Dairy'] }))).toEqual([
      'nuts', 'dairy',
    ]);
  });

  it('merges allergies + allergyTags and dedupes', () => {
    const out = dietaryAllergens(g({
      allergies: ['nuts', 'dairy'],
      allergyTags: ['dairy', 'eggs'],
    }));
    expect(out.sort()).toEqual(['dairy', 'eggs', 'nuts']);
  });

  it('trims whitespace and lowercases', () => {
    expect(dietaryAllergens(g({ allergies: '  Nuts , SHELLFISH ' }))).toEqual([
      'nuts', 'shellfish',
    ]);
  });

  it('drops empty tags', () => {
    expect(dietaryAllergens(g({ allergies: ['nuts', '', '   ', 'dairy'] }))).toEqual([
      'nuts', 'dairy',
    ]);
  });
});

// ---------- summarizeDietaryAcrossTables ----------
describe('summarizeDietaryAcrossTables', () => {
  it('returns sorted allergen counts per table', () => {
    const tables = [t({ id: 'A' }), t({ id: 'B' })];
    const guests = {
      G1: g({ id: 'G1', allergies: ['nuts', 'shellfish'] }),
      G2: g({ id: 'G2', allergies: 'nuts' }),
      G3: g({ id: 'G3', allergies: 'shellfish' }),
    };
    const assignments = [a('G1', 'A'), a('G2', 'A'), a('G3', 'B')];
    const out = summarizeDietaryAcrossTables(tables, assignments, guests);
    expect(out.A).toEqual([
      { tag: 'nuts', count: 2 }, { tag: 'shellfish', count: 1 },
    ]);
    expect(out.B).toEqual([{ tag: 'shellfish', count: 1 }]);
  });

  it('returns empty array for tables with no dietary info', () => {
    const out = summarizeDietaryAcrossTables([t({ id: 'A' })], [], {});
    expect(out.A).toEqual([]);
  });
});

// ---------- suggestTableForCategory ----------
describe('suggestTableForCategory', () => {
  it('picks smallest table with room', () => {
    const tables = [
      t({ id: 'BIG', capacity: 20, tableCategory: 'friends' }),
      t({ id: 'SMALL', capacity: 4, tableCategory: 'friends' }),
    ];
    expect(suggestTableForCategory(g(), tables, [])?.id).toBe('SMALL');
  });

  it('skips full tables', () => {
    const tables = [
      t({ id: 'FULL', capacity: 4 }),
      t({ id: 'OPEN', capacity: 4 }),
    ];
    const assignments = [a('X', 'FULL'), a('Y', 'FULL'), a('Z', 'FULL'), a('W', 'FULL')];
    expect(suggestTableForCategory(g(), tables, assignments)?.id).toBe('OPEN');
  });

  it('returns null when no table has room', () => {
    const tables = [t({ id: 'FULL', capacity: 1 })];
    const assignments = [a('X', 'FULL')];
    expect(suggestTableForCategory(g(), tables, assignments)).toBeNull();
  });

  it('falls back to other-category tables when category has no fit', () => {
    const tables = [
      t({ id: 'OTHER', capacity: 8, tableCategory: 'other' }),
    ];
    const brideGuest = g({ side: 'bride' });
    expect(suggestTableForCategory(brideGuest, tables, [])?.id).toBe('OTHER');
  });
});

// ---------- validateAssignment ----------
describe('validateAssignment', () => {
  it('rejects unknown table', () => {
    expect(validateAssignment('G', 'NOPE', [], [])).toEqual({
      ok: false, wouldOverflow: false,
    });
  });

  it('flags overflow but still returns the table', () => {
    const tables = [t({ id: 'A', capacity: 2 })];
    const assignments = [a('X', 'A'), a('Y', 'A')];
    const out = validateAssignment('Z', 'A', tables, assignments);
    expect(out.ok).toBe(true);
    expect(out.wouldOverflow).toBe(true);
  });

  it('reports existing assignment', () => {
    const tables = [t({ id: 'A', capacity: 4 }), t({ id: 'B', capacity: 4 })];
    const assignments = [a('G', 'A')];
    const out = validateAssignment('G', 'B', tables, assignments);
    expect(out.alreadyAssigned).toBe('A');
    expect(out.wouldOverflow).toBe(false);
  });

  it('does not double-count when guest is already on the target table', () => {
    const tables = [t({ id: 'A', capacity: 2 })];
    const assignments = [a('X', 'A'), a('G', 'A')];
    // G reassigning to A doesn't increase fill (same table)
    const out = validateAssignment('G', 'A', tables, assignments);
    expect(out.wouldOverflow).toBe(false);
  });
});

// ============================ P13.3 helpers ============================

import {
  liveSeatingBadges,
  findAssignmentForGuest,
  tableLabelForGuest,
  formatLivePill,
  categorizeErrors,
} from './seatingPure';

describe('P13.3 — scanner hook + live badge helpers', () => {
  describe('liveSeatingBadges', () => {
    const tables = [
      t({ id: 'A', capacity: 8, tableCategory: 'friends' }),
      t({ id: 'B', capacity: 10, tableCategory: 'friends' }),
    ];
    const guests = {
      g1: { id: 'g1', name: 'Alice', side: 'bride' },
      g2: { id: 'g2', name: 'Bob', side: 'groom' },
      g3: { id: 'g3', name: 'Carol', side: 'both' },
    };
    const assignments = [
      { guestId: 'g1', tableId: 'A' },
      { guestId: 'g2', tableId: 'A' },
      { guestId: 'g3', tableId: 'B' },
    ];

    it('returns one badge per table', () => {
      const badges = liveSeatingBadges(tables, assignments, guests, []);
      expect(badges).toHaveLength(2);
    });

    it('reports checkedIn from checkIns array', () => {
      const checkIns = [
        { guestId: 'g1', tableId: 'A' },
        { guestId: 'g2', tableId: 'A' },
      ];
      const badges = liveSeatingBadges(tables, assignments, guests, checkIns);
      const aBadge = badges.find((b) => b.tableId === 'A');
      expect(aBadge.checkedIn).toBe(2);
      const bBadge = badges.find((b) => b.tableId === 'B');
      expect(bBadge.checkedIn).toBe(0);
    });

    it('buckets unmatched checkIns under __unmatched__', () => {
      const checkIns = [{ guestId: 'gX', tableId: null }];
      const badges = liveSeatingBadges(tables, assignments, guests, checkIns);
      const um = badges.find((b) => b.tableId === '__unmatched__');
      expect(um).toBeDefined();
      expect(um.checkedIn).toBe(1);
    });

    it('handles missing checkIns arg gracefully', () => {
      const badges = liveSeatingBadges(tables, assignments, guests);
      expect(badges.every((b) => b.checkedIn === 0)).toBe(true);
    });

    it('handles non-array checkIns arg gracefully', () => {
      const badges = liveSeatingBadges(tables, assignments, guests, null);
      expect(badges).toHaveLength(2);
    });

    it('flags overflow on tables with over-assignment', () => {
      const overflowAssignments = [
        { guestId: 'g1', tableId: 'A' },
        { guestId: 'g2', tableId: 'A' },
        { guestId: 'g3', tableId: 'A' },
      ]; // 3 guests but tables has A with capacity 8 — actually fine
      // Let's force overflow with a small table
      const smallTables = [t({ id: 'A', capacity: 2, tableCategory: 'friends' })];
      const badges = liveSeatingBadges(
        smallTables,
        overflowAssignments,
        guests,
        [],
      );
      expect(badges[0].overflow).toBe(1);
    });
  });

  describe('findAssignmentForGuest', () => {
    const assignments = [
      { guestId: 'g1', tableId: 'A' },
      { guestId: 'g2', tableId: 'B' },
    ];

    it('finds the matching assignment', () => {
      expect(findAssignmentForGuest('g1', assignments)).toEqual({
        guestId: 'g1',
        tableId: 'A',
      });
    });

    it('returns null for unassigned guest', () => {
      expect(findAssignmentForGuest('gX', assignments)).toBeNull();
    });

    it('returns null for empty guestId', () => {
      expect(findAssignmentForGuest('', assignments)).toBeNull();
      expect(findAssignmentForGuest(null, assignments)).toBeNull();
    });

    it('returns null for non-array assignments', () => {
      expect(findAssignmentForGuest('g1', null)).toBeNull();
      expect(findAssignmentForGuest('g1', undefined)).toBeNull();
    });

    it('skips malformed assignments gracefully', () => {
      const dirty = [null, { guestId: 'g1', tableId: 'A' }, undefined];
      expect(findAssignmentForGuest('g1', dirty)).toEqual({
        guestId: 'g1',
        tableId: 'A',
      });
    });

    it('returns first match when there are dupes (defensive)', () => {
      const dupes = [
        { guestId: 'g1', tableId: 'A' },
        { guestId: 'g1', tableId: 'B' },
      ];
      expect(findAssignmentForGuest('g1', dupes).tableId).toBe('A');
    });
  });

  describe('tableLabelForGuest', () => {
    const tables = [t({ id: 'A', label: 'T-01', capacity: 8 })];
    const assignments = [{ guestId: 'g1', tableId: 'A' }];

    it('resolves table label', () => {
      expect(tableLabelForGuest('g1', assignments, tables)).toBe('T-01');
    });

    it('returns null for unassigned guest', () => {
      expect(tableLabelForGuest('gX', assignments, tables)).toBeNull();
    });

    it('falls back to tableId when table was deleted', () => {
      expect(tableLabelForGuest('g1', assignments, [])).toBe('A');
    });

    it('falls back to tableId when table has no label', () => {
      const noLabel = [{ id: 'A', capacity: 8 }];
      expect(tableLabelForGuest('g1', assignments, noLabel)).toBe('A');
    });

    it('accepts assignment row with tableId field (not just id)', () => {
      const altTables = [{ tableId: 'A', label: 'T-Alt', capacity: 8 }];
      expect(tableLabelForGuest('g1', assignments, altTables)).toBe('T-Alt');
    });
  });

  describe('formatLivePill', () => {
    it('formats 3-segment pill text', () => {
      expect(formatLivePill({ checkedIn: 7, filled: 8, capacity: 12 })).toBe(
        '7/8/12',
      );
    });

    it('returns null for empty badge', () => {
      expect(formatLivePill(null)).toBeNull();
      expect(formatLivePill({})).toBeNull();
    });

    it('returns null for zero capacity', () => {
      expect(formatLivePill({ checkedIn: 1, filled: 1, capacity: 0 })).toBeNull();
    });

    it('returns null for __unmatched__ sentinel', () => {
      expect(
        formatLivePill({ tableId: '__unmatched__', capacity: 0 }),
      ).toBeNull();
    });

    it('works with all zeros', () => {
      expect(formatLivePill({ capacity: 8 })).toBe('0/0/8');
    });
  });

  describe('categorizeErrors', () => {
    it('buckets errors by reason', () => {
      const errors = [
        { guestId: 'g1', reason: 'overflow' },
        { guestId: 'g2', reason: 'invalidTable' },
        { guestId: 'g3', reason: 'overflow' },
        { guestId: 'g4', reason: 'duplicate' },
      ];
      const out = categorizeErrors(errors);
      expect(out.overflow).toHaveLength(2);
      expect(out.invalidTable).toHaveLength(1);
      expect(out.duplicate).toHaveLength(1);
      expect(out.unknown).toHaveLength(0);
    });

    it('puts unknown reasons in unknown bucket', () => {
      const errors = [
        { guestId: 'g1', reason: 'mystery' },
        { guestId: 'g2', reason: null },
      ];
      const out = categorizeErrors(errors);
      expect(out.unknown).toHaveLength(2);
    });

    it('handles empty/null input', () => {
      expect(categorizeErrors([])).toEqual({
        overflow: [],
        invalidTable: [],
        duplicate: [],
        unknown: [],
      });
      expect(categorizeErrors(null)).toEqual({
        overflow: [],
        invalidTable: [],
        duplicate: [],
        unknown: [],
      });
    });

    it('skips null entries', () => {
      const errors = [null, { guestId: 'g1', reason: 'overflow' }, null];
      const out = categorizeErrors(errors);
      expect(out.overflow).toHaveLength(1);
      expect(out.unknown).toHaveLength(0);
    });
  });
});
