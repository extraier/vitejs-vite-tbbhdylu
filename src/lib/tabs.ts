// Tab visibility logic — shared between TabNav.jsx (production) and
// tabs.test.ts (unit tests). Returns the list of (viewKey, label) tuples
// the tab bar should render for the given role + perms.
//
// As of 2026-07-01 the admin prefix is no longer prepended here. Admin
// tools (📊 商戶數據, 🛡️ 管理員控制台) are surfaced as pills in the dark
// role-switcher bar at the top of the screen (RoleSimulator.jsx), not
// the in-project tab nav. The tab bar is now strictly the couple's
// project view — 6 tabs the owner sees only after picking a wedding.

export type TabTuple = [viewKey: string, label: string];

export interface HelperPerms {
  canScan?: boolean;
  canViewGuestList?: boolean;
  canViewBudget?: boolean;
  canViewChecklist?: boolean;
  canViewPhotos?: boolean;
}

export type UserRole = 'owner' | 'reception' | 'helper' | 'vendor';

export function tabsForRole(
  userRole: UserRole | string,
  helperPerms: HelperPerms | null = null,
  isAdmin: boolean = false,
): TabTuple[] {
  // Note: isAdmin is accepted for backwards compatibility with callers in
  // App.jsx, but no longer affects the returned list. Admin tools live in
  // RoleSimulator now.
  void isAdmin;
  if (userRole === 'owner') {
    return [
      ['couple-checklist', '📋 籌備清單'],
      ['wedding-day', '📅 大日統籌'],
      ['couple-budget', '💰 預算管理'],
      ['discover-vendors', '🔍 商戶指南'],
      ['couple-jobboard', '🆘 徵求報價'],
      ['couple-guests', '🎟️ 嘉賓與座位'],
      ['photo-drop', '📸 互動相片牆'],
    ];
  }

  if (userRole === 'reception' || userRole === 'helper') {
    const tabs: TabTuple[] = [];
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
