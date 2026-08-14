import { Users, Shield, BarChart3, Store, Inbox, CreditCard, ShieldAlert } from 'lucide-react';

/**
 * RoleSimulator — dark "developer-mode" pill bar at the top of the screen.
 *
 * Three role chips let the user preview the app as owner / reception / vendor.
 * As of 2026-07-01, admins also get two extra pills rendered to the right of
 * the role group (separated by a thin divider) that jump straight to admin
 * views inside the current wedding project:
 *
 *   - 📊 商戶數據   → currentView = 'vendor-analytics'
 *   - 🛡️ 管理員控制台 → currentView = 'admin-users'
 *
 * As of 2026-07-02 a third admin pill was added:
 *
 *   - 🛍️ 商戶控制台 → currentView = 'admin-vendors'
 *
 * As of 2026-07-29 a fourth admin pill:
 *
 *   - 📋 審批管理 → currentView = 'admin-queue'
 *
 * As of 2026-08-07 a fifth admin pill:
 *
 *   - 💳 收款設定 → currentView = 'admin-payment-settings'
 *
 * Active state mirrors the corresponding role chip pattern (color-coded).
 * Admin pills are considered active when currentView matches one of those two.
 *
 * `onSwitch` accepts either a role string (existing behavior — routes to the
 * role's landing view) or the literal 'admin' (a new pathway that just sets
 * currentView without changing userRole). The component wires both paths.
 */
export function RoleSimulator({
  userRole,
  activeGuestPortal,
  isAdmin = false,
  currentView = null,
  onSwitch,
  show = true,
}) {
  if (!show) return null;

  return (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex flex-wrap justify-center items-center gap-3 z-50">
      <span className="font-bold flex items-center gap-1">
        <Users className="w-4 h-4 text-slate-400" /> 開發者模式視角切換：
      </span>

      {/* Role pills — existing behavior. */}
      <button
        onClick={() => onSwitch('owner')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        👩🏻‍❤️‍👨🏻 主理新人
      </button>
      {/* 2026-07-15 — renamed for clarity. Previously this pill was
          labelled "兄弟姊妹(接待)" which conflated two unrelated
          features:
            - 兄弟姊妹 (Helpers) — invited via HelperManager modal,
              shown in HelperWaitingScreen until they accept an
              invite.
            - 接待處 (Reception desk) — the QR-code scanner used at
              the wedding reception table for guest check-in.
          This pill routes to the QR-scanner role, not the helper
          flow, so the label now says "接待處掃描" (Reception scanner). */}
      <button
        onClick={() => onSwitch('reception')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
        title="接待處 QR 掃碼 (Reception desk QR scanner)"
      >
        🛂 接待處掃描
      </button>
      <button
        onClick={() => onSwitch('vendor')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        💼 商戶 (Vendor)
      </button>

      {/* Guest portal pill — pre-existing, kept verbatim.
          2026-07-03 — wired onClick so clicking it exits the guest
          preview and returns to the owner's events dashboard. Before
          this fix the button had no handler at all (zero feedback),
          which made the dev panel feel incomplete. */}
      {activeGuestPortal && (
        <button
          onClick={() => {
            setUserRole('owner');
            setActiveGuestPortal(null);
            setCurrentView('events-dashboard');
          }}
          title="離開賓客預覽，返回主人 Dashboard"
          className="px-3 py-1 rounded-full bg-pink-500 font-bold text-white shadow-md border-2 border-white/20 animate-pulse hover:bg-pink-600 transition-colors"
        >
          📱 賓客專屬網頁 ({activeGuestPortal.name}) · 退出
        </button>
      )}

      {/* Admin pills — only for users who hold the platform admin claim.
          Group separator is a thin vertical bar that visually distinguishes
          the admin set from the role set without dominating the layout. */}
      {isAdmin && (
        <>
          <span
            aria-hidden="true"
            className="mx-1 h-5 w-px bg-slate-700 self-stretch"
          />
          <button
            onClick={() => onSwitch('vendor-analytics')}
            title="查看商戶活動數據 (平台管理員)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'vendor-analytics'
                ? 'bg-indigo-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            📊 商戶數據
          </button>
          <button
            onClick={() => onSwitch('admin-users')}
            title="用戶帳號管理 (平台管理員)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'admin-users'
                ? 'bg-indigo-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            🛡️ 管理員控制台
          </button>
          <button
            onClick={() => onSwitch('admin-vendors')}
            title="商戶檔案管理 (平台管理員)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'admin-vendors'
                ? 'bg-emerald-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            🛍️ 商戶控制台
          </button>
          {/* 2026-07-29 — Phase 4 admin queue pill. Triage pending
              social proof, referral claims, and payment receipts
              in one place. */}
          <button
            onClick={() => onSwitch('admin-queue')}
            title="待審批項目 (平台管理員)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'admin-queue'
                ? 'bg-amber-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            📋 審批管理
          </button>
          {/* 2026-08-07 — Admin payment settings pill. Configure
              the PayMe QR + FPS banking details that <PurchaseModal>
              renders to couples paying for Premium. Storing QR
              images in Firebase Storage + banking text in
              /artifacts/{appId}/platform/paymentSettings; both
              gated to admin-only writes via security rules. */}
          <button
            onClick={() => onSwitch('admin-payment-settings')}
            title="收款設定 (PayMe QR + FPS 銀行資料)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'admin-payment-settings'
                ? 'bg-emerald-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            💳 收款設定
          </button>
          {/* 2026-08-14 — M-06 follow-up: CSP report diagnostic view.
              Reads from /cspReports (admin-only read per firestore.rules).
              Useful for spotting browsers that try to load blocked
              resources — typically Cloudflare beacon, image sources,
              or unauthorized Connect-src calls. */}
          <button
            onClick={() => onSwitch('admin-csp-reports')}
            title="CSP 違規報告 (平台管理員)"
            className={`px-3 py-1 rounded-full flex items-center gap-1 ${
              currentView === 'admin-csp-reports'
                ? 'bg-rose-500 font-bold'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            🛡️ CSP 報告
          </button>
        </>
      )}
    </div>
  );
}
