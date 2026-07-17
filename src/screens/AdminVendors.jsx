// AdminVendors — master list of vendor profiles with inline edit + delete.
//
// Backend: three callable functions in functions/src/index.ts:
//   - admin_listVendors    : paginated list of vendor docs joined with auth email
//   - admin_updateVendor   : patches whitelisted fields (name/category/rating/
//                            price/tags/description/portfolio)
//   - admin_deleteVendor   : hard-deletes a vendor doc (does NOT touch auth)
//
// Reached from the dark role-switcher pill bar at the top of the screen
// (RoleSimulator.jsx → currentView = 'admin-vendors'). Admin-only; non-admin
// visitors see the gate page rendered below.
//
// 2026-07-02: vendor CRUD surface for admins. The DiscoverDirectory screen
// still reads from a hardcoded DEFAULT_VENDORS array in src/lib/config.ts;
// once vendors start writing their own profiles, this console becomes the
// admin moderation tool for them.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Store,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Star,
  Image as ImageIcon,
  Lock,
  X,
  Save,
  AlertCircle,
  Eye,
  Clock,
  CheckCircle2,
  XCircle,
  Pause,
} from 'lucide-react';

import { VendorModal } from '../components/modals/VendorModal';
import {
  VENDOR_CATEGORIES,
  getVendorCategoryLabel,
} from '../lib/config';

