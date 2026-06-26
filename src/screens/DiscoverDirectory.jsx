import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { trackVendorView, trackVendorClick } from '../lib/vendorAnalytics';

export function DiscoverDirectory({ vendors, filter, onFilterChange, onViewProfile, user }) {
  const filtered = useMemo(() => {
    if (filter === 'all') return vendors;
    return vendors.filter((v) => v.category === filter);
  }, [filter, vendors]);

  // Track one view per (vendor, render). Dedupe by vendorId in a ref so
  // re-renders within the same session don't fire repeatedly.
  const viewedRef = useRef(new Set());
  useEffect(() => {
    const newlyViewed = filtered.filter((v) => !viewedRef.current.has(v.id));
    newlyViewed.forEach((v) => {
      viewedRef.current.add(v.id);
      trackVendorView(v, user);
    });
  }, [filtered, user]);

  const handleClick = (vendor) => {
    trackVendorClick(vendor, user);
    onViewProfile(vendor);
  };

  return (
    <div className="max-w-7xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-black text-slate-800 mb-4">探索優質婚禮商戶</h2>
      </div>
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        <FilterBtn current={filter} value="all" onClick={onFilterChange}>
          全部商戶
        </FilterBtn>
        <FilterBtn current={filter} value="photography" onClick={onFilterChange}>
          📸 攝影
        </FilterBtn>
        <FilterBtn current={filter} value="deco" onClick={onFilterChange}>
          🌸 佈置
        </FilterBtn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filtered.map((vendor) => (
          <div
            key={vendor.id}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg cursor-pointer group"
            onClick={() => handleClick(vendor)}
          >
            <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
              {vendor.portfolio?.[0] && (
                <img
                  src={vendor.portfolio[0]}
                  alt={vendor.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              )}
            </div>
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-2 truncate">{vendor.name}</h3>
              <div className="flex justify-between items-center border-t border-slate-100 pt-4">
                <span className="font-black text-rose-600">{vendor.price}</span>
                <span className="text-sm font-bold text-slate-900 bg-slate-100 px-4 py-2 rounded-lg flex items-center gap-1">
                  查看作品集 <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterBtn({ current, value, onClick, children }) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${
        active
          ? 'bg-slate-900 text-white shadow-md'
          : 'bg-white text-slate-600 border border-slate-200'
      }`}
    >
      {children}
    </button>
  );
}