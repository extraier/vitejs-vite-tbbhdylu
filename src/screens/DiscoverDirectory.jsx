// DiscoverDirectory — the 🔍 商戶指南 page.
//
// 2026-07-17 — Brought on parity with the canonical VENDOR_CATEGORIES
// hierarchical taxonomy in src/lib/config.ts. Two-tier UX:
//
//   1. Default view (filter === 'all'): show 13 top-level category
//      cards. Each card has the canonical emoji + label + live vendor
//      count. Click a card → set filter to the category top-level key.
//
//   2. Drilldown (filter === '<topKey>' OR '<topKey>.<subKey>'):
//      sub-category chips across the top + a vendor grid below
//      filtered by category (and sub-category if a sub-chip is
//      selected). Clicking the "all" chip inside a category resets
//      to category-only matching; clicking the "← 全部類別" back
//      link at the top resets to all.
//
// Filter encoding (sent up to App.jsx via onFilterChange):
//   'all'                                  → all vendors
//   'photo_video'                          → photo_video + any sub
//   'photo_video.photographer'             → photo_video + photographer sub
//
// Vendor docs shape:
//   vendor.category     = topKey    e.g. 'venue'
//   vendor.subcategory  = subKey    e.g. 'banquet_hall'

import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { trackVendorView, trackVendorClick } from '../lib/vendorAnalytics';
import {
  VENDOR_CATEGORIES,
  getVendorCategoryLabel,
} from '../lib/config';

function isSubMatch(filter) {
  return filter && filter.includes('.');
}

