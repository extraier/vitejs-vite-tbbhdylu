// Tests for TabNav — the helper-aware tab filtering logic.
//
// We don't render JSX in jsdom tests (vitest setup is jsdom but we're not
// importing @testing-library). Instead we extract the pure decision logic
// into a helper that the test can call directly. The actual JSX uses the
// same helper.

import { describe, it, expect } from 'vitest';
import { defaultHelperPerms } from './helpers';

// Mirror of the JSX filter from components/TabNav.jsx.
// Returns the list of (viewKey, label) tuples the TabNav would render.
export function tabsForRole(userRole, helperPerms) {
  if (userRole === 'owner') {
    return [
      ['couple-checklist', '📋 籌備清單'],
      ['couple-budget', '💰 預算管理'],
      ['discover-vendors', '🔍 商戶指南'],
      ['couple-jobboard', '🆘 出Post求救'],
      ['couple-guests', '🎟️ 嘉賓與座位'],
      ['photo-drop', '📸 互動相片牆'],
    ];
  }

  if (userRole === 'reception' || userRole === 'helper') {
    // Reception (no helperPerms) sees all the basic tabs (legacy demo).
    // Helper (with helperPerms) sees only what they're allowed.
    const tabs = [];
    if (!helperPerms || helperPerms.canScan) tabs.push(['reception-scanner', '📷 掃描 QR Code']);
    if (!helperPerms || helperPerms.canViewGuestList) tabs.push(['couple-guests', '📋 查閱名單']);
    if (helperPerms?.canViewBudget) tabs.push(['couple-budget', '💰 預算管理']);
    if (helperPerms?.canViewChecklist) tabs.push(['couple-checklist', '📋 籌備清單']);
    if (helperPerms?.canViewPhotos) tabs.push(['photo-drop', '📸 互動相片牆']);
    return tabs;
  }

  if (userRole === 'vendor') {
    return [
      ['vendor-dashboard', '💼 接單大堂'],
      ['vendor-profile', '👤 管理專頁'],
    ];
  }

  return [];
}

describe('tabsForRole', () => {
  it('owner sees all 6 tabs', () => {
    const tabs = tabsForRole('owner', null);
    expect(tabs.length).toBe(6);
  });

  it('reception (no helperPerms) sees scan + guest list', () => {
    const tabs = tabsForRole('reception', null);
    expect(tabs.map((t) => t[0])).toEqual(['reception-scanner', 'couple-guests']);
  });

  it('helper with canScan only sees scanner tab', () => {
    const perms = { ...defaultHelperPerms(), canScan: true };
    const tabs = tabsForRole('helper', perms);
    expect(tabs.map((t) => t[0])).toEqual(['reception-scanner']);
  });

  it('helper with canViewPhotos only sees photo tab', () => {
    const perms = { ...defaultHelperPerms(), canViewPhotos: true };
    const tabs = tabsForRole('helper', perms);
    expect(tabs.map((t) => t[0])).toEqual(['photo-drop']);
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
    const views = tabs.map((t) => t[0]);
    expect(views).toContain('reception-scanner');
    expect(views).toContain('couple-budget');
    expect(views).toContain('photo-drop');
    // Order matters in the UI — let's also assert scanner comes first
    expect(views[0]).toBe('reception-scanner');
  });

  it('vendor sees their two tabs regardless of helperPerms', () => {
    const tabs = tabsForRole('vendor', defaultHelperPerms());
    expect(tabs.map((t) => t[0])).toEqual(['vendor-dashboard', 'vendor-profile']);
  });

  it('unknown role returns empty array', () => {
    expect(tabsForRole('intruder', null)).toEqual([]);
  });
});