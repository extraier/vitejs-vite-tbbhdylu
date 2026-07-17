// DiscoverDirectory — the 🔍 商戶指南 page.
//
// 2026-07-17 — Brought on parity with the canonical VENDOR_CATEGORIES
// hierarchical taxonomy in src/lib/config.ts. Two-tier UX:
//
//   1. Default view (filter === 'all'): 13 top-level category cards
//      with sub-category breakdown text + a search box across vendor
//      names + descriptions + tags.
//
//   2. Drilldown (filter === '<topKey>' OR '<topKey>.<subKey>'):
//      sub-category chips across the top + filtered vendor grid.
//
// 2026-07-17 — Search + sub-category labels on category cards.
//   Search state is local (useState) so navigation between filter
//   states doesn't carry stale queries. To clear search: clear the
//   input AND set the filter back to 'all' (handled in the empty-state
//   button below).
//
// Filter encoding (sent up to App.jsx via onFilterChange):
//   'all'                                  → all vendors
//   '<topKey>'                             → top-level match
//   '<topKey>.<subKey>'                    → top-level + sub match

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, Search, X } from 'lucide-react';
import { trackVendorView, trackVendorClick } from '../lib/vendorAnalytics';
import {
  VENDOR_CATEGORIES,
  getVendorCategoryLabel,
} from '../lib/config';

function isSubMatch(filter) {
  return filter && filter.includes('.');
}

// Lowercase + trim a free-text value; tolerant of undefined.
function norm(s) {
  return (s || '').toLowerCase().trim();
}

// Concatenates vendor name + description + tags into one search blob,
// lowercased once. Used by the search filter.
function searchText(v) {
  const tags = Array.isArray(v.tags) ? v.tags.join(' ') : '';
  return `${norm(v.name)} ${norm(v.description)} ${norm(tags)}`;
}