export function DiscoverDirectory({
  vendors,
  filter,
  onFilterChange,
  onViewProfile,
  user,
}) {
  const filtered = useMemo(() => {
    // Hide vendors that are still pending admin review. Status is set by
    // applyAsVendor on submission. Pre-onboarding DEFAULT_VENDORS don't
    // have a status field, which we treat as 'approved'.
    const visible = vendors.filter((v) => v.status !== 'pending');
    if (filter === 'all' || !filter) return visible;
    if (isSubMatch(filter)) {
      const [top, sub] = filter.split('.');
      return visible.filter(
        (v) => v.category === top && v.subcategory === sub,
      );
    }
    // top-level match
    return visible.filter((v) => v.category === filter);
  }, [filter, vendors]);

  // Per-category + per-subcategory counts for the pill labels and the
  // default-view category cards. Computed once per vendor update.
  const counts = useMemo(() => {
    const visible = vendors.filter((v) => v.status !== 'pending');
    const topCounts = {};
    const subCounts = {}; // { topKey: { subKey: n } }
    visible.forEach((v) => {
      const top = v.category || 'miscellaneous';
      topCounts[top] = (topCounts[top] || 0) + 1;
      if (v.subcategory) {
        if (!subCounts[top]) subCounts[top] = {};
        subCounts[top][v.subcategory] =
          (subCounts[top][v.subcategory] || 0) + 1;
      }
    });
    return { topCounts, subCounts, total: visible.length };
  }, [vendors]);

  // Track one view per (vendor, render). Dedupe by vendorId in a ref so
  // re-renders within the same session don't fire repeatedly.
  const viewedRef = useRef(new Set());
  useEffect(() => {
    const newlyViewed = filtered.filter((v) => !viewedRef.current.has(v.id));
    if (newlyViewed.length === 0) return;
    const sessionKey = filter || 'all';
    newlyViewed.forEach((v) => {
      viewedRef.current.add(`${sessionKey}:${v.id}`);
      trackVendorView(v, user);
    });
  }, [filtered, user, filter]);

  const handleClick = (vendor) => {
    trackVendorClick(vendor, user);
    onViewProfile(vendor);
  };

  const inCategory = filter && filter !== 'all' && !isSubMatch(filter);
  const inSub = isSubMatch(filter);
  const isDrilldown = inCategory || inSub;

  return (
    <div className="max-w-7xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-black text-slate-800 mb-4">
          {isDrilldown ? (
            <button
              type="button"
              onClick={() => onFilterChange('all')}
              className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
              全部類別
            </button>
          ) : (
            '探索優質婚禮商戶'
          )}
        </h2>
        <p className="text-sm text-slate-500">
          {isDrilldown
            ? filter.replace('.', ' › ')
            : `${counts.total} 個認證商戶，分 ${Object.keys(VENDOR_CATEGORIES).length} 大類`}
        </p>
      </div>

      {/* Default view: 13 category cards */}
      {!isDrilldown && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Object.entries(VENDOR_CATEGORIES).map(([topKey, cfg]) => {
            const count = counts.topCounts[topKey] || 0;
            return (
              <button
                key={topKey}
                type="button"
                onClick={() => onFilterChange(topKey)}
                disabled={count === 0}
                className={`group relative rounded-2xl p-5 text-left transition-all border ${
                  count === 0
                    ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed'
                    : 'bg-white border-slate-200 hover:border-emerald-400 hover:shadow-md cursor-pointer'
                }`}
              >
                <div className="text-4xl mb-2">{cfg.icon}</div>
                <div className="font-black text-slate-800 mb-1 text-sm">
                  {cfg.label}
                </div>
                <div className="text-xs text-slate-500">
                  {count === 0 ? '尚未有商戶' : `${count} 個商戶`}
                </div>
                {count > 0 && (
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 absolute top-4 right-4 transition-colors" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Drilldown view: sub-category chips + filtered vendor grid */}
      {isDrilldown && (
        <>
          <SubCategoryChips
            topKey={inSub ? filter.split('.')[0] : filter}
            currentFilter={filter}
            onFilterChange={onFilterChange}
            subCounts={counts.subCounts}
          />
          <VendorGrid vendors={filtered} onSelect={handleClick} />
        </>
      )}
    </div>
  );
}

// Renders sub-category chips for a given top-level category, plus an
// "全部" chip that resets the filter to just the top-level.
function SubCategoryChips({ topKey, currentFilter, onFilterChange, subCounts }) {
  const cfg = VENDOR_CATEGORIES[topKey];
  if (!cfg) return null;
  const subs = Object.entries(cfg.subs);
  const activeSub = isSubMatch(currentFilter) ? currentFilter.split('.')[1] : null;
  const topCount =
    subCounts[topKey] &&
    Object.values(subCounts[topKey]).reduce((a, b) => a + b, 0);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2 mb-4 justify-center">
        <FilterBtn
          current={activeSub ? null : topKey}
          value={topKey}
          onClick={onFilterChange}
        >
          📦 全部{cfg.label}
          {topCount > 0 && (
            <span className="ml-1.5 text-xs opacity-70">({topCount})</span>
          )}
        </FilterBtn>
        {subs.map(([subKey, subLabel]) => {
          const n = subCounts[topKey]?.[subKey] || 0;
          return (
            <FilterBtn
              key={subKey}
              current={activeSub === subKey ? `${topKey}.${subKey}` : null}
              value={`${topKey}.${subKey}`}
              onClick={onFilterChange}
              disabled={n === 0}
            >
              {subLabel}
              {n > 0 && (
                <span className="ml-1.5 text-xs opacity-70">({n})</span>
              )}
            </FilterBtn>
          );
        })}
      </div>
    </div>
  );
}

// Filter chip with active / disabled states.
function FilterBtn({ current, value, onClick, disabled, children }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      disabled={disabled}
      className={`px-4 py-2 rounded-full font-bold text-sm transition-all ${
        disabled
          ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
          : active
          ? 'bg-slate-900 text-white shadow-md'
          : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  );
}

// Renders the actual vendor cards for the (filtered) directory list.
function VendorGrid({ vendors, onSelect }) {
  if (vendors.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
        <p className="text-slate-500">
          呢個分類暫時未有商戶，試下其他分類啦！
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {vendors.map((vendor) => {
        const catLabel = getVendorCategoryLabel(
          vendor.category,
          vendor.subcategory,
        );
        const subLabel = vendor.subcategory
          ? Object.values(
              VENDOR_CATEGORIES[vendor.category]?.subs || {},
            ).find((subKey, idx) => {
              const keys = Object.keys(
                VENDOR_CATEGORIES[vendor.category]?.subs || {},
              );
              return keys[idx] === vendor.subcategory;
            }) || vendor.subcategory
          : null;
        return (
          <div
            key={vendor.id}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg cursor-pointer group"
            onClick={() => onSelect(vendor)}
          >
            <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
              {vendor.portfolio?.[0] && (
                <img
                  src={vendor.portfolio[0]}
                  alt={vendor.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              )}
              {vendor.category &&
                VENDOR_CATEGORIES[vendor.category] && (
                  <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
                    {VENDOR_CATEGORIES[vendor.category].icon}{' '}
                    {VENDOR_CATEGORIES[vendor.category].label}
                  </div>
                )}
            </div>
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-1 truncate">
                {vendor.name}
              </h3>
              {subLabel && (
                <div className="text-xs text-slate-500 mb-2 truncate">
                  {subLabel}
                </div>
              )}
              <div className="flex justify-between items-center border-t border-slate-100 pt-4">
                <span className="font-black text-rose-600">{vendor.price}</span>
                <span className="text-sm font-bold text-slate-900 bg-slate-100 px-4 py-2 rounded-lg flex items-center gap-1">
                  查看作品集 <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