function fmtDate(v) {
  if (!v) return '—';
  // Firestore timestamps serialize as {_seconds, _nanoseconds} or as ISO.
  let d = null;
  try {
    if (typeof v === 'object' && typeof v._seconds === 'number') {
      d = new Date(v._seconds * 1000);
    } else if (typeof v === 'string') {
      d = new Date(v);
    } else if (typeof v === 'number') {
      d = new Date(v);
    }
  } catch {
    return String(v);
  }
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

// StatusChip — clickable filter pill above the vendor table.
// tone is one of: 'slate' | 'amber' | 'emerald' | 'rose' — sets the active
// color so admin can tell at a glance which filter is engaged.
const CHIP_TONES = {
  slate: { active: 'bg-slate-700 text-white border-slate-700', inactive: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' },
  amber: { active: 'bg-amber-500 text-white border-amber-500', inactive: 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50' },
  emerald: { active: 'bg-emerald-600 text-white border-emerald-600', inactive: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
  rose: { active: 'bg-rose-600 text-white border-rose-600', inactive: 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50' },
};
function StatusChip({ label, active, onClick, count, tone = 'slate' }) {
  const t = CHIP_TONES[tone] || CHIP_TONES.slate;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
        active ? t.active : t.inactive
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[10px] ${
          active ? 'bg-white/20' : 'bg-slate-100'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// StatusBadge — small pill rendered inside each table row. Pre-onboarding
// docs (no status) render as 'approved' so existing DEFAULT_VENDORS look
// normal to admin.
function StatusBadge({ status }) {
  const effective = status || 'approved';
  const map = {
    pending: { Icon: Clock, className: 'bg-amber-100 text-amber-800', label: '待審批' },
    approved: { Icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-800', label: '已批准' },
    rejected: { Icon: XCircle, className: 'bg-rose-100 text-rose-800', label: '已拒絕' },
    suspended: { Icon: Pause, className: 'bg-slate-200 text-slate-700', label: '已停權' },
  };
  const cfg = map[effective] || map.approved;
  const { Icon, className, label } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${className}`}
      title={effective === 'pending' ? '新申請，等待審批' : effective}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export function AdminVendors({ user, isAdmin }) {
  const [vendors, setVendors] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 2026-07-11 — vendor onboarding. Filter the table by approval status.
  //   'all'        → show everyone (default)
  //   'pending'    → only new applications awaiting admin review
  //   'approved'   → only currently-visible vendors
  //   'rejected'   → only denied applications
  //   'suspended'  → only previously-approved-now-hidden vendors
  // Pre-onboarding vendor docs (no status field) are treated as 'approved'
  // so existing DEFAULT_VENDORS + admin-created vendors stay visible.
  const [statusFilter, setStatusFilter] = useState('all');
  const [pendingAction, setPendingAction] = useState(null);
  const [editingVendor, setEditingVendor] = useState(null);
  const [previewingVendor, setPreviewingVendor] = useState(null);
  const [pageTokens, setPageTokens] = useState([null]); // history stack for prev page

  const loadPage = useCallback(async (token) => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'admin_listVendors');
      const res = await fn({ pageSize: 50, pageToken: token || undefined });
      const data = res.data || {};
      setVendors(data.vendors || []);
      setTotal(data.total ?? (data.vendors || []).length);
      setNextPageToken(data.nextPageToken || null);
    } catch (err) {
      setError(err?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadPage(null);
  }, [isAdmin, loadPage]);

  const filteredVendors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // Status filter first — cheaper than the text search and a common
    // admin workflow ("show me just pending").
    const byStatus = statusFilter === 'all'
      ? vendors
      : vendors.filter((v) => {
          // Treat null status (pre-onboarding docs) as 'approved' so the
          // 'approved' filter still shows DEFAULT_VENDORS + admin-created.
          const s = v.status || 'approved';
          return s === statusFilter;
        });
    if (!q) return byStatus;
    return byStatus.filter((v) => {
      return (
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.email && v.email.toLowerCase().includes(q)) ||
        (v.category && v.category.toLowerCase().includes(q)) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        v.vendorUid.toLowerCase().includes(q)
      );
    });
  }, [vendors, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const t = vendors.length;
    const categories = new Set(vendors.map((v) => v.category).filter(Boolean)).size;
    const ratedVendors = vendors.filter((v) => typeof v.rating === 'number');
    const avgRating =
      ratedVendors.length === 0
        ? '—'
        : (ratedVendors.reduce((s, v) => s + v.rating, 0) / ratedVendors.length).toFixed(2);
    const withPortfolio = vendors.filter((v) => v.portfolio && v.portfolio.length > 0).length;
    // 2026-07-11 — count vendors awaiting admin approval. Surfaces in a
    // stat card so admin notices new applications without filtering.
    const pendingCount = vendors.filter((v) => v.status === 'pending').length;
    return { t, categories, avgRating, withPortfolio, pendingCount };
  }, [vendors]);

  function goNextPage() {
    if (!nextPageToken) return;
    setPageTokens((prev) => [...prev, nextPageToken]);
    loadPage(nextPageToken);
  }

  function goPrevPage() {
    setPageTokens((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      loadPage(next[next.length - 1]);
      return next;
    });
  }

  async function handleDelete(v) {
    const label = v.name || v.email || v.vendorUid;
    if (
      !confirm(
        `確定要刪除商戶「${label}」？\n\n` +
          `此動作會從 Firestore 永久刪除商戶文件 (${v.vendorUid})。\n` +
          `商戶的登入帳戶不會被刪除 — 如需停用登入請到「管理員控制台」。`,
      )
    ) {
      return;
    }
    const actionKey = `${v.vendorUid}:delete`;
    setPendingAction(actionKey);
    try {
      const fn = httpsCallable(getFunctions(), 'admin_deleteVendor');
      await fn({ vendorUid: v.vendorUid });
      setVendors((prev) => prev.filter((row) => row.vendorUid !== v.vendorUid));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alert(`刪除失敗: ${err?.message || err}`);
    } finally {
      setPendingAction(null);
    }
  }

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
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Store className="w-8 h-8 text-emerald-600" />
          <h1 className="text-3xl font-black text-slate-900">商戶控制台</h1>
        </div>
        <p className="text-slate-500">查看所有商戶資料，編輯內容或刪除違規商戶。</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="總商戶 (本頁)"
          value={stats.t}
          icon={<Store className="w-5 h-5" />}
        />
        <StatCard
          label="類別數"
          value={stats.categories}
          icon={<ImageIcon className="w-5 h-5 text-rose-600" />}
        />
        <StatCard
          label="平均評分"
          value={stats.avgRating}
          icon={<Star className="w-5 h-5 text-amber-400 fill-amber-400" />}
        />
        <StatCard
          label="有作品集"
          value={`${stats.withPortfolio}/${stats.t}`}
          icon={<ImageIcon className="w-5 h-5 text-emerald-600" />}
        />
        {/*
          2026-07-11 — pending approvals stat card. Clickable: clicking it
          sets the status filter to 'pending' so admin can jump straight
          to the approval queue. Highlights in amber when > 0 so it stands
          out from the other neutral cards.
        */}
        <button
          type="button"
          onClick={() => setStatusFilter(stats.pendingCount > 0 ? 'pending' : 'all')}
          className={`text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
            stats.pendingCount > 0
              ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
              : 'border-slate-100 bg-white hover:bg-slate-50'
          } ${statusFilter === 'pending' ? 'ring-2 ring-amber-400' : ''}`}
        >
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center">
            <Clock className={`w-5 h-5 ${stats.pendingCount > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div>
            <div className="text-xs text-slate-500">待審批</div>
            <div className={`text-2xl font-bold ${stats.pendingCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {stats.pendingCount}
            </div>
          </div>
        </button>
      </div>

      {/* Status filter chips — sits between stat cards and the search bar. */}
      <div className="flex flex-wrap gap-2 mb-3">
        <StatusChip
          label="全部"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          count={vendors.length}
        />
        <StatusChip
          label="待審批"
          active={statusFilter === 'pending'}
          onClick={() => setStatusFilter('pending')}
          count={stats.pendingCount}
          tone="amber"
        />
        <StatusChip
          label="已批准"
          active={statusFilter === 'approved'}
          onClick={() => setStatusFilter('approved')}
          count={
            vendors.filter((v) => (v.status || 'approved') === 'approved').length
          }
          tone="emerald"
        />
        <StatusChip
          label="已拒絕"
          active={statusFilter === 'rejected'}
          onClick={() => setStatusFilter('rejected')}
          count={vendors.filter((v) => v.status === 'rejected').length}
          tone="rose"
        />
        <StatusChip
          label="已停權"
          active={statusFilter === 'suspended'}
          onClick={() => setStatusFilter('suspended')}
          count={vendors.filter((v) => v.status === 'suspended').length}
          tone="slate"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜尋名稱、電郵、類別、UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none"
          />
        </div>
        <button
          onClick={() => {
            setPageTokens([null]);
            loadPage(null);
          }}
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
            <div className="text-sm text-red-700 whitespace-pre-wrap">{error}</div>
            {error.code && (
              <div className="text-xs text-red-600 mt-2 font-mono">
                err.code = {String(error.code)}
              </div>
            )}
            <div className="text-xs text-red-600 mt-2">
              提示：開 DevTools → Network tab 揾 <code>admin_listVendors</code> request，
              copy response body + 撳「重新整理」按鈕重試。
              如果係「&quot;internal&quot;」通常係 (a) Firebase API key 無效 / 被封 / (b) Cloud Function
              部署失敗。請用 <code>firebase functions:log --only admin_listVendors</code> 查
              server-side stack trace。
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">商戶</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden md:table-cell">
                  類別
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden lg:table-cell">
                  評分
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden lg:table-cell">
                  作品
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">
                  {/* Always visible — admin needs to see approval status at
                      a glance, especially for the pending queue. */}
                  狀態
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden xl:table-cell">
                  更新
                </th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && vendors.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    載入中...
                  </td>
                </tr>
              )}
              {!loading && filteredVendors.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    {vendors.length === 0
                      ? '目前沒有任何商戶文件。請確認 Firestore /vendors/{uid} 集合下有資料。'
                      : '找不到符合的商戶。'}
                  </td>
                </tr>
              )}
              {filteredVendors.map((v) => {
                const deletePending = pendingAction === `${v.vendorUid}:delete`;
                return (
                  <tr
                    key={v.vendorUid}
                    className={`hover:bg-slate-50 transition-colors ${
                      v.authDisabled ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {v.portfolio && v.portfolio[0] ? (
                          <img
                            src={v.portfolio[0]}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {(v.name || v.email || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 truncate max-w-xs">
                              {v.name || '(無名稱)'}
                            </span>
                            {v.authDisabled && (
                              <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                                帳號已停用
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate max-w-xs">
                            {v.email || <span className="italic">(無電郵)</span>}
                            {v.price ? ` · ${v.price}` : ''}
                          </div>
                          <div className="text-xs text-slate-400 font-mono truncate max-w-xs">
                            {v.vendorUid}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="inline-flex flex-col gap-0.5">
                        <span className="inline-flex text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded w-fit">
                          {getVendorCategoryLabel(v.category)}
                        </span>
                        {v.subcategory && (
                          <span className="inline-flex text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded w-fit">
                            {getVendorCategoryLabel(v.category, v.subcategory)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1 text-slate-700">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        {typeof v.rating === 'number' ? v.rating.toFixed(1) : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-600">
                      {v.portfolio ? v.portfolio.length : 0}
                    </td>
                    <td className="px-4 py-3">
                      {/* Status badge — always visible. Click to filter
                          to that status in the chip row above. */}
                      <button
                        type="button"
                        onClick={() => setStatusFilter(v.status || 'approved')}
                        title={`只睇${(v.status || 'approved') === 'pending' ? '待審批' : (v.status || 'approved') === 'approved' ? '已批准' : (v.status || 'approved') === 'rejected' ? '已拒絕' : '已停權'}嘅商戶`}
                        className="hover:opacity-80 transition-opacity"
                      >
                        <StatusBadge status={v.status} />
                      </button>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-slate-600 whitespace-nowrap">
                      {fmtDate(v.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPreviewingVendor(v)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                          title="預覽完整商戶專頁（客人睇到嘅樣）"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          預覽
                        </button>
                        <button
                          onClick={() => setEditingVendor(v)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                          title="編輯商戶資料"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          編輯
                        </button>
                        <button
                          onClick={() => handleDelete(v)}
                          disabled={deletePending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border bg-white border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
                          title="刪除商戶文件"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {deletePending ? '刪除中...' : '刪除'}
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
        <div>
          每頁 50 個 · 顯示 {filteredVendors.length} / 總 {total}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrevPage}
            disabled={pageTokens.length <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> 上一頁
          </button>
          <button
            disabled={!nextPageToken || loading}
            onClick={goNextPage}
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

      {editingVendor && (
        <VendorEditModal
          vendor={editingVendor}
          onClose={() => setEditingVendor(null)}
          onSaved={(updated) => {
            setVendors((prev) =>
              prev.map((row) =>
                row.vendorUid === updated.vendorUid
                  ? { ...row, ...updated, updatedAt: new Date().toISOString() }
                  : row,
              ),
            );
            setEditingVendor(null);
          }}
        />
      )}

      {/* Restore 2026-07-02: admin-side preview modal — shows the vendor
          profile exactly as couples see it from the DiscoverDirectory. */}
      <VendorModal
        vendor={previewingVendor}
        onClose={() => setPreviewingVendor(null)}
      />
    </div>
  );
}

function VendorEditModal({ vendor, onClose, onSaved }) {
  const [name, setName] = useState(vendor.name || '');
  const [category, setCategory] = useState(vendor.category || '');
  const [subcategory, setSubcategory] = useState(vendor.subcategory || '');
  const [rating, setRating] = useState(
    typeof vendor.rating === 'number' ? String(vendor.rating) : '',
  );
  const [price, setPrice] = useState(vendor.price || '');
  const [description, setDescription] = useState(vendor.description || '');
  const [tags, setTags] = useState((vendor.tags || []).join(', '));
  const [portfolio, setPortfolio] = useState((vendor.portfolio || []).join('\n'));
  // 2026-07-11 — vendor onboarding approval. Pre-onboarding docs (no
  // status) display as 'approved' so the dropdown's initial value is sane.
  const [status, setStatus] = useState(vendor.status || 'approved');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Sub-options for the chosen top-level category. Subcategories are an
  // object map (subKey → label) — keep it sorted by label so admin can
  // find common ones by eye.
  const subOptions = useMemo(() => {
    if (!category) return [];
    const cfg = VENDOR_CATEGORIES[category];
    if (!cfg || !cfg.subs) return [];
    return Object.entries(cfg.subs)
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-HK'));
  }, [category]);

  // When category changes, drop a subcategory that no longer matches.
  // This is important when admin re-classifies a vendor — the previous
  // sub would silently become invalid.
  function handleCategoryChange(next) {
    setCategory(next);
    if (!next) {
      setSubcategory('');
      return;
    }
    const cfg = VENDOR_CATEGORIES[next];
    if (!cfg || !cfg.subs) {
      // No subs at all → no subcategory possible for this top.
      setSubcategory('');
      return;
    }
    if (!cfg.subs[subcategory]) {
      setSubcategory('');
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

    const updates = {};
    if (name !== (vendor.name || '')) updates.name = name.trim();
    if (category !== (vendor.category || '')) updates.category = category.trim();
    // Persist subcategory as a string (or null to clear).
    const newSub = subcategory || null;
    const oldSub = vendor.subcategory || null;
    if (newSub !== oldSub) {
      updates.subcategory = newSub;
    }
    if (price !== (vendor.price || '')) updates.price = price.trim();
    if (description !== (vendor.description || '')) updates.description = description.trim();
    if (status !== (vendor.status || 'approved')) updates.status = status;

    const newRating = rating === '' ? null : Number(rating);
    if (typeof newRating === 'number' && newRating !== vendor.rating) {
      if (Number.isNaN(newRating) || newRating < 0 || newRating > 5) {
        setError('評分必須是 0 到 5 之間的數字。');
        return;
      }
      updates.rating = newRating;
    }

    const newTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const oldTags = vendor.tags || [];
    if (
      newTags.length !== oldTags.length ||
      newTags.some((t, i) => t !== oldTags[i])
    ) {
      updates.tags = newTags;
    }

    const newPortfolio = portfolio
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    const oldPortfolio = vendor.portfolio || [];
    if (
      newPortfolio.length !== oldPortfolio.length ||
      newPortfolio.some((u, i) => u !== oldPortfolio[i])
    ) {
      updates.portfolio = newPortfolio;
    }

    if (Object.keys(updates).length === 0) {
      // 2026-07-17 — UX fix. Previously this silently closed the
      // modal, which made "I clicked save and nothing happened" feel
      // like a bug. Now: surface a no-op message inline in the
      // existing error banner + keep the modal open so the admin
      // can keep editing. We repurpose setError with the (info)
      // prefix so the banner styling stays consistent.
      setError('(資料無變更, 唔需要儲存)');
      return;
    }

    setSaving(true);
    try {
      // 2026-07-17 — instrumentation. Save is silently failing for
      // cs.kcupid@gmail.com on this branch — log every step of the
      // path so we can see in DevTools if the function call never
      // starts, never resolves, or rejects. Leave these in for now;
      // we'll trim once the root cause is fixed.
      const fn = httpsCallable(getFunctions(), 'admin_updateVendor');
      console.log('[VendorEdit] calling admin_updateVendor', { vendorUid: vendor.vendorUid, updates });
      const t0 = Date.now();
      const result = await fn({ vendorUid: vendor.vendorUid, updates });
      console.log('[VendorEdit] admin_updateVendor resolved in', Date.now() - t0, 'ms', result?.data);
      onSaved({ vendorUid: vendor.vendorUid, ...updates });
    } catch (err) {
      // The Cloud Functions SDK compresses HttpsError codes; expose
      // them in the UI instead of just the message string so we don't
      // chase misleading "internal" messages.
      const code = err?.code || '';
      const message = err?.message || String(err);
      console.error('[VendorEdit] save failed', { code, message, updates });
      setError(message ? (code ? `(${code}) ${message}` : message) : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-900">
              編輯商戶 — {vendor.name || vendor.vendorUid}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg"
            aria-label="關閉"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSave} className="overflow-y-auto custom-scrollbar flex-grow">
          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">名稱</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  類別 <span className="text-xs text-slate-400 font-normal">(由管理員代客戶揀)</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="">— 請選擇分類 —</option>
                  {Object.entries(VENDOR_CATEGORIES).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.icon} {cfg.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  客戶端 (DiscoverDirectory) 嘅分類卡片會用呢個 key 嚟做 filter。
                </p>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  子分類 (選填)
                </label>
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  disabled={!category || subOptions.length === 0}
                  className={`w-full p-2.5 rounded-lg border outline-none ${
                    !category || subOptions.length === 0
                      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border-slate-300 focus:border-emerald-500'
                  }`}
                >
                  <option value="">
                    {!category
                      ? '— 揀完主分類先 —'
                      : subOptions.length === 0
                      ? '— 此分類冇子分類 —'
                      : '— (留空) —'}
                  </option>
                  {subOptions.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  商戶指南入面鑽入分類後嘅 top-chip 會用到呢個 sub 嚟做 filter。
                </p>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">評分 (0–5)</label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none"
                />
              </div>
              {/*
                2026-07-11 — approval status. Shown in the edit form so admin
                can flip a pending vendor to approved (or vice versa)
                without writing a separate approval screen.
              */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">審批狀態</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="approved">✅ 已批准 (公開展示)</option>
                  <option value="pending">⏳ 待審批 (隱藏)</option>
                  <option value="rejected">❌ 已拒絕 (隱藏)</option>
                  <option value="suspended">⏸ 已停權 (隱藏)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">參考價</label>
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="$18,000+"
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">簡介</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                標籤 (用逗號分隔)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="伯大尼, Ritz Carlton, 紀實唯美"
                className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                作品集連結 (每行一個 URL)
              </label>
              <textarea
                rows={4}
                value={portfolio}
                onChange={(e) => setPortfolio(e.target.value)}
                placeholder="https://..."
                className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none resize-none font-mono text-xs"
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}