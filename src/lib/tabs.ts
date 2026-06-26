// Tab visibility logic — shared between TabNav.jsx (production) and
// tabs.test.ts (unit tests). Returns the list of (viewKey, label) tuples
// the tab bar should render for the given role + perms.
//
// When `isAdmin` is true, append the vendor-analytics tab to the owner's
// tab list. Admin sees this tab regardless of which role they were viewing
// in the simulator (the App.jsx gate `isAdmin && currentView === 'vendor-analytics'`
// ensures the tab itself only renders for admin).

export function tabsForRole(userRole, helperPerms, isAdmin = false) {
  if (userRole === 'owner') {
    const tabs = [
      ['couple-checklist', '📋 籌備清單'],
      ['couple-budget', '💰 預算管理'],
      ['discover-vendors', '🔍 商戶指南'],
      ['couple-jobboard', '🆘 出Post求救'],
      ['couple-guests', '🎟️ 嘉賓與座位'],
      ['photo-drop', '📸 互動相片牆'],
    ];
    if (isAdmin) tabs.push(['vendor-analytics', '📊 商戶數據']);
    return tabs;
  }

  if (userRole === 'reception' || userRole === 'helper') {
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