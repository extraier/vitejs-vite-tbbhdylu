import { describe, it, expect } from 'vitest';
import { SHORTCUTS, groupShortcuts, shouldHandleCanvasShortcut } from './seatingKeys';

describe('SHORTCUTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SHORTCUTS)).toBe(true);
    expect(SHORTCUTS.length).toBeGreaterThan(5);
  });

  it('every entry has keys, label, hint, category', () => {
    for (const s of SHORTCUTS) {
      expect(typeof s.keys).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.hint).toBe('string');
      expect(typeof s.category).toBe('string');
    }
  });

  it('categories are navigation / edit / view only', () => {
    const allowed = new Set(['navigation', 'edit', 'view']);
    for (const s of SHORTCUTS) {
      expect(allowed.has(s.category)).toBe(true);
    }
  });

  it('keys are non-empty strings', () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe('groupShortcuts', () => {
  it('groups by category', () => {
    const out = groupShortcuts();
    expect(out.navigation.length).toBeGreaterThan(0);
    expect(out.edit.length).toBeGreaterThan(0);
    expect(out.view.length).toBeGreaterThan(0);
  });

  it('preserves input order within each category', () => {
    const out = groupShortcuts();
    // SHORTCUTS is ordered: navigation → edit → view → ...
    // The first navigation entry should be Tab (matches SHORTCUTS[0])
    expect(out.navigation[0].keys).toBe(SHORTCUTS[0].keys);
  });

  it('returns a fresh object each call (so caller can mutate safely)', () => {
    const a = groupShortcuts();
    const b = groupShortcuts();
    expect(a).not.toBe(b);
    a.navigation.push({ keys: 'X', label: 'X', hint: 'X', category: 'navigation' });
    expect(b.navigation.length).toBe(a.navigation.length - 1);
  });

  it('handles empty input', () => {
    const out = groupShortcuts([]);
    expect(out.navigation).toEqual([]);
    expect(out.edit).toEqual([]);
    expect(out.view).toEqual([]);
  });

  it('passes through unknown categories without dropping them', () => {
    const out = groupShortcuts([
      { keys: 'A', label: 'A', hint: 'A', category: 'unknown' },
    ]);
    expect(out.unknown).toEqual([
      { keys: 'A', label: 'A', hint: 'A', category: 'unknown' },
    ]);
  });
});

describe('shouldHandleCanvasShortcut', () => {
  function fakeEvent(target) {
    return { target };
  }
  function fakeInput() {
    return { closest: (sel) => (sel === 'input, textarea, [contenteditable="true"]' ? {} : null) };
  }
  function fakeDiv() {
    return { closest: () => null };
  }
  function fakeBrokenTarget() {
    // Some elements don't expose .closest (e.g. document).
    return {};
  }

  it('returns false when target is an input/textarea/contenteditable', () => {
    expect(shouldHandleCanvasShortcut(fakeEvent(fakeInput()))).toBe(false);
  });

  it('returns true when target is a regular div/canvas', () => {
    expect(shouldHandleCanvasShortcut(fakeEvent(fakeDiv()))).toBe(true);
  });

  it('returns true when target has no .closest method (defensive)', () => {
    expect(shouldHandleCanvasShortcut(fakeEvent(fakeBrokenTarget()))).toBe(true);
  });

  it('returns true when event is null (defensive)', () => {
    expect(shouldHandleCanvasShortcut(null)).toBe(true);
  });

  it('returns true when event has no target (defensive)', () => {
    expect(shouldHandleCanvasShortcut({})).toBe(true);
  });
});
