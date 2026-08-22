// WeddingDay.location-chips.test.ts
//
// 2026-08-21 — location-chip helper tests. The visible behavior
// of the new 大日流程 location-filter chip row is driven by the
// pure helper buildRundownLocationChips (extracted out of the
// RundownTab useMemo in this commit so it can be unit-tested
// without mounting the heavy RundownTab surface — dnd-kit,
// framer-motion, the HelperPicker dropdown, etc.).
//
// What this file guards:
//
//   1. Skips entries whose location is empty / missing /
//      whitespace-only.
//   2. Dedups case-insensitively on the trimmed string (\"女家\" /
//      \"女家 \" / \"女家\" collapse to one chip).
//   3. Displays the FIRST encountered form so the chip label
//      matches the first thing the user typed.
//   4. Counts entries per dedup key (so \"女家 (3)\" really means
//      3 entries, even if some have trailing whitespace or
//      different case).
//   5. Returns labels sorted by zh-Hant localeCompare so the chip
//      order is stable across renders.
//   6. Returns { labels: [], perCount: {} } when no entries have
//      a location, so the rendering layer can hide the row
//      entirely (\"全部地點\" chip alone is not useful).
//   7. Doesn't mutate the input entries array.
//
// Why split this out from a RundownTab integration test:
//   RundownTab pulls in dnd-kit + framer-motion + the partner
//   picker dropdown. Mounting it for one chip-row assertion
//   would add ~600ms to the test run AND trigger dependency
//   re-resolution for all three libraries. The pure helper
//   covers the meaningful logic; the chip-render layer is a
//   trivial `map` over the helper output that's already
//   covered by the smoke tests of the existing FilterPill
//   (filter-pill-active / filter-pill-inactive data-testids).

import { describe, it, expect } from 'vitest';
import { buildRundownLocationChips } from './WeddingDay';

describe('buildRundownLocationChips', () => {
  it('returns empty labels + empty counts when no entries have a location', () => {
    const entries = [
      { id: 'a', location: '' },
      { id: 'b', location: '   ' },
      { id: 'c' },
    ];
    const result = buildRundownLocationChips(entries);
    expect(result.labels).toEqual([]);
    expect(result.perCount).toEqual({});
  });

  it('returns one chip per unique location with the correct count', () => {
    const entries = [
      { id: 'a', location: '女家' },
      { id: 'b', location: '女家' },
      { id: 'c', location: '宴會廳' },
      { id: 'd', location: '宴會廳' },
      { id: 'e', location: '宴會廳' },
    ];
    const result = buildRundownLocationChips(entries);
    // Order is alpha-sorted, so 女家 comes before 宴會廳.
    expect(result.labels).toEqual(['女家', '宴會廳']);
    expect(result.perCount['女家']).toBe(2);
    expect(result.perCount['宴會廳']).toBe(3);
  });

  it('dedups case-insensitively on the trimmed form', () => {
    const entries = [
      { id: 'a', location: 'Wedding Hall' },
      { id: 'b', location: '  WEDDING HALL  ' },
      { id: 'c', location: 'wedding hall' },
      { id: 'd', location: 'Wedding hall' },
    ];
    const result = buildRundownLocationChips(entries);
    expect(result.labels).toHaveLength(1);
    // Display the FIRST encountered form (not lowercased).
    expect(result.labels[0]).toBe('Wedding Hall');
    expect(result.perCount['wedding hall']).toBe(4);
  });

  it('ignores empty / whitespace-only locations but keeps those entries visible elsewhere', () => {
    // The chip row hides for empty-locations-only datasets —
    // those entries just don't show up under any location chip
    // (they'd still be visible under the category chips).
    const entries = [
      { id: 'a', location: '' },
      { id: 'b', location: '   ' },
      { id: 'c', location: null },
      { id: 'd', location: undefined },
      { id: 'e', location: '女家' },
    ];
    const result = buildRundownLocationChips(entries);
    expect(result.labels).toEqual(['女家']);
    expect(result.perCount['女家']).toBe(1);
  });

  it('returns labels sorted by zh-Hant localeCompare (stable order across renders)', () => {
    // Order is locale-aware. With zh-Hant collator the
    // ordering here is deterministic; what we care about is
    // that re-running with the same input produces the same
    // order (callers rely on this for the chip-row visual
    // stability — chips don't reshuffle on every state update).
    const entries = [
      { id: 'a', location: '女家' },
      { id: 'b', location: '宴會廳' },
      { id: 'c', location: '酒店門口' },
      { id: 'd', location: '中環' },
      { id: 'e', location: '男家' },
    ];
    const result1 = buildRundownLocationChips(entries);
    const result2 = buildRundownLocationChips(entries);
    expect(result1.labels).toEqual(result2.labels);
    expect(result1.labels.length).toBe(5);
    // At minimum, the labels are sorted (not necessarily in
    // this exact order across runtimes, but contiguous and
    // sorted vs the original input order).
    const sorted = [...entries.map((e) => e.location)].sort((a, b) =>
      a.localeCompare(b, 'zh-Hant'),
    );
    expect(result1.labels).toEqual(sorted);
  });

  it('does NOT mutate the input entries', () => {
    const entries = [
      { id: 'a', location: '女家' },
      { id: 'b', location: '宴會廳' },
    ];
    const snapshot = JSON.stringify(entries);
    buildRundownLocationChips(entries);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it('handles an empty entries array without crashing', () => {
    expect(buildRundownLocationChips([])).toEqual({ labels: [], perCount: {} });
    expect(buildRundownLocationChips(null)).toEqual({ labels: [], perCount: {} });
    expect(buildRundownLocationChips(undefined)).toEqual({ labels: [], perCount: {} });
  });

  it('treats an entry whose only location field is numeric 0 as "no location"', () => {
    // Defensive: 0 is falsy in JS but is technically a valid
    // string-castable value. This documents the helper's
    // current behavior (treats 0 / false as empty) so callers
    // know not to send such values. If we ever support those
    // we'll revisit the trim() check.
    const entries = [
      { id: 'a', location: 0 },
      { id: 'b', location: false },
      { id: 'c', location: '女家' },
    ];
    const result = buildRundownLocationChips(entries);
    expect(result.labels).toEqual(['女家']);
  });
});
