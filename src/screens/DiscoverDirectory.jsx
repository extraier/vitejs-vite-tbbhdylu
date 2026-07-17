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
// 2026-07-17 — Round 2:
//   - Sort dropdown (5 modes), featured badge, ⭐ 推薦 boost,
//     ❤️ favorites (heart on every card + dedicated filter chip).
//
// 2026-07-17 — Round 3:
//   - Multi-select category cards in default view. Click any
//     combination of category cards to OR-filter vendors across
//     more than one category at a time.
//   - '📊 比較模式' toggle in favorites view. Add up to 3
//     vendors to a comparison tray, then '📊 比較 (N/3)' button
//     opens a side-by-side <CompareModal/>.
//   - '📤 分享商戶列表' chip — exports a WhatsApp-friendly text
//     message via navigator.share (mobile) or clipboard (desktop).
//   - '✅ 已選 N 個分類' (multi-select) and '🛒 比較 (N/3)'
//     (compare tray) sticky bottom tray — light dismissable
//     action bar.
//
// Filter encoding (sent up to App.jsx via onFilterChange):
//   'all'                       → all vendors
//   'favorites'                 → only favorites
//   '<topKey>'                  → top-level match
//   '<topKey>.<subKey>'         → top-level + sub
//
// Local state (not lifted to App.jsx):
//   search           text query
//   sortMode         5-mode dropdown
//   selectedCats     Set<topKey> for multi-select in default view
//   compareMode      boolean — when in favorites view, allow + vendors
//   compareTray      string[] (vendor ids; up to 3)

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Heart,
  Search,
  Share2,
  Star,
  X,
  ShoppingBag,
  BarChart3,
} from 'lucide-react';
import { trackVendorView, trackVendorClick } from '../lib/vendorAnalytics';
import {
  VENDOR_CATEGORIES,
  getVendorCategoryLabel,
} from '../lib/config';
import { parseFormattedNumber } from '../lib/format';
import { CompareModal } from '../components/CompareModal';
import { shareOrCopyShortlist } from '../lib/vendorShare';
import { useLongPressRegistry } from '../lib/useLongPress';

function isSubMatch(filter) {
  return filter && filter.includes('.');
}

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
    const aFeat = a.featured ? 1 : 0;
    const bFeat = b.featured ? 1 : 0;
    if (aFeat !== bFeat) return bFeat - aFeat;
    return primary(a) - primary(b);
  };
}

