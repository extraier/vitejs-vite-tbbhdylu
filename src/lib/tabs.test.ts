// Tests for the tab ordering logic — what TabNav renders per role/perms/admin.
//
// The test file has historically had a hand-mirrored copy of `tabsForRole` so
// the assertions could run without spinning up jsdom or the React tree. As of
// 2026-07-01 we now re-export from src/lib/tabs.ts so the test cannot drift.
// If you change tabsForRole, this file reflects it automatically.

import { describe, it, expect } from 'vitest';
import { tabsForRole, ADMIN_DIVIDER } from './tabs';
import { defaultHelperPerms } from './helpers';

// Convenience: pluck just the viewKey from each entry, dropping the
// divider sentinel so equality checks against the user-visible tab order
// stay readable.
function viewKeys(entries: readonly any[]): string[] {
  return entries.filter((e) => e !== ADMIN_DIVIDER).map(([v]) => v);
}

describe('tabsForRole', () => {
  it('owner (non-admin) sees 6 tabs in the old order, no divider', () => {
    const tabs = tabsForRole('owner', null, false);
    expect(tabs.length).toBe(6);
    expect(tabs.includes(ADMIN_DIVIDER as any)).toBe(false);
    expect(viewKeys(tabs)).toEqual([
      'couple-checklist',
      'couple-budget',
      'discover-vendors',
      'couple-jobboard',
      'couple-guests',
      'photo-drop',
    ]);
  });

  it('admin owner sees admin tabs PREPENDED, divider after them, then 6 owner tabs', () => {
    const tabs = tabsForRole('owner', null, true);
    expect(tabs.length).toBe(9); // 2 admin + 1 divider + 6 owner
    expect(viewKeys(tabs).slice(0, 2)).toEqual(['vendor-analytics', 'admin-users']);
    expect(tabs[2]).toBe(ADMIN_DIVIDER); // sentinel sits at index 2 (in the raw array)
    // viewKeys() filters out the divider, so admin=2 entries + owner=6 entries = 8 total.
    // Owner entries start at index 2 of the *filtered* array.
    expect(viewKeys(tabs).slice(2)).toEqual([
      'couple-checklist',
      'couple-budget',
      'discover-vendors',
      'couple-jobboard',
      'couple-guests',
      'photo-drop',
    ]);
  });

  it('reception (no helperPerms) sees scan + guest list', () => {
    const tabs = tabsForRole('reception', null);
    expect(viewKeys(tabs)).toEqual(['reception-scanner', 'couple-guests']);
    expect(tabs.includes(ADMIN_DIVIDER as any)).toBe(false);
  });

  it('helper with canScan only sees scanner tab', () => {
    const perms = { ...defaultHelperPerms(), canScan: true };
    const tabs = tabsForRole('helper', perms);
    expect(viewKeys(tabs)).toEqual(['reception-scanner']);
  });

  it('helper with canViewPhotos only sees photo tab', () => {
    const perms = { ...defaultHelperPerms(), canViewPhotos: true };
    const tabs = tabsForRole('helper', perms);
    expect(viewKeys(tabs)).toEqual(['photo-drop']);
  });

  it('helper with zero perms sees NO tabs', () => {
    const perms = defaultHelperPerms();
    const tabs = tabsForRole('helper', perms);
    expect(tabs).toEqual([]);
  });

  it('helper with multiple perms sees all the corresponding tabs', () => {
    const perms = {
      ...defaultHelperPerms(),
      canScan: true,
      canViewBudget: true,
      canViewPhotos: true,
    };
    const tabs = tabsForRole('helper', perms);
    const views = viewKeys(tabs);
    expect(views).toContain('reception-scanner');
    expect(views).toContain('couple-budget');
    expect(views).toContain('photo-drop');
    expect(views[0]).toBe('reception-scanner');
  });

  it('vendor sees their two tabs regardless of helperPerms', () => {
    const tabs = tabsForRole('vendor', defaultHelperPerms());
    expect(viewKeys(tabs)).toEqual(['vendor-dashboard', 'vendor-profile']);
  });

  it('unknown role returns empty array', () => {
    expect(tabsForRole('intruder', null)).toEqual([]);
  });
});
