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
// Layout (left → right):
//   [vendor name + category]  [管理專頁]  [🔔 bell]  [登出]
// The vendor identity card lives on the left, the three actions
// (manage, bell, logout) cluster on the right. Sticky on top with
// the same shadow + border as the main header so it feels like
// the same chrome class.

import { LogOut, Settings } from 'lucide-react';

export function VendorTopBar({
  vendorName = null,
  categoryLabel = null,
  bell = null,
  onLogout = null,
  showLogoutButton = true,
  onManageProfile = null,
  showManageButton = true,
}) {
  // Nothing to render when every action is hidden AND there's no
  // bell. The "vendor identity" left side is not enough alone \u2014
  // skip the bar entirely so the page doesn't waste vertical space.
  if (!bell && !showLogoutButton && !showManageButton) return null;
  return (
    <div
      className="sticky top-0 z-40 bg-white shadow-sm border-b border-slate-200 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6"
      data-testid="vendor-top-bar"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: vendor identity. Truncates if long. This used
            to live in the dark "商戶接單大堂" panel further down \u2014
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
            manage \u2192 bell \u2192 logout: the primary action (managing
            the vendor profile) sits first; the bell (notifications)
            is between the two transactional buttons; logout is the
            last / least frequent action. */}
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
