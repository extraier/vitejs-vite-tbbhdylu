// DiscoverDirectory — the 🔍 商戶指南 page.
//
// 2026-07-17 — Two-tier UX with the canonical VENDOR_CATEGORIES
// hierarchical taxonomy from src/lib/config.ts:
//
//   1. Default view (filter === 'all'): 13 top-level category cards
//      with sub-category breakdown + a search box across vendor
//      names + descriptions + tags.
//
//   2. Drilldown (filter === '<topKey>' OR '<topKey>.<subKey>'):
//      sub-category chips across the top + filtered vendor grid.
//
// 2026-07-17 — Round 2 enhancements:
//   - Sort dropdown (5 modes: ⭐ 推薦, 最高評分, 價格低到高,
//     價格高到低, 最新加入). Sort + search + filter compose.
//   - Featured vendors (vendor.featured === true) get a ⭐ 推薦 badge
//     and float to the top under the default ⭐ 推薦 sort.
//   - ❤️ Favorites — couples can heart any vendor card. Favorites
//     persist in /users/{uid}/favorites/{vendorId} so they survive
//     page reloads + multi-device. A '❤️ 我的最愛' filter chip
//     narrows the grid to favorites only.
//
// Filter encoding (sent up to App.jsx via onFilterChange):
//   'all'                       → all vendors in scope
//   'favorites'                 → only favorites (overrides category
//                                 and is mutually exclusive; uses a
//                                 separate path in the drilldown)
//   '<topKey>'                  → top-level match
//   '<topKey>.<subKey>'         → top-level + sub
//
// Sort encoding (this component only, useState):
//   'recommended'               → featured first, then rating desc
//   'rating'                    → rating desc
//   'price_asc'                 → priceMin asc
//   'price_desc'                → priceMin desc
//   'newest'                    → createdAt desc (falls back to id)

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Heart,
  Search,
  Star,
  X,
} from 'lucide-react';
import { trackVendorView, trackVendorClick } from '../lib/vendorAnalytics';
import {
  VENDOR_CATEGORIES,
  getVendorCategoryLabel,
} from '../lib/config';
import { parseFormattedNumber } from '../lib/format';

function isSubMatch(filter) {
  return filter && filter.includes('.');
}

// Sort modes. Stable comparator chain — featured vendors always
// rank above non-featured, regardless of the chosen sort.
const SORT_MODES = [
  { value: 'recommended', label: '⭐ 推薦' },
  { value: 'rating', label: '最高評分' },
  { value: 'price_asc', label: '價格由低至高' },
  { value: 'price_desc', label: '價格由高至低' },
  { value: 'newest', label: '最新加入' },
];

