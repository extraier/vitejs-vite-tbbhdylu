// AdminUsers — master list of all Firebase Auth users with admin/disable toggles.
//
// Backend: two callable functions in functions/src/index.ts:
//   - admin_listUsers    : paginated list of users + their claims + provider info
//   - admin_setDisabled  : toggle auth.updateUser(uid, { disabled })
// Admin role toggle uses the existing `grantAdmin` callable from helpers.ts.
//
// Component shape (post-extraction, 2026-07-01):
//   <AdminUsersBar/>      – 4-KPI card strip (live rendering on EventsDashboard)
//   <AdminUsersTable/>    – full users table with actions
//   <AdminUsers/>         – renders both above, kept for the existing tab nav entry
//   <AdminDashboardSection/> – the "Both" combo for EventsDashboard:
//       KPIs inline at top + full table below event cards.
//
// Data hook is lifted into ./adminUsersHook.js so the EventsDashboard can
// call it once and feed both subcomponents — avoids two Firebase round-trips.

import { useState, useMemo } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Shield, ShieldOff, Lock, Unlock, Mail, AlertCircle } from 'lucide-react';
import { useAdminUsers, computeAdminStats } from './adminUsersHook';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function providerLabel(p) {
  switch (p.providerId) {
    case 'google.com': return 'Google';
    case 'password': return 'Email/Password';
    case 'anonymous': return 'Anonymous';
    case 'phone': return 'Phone';
    default: return p.providerId;
  }
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function AdminStatsCards({ stats, loading }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <StatCard label="總用戶" value={loading ? '—' : stats.total} icon={<Mail className="w-5 h-5" />} />
      <StatCard label="已驗證電郵" value={loading ? '—' : stats.verified} icon={<Mail className="w-5 h-5 text-emerald-600" />} />
      <StatCard label="管理員" value={loading ? '—' : stats.admins} icon={<Shield className="w-5 h-5 text-indigo-600" />} />
      <StatCard label="已停用" value={loading ? '—' : stats.disabled} icon={<Lock className="w-5 h-5 text-red-600" />} />
    </div>
  );
}

/**
 * AdminUsersBar — 4-KPI strip driven by parent-provided data.
 * Callers should pass the same `users` / `loading` / `error` they use for
 * <AdminUsersTable/> so the two subcomponents stay in lockstep.
 */
export function AdminUsersBar({ isAdmin, users, loading, error }) {
  if (!isAdmin) return null;
  const stats = useMemo(() => computeAdminStats(users), [users]);
  if (error) {
    return (
      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        管理員數據載入失敗: {error}
      </div>
    );
  }
  return <AdminStatsCards stats={stats} loading={loading} />;
}

/**
 * AdminUsersTable — full management table (search, toggle, paginate).
 * `users` / `setUsers` / `loading` / `error` / `loadPage` come from the parent
 * hook so mounting both Bar and Table together (on EventsDashboard) doesn't
 * trigger two parallel Firebase calls.
 */