function norm(s) {
  return (s || '').toLowerCase().trim();
}

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
  favoriteIds,
  onToggleFavorite,
}) {
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('recommended');
  // Multi-select category cards in default view. Cleared when entering
  // a drilldown or favorites view.
  const [selectedCats, setSelectedCats] = useState(() => new Set());
  // Compare mode lives only in the favorites view. The tray is up to 3 ids.
  const [compareMode, setCompareMode] = useState(false);
  const [compareTray, setCompareTray] = useState(() => new Set());
  const [showCompareModal, setShowCompareModal] = useState(false);
  // Local toast for "shortlist copied!" feedback after shareOrCopy.
  const [actionToast, setActionToast] = useState(null);

  const favoriteSet = useMemo(() => favoriteIds || new Set(), [favoriteIds]);

  // Compute filtered + search-narrowed + sorted vendor list.
  const filtered = useMemo(() => {
    const visible = vendors.filter((v) => v.status !== 'pending');
    let narrowed = visible;

    // 1) Category / subcategory narrowing (except pseudo-filters).
    if (
      filter &&
      filter !== 'all' &&
      filter !== 'favorites' &&
      filter !== 'selected'
    ) {
      if (isSubMatch(filter)) {
        const [top, sub] = filter.split('.');
        narrowed = narrowed.filter(
          (v) => v.category === top && v.subcategory === sub,
        );
      } else {
        narrowed = narrowed.filter((v) => v.category === filter);
      }
    }

    // 2) Multi-select chip set (only when the 'selected' pseudo-filter
    //    is active). OR semantics: vendor passes if category is in set.
    if (filter === 'selected') {
      narrowed = narrowed.filter((v) => selectedCats.has(v.category));
    }

    // 3) Favorites pseudo-filter.
    if (filter === 'favorites') {
      narrowed = narrowed.filter((v) => favoriteSet.has(v.id));
    }

    // 4) Text search.
    const q = norm(search);
    if (q) {
      narrowed = narrowed.filter((v) => searchText(v).includes(q));
    }

    const sorter = buildSorter(sortMode);
    return [...narrowed].sort(sorter);
  }, [filter, vendors, search, sortMode, favoriteSet, selectedCats]);

  // Counts across both category cards and per-subcategory chips.
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

  // Vendor list scoped to compare tray (in modal). Recomputed when the
  // tray changes so the modal always sees the latest ids.
  const compareVendors = useMemo(() => {
    return [...compareTray]
      .map((id) => vendors.find((v) => v.id === id))
      .filter(Boolean);
  }, [compareTray, vendors]);

  // Auto-clear compare mode + tray when leaving favorites view.
  useEffect(() => {
    if (filter !== 'favorites') {
      setCompareMode(false);
      setCompareTray(new Set());
      setShowCompareModal(false);
    }
  }, [filter]);

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

  // ----- Category multi-select helpers -----
  function toggleCat(topKey) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(topKey)) next.delete(topKey);
      else next.add(topKey);
      return next;
    });
  }
  function clearCats() {
    setSelectedCats(new Set());
  }
  function applySelected() {
    onFilterChange('selected');
  }

  // ----- Compare tray helpers -----
  function toggleCompare(vendorId) {
    setCompareTray((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        if (next.size >= 3) return prev; // cap at 3
        next.add(vendorId);
      }
      return next;
    });
  }

  // ----- Share shortlist -----
  // Always operates on the currently-visible vendor list (filter +
  // search context). On the favorites view this is the favorited
  // set; in default view it's the search-narrowed set.
  async function handleShare() {
    if (filtered.length === 0) {
      setActionToast('未有可分享嘅商戶');
      setTimeout(() => setActionToast(null), 2200);
      return;
    }
    const userName =
      (user && (user.displayName || user.email?.split('@')[0])) || '';
    await shareOrCopyShortlist(filtered, userName);
    setActionToast(
      navigator.share ? '✓ 已開啟分享面板' : '✓ 商戶列表已複製到剪貼簿',
    );
    setTimeout(() => setActionToast(null), 2200);
  }

  const inCategory = filter && !['all', 'favorites', 'selected'].includes(filter) && !isSubMatch(filter);
  const inSub = isSubMatch(filter);
  const inFavorites = filter === 'favorites';
  const inMultiSelect = filter === 'selected';
  const isDrilldown =
    !!filter && !['all', 'favorites', 'selected'].includes(filter);

  function setFilterWithSearchReset(next) {
    setSearch('');
    setSelectedCats(new Set());
    onFilterChange(next);
  }

  const totalCategories = Object.keys(VENDOR_CATEGORIES).length;
  const visibleCount = filtered.length;
  const hasAnySelection = selectedCats.size > 0;
  const isComparing = compareMode && compareTray.size >= 2;

  return (
    <div className="max-w-7xl mx-auto mt-8 mb-32 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-black text-slate-800 mb-4">
          {isDrilldown || inFavorites || inMultiSelect ? (
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
          {inFavorites
            ? '我哋嘅心水商戶'
            : inMultiSelect
            ? `已選 ${selectedCats.size} 個類別，商戶總數：${visibleCount}`
            : inSub
            ? filter.replace('.', ' › ')
            : inCategory
            ? VENDOR_CATEGORIES[filter]?.label || ''
            : `${counts.total} 個認證商戶，分 ${totalCategories} 大類`}
        </p>
      </div>

      {/* Toolbar — search + sort */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6 max-w-3xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              inFavorites
                ? '搜尋我嘅最愛商戶...'
                : inMultiSelect
                ? '喺已選類別入面搜尋...'
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

      {/* Action chips — favorites + share + (compare, only in favorites view) */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        <button
          type="button"
          onClick={() =>
            inFavorites ? setFilterWithSearchReset('all') : onFilterChange('favorites')
          }
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all ${
            inFavorites
              ? 'bg-rose-100 text-rose-600 border border-rose-300 shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-rose-300 hover:text-rose-600'
          }`}
        >
          <Heart
            className={`w-4 h-4 ${
              inFavorites ? 'fill-rose-500 text-rose-500' : ''
            }`}
          />
          我的最愛
          {counts.favorites > 0 && (
            <span className="ml-1 text-xs opacity-70">({counts.favorites})</span>
          )}
        </button>

        {/* Share — visible in all views except strict drilldown (we
            still let users share from default + favorites + multi). */}
        {!isDrilldown && (
          <button
            type="button"
            onClick={handleShare}
            disabled={filtered.length === 0}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all border ${
              filtered.length === 0
                ? 'bg-slate-50 text-slate-300 cursor-not-allowed border-slate-100'
                : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-600'
            }`}
            title="複製現時顯示嘅商戶列表到剪貼簿/分享到其他 apps"
          >
            <Share2 className="w-4 h-4" />
            分享商戶列表
            {filtered.length > 0 && (
              <span className="ml-1 text-xs opacity-70">
                ({filtered.length})
              </span>
            )}
          </button>
        )}

        {/* Compare toggle — only in favorites view. */}
        {inFavorites && counts.favorites >= 2 && (
          <button
            type="button"
            onClick={() => setCompareMode((m) => !m)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all border ${
              compareMode
                ? 'bg-indigo-100 text-indigo-700 border-indigo-300 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            比較模式
            {compareTray.size > 0 && (
              <span className="ml-1 text-xs opacity-70">
                ({compareTray.size}/3)
              </span>
            )}
          </button>
        )}
      </div>

      {/* Default view: 13 category cards */}
      {filter === 'all' && (
        <>
          <CategoryGrid
            counts={counts}
            subCounts={counts.subCounts}
            onCardClick={(topKey) => toggleCat(topKey)}
            onCardDrilldown={(topKey) => setFilterWithSearchReset(topKey)}
            selectedCats={selectedCats}
          />
          {search && visibleCount === 0 && (
            <SearchEmpty onClear={() => setSearch('')} query={search} />
          )}
          {/* Tip line under the grid so users discover the long-press
              gesture. Hidden once they've favorited any vendors (no
              need to remind). */}
          {counts.favorites === 0 && (
            <p className="text-center text-xs text-slate-400 mt-6">
              💡 <span className="hidden md:inline">右撳 / </span>
              長按商戶分類卡片直接進入（短撳係加入選擇）
            </p>
          )}
        </>
      )}

      {/* Multi-select applied view */}
      {inMultiSelect && (
        <>
          <SelectedCategoryChips
            selectedCats={selectedCats}
            onToggle={toggleCat}
            onClear={clearCats}
          />
          <VendorGrid
            vendors={filtered}
            onSelect={handleClick}
            onToggleFavorite={onToggleFavorite}
            favoriteIds={favoriteSet}
            emptyMessage={
              search
                ? `已選類別入面未搵到「${search}」。`
                : '已選類別入面未有商戶。'
            }
          />
        </>
      )}

      {/* Favorites view */}
      {inFavorites && (
        <>
          <div className="text-center mb-4">
            <p className="text-sm text-slate-500">
              {compareMode
                ? '📊 選擇 2-3 個商戶加入比較籃（最多 3 個）'
                : '撳商戶卡片 ❤️ 將佢加入或移出最愛。'}
            </p>
          </div>
          <VendorGrid
            vendors={filtered}
            onSelect={handleClick}
            onToggleFavorite={onToggleFavorite}
            favoriteIds={favoriteSet}
            compareMode={compareMode}
            compareTray={compareTray}
            onToggleCompare={toggleCompare}
            emptyMessage={
              search
                ? `你嘅最愛入面未搵到「${search}」。`
                : '未加入任何最愛商戶 — 喺商戶卡片上面撳 ❤️ 就可以加入!'
            }
          />
        </>
      )}

      {/* Drilldown view: sub-category chips + filtered vendor grid */}
      {isDrilldown && (
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

      {/* ---- Sticky bottom action tray ---- */}
      {/* Multi-select tray — only visible in default view when
          at least one card is selected. Stays out of the way
          until the user picks something. */}
      {filter === 'all' && hasAnySelection && (
        <ActionTray>
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <ShoppingBag className="w-4 h-4 text-emerald-600" />
            已選 {selectedCats.size} 個分類（共{' '}
            {visibleCount} 個商戶）
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearCats}
              className="px-3 py-1.5 rounded-full text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              清除
            </button>
            <button
              type="button"
              onClick={applySelected}
              className="px-4 py-1.5 rounded-full text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors"
            >
              📥 套用到篩選
            </button>
          </div>
        </ActionTray>
      )}

      {/* Compare tray — visible in favorites view + compareMode,
          only when ≥ 2 vendors in the tray. ≤ 3 by design. */}
      {inFavorites && compareMode && compareTray.size >= 2 && (
        <ActionTray>
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            比較籃：{compareTray.size} / 3 個商戶
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareTray(new Set())}
              className="px-3 py-1.5 rounded-full text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              清除
            </button>
            <button
              type="button"
              onClick={() => setShowCompareModal(true)}
              className="px-4 py-1.5 rounded-full text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm transition-colors"
            >
              📊 比較 ({compareTray.size}/3)
            </button>
          </div>
        </ActionTray>
      )}

      {/* Compare modal */}
      {showCompareModal && compareVendors.length >= 2 && (
        <CompareModal
          vendors={compareVendors}
          onClose={() => setShowCompareModal(false)}
          onToggleFavorite={onToggleFavorite}
          favoriteIds={favoriteSet}
        />
      )}

      {/* Tiny toast for share/copy actions */}
      {actionToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur text-white text-sm font-bold rounded-full px-5 py-2.5 shadow-xl animate-in slide-in-from-bottom-4 duration-200">
          {actionToast}
        </div>
      )}
    </div>
  );
}

function ActionTray({ children }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-slate-200 shadow-2xl rounded-full px-5 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-2 duration-200">
      {children}
    </div>
  );
}

