// CompareModal — side-by-side comparison of up to 3 favorited vendors.
//
// Appears as a full-screen modal when the user has selected 2-3
// vendors in the favorites view's compare mode. Renders a 3-column
// grid (or 2 if only 2 picked; 1 if only 1 — but the UI gates to
// ≥ 2 before opening).
//
// Columns:
//   - Header (name + heart to unfavorite)
//   - Portfolio (single image, lg, square crops acceptable)
//   - Price range (uses formatVendorPrice if available else legacy .price)
//   - Category + sub-category pills
//   - Rating (star + number)
//   - Description (verbatim)
//   - Tags (chips)
//
// Closing: × top-right + ESC + click backdrop.

import { useEffect } from 'react';
import { X, Star, Heart } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../lib/config';
import { formatVendorPrice } from '../lib/format';

export function CompareModal({ vendors, onClose, onToggleFavorite, favoriteIds }) {
  // Esc-to-close. Single-purpose effect for an ephemeral modal.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cols = Math.max(2, Math.min(3, vendors.length));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl w-full max-w-6xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-xl font-black text-slate-800">
            📊 商戶比較
            <span className="ml-2 text-sm font-bold text-slate-500">
              ({vendors.length}/{cols})
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            aria-label="關閉比較"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Columns */}
        <div className="flex-1 overflow-auto p-6">
          <div
            className={`grid gap-6 ${
              vendors.length === 1
                ? 'grid-cols-1'
                : vendors.length === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 md:grid-cols-3'
            }`}
          >
            {vendors.map((v) => (
              <VendorColumn
                key={v.id}
                vendor={v}
                onToggleFavorite={onToggleFavorite}
                isFavorited={favoriteIds?.has(v.id) || false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorColumn({ vendor, onToggleFavorite, isFavorited }) {
  const catConfig = VENDOR_CATEGORIES[vendor.category];
  const subLabel = vendor.subcategory
    ? catConfig?.subs?.[vendor.subcategory]
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      {/* Image */}
      <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
        {vendor.portfolio?.[0] && (
          <img
            src={vendor.portfolio[0]}
            alt={vendor.name}
            className="w-full h-full object-cover"
          />
        )}
        {vendor.featured && (
          <div className="absolute top-3 left-3 bg-amber-100/95 backdrop-blur-sm text-amber-700 rounded-full px-2.5 py-1 text-[11px] font-black shadow-sm flex items-center gap-1">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            推薦
          </div>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(vendor)}
            className={`absolute top-3 right-3 w-9 h-9 rounded-full shadow-sm flex items-center justify-center transition-all ${
              isFavorited
                ? 'bg-rose-500 text-white'
                : 'bg-white/90 backdrop-blur-sm text-slate-400'
            }`}
            aria-label={isFavorited ? '從最愛移除' : '加入最愛'}
          >
            <Heart className={`w-4 h-4 ${isFavorited ? 'fill-white' : ''}`} />
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Name + close-remove */}
        <div>
          <h4 className="text-lg font-black text-slate-800 leading-tight">
            {vendor.name}
          </h4>
          {vendor.rating ? (
            <span className="inline-flex items-center gap-1 text-sm text-amber-600 mt-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {vendor.rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        {/* Price */}
        <CompareRow label="價錢">
          <span className="font-black text-rose-600 text-base">
            {formatVendorPrice(vendor)}
          </span>
        </CompareRow>

        {/* Category + subcategory */}
        <CompareRow label="分類">
          {catConfig ? (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 text-sm font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                {catConfig.icon} {catConfig.label}
              </span>
              {subLabel && (
                <div className="text-xs text-slate-500">{subLabel}</div>
              )}
            </div>
          ) : (
            <span className="text-slate-400 text-sm">—</span>
          )}
        </CompareRow>

        {/* Description */}
        <CompareRow label="簡介">
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-6">
            {vendor.description || '—'}
          </p>
        </CompareRow>

        {/* Tags */}
        {Array.isArray(vendor.tags) && vendor.tags.length > 0 && (
          <CompareRow label="標籤">
            <div className="flex flex-wrap gap-1">
              {vendor.tags.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full"
                >
                  {t}
                </span>
              ))}
            </div>
          </CompareRow>
        )}
      </div>
    </div>
  );
}

function CompareRow({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