function getCreatedAtMs(v) {
  if (typeof v.createdAt === 'number') return v.createdAt;
  if (v.createdAt && typeof v.createdAt.toMillis === 'function') {
    return v.createdAt.toMillis();
  }
  if (typeof v.createdAt === 'string') {
    const parsed = Date.parse(v.createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

// Builds a comparator from a sort mode. Featured vendors always come
// first (a stable boost across all sorts), then mode-specific.
function buildSorter(mode) {
  const primary =
    mode === 'rating'
      ? (v) => -1 * (v.rating || 0)
      : mode === 'price_asc'
      ? (v) => parseFormattedNumber(v.price) || Infinity
      : mode === 'price_desc'
      ? (v) => -1 * (parseFormattedNumber(v.price) || 0)
      : mode === 'newest'
      ? (v) => -1 * getCreatedAtMs(v)
      : mode === 'recommended'
      ? (v) => -1 * (v.rating || 0)
      : () => 0;
  return (a, b) => {
    // Feature boost: featured vendors always rank above non-featured.
    const aFeat = a.featured ? 1 : 0;
    const bFeat = b.featured ? 1 : 0;
    if (aFeat !== bFeat) return bFeat - aFeat;
    return primary(a) - primary(b);
  };
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
  // Set of vendor IDs the current couple has favorited. Comes from
  // App.jsx's onSnapshot on /users/<uid>/favorites.
  favoriteIds,
  // Toggle handler passed from App.jsx (writes/clears a doc in
  // /users/<uid>/favorites/<vendorId>). Vendor obj passed in so the
  // caller can snapshot vendorName + category for the doc body.
  onToggleFavorite,
}) {
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('recommended');

  const favoriteSet = useMemo(
    () => favoriteIds || new Set(),
    [favoriteIds],
  );

  // Compute filtered + search-narrowed + sorted vendor list.
  const filtered = useMemo(() => {
    // Hide pending vendors from the public directory.
    const visible = vendors.filter((v) => v.status !== 'pending');

    // 1) Category / subcategory narrowing (except the 'favorites'
    //    pseudo-filter which is a separate path below).
    let narrowed = visible;
    if (filter && filter !== 'all' && filter !== 'favorites') {
      if (isSubMatch(filter)) {
        const [top, sub] = filter.split('.');
        narrowed = narrowed.filter(
          (v) => v.category === top && v.subcategory === sub,
        );
      } else {
        narrowed = narrowed.filter((v) => v.category === filter);
      }
    }

    // 2) Favorites pseudo-filter: only keep vendors the couple has
    //    hearted. This composes with category filtering (e.g. showing
    //    favorites inside 'photo_video').
    if (filter === 'favorites') {
      narrowed = narrowed.filter((v) => favoriteSet.has(v.id));
    }

    // 3) Text search across name + description + tags.
    const q = norm(search);
    if (q) {
      narrowed = narrowed.filter((v) => searchText(v).includes(q));
    }

    // 4) Sort. Stable across re-renders since the comparator is
    //    pure given (mode, featured, rating, price, createdAt, id).
    const sorter = buildSorter(sortMode);
    return [...narrowed].sort(sorter);
  }, [filter, vendors, search, sortMode, favoriteSet]);

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
    return {
      topCounts,
      subCounts,
      total: visible.length,
      favorites: visible.filter((v) => favoriteSet.has(v.id)).length,
    };
  }, [vendors, favoriteSet]);

  // Track one view per (vendor, filter, search, session).
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

  const inCategory = filter && !['all', 'favorites'].includes(filter) && !isSubMatch(filter);
  const inSub = isSubMatch(filter);
  const isDrilldown = !!filter && filter !== 'all'; // includes 'favorites'

  function setFilterWithSearchReset(next) {
    setSearch('');
    onFilterChange(next);
  }

  const totalCategories = Object.keys(VENDOR_CATEGORIES).length;
  const visibleCount = filtered.length;

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
          {filter === 'favorites'
            ? '我哋嘅心水商戶'
            : inSub
            ? filter.replace('.', ' › ')
            : inCategory
            ? VENDOR_CATEGORIES[filter]?.label || ''
            : `${counts.total} 個認證商戶，分 ${totalCategories} 大類`}
        </p>
      </div>

      {/* Toolbar — search + sort row */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-8 max-w-3xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              filter === 'favorites'
                ? '搜尋我嘅最愛商戶...'
                : '搜尋商戶名稱、描述或標籤...'
            }
            className="w-full pl-11 pr-10 py-3 rounded-full border border-slate-200 bg-white text-sm font-medium focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 outline-none transition-shadow"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="清除搜尋"
              title="清除搜尋"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 md:flex-shrink-0">
          <label
            htmlFor="dd-sort"
            className="text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap"
          >
            排序
          </label>
          <select
            id="dd-sort"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="px-3 py-2 rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 outline-none cursor-pointer"
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Favorites filter chip (always visible) */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        <button
          type="button"
          onClick={() =>
            filter === 'favorites'
              ? setFilterWithSearchReset('all')
              : onFilterChange('favorites')
          }
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all ${
            filter === 'favorites'
              ? 'bg-rose-100 text-rose-600 border border-rose-300 shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-rose-300 hover:text-rose-600'
          }`}
        >
          <Heart
            className={`w-4 h-4 ${
              filter === 'favorites' ? 'fill-rose-500 text-rose-500' : ''
            }`}
          />
          我的最愛
          {counts.favorites > 0 && (
            <span className="ml-1 text-xs opacity-70">
              ({counts.favorites})
            </span>
          )}
        </button>
      </div>

      {/* Default view: 13 category cards */}
      {filter === 'all' && (
        <>
          <CategoryGrid
            counts={counts}
            subCounts={counts.subCounts}
            onCardClick={(topKey) => setFilterWithSearchReset(topKey)}
          />
          {search && visibleCount === 0 && (
            <SearchEmpty onClear={() => setSearch('')} query={search} />
          )}
        </>
      )}

      {/* Favorites view */}
      {filter === 'favorites' && (
        <>
          <VendorGrid
            vendors={filtered}
            onSelect={handleClick}
            onToggleFavorite={onToggleFavorite}
            favoriteIds={favoriteSet}
            emptyMessage={
              search
                ? `你嘅最愛入面未搵到「${search}」。`
                : '未加入任何最愛商戶 — 喺商戶卡片上面撳 ❤️ 就可以加入!'
            }
          />
        </>
      )}

      {/* Drilldown view: sub-category chips + filtered vendor grid */}
      {(inCategory || inSub) && (
        <>
          <SubCategoryChips
            topKey={inSub ? filter.split('.')[0] : filter}
            currentFilter={filter}
            onFilterChange={(next) => onFilterChange(next)}
            subCounts={counts.subCounts}
          />
          <VendorGrid
            vendors={filtered}
            onSelect={handleClick}
            onToggleFavorite={onToggleFavorite}
            favoriteIds={favoriteSet}
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

// 13 top-level categories with sub-category breakdown text per card.
function CategoryGrid({ counts, subCounts, onCardClick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Object.entries(VENDOR_CATEGORIES).map(([topKey, cfg]) => {
        const count = counts.topCounts[topKey] || 0;
        const subs = Object.entries(cfg.subs);
        const subItems = subCounts[topKey] || {};
        const visibleSubs = subs
          .filter(([subKey]) => (subItems[subKey] || 0) > 0)
          .slice(0, 3);
        const remainingSubs = subs.length - visibleSubs.length;
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
              {count === 0 ? '尚未有商戶' : `${count} 個商戶`}
            </div>
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

// Sub-category chips for the active top-level category.
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

// Card grid for vendors. Each card has a heart icon (toggle favorite)
// + featured badge (if applicable).
function VendorGrid({
  vendors,
  onSelect,
  onToggleFavorite,
  favoriteIds,
  emptyMessage,
}) {
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
        const subLabel = vendor.subcategory
          ? VENDOR_CATEGORIES[vendor.category]?.subs?.[vendor.subcategory]
          : null;
        const isFavorited = favoriteIds.has(vendor.id);
        return (
          <div
            key={vendor.id}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg cursor-pointer group relative"
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
              {/* Category pill (top-left) */}
              {vendor.category && VENDOR_CATEGORIES[vendor.category] && (
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
                  {VENDOR_CATEGORIES[vendor.category].icon}{' '}
                  {VENDOR_CATEGORIES[vendor.category].label}
                </div>
              )}
              {/* ⭐ 推薦 badge (top-right next to heart) */}
              {vendor.featured && (
                <div className="absolute top-3 right-14 bg-amber-100/95 backdrop-blur-sm text-amber-700 rounded-full px-2.5 py-1 text-[11px] font-black shadow-sm flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  推薦
                </div>
              )}
              {/* Heart toggle (top-right) — separate click target so
                  tapping the heart doesn't open the vendor profile. */}
              {onToggleFavorite && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(vendor);
                  }}
                  className={`absolute top-3 right-3 w-9 h-9 rounded-full shadow-sm flex items-center justify-center transition-all ${
                    isFavorited
                      ? 'bg-rose-500 text-white hover:bg-rose-600'
                      : 'bg-white/90 backdrop-blur-sm text-slate-400 hover:text-rose-500 hover:bg-white'
                  }`}
                  aria-label={
                    isFavorited ? '從最愛移除' : '加入最愛'
                  }
                  title={isFavorited ? '從最愛移除' : '加入最愛'}
                >
                  <Heart
                    className={`w-4 h-4 ${isFavorited ? 'fill-white' : ''}`}
                  />
                </button>
              )}
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-bold text-slate-800 truncate">
                  {vendor.name}
                </h3>
                {vendor.rating ? (
                  <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 flex-shrink-0">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    {vendor.rating.toFixed(1)}
                  </span>
                ) : null}
              </div>
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

function SearchEmpty({ onClear, query }) {
  return (
    <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 mt-2">
      <p className="text-slate-500 mb-3">「{query}」搵唔到任何商戶。</p>
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
