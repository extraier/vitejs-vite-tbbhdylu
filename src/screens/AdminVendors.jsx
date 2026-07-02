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
} from 'lucide-react';

const CATEGORY_LABELS = {
  photography: '📸 攝影',
  deco: '🌸 佈置',
  bridal_makeup: '💄 化妝',
  mc: '🎤 司儀',
  venue: '🏛️ 場地',
  banquet: '🍽️ 婚宴',
  cake: '🎂 蛋糕',
  wedding_car: '🚗 花車',
  invite: '✉️ 喜帖',
  gift: '🎁 回禮',
  honeymoon: '✈️ 蜜月',
  other: '🔖 其他',
};

function categoryLabel(c) {
  if (!c) return '—';
  return CATEGORY_LABELS[c] || c;
}

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

export function AdminVendors({ user, isAdmin }) {
  const [vendors, setVendors] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [editingVendor, setEditingVendor] = useState(null);
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
    if (!q) return vendors;
    return vendors.filter((v) => {
      return (
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.email && v.email.toLowerCase().includes(q)) ||
        (v.category && v.category.toLowerCase().includes(q)) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        v.vendorUid.toLowerCase().includes(q)
      );
    });
  }, [vendors, searchQuery]);

  const stats = useMemo(() => {
    const t = vendors.length;
    const categories = new Set(vendors.map((v) => v.category).filter(Boolean)).size;
    const ratedVendors = vendors.filter((v) => typeof v.rating === 'number');
    const avgRating =
      ratedVendors.length > 0
        ? (ratedVendors.reduce((s, v) => s + v.rating, 0) / ratedVendors.length).toFixed(2)
        : '—';
    const withPortfolio = vendors.filter((v) => v.portfolio && v.portfolio.length > 0).length;
    return { t, categories, avgRating, withPortfolio };
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
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden xl:table-cell">
                  更新
                </th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && vendors.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    載入中...
                  </td>
                </tr>
              )}
              {!loading && filteredVendors.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
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
                      <span className="inline-flex text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                        {categoryLabel(v.category)}
                      </span>
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
                    <td className="px-4 py-3 hidden xl:table-cell text-slate-600 whitespace-nowrap">
                      {fmtDate(v.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
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
    </div>
  );
}

function VendorEditModal({ vendor, onClose, onSaved }) {
  const [name, setName] = useState(vendor.name || '');
  const [category, setCategory] = useState(vendor.category || '');
  const [rating, setRating] = useState(
    typeof vendor.rating === 'number' ? String(vendor.rating) : '',
  );
  const [price, setPrice] = useState(vendor.price || '');
  const [description, setDescription] = useState(vendor.description || '');
  const [tags, setTags] = useState((vendor.tags || []).join(', '));
  const [portfolio, setPortfolio] = useState((vendor.portfolio || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

    const updates = {};
    if (name !== (vendor.name || '')) updates.name = name.trim();
    if (category !== (vendor.category || '')) updates.category = category.trim();
    if (price !== (vendor.price || '')) updates.price = price.trim();
    if (description !== (vendor.description || '')) updates.description = description.trim();

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
      onClose();
      return;
    }

    setSaving(true);
    try {
      const fn = httpsCallable(getFunctions(), 'admin_updateVendor');
      await fn({ vendorUid: vendor.vendorUid, updates });
      onSaved({ vendorUid: vendor.vendorUid, ...updates });
    } catch (err) {
      setError(err?.message || '儲存失敗');
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
                <label className="block text-sm font-bold text-slate-700 mb-1">類別</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="photography / deco / bridal_makeup ..."
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 outline-none"
                />
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