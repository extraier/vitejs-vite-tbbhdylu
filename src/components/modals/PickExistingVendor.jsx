// PickExistingVendor — search modal that lets couples pick a vendor
// from our 677-vendor catalog and link it to their MyVendors
// address book. Two-dropdown UI: main category + subcategory
// filters. Shows ALL matching vendors (no 50-row cap) so couples
// can browse the full catalog by category.
//
// 2026-07-21 — initial release. Couples who already found a vendor
// through the DiscoverDirectory don't need to retype contact info
// — we just link the existing vendor record via linkedVendorUid.
// Chat opens immediately because the vendor is already onboarded.
//
// 2026-07-21 (later) — switched from "search input + 50-row list"
// to "main + sub category dropdowns + full list". Dropdowns are
// faster than typing for browsing, and showing all matches
// (instead of capping at 50) lets couples discover the full
// catalog instead of "first 50 alphabetical".

import { useState, useEffect, useMemo } from 'react';
import { X, MapPin, Star, Loader2 } from 'lucide-react';
import { collection, getDocs, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { VENDOR_CATEGORIES } from '../../lib/config';

export function PickExistingVendor({ onPick, onClose }) {
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState(null);

  // Two-dropdown state
  const [topCategory, setTopCategory] = useState('all');  // 'all' or 'venue', 'styling', etc.
  const [subCategory, setSubCategory] = useState('all');   // 'all' or 'banquet_hall', etc.

  // Fetch vendors once (cached in-memory for the session)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Pull from root-level /vendors collection. We currently have ~700.
        const snap = await getDocs(collection(db, 'vendors'), limit(2000));
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || '(無名稱)',
            category: data.category || data.serviceCategory || '',
            subcategory: data.subcategory || data.serviceSubcategory || '',
            categoryLabel: data.categoryLabel || '',
            serviceAreaCity: data.serviceAreaCity || '',
            serviceAreaDistrict: data.serviceAreaDistrict || '',
            portfolio: data.portfolio || [],
            rating: data.rating || data.avgRating || 0,
            signupStatus: data.signupStatus || '',
            claimedBy: data.claimedBy || '',
          };
        });
        // Sort by name for stable UX
        list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
        setVendors(list);
        setError(null);
      } catch (e) {
        console.error('PickExistingVendor fetch failed:', e);
        setError('載入商戶失敗，請稍後再試。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subcategory list depends on selected topCategory
  const subOptions = useMemo(() => {
    if (topCategory === 'all') return [];
    const top = VENDOR_CATEGORIES[topCategory];
    if (!top) return [];
    return Object.entries(top.subs).map(([key, label]) => ({ key, label }));
  }, [topCategory]);

  // When topCategory changes, reset subCategory to 'all'
  useEffect(() => {
    setSubCategory('all');
  }, [topCategory]);

  // Filter vendors by selected categories (NO 50-row cap)
  const filtered = useMemo(() => {
    if (topCategory === 'all') return vendors;  // All 677 if no filter
    return vendors.filter((v) => {
      if (v.category !== topCategory) return false;
      if (subCategory !== 'all' && v.subcategory !== subCategory) return false;
      return true;
    });
  }, [vendors, topCategory, subCategory]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            🏪 從商戶目錄搵
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Two-dropdown filter bar */}
        <div className="p-4 border-b border-slate-100 flex-shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Main category */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                主類別
              </label>
              <select
                value={topCategory}
                onChange={(e) => setTopCategory(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl outline-none focus:border-emerald-500 bg-white text-sm font-bold"
              >
                <option value="all">📋 所有商戶 ({vendors.length} 個)</option>
                {Object.entries(VENDOR_CATEGORIES).map(([key, cat]) => (
                  <option key={key} value={key}>
                    {cat.icon} {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sub category (depends on top) */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                子類別
              </label>
              <select
                value={subCategory}
                onChange={(e) => setSubCategory(e.target.value)}
                disabled={topCategory === 'all'}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl outline-none focus:border-emerald-500 bg-white text-sm font-bold disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="all">
                  {topCategory === 'all' ? '先揀主類別' : '所有子類別'}
                </option>
                {subOptions.map((sub) => (
                  <option key={sub.key} value={sub.key}>
                    ↳ {sub.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Result count + active filter chip */}
          <div className="flex items-center gap-2 mt-3">
            {loading ? (
              <span className="text-[10px] text-slate-500">載入中...</span>
            ) : (
              <>
                <span className="text-[11px] font-bold text-slate-700">
                  {filtered.length} 個商戶
                </span>
                {topCategory !== 'all' && (
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">
                    {VENDOR_CATEGORIES[topCategory]?.icon} {VENDOR_CATEGORIES[topCategory]?.label}
                    {subCategory !== 'all' && ` · ${subOptions.find((s) => s.key === subCategory)?.label}`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Results grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
            </div>
          ) : error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm text-slate-600 font-bold mb-1">
                呢個類別未有商戶
              </p>
              <p className="text-xs text-slate-500">
                揀另一個類別，或者用「自己新增」保存佢哋嘅聯絡資料。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onPick(v)}
                  className="text-left bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-xl p-3 transition-all group"
                >
                  <div className="flex items-start gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center text-emerald-700 font-black text-sm flex-shrink-0">
                      {v.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-xs truncate group-hover:text-emerald-700">
                        {v.name}
                      </div>
                      {v.serviceAreaCity && (
                        <div className="flex items-center gap-0.5 text-[9px] text-slate-500 mt-0.5 truncate">
                          <MapPin className="w-2.5 h-2.5" />
                          {v.serviceAreaCity}
                          {v.serviceAreaDistrict && ` · ${v.serviceAreaDistrict}`}
                        </div>
                      )}
                    </div>
                    {v.rating > 0 && (
                      <div className="flex items-center gap-0.5 text-[9px] text-amber-600 flex-shrink-0">
                        <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                        {v.rating.toFixed(1)}
                      </div>
                    )}
                  </div>
                  {/* Category pill */}
                  {v.category && VENDOR_CATEGORIES[v.category] && (
                    <div className="text-[9px] text-slate-400 mt-1 truncate">
                      {VENDOR_CATEGORIES[v.category].icon} {VENDOR_CATEGORIES[v.category].label}
                      {v.subcategory && VENDOR_CATEGORIES[v.category].subs[v.subcategory] &&
                        ` · ${VENDOR_CATEGORIES[v.category].subs[v.subcategory]}`}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <p className="text-[10px] text-slate-500 text-center leading-relaxed">
            💡 目錄未有嘅商戶？ 用「自己新增」保存佢哋嘅聯絡資料。
          </p>
        </div>
      </div>
    </div>
  );
}