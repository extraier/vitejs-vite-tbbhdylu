import { Users, Shield, BarChart3, Store } from 'lucide-react';

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
      <button
        onClick={() => onSwitch('reception')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        👯‍♀️ 兄弟姊妹(接待)
      </button>
      <button
        onClick={() => onSwitch('vendor')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        💼 商戶 (Vendor)
      </button>

      {/* Guest portal pill — pre-existing, kept verbatim. */}
      {activeGuestPortal && (
        <button className="px-3 py-1 rounded-full bg-pink-500 font-bold text-white shadow-md border-2 border-white/20 animate-pulse">
          📱 賓客專屬網頁 ({activeGuestPortal.name})
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
        </>
      )}
    </div>
  );
}
