// 2026-08-15 — Vendor Onboarding & Assignment Audit (Fix 4).
// "重新連結商戶" modal. Replaces the old prompt() that asked for
// a raw vendor uid. The couple now searches the public vendor
// directory by name (or filters by category), previews the
// match, then confirms to re-stamp linkedVendorUid on the
// contact. Audit fields (linkedAt, linkSource: 'manual-relink')
// are stamped by the cloud function.

import { useEffect, useState } from 'react';
import { Search, Loader2, X, CheckCircle2, AlertTriangle, Store } from 'lucide-react';
import {
  searchVendorsByName,
  previewLinkVendorContact,
  linkVendorContact,
} from '../../lib/vendorRelink';

export function RelinkVendorModal({ contact, onClose, onLinked }) {
  const [name, setName] = useState(contact?.vendorName || '');
  const [category, setCategory] = useState(contact?.category || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  // Run a search whenever name or category changes (debounced).
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const hits = await searchVendorsByName({
          name: name.trim(),
          category: category || undefined,
          limit: 20,
        });
        if (!cancelled) {
          setResults(hits);
          setSearching(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || '搜尋失敗');
          setSearching(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, category]);

  // Preview whenever the selection changes (so the couple sees
  // what would change before they confirm).
  useEffect(() => {
    if (!selected || !contact?.id) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await previewLinkVendorContact({
          contactId: contact.id,
          vendorUid: selected.uid,
        });
        if (!cancelled) setPreview(p);
      } catch (err) {
        if (!cancelled) setError(err?.message || '預覽失敗');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, contact?.id]);

  async function handleConfirm() {
    if (!selected || !contact?.id) return;
    setLinking(true);
    setError(null);
    try {
      await linkVendorContact({
        contactId: contact.id,
        vendorUid: selected.uid,
      });
      setLinked(true);
      onLinked?.({
        contactId: contact.id,
        vendorUid: selected.uid,
        vendorName: selected.name,
      });
      // Auto-close after a moment to show the success state.
      setTimeout(() => onClose?.(), 1200);
    } catch (err) {
      setError(err?.message || '連結失敗');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-rose-500" />
            <h2 className="font-bold text-slate-800">重新連結商戶</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">連結以下商戶到 Save The Day 目錄：</p>
          <p className="text-sm font-bold text-slate-800">
            {contact?.vendorName || '未命名商戶'}
          </p>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">商戶名稱</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="輸入商戶名稱或關鍵字"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-rose-200"
                autoFocus
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">分類</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-rose-200"
            >
              <option value="">所有分類</option>
              <option value="venue">場地</option>
              <option value="photography">攝影</option>
              <option value="videography">錄影</option>
              <option value="bridal_makeup">新娘化妝</option>
              <option value="mc">司儀</option>
              <option value="florist">花藝</option>
              <option value="catering">婚宴餐飲</option>
              <option value="wedding_dress">婚紗</option>
              <option value="rings">戒指</option>
              <option value="decoration">佈置</option>
            </select>
          </label>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {searching ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              搜尋中...
            </div>
          ) : results.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">
              冇符合嘅結果
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.uid}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                      selected?.uid === r.uid
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-bold text-sm text-slate-800">{r.name}</span>
                      <span className="text-[10px] text-slate-400">{r.uid}</span>
                    </div>
                    {(r.category || r.serviceAreaCity) && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.category && <span>{r.category}</span>}
                        {r.category && r.serviceAreaCity && <span> · </span>}
                        {r.serviceAreaCity && <span>📍 {r.serviceAreaCity}</span>}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Preview + actions */}
        {preview && (
          <div className="px-4 py-2 border-t border-slate-100 bg-amber-50">
            <p className="text-xs text-amber-800">
              <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
              將會覆蓋連結：{preview.vendorName}（{preview.vendorCategory || '未分類'}）
              {preview.currentLinkedVendorUid && (
                <span className="block text-amber-700 mt-0.5">
                  現有連結：{preview.currentLinkedVendorUid}
                </span>
              )}
            </p>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 border-t border-slate-100 bg-rose-50">
            <p className="text-xs text-rose-700">✗ {error}</p>
          </div>
        )}

        {linked && (
          <div className="px-4 py-2 border-t border-slate-100 bg-emerald-50">
            <p className="text-xs text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> 已連結！畫面即將更新。
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 p-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2 text-sm text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || linking || linked}
            className="flex-1 px-3 py-2 text-sm text-white bg-rose-500 rounded-lg hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            {linking && <Loader2 className="w-4 h-4 animate-spin" />}
            {linked ? '✓ 已連結' : '確認連結'}
          </button>
        </div>
      </div>
    </div>
  );
}