export function DiscoverDirectory({
  vendors,
  filter,
  onFilterChange,
  onViewProfile,
  user,
}) {
  // Local search state. Reset whenever the user enters a drilldown
  // or returns to the default view — controlled by a key prop on
  // the input we re-mount via filter-change handler.
  const [search, setSearch] = useState('');

  // Compute filtered + search-narrowed vendor list.
  const filtered = useMemo(() => {
    // Hide pending vendors from the public directory.
    const visible = vendors.filter((v) => v.status !== 'pending');

    // First narrow by category/subcategory if filter is set.
    let narrowed = visible;
    if (filter && filter !== 'all') {
      if (isSubMatch(filter)) {
        const [top, sub] = filter.split('.');
        narrowed = narrowed.filter(
          (v) => v.category === top && v.subcategory === sub,
        );
      } else {
        narrowed = narrowed.filter((v) => v.category === filter);
      }
    }

    // Then narrow by search. Match against name + description + tags,
    // case-insensitive. Empty search passes everything through.
    const q = norm(search);
    if (q) {
      narrowed = narrowed.filter((v) => searchText(v).includes(q));
    }

    return narrowed;
  }, [filter, vendors, search]);

  // Per-category + per-subcategory counts for the pill labels and the
  // default-view category cards.
  const counts = useMemo(() => {
    const visible = vendors.filter((v) => v.status !== 'pending');
    const topCounts = {};
    const subCounts = {};
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

  // Track one view per (vendor, filter, session). Dedupe by a string key
  // so a vendor seen in two filters fires two events (analytics-correct).
  const viewedRef = useRef(new Set());
  useEffect(() => {
    const newlyViewed = filtered.filter((v) => {
      const k = `${filter || 'all'}:${search.trim()}:${v.id}`;
      return !viewedRef.current.has(k);
    });
    if (newlyViewed.length === 0) return;
    newlyViewed.forEach((v) => {
      viewedRef.current.add(`${filter || 'all'}:${search.trim()}:${v.id}`);
      trackVendorView(v, user);
    });
  }, [filtered, user, filter, search]);

  const handleClick = (vendor) => {
    trackVendorClick(vendor, user);
    onViewProfile(vendor);
  };

  const inCategory = filter && filter !== 'all' && !isSubMatch(filter);
  const inSub = isSubMatch(filter);
  const isDrilldown = inCategory || inSub;
  const totalCategories = Object.keys(VENDOR_CATEGORIES).length;
  const visibleCount = filtered.length;

  // Reset search when navigating between filter states so the user
  // doesn't carry over a stale query (e.g. when they go back via the
  // "← 全部類別" link). Caller-driven via onFilterChange wrapping.
  function setFilterWithSearchReset(next) {
    setSearch('');
    onFilterChange(next);
  }

  return (
    <div className="max-w-7xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-black text-slate-800 mb-4">
          {isDrilldown ? (
            <button
              type="button"
              onClick={() => setFilterWithSearchReset('all')}
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
            : `${counts.total} 個認證商戶，分 ${totalCategories} 大類`}
        </p>
      </div>

      {/* Default view: 13 category cards */}
      {!isDrilldown && (
        <>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="搜尋商戶名稱、描述或標籤..."
          />
          <CategoryGrid
            counts={counts}
            subCounts={counts.subCounts}
            onCardClick={(topKey) => setFilterWithSearchReset(topKey)}
          />
          {/* If a search returned no rows in 'all' mode, surface that
              clearly so the user knows to clear it. */}
          {search && visibleCount === 0 && (
            <SearchEmpty onClear={() => setSearch('')} query={search} />
          )}
        </>
      )}

      {/* Drilldown view: sub-category chips + filtered vendor grid */}
      {isDrilldown && (
        <>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="搜尋此類別商戶..."
          />
          <SubCategoryChips
            topKey={inSub ? filter.split('.')[0] : filter}
            currentFilter={filter}
            onFilterChange={(next) => {
              // Keep search across category-switches within the
              // drilldown — it's a relevant query. Only clear when
              // going back to the default view.
              onFilterChange(next);
            }}
            subCounts={counts.subCounts}
          />
          <VendorGrid
            vendors={filtered}
            onSelect={handleClick}
            emptyMessage={
              search
                ? `冇商戶同時符合「${filter}」同「${search}」。`
                : '呢個分類暫時未有商戶，試下其他分類啦！'
            }
          />
        </>
      )}
    </div>
  );
}

// Search input box, accessible + keyboard-friendly.
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="relative max-w-xl mx-auto mb-8">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-11 pr-10 py-3 rounded-full border border-slate-200 bg-white text-sm font-medium focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 outline-none transition-shadow"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
          aria-label="清除搜尋"
          title="清除搜尋"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Default-view grid: 13 top-level categories with sub-category
// breakdown text per card.
function CategoryGrid({ counts, subCounts, onCardClick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Object.entries(VENDOR_CATEGORIES).map(([topKey, cfg]) => {
        const count = counts.topCounts[topKey] || 0;
        const subs = Object.entries(cfg.subs);
        const subItems = subCounts[topKey] || {};
        const visibleSubs = subs
          .filter(([subKey]) => (subItems[subKey] || 0) > 0)
          .slice(0, 3); // cap at 3 subcategory lines so cards stay compact
        const remainingSubs =
          subs.length - visibleSubs.length;
        return (
          <button
            key={topKey}
            type="button"
            onClick={() => onCardClick(topKey)}
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
            <div className="text-xs text-slate-500 mb-2">
              {count === 0
                ? '尚未有商戶'
                : `${count} 個商戶`}
            </div>
            {/* Sub-category breakdown — shows what's available within
                this category without forcing a click. Capped at 3 lines
                + an "+N 個" overflow indicator to keep cards compact
                on mobile. */}
            {visibleSubs.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
                {visibleSubs.map(([subKey, subLabel]) => (
                  <li key={subKey} className="flex justify-between gap-1">
                    <span className="truncate">{subLabel}</span>
                    <span className="text-slate-400 font-bold flex-shrink-0">
                      {subItems[subKey]}
                    </span>
                  </li>
                ))}
                {remainingSubs > 0 && (
                  <li className="text-slate-400 italic">
                    +{remainingSubs} 個分類...
                  </li>
                )}
              </ul>
            )}
            {count > 0 && (
              <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 absolute top-4 right-4 transition-colors" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Renders sub-category chips for the active top-level category, plus
// an "全部" chip that resets the filter to the top-level only.
function SubCategoryChips({ topKey, currentFilter, onFilterChange, subCounts }) {
  const cfg = VENDOR_CATEGORIES[topKey];
  if (!cfg) return null;
  const subs = Object.entries(cfg.subs);
  const activeSub = isSubMatch(currentFilter)
    ? currentFilter.split('.')[1]
    : null;
  const topCount = subCounts[topKey]
    ? Object.values(subCounts[topKey]).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2 justify-center">
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

// Card grid for vendors in a (sub-)category view.
function VendorGrid({ vendors, onSelect, emptyMessage }) {
  if (vendors.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
        <p className="text-slate-500">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {vendors.map((vendor) => {
        // Look up sub-category label without needing to import
        // VENDOR_CATEGORIES twice — done via local lookup.
        const subLabel = vendor.subcategory
          ? VENDOR_CATEGORIES[vendor.category]?.subs?.[vendor.subcategory]
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
                <span className="font-black text-rose-600">
                  {vendor.price}
                </span>
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

// Empty-state shown when a search returns nothing in the default view.
function SearchEmpty({ onClear, query }) {
  return (
    <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 mt-2">
      <p className="text-slate-500 mb-3">
        「{query}」搵唔到任何商戶。
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-sm font-bold text-emerald-600 hover:text-emerald-700 underline"
      >
        清除搜尋
      </button>
    </div>
  );
}
