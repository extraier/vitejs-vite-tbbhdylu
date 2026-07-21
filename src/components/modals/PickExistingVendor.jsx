// PickExistingVendor — search modal that filters the vendor catalog
// (677 onboarded vendors at /vendors/{uid}) so couples can link an
// existing platform vendor to their MyVendors address book.
//
// 2026-07-21 — initial release. Couples who already found a vendor
// through the DiscoverDirectory don't need to type the contact info
// again — we just link the existing vendor record to MyVendors via
// linkedVendorUid. Chat opens immediately because the vendor is
// already onboarded.

import { useState, useEffect, useMemo } from 'react';
import { X, Search, Loader2, MapPin, Star } from 'lucide-react';
import { collection, getDocs, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export function PickExistingVendor({ onPick, onClose }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState(null);

  // Fetch vendors once (cached in-memory for the session)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Pull from root-level /vendors collection. Limit to 1000 to
        // avoid paying for unused rows (we currently have ~700).
        const snap = await getDocs(collection(db, 'vendors'), limit(1000));
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || '(無名稱)',
            category: data.category || data.serviceCategory || '',
            categoryLabel: data.categoryLabel || '',
            serviceAreaCity: data.serviceAreaCity || '',
            serviceAreaDistrict: data.serviceAreaDistrict || '',
            portfolio: data.portfolio || [],
            rating: data.rating || data.avgRating || 0,
            signupStatus: data.signupStatus || '',
            claimedBy: data.claimedBy || '',
            displayName: data.displayName || data.name || '',
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

  // Client-side filter (cheap, since <1000 items).
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return vendors.slice(0, 50); // empty search: show first 50
    const q = searchTerm.toLowerCase().trim();
    return vendors
      .filter((v) => {
        if ((v.name || '').toLowerCase().includes(q)) return true;
        if ((v.displayName || '').toLowerCase().includes(q)) return true;
        if ((v.categoryLabel || '').toLowerCase().includes(q)) return true;
        if ((v.serviceAreaCity || '').toLowerCase().includes(q)) return true;
        if ((v.serviceAreaDistrict || '').toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 50);
  }, [vendors, searchTerm]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <Search className="w-5 h-5 text-emerald-600" />
            從商戶目錄搵
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              placeholder="搵商戶名 / 類別 / 地區..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-emerald-500 text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            {loading ? '載入中...' : `${filtered.length} 個商戶${searchTerm ? '' : '（顯示首 50 個）'}`}
          </p>
        </div>

        {/* Results */}
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
                搵唔到「{searchTerm}」
              </p>
              <p className="text-xs text-slate-500">
                試下用其他關鍵字，或者用「自己新增一個商戶」自己輸入。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onPick(v)}
                  className="text-left bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-xl p-3 transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center text-emerald-700 font-black text-base flex-shrink-0">
                      {v.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-sm truncate group-hover:text-emerald-700">
                        {v.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                        {v.categoryLabel && (
                          <span className="truncate">{v.categoryLabel}</span>
                        )}
                        {v.serviceAreaCity && (
                          <span className="flex items-center gap-0.5 flex-shrink-0">
                            <MapPin className="w-3 h-3" />
                            {v.serviceAreaCity}
                          </span>
                        )}
                      </div>
                    </div>
                    {v.rating > 0 && (
                      <div className="flex items-center gap-0.5 text-[10px] text-amber-600 flex-shrink-0">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        {v.rating.toFixed(1)}
                      </div>
                    )}
                  </div>
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