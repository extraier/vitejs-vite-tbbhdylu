// Tests for the tab ordering logic — what TabNav renders per role/perms/admin.
//
// Source of truth is src/lib/tabs.ts (re-exported here so the test cannot drift).

import { describe, it, expect } from 'vitest';
import { tabsForRole } from './tabs';
import { defaultHelperPerms } from './helpers';

describe('tabsForRole', () => {
  it('owner sees exactly 6 tabs in the canonical order', () => {
    const tabs = tabsForRole('owner', null, false);
    expect(tabs.length).toBe(6);
    expect(tabs.map(([v]) => v)).toEqual([
      'couple-checklist',
      'couple-budget',
      'discover-vendors',
      'couple-jobboard',
      'couple-guests',
      'photo-drop',
    ]);
  });

  it('isAdmin no longer adds admin tabs to the bottom nav', () => {
    // 2026-07-01: admin prefix moved to RoleSimulator pills.
    const tabs = tabsForRole('owner', null, true);
    expect(tabs.length).toBe(6);
    expect(tabs.map(([v]) => v)).toEqual([
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
    expect(tabs.map(([v]) => v)).toEqual(['reception-scanner', 'couple-guests']);
  });

  it('helper with canScan only sees scanner tab', () => {
    const perms = { ...defaultHelperPerms(), canScan: true };
    const tabs = tabsForRole('helper', perms);
    expect(tabs.map(([v]) => v)).toEqual(['reception-scanner']);
  });

  it('helper with canViewPhotos only sees photo tab', () => {
    const perms = { ...defaultHelperPerms(), canViewPhotos: true };
    const tabs = tabsForRole('helper', perms);
    expect(tabs.map(([v]) => v)).toEqual(['photo-drop']);
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
    const views = tabs.map(([v]) => v);
    expect(views).toContain('reception-scanner');
    expect(views).toContain('couple-budget');
    expect(views).toContain('photo-drop');
    expect(views[0]).toBe('reception-scanner');
  });

  it('vendor sees their two tabs regardless of helperPerms', () => {
    const tabs = tabsForRole('vendor', defaultHelperPerms());
    expect(tabs.map(([v]) => v)).toEqual(['vendor-dashboard', 'vendor-profile']);
  });

  it('unknown role returns empty array', () => {
    expect(tabsForRole('intruder', null)).toEqual([]);
  });
});
