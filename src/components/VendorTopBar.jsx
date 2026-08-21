// VendorTopBar.jsx — sticky top bar for the vendor dashboard.
//
// Why this exists:
//   The main App header (with the bell + logout) only renders when
//   `currentEvent` is set — owners and co-owners have one, vendors
//   don't. So switching to vendor-dashboard removed the bell, the
//   logout button, AND the 管理專頁 edit button — all three of
//   which were stranded in the dark "商戶接單大堂" panel at the
//   bottom of the dashboard. This component consolidates every
//   vendor action + identity card into one sticky top bar.
//
// 2026-08-21 — replaces the missing-bell issue from the vendor
// dashboard. The bell element itself is passed in from App.jsx
// already wrapped in <VendorBellErrorBoundary> + the same
// resetKey triplet as the main header, so a render exception
// falls back to the same retryable warning button rather than
// disappearing entirely. The audit's evidence boundary —
// "the bell and the assigned-tasks panel are independent
// concerns" — is preserved.
//
// 2026-08-21 — consolidates the dark "商戶接單大堂" panel
// contents (管理專頁 button, 登出 button, 當前登入商戶 identity
// card) into the sticky top bar. Replaces the previous 2-tier
// navigation (top bar + scroll-down panel) with a single visible
// chrome surface, so vendors see every action the moment they
// land on the dashboard.
//
// 2026-08-21 — adds the inbox icon + unread badge. The
// 客戶查詢收件箱 panel that used to live at the top of the
// dashboard is now a single mail icon in the bar; the badge
// shows the cross-inquiry unread count (same source as the
// owner header's inbox badge — totalUnread in App.jsx).
// Clicking the icon routes to the Inbox view, which the
// VendorInquiriesPanel already populated.
//
// Layout (left → right):
//   [vendor name + category]  [管理專頁]  [📬 inbox + badge]  [🔔 bell]  [登出]
// The vendor identity card lives on the left, the four actions
// (manage, inbox, bell, logout) cluster on the right. Sticky on
// top with the same shadow + border as the main header so it
// feels like the same chrome class.

import { LogOut, Settings, Inbox } from 'lucide-react';

export function VendorTopBar({
  vendorName = null,
  categoryLabel = null,
  bell = null,
  onLogout = null,
  showLogoutButton = true,
  onManageProfile = null,
  showManageButton = true,
  // 2026-08-21 — inbox icon + badge. The vendor's inbox panel
  // lived as a full-width section above the assigned tasks for
  // months but its only useful affordance was the unread badge
  // + open-inbox link. Both are now in the top bar so the
  // surface collapses to a single icon with a red badge for
  // unread messages. Click routes to the existing Inbox view.
  inboxCount = 0,
  onOpenInbox = null,
  showInboxButton = true,
}) {
  // Nothing to render when every action is hidden AND there's no
  // bell. The "vendor identity" left side is not enough alone —
  // skip the bar entirely so the page doesn't waste vertical space.
  if (!bell && !showLogoutButton && !showManageButton && !showInboxButton) return null;
  return (
    <div
      className="sticky top-0 z-40 bg-white shadow-sm border-b border-slate-200 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6"
      data-testid="vendor-top-bar"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: vendor identity. Truncates if long. This used
            to live in the dark "商戶接單大堂" panel further down —
            now it's the explicit anchor so the vendor always knows
            which account is logged in, without scrolling. */}
        <div className="min-w-0 flex-1">
          {vendorName ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                商戶後台
              </div>
              <div
                className="font-bold text-slate-800 text-sm sm:text-base truncate"
                title={vendorName}
                data-testid="vendor-top-bar-name"
              >
                {vendorName}
              </div>
              {categoryLabel && (
                <div className="text-xs text-slate-500 truncate">{categoryLabel}</div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-400">商戶後台</div>
          )}
        </div>
        {/* Right: actions. All flex-shrink-0 so they never get
            squeezed off-screen on narrow viewports. Order is
            manage → inbox → bell → logout. Manage is the primary
            action (profile-edit); inbox surfaces unread messages;
            bell surfaces comment / proposal notifications; logout
            is the last / least frequent action. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {showManageButton && onManageProfile && (
            <button
              type="button"
              onClick={onManageProfile}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm transition-colors whitespace-nowrap"
              title="管理商戶專頁"
              aria-label="管理商戶專頁"
              data-testid="vendor-top-bar-manage"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">管理專頁</span>
            </button>
          )}
          {showInboxButton && onOpenInbox && (
            <button
              type="button"
              onClick={onOpenInbox}
              // Same badge chrome as the owner header's inbox
              // button (relative wrapper, red rose-500 pill in
              // the top-right corner with a white ring so the
              // badge sits cleanly over the icon on hover).
              className="relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
              title="訊息收件匣"
              aria-label="訊息收件匣"
              data-testid="vendor-top-bar-inbox"
            >
              <Inbox className="w-5 h-5" />
              {inboxCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white"
                  data-testid="vendor-top-bar-inbox-badge"
                >
                  {inboxCount > 9 ? '9+' : inboxCount}
                </span>
              )}
            </button>
          )}
          {bell}
          {showLogoutButton && onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm transition-colors border border-slate-600 whitespace-nowrap"
              title="登出商戶帳號"
              aria-label="登出商戶帳號"
              data-testid="vendor-top-bar-logout"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">登出</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
