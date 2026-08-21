// VendorTopBar.jsx — sticky top bar for the vendor dashboard.
//
// Why this exists:
//   The main App header (with the bell + logout) only renders when
//   `currentEvent` is set \u2014 owners and co-owners have one, vendors
//   don't. So switching to vendor-dashboard removed the bell and
//   the only way to reach the logout button was scrolling down to
//   the dark "商戶接單大堂" panel. This component gives the vendor
//   a persistent top bar that surfaces the bell + a logout button
//   in the same visible chrome as owners see.
//
// 2026-08-21 \u2014 replaces the missing-bell issue from the vendor
// dashboard. The bell element itself is passed in from App.jsx
// already wrapped in <VendorBellErrorBoundary> + the same
// resetKey triplet as the main header, so a render exception
// falls back to the same retryable warning button rather than
// disappearing entirely. The audit's evidence boundary \u2014
// "the bell and the assigned-tasks panel are independent
// concerns" \u2014 is preserved.
//
// Layout:
//   [vendor name + tier]  ...  [bell]  [logout]
// Sticky on top with same shadow + border as the main header so
// it feels like the same chrome class.

import { LogOut } from 'lucide-react';

export function VendorTopBar({
  vendorName = null,
  categoryLabel = null,
  bell = null,
  onLogout = null,
  showLogoutButton = true,
}) {
  if (!bell && !showLogoutButton) return null;
  return (
    <div
      className="sticky top-0 z-40 bg-white shadow-sm border-b border-slate-200 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6"
      data-testid="vendor-top-bar"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: vendor identity. Truncates if long. The full
            name + category still appear in the dark "商戶接單大堂"
            panel further down \u2014 this is just a quick anchor so
            the vendor always knows which account is logged in. */}
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
        {/* Right: bell + logout. Both flex-shrink-0 so they
            never get squeezed off-screen on narrow viewports. */}
        <div className="flex items-center gap-2 flex-shrink-0">
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
