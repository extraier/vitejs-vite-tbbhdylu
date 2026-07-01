// Tab visibility logic — shared between TabNav.jsx (production) and
// tabs.test.ts (unit tests). Returns the list of (viewKey, label) tuples
// the tab bar should render for the given role + perms.
//
// Tab ordering for an owner who is also admin (left to right):
//
//   [📊 商戶數據]  [🛡️ 管理員控制台]   ─── divider ───   📋 籌備清單  💰 預算管理  🔍 商戶指南  🆘 出Post求救  🎟️ 嘉賓與座位  📸 互動相片牆
//
// The admin group is prepended (not appended) so admins land on analytics
// or user-management with the same "reach" they'd give any other tab —
// no extra click to get to admin work. TabNav.jsx renders the divider
// between the admin prefix and the owner suffix.
//
// The two admin tabs are only added for owner roles. Helpers / reception /
// vendors never see the admin prefix even if their Firebase claim is admin
// (defensive: admins assigned to a wedding as a helper should not see
// platform-wide admin tools inside the couple's project view).
//
// We pass a sentinel `'__divider'` between the two halves — TabNav renders
// it as a vertical bar; if you grep for it in tests, you know it's the
// divider marker, not a real tab.

export type TabTuple = [viewKey: string, label: string];

// A divider is a sentinel that renders as a visual separator in TabNav,
// not a real clickable tab. Tests can grep for it (or for ADMIN_DIVIDER)
// to confirm the admin group is properly isolated from the owner group.
export type TabOrDivider = TabTuple | typeof ADMIN_DIVIDER;

// Note: the explicit `'__divider'` type annotation is intentional so the
// discriminated union in TabOrDivider unions against a literal type. If
// oxlint/typescript suggests `as const` here, that's wrong for our purposes
// (we need the literal in scope, not the wider string type).
export const ADMIN_DIVIDER = '__divider' as const;

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
): TabOrDivider[] {
  if (userRole === 'owner') {
    const ownerTabs: TabTuple[] = [
      ['couple-checklist', '📋 籌備清單'],
      ['couple-budget', '💰 預算管理'],
      ['discover-vendors', '🔍 商戶指南'],
      ['couple-jobboard', '🆘 出Post求救'],
      ['couple-guests', '🎟️ 嘉賓與座位'],
      ['photo-drop', '📸 互動相片牆'],
    ];
    // Prepend admin tabs when the user holds the platform admin claim.
    // Order inside the admin group: vendor-analytics first, then admin-users,
    // matching the visual flow from "summary" to "control".
    const adminTabs: TabTuple[] = isAdmin
      ? [
          ['vendor-analytics', '📊 商戶數據'],
          ['admin-users', '🛡️ 管理員控制台'],
        ]
      : [];
    if (adminTabs.length === 0) return ownerTabs;
    // The divider sentinel is rendered by TabNav as a visual separator.
    const result: TabOrDivider[] = [...adminTabs, ADMIN_DIVIDER, ...ownerTabs];
    return result;
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