export function AdminUsersTable({ isAdmin, user, users, setUsers, loading, error, loadPage, nextPageToken }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  async function toggleAdmin(u) {
    if (u.uid === user?.uid) {
      alert('Cannot change your own admin status from here.');
      return;
    }
    const newVal = !u.customClaims?.admin;
    const actionKey = `${u.uid}:admin`;
    setPendingAction(actionKey);
    try {
      const fn = httpsCallable(getFunctions(), 'grantAdmin');
      await fn({ uid: u.uid, admin: newVal });
      setUsers((prev) =>
        prev.map((row) =>
          row.uid === u.uid
            ? { ...row, customClaims: newVal ? { admin: true } : null }
            : row
        )
      );
    } catch (err) {
      alert(`Failed to ${newVal ? 'grant' : 'revoke'} admin: ${err?.message || err}`);
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleDisabled(u) {
    if (u.uid === user?.uid) {
      alert('Cannot disable your own account here.');
      return;
    }
    const newVal = !u.disabled;
    if (!confirm(`Are you sure you want to ${newVal ? 'disable' : 'enable'} ${u.email || u.displayName || u.uid}?`)) {
      return;
    }
    const actionKey = `${u.uid}:disabled`;
    setPendingAction(actionKey);
    try {
      const fn = httpsCallable(getFunctions(), 'admin_setDisabled');
      await fn({ uid: u.uid, disabled: newVal });
      setUsers((prev) =>
        prev.map((row) =>
          row.uid === u.uid ? { ...row, disabled: newVal } : row
        )
      );
    } catch (err) {
      alert(`Failed to ${newVal ? 'disable' : 'enable'}: ${err?.message || err}`);
    } finally {
      setPendingAction(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        u.uid.toLowerCase().includes(q) ||
        (u.customClaims?.admin && 'admin'.includes(q))
      );
    });
  }, [users, searchQuery]);

  if (!isAdmin) return null;

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜尋電郵、顯示名稱或 UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
        <button
          onClick={() => loadPage(null)}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          重新整理
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-900">載入失敗</div>
            <div className="text-sm text-red-700">{error}</div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">用戶</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden md:table-cell">登入方式</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden lg:table-cell">最後登入</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">狀態</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">載入中...</td></tr>
              )}
              {!loading && filteredUsers.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">找不到符合的用戶。</td></tr>
              )}
              {filteredUsers.map((u) => {
                const isAdminRow = !!u.customClaims?.admin;
                const isMe = u.uid === user?.uid;
                const adminPending = pendingAction === `${u.uid}:admin`;
                const disabledPending = pendingAction === `${u.uid}:disabled`;
                return (
                  <tr key={u.uid} className={`hover:bg-slate-50 transition-colors ${u.disabled ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {u.photoURL ? (
                          <img src={u.photoURL} alt="" className="w-9 h-9 rounded-full" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                            {(u.displayName || u.email || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 truncate max-w-xs">
                              {u.displayName || u.email || '(no name)'}
                            </span>
                            {isMe && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">你</span>}
                            {!u.emailVerified && u.email && (
                              <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">未驗證</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate max-w-xs">
                            {u.email || <span className="italic">(no email)</span>}
                          </div>
                          <div className="text-xs text-slate-400 font-mono truncate max-w-xs">{u.uid}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {u.providerData.length === 0 && <span className="text-slate-400">—</span>}
                        {u.providerData.map((p, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                            {providerLabel(p)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-600 whitespace-nowrap">
                      {fmtDate(u.lastSignInTime)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {isAdminRow && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded w-fit">
                            <Shield className="w-3 h-3" /> 管理員
                          </span>
                        )}
                        {u.disabled && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded w-fit">
                            <Lock className="w-3 h-3" /> 已停用
                          </span>
                        )}
                        {!isAdminRow && !u.disabled && (
                          <span className="text-xs text-slate-400">一般用戶</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleAdmin(u)}
                          disabled={isMe || adminPending}
                          title={isMe ? '無法修改自己的管理員狀態' : isAdminRow ? '撤銷管理員' : '設為管理員'}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            isAdminRow
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {isAdminRow ? <ShieldOff className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                          {isAdminRow ? '撤銷' : '設為管理'}
                        </button>
                        <button
                          onClick={() => toggleDisabled(u)}
                          disabled={isMe || disabledPending}
                          title={isMe ? '無法停用自己的帳戶' : u.disabled ? '啟用帳戶' : '停用帳戶'}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            u.disabled
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-white border-red-200 text-red-700 hover:bg-red-50'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {u.disabled ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          {u.disabled ? '啟用' : '停用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <div>每頁 50 個 · 顯示 {filteredUsers.length} 個</div>
        <div className="flex items-center gap-2">
          <button
            disabled
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> 上一頁
          </button>
          <button
            disabled={!nextPageToken || loading}
            onClick={() => loadPage(nextPageToken)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
          >
            下一頁 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <details className="mt-8 text-xs text-slate-400">
        <summary className="cursor-pointer hover:text-slate-600">查看當前管理員 UID（除錯用）</summary>
        <div className="mt-2 font-mono">{user?.uid}</div>
      </details>
    </>
  );
}

/**
 * AdminDashboardSection — the "embed on home" combo:
 *   - 4 KPI cards inline at the top of the section
 *   - full table below them
 * Owns the data hook so callers don't need to wire `useAdminUsers` themselves.
 */
export function AdminDashboardSection({ isAdmin, user }) {
  const data = useAdminUsers(isAdmin);
  if (!isAdmin) return null;
  return (
    <div className="mt-10 pt-10 border-t border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        <Shield className="w-7 h-7 text-indigo-600" />
        <h2 className="text-2xl font-black text-slate-900">管理員控制台</h2>
      </div>
      <p className="text-slate-500 mb-6">查看所有用戶帳號，調整管理員權限或停用帳戶。</p>
      <AdminUsersBar isAdmin={isAdmin} users={data.users} loading={data.loading} error={data.error} />
      <AdminUsersTable
        isAdmin={isAdmin}
        user={user}
        users={data.users}
        setUsers={data.setUsers}
        loading={data.loading}
        error={data.error}
        loadPage={data.loadPage}
        nextPageToken={data.nextPageToken}
      />
    </div>
  );
}

/**
 * AdminUsers — full screen (KPI cards + table) for the existing `/admin-users` tab.
 * Kept as a union so the TabNav entry still works.
 */
export function AdminUsers({ user, isAdmin }) {
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-100">
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">管理員專用</h2>
          <p className="text-slate-500">此頁面僅供管理員使用。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-7xl mx-auto mt-8 px-4 pb-16">
      <AdminDashboardSection isAdmin={isAdmin} user={user} />
    </div>
  );
}