// Default-view category grid. Multi-select: clicking a card toggles it.
// Cards stay in-place; selected cards get an emerald ring + check mark.
function CategoryGrid({
  counts,
  subCounts,
  onCardClick,
  onCardDrilldown,
  selectedCats,
}) {
  // Single registry hook generates handlers for any number of cards
  // without violating the Rules of Hooks (no per-element hooks).
  const getPressHandlers = useLongPressRegistry({
    delayMs: 600,
    disableContextMenu: true,
    onLongPress: (topKey) => onCardDrilldown?.(topKey),
  });
  const allTopKeys = Object.keys(VENDOR_CATEGORIES);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {allTopKeys.map((topKey) => {
        const cfg = VENDOR_CATEGORIES[topKey];
        const count = counts.topCounts[topKey] || 0;
        const subs = Object.entries(cfg.subs);
        const subItems = subCounts[topKey] || {};
        const visibleSubs = subs
          .filter(([subKey]) => (subItems[subKey] || 0) > 0)
          .slice(0, 3);
        const remainingSubs = subs.length - visibleSubs.length;
        const isSelected = selectedCats.has(topKey);
        // Long-press: hold ≥600ms to drill directly (skip multi-select).
        // Suppresses the synthetic click that fires on pointerup via
        // onClickCapture so the gesture doesn't accidentally toggle the
        // selection in addition to drilling down.
        const pressHandlers = onCardDrilldown
          ? getPressHandlers(topKey)
          : null;
        return (
          <button
            key={topKey}
            type="button"
            onClick={() => onCardClick(topKey)}
            disabled={count === 0}
            {...(pressHandlers || {})}
            className={`group relative rounded-2xl p-5 text-left transition-all border select-none ${
              count === 0
                ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed'
                : isSelected
                ? 'bg-emerald-50 border-emerald-400 shadow-md cursor-pointer ring-2 ring-emerald-300'
                : 'bg-white border-slate-200 hover:border-emerald-400 hover:shadow-md cursor-pointer'
            }`}
          >
            <div className="text-4xl mb-2">{cfg.icon}</div>
            <div className="font-black text-slate-800 mb-1 text-sm flex items-center gap-1">
              {cfg.label}
              {isSelected && (
                <span className="text-emerald-600 text-xs ml-auto">✓</span>
              )}
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
            {count > 0 && !isSelected && (
              <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 absolute top-4 right-4 transition-colors" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Multi-select applied view header — lists chosen categories as
// dismissible chips, plus a "Clear all" link.
function SelectedCategoryChips({ selectedCats, onToggle, onClear }) {
  if (selectedCats.size === 0) return null;
  return (
    <div className="max-w-4xl mx-auto mb-6">
      <div className="flex flex-wrap gap-2 items-center justify-center">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          已選類別
        </span>
        {[...selectedCats].map((topKey) => {
          const cfg = VENDOR_CATEGORIES[topKey];
          if (!cfg) return null;
          return (
            <button
              key={topKey}
              type="button"
              onClick={() => onToggle(topKey)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-sm font-bold hover:bg-emerald-100 transition-colors"
            >
              {cfg.icon} {cfg.label}
              <X className="w-3 h-3" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-400 hover:text-slate-700 underline ml-2"
        >
          清除全部
        </button>
      </div>
    </div>
  );
}

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

function VendorGrid({
  vendors,
  onSelect,
  onToggleFavorite,
  favoriteIds,
  compareMode,
  compareTray,
  onToggleCompare,
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
        const isCompared = compareTray?.has(vendor.id);
        return (
          <div
            key={vendor.id}
            className={`bg-white rounded-2xl shadow-sm border overflow-hidden cursor-pointer group relative transition-all ${
              compareMode && isCompared
                ? 'border-indigo-400 ring-2 ring-indigo-300'
                : 'border-slate-200 hover:shadow-lg'
            }`}
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
              {vendor.category && VENDOR_CATEGORIES[vendor.category] && (
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
                  {VENDOR_CATEGORIES[vendor.category].icon}{' '}
                  {VENDOR_CATEGORIES[vendor.category].label}
                </div>
              )}
              {vendor.featured && (
                <div className="absolute top-3 right-14 bg-amber-100/95 backdrop-blur-sm text-amber-700 rounded-full px-2.5 py-1 text-[11px] font-black shadow-sm flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  推薦
                </div>
              )}
              {compareMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCompare(vendor.id);
                  }}
                  disabled={
                    !isCompared && (compareTray?.size || 0) >= 3
                  }
                  className={`absolute top-3 right-3 w-9 h-9 rounded-full shadow-sm flex items-center justify-center transition-all ${
                    isCompared
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/90 backdrop-blur-sm text-slate-400 hover:text-indigo-600 hover:bg-white border border-indigo-200'
                  } ${!isCompared && (compareTray?.size || 0) >= 3 ? 'opacity-30 cursor-not-allowed' : ''}`}
                  aria-label={isCompared ? '從比較移除' : '加入比較'}
                  title={isCompared ? '從比較移除' : '加入比較'}
                >
                  {isCompared ? (
                    <span className="font-black text-xs">✓</span>
                  ) : (
                    <span className="font-black text-xs">+</span>
                  )}
                </button>
              )}
              {!compareMode && onToggleFavorite && (
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
                  aria-label={isFavorited ? '從最愛移除' : '加入最愛'}
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
