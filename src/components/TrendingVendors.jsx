// TrendingVendors — compact "Trending now" strip on the couple's
// home page. Surfaces the top 6 vendors by 7-day view count from
// the popularity counter maintained by the onVendorImageViewCreated
// cloud function. Lets couples discover what's hot right now even
// before they pick a task category to start their planning.
//
// 2026-07-20 — first version. Pulled out of CoupleChecklist so it
// can also be embedded in other surfaces (events dashboard,
// post-onboarding welcome). Reads from the merged vendor list —
// no extra Firestore query.

import { Flame, ArrowRight, TrendingUp } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../lib/config';

// Pick the top N trending vendors by viewCount (already attached
// on each vendor at App.jsx subscription layer).
function pickTrending(vendors, n = 6) {
  const ranked = vendors
    .filter((v) => (v.viewCount || 0) > 0)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  return ranked.slice(0, n);
}

function categoryLabel(cat) {
  return VENDOR_CATEGORIES[cat]?.label || cat;
}

export function TrendingVendors({ vendors, onSelect, onGoDiscover }) {
  const top = pickTrending(vendors, 6);
  if (top.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-rose-50 via-white to-amber-50 border border-rose-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-rose-500 flex items-center justify-center">
            <Flame className="w-4 h-4 text-white" />
          </span>
          <div>
            <h3 className="font-black text-slate-800">熱門商戶</h3>
            <p className="text-xs text-slate-500">近 7 日最多新人瀏覽</p>
          </div>
        </div>
        {onGoDiscover && (
          <button
            type="button"
            onClick={onGoDiscover}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1"
          >
            查看更多 <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {top.map((vendor) => {
          const cat = VENDOR_CATEGORIES[vendor.category];
          return (
            <button
              key={vendor.id}
              type="button"
              onClick={() => onSelect && onSelect(vendor)}
              className="bg-white rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 hover:shadow-md transition-all text-left group"
            >
              <div className="h-16 w-full overflow-hidden bg-slate-100 relative">
                {vendor.portfolio?.[0] && (
                  <img
                    src={vendor.portfolio[0]}
                    alt={vendor.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                )}
                {cat && (
                  <div className="absolute bottom-1 left-1 bg-white/90 backdrop-blur-sm rounded-full px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                    {cat.icon} {cat.label}
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs font-bold text-slate-800 truncate mb-1">
                  {vendor.name}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-rose-600">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-bold">{vendor.viewCount}</span>
                  <span className="text-slate-500">瀏覽</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}