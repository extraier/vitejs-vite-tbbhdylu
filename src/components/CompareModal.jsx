// CompareModal — side-by-side comparison of up to 3 favorited vendors.
//
// Appears as a full-screen modal when the user has selected 2-3
// vendors in the favorites view's compare mode. Renders a 1-3 column
// grid (auto-fits: 1 col for 1 vendor, 2 for 2, 3 for 3).
//
// Columns:
//   - Image (+ featured badge + heart to unfavorite)
//   - Name + rating
//   - Price range
//   - Category + sub-category
//   - Description
//   - Tags
//
// Action bar (header right):
//   - 📄 儲存為圖片  — exports the columns grid as a PNG via
//                       html2canvas-pro. CORS-friendly (proxies
//                       portfolio images, no proxy required for
//                       unsplash and similar public CDNs that send
//                       CORS headers).
//   - × close
//
// Closing: × + ESC + click backdrop.

import { useEffect, useRef, useState } from 'react';
import { X, Star, Heart, Download, Loader2 } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../lib/config';
import { formatVendorPrice } from '../lib/format';

// Lazy-import html2canvas-pro so the heavy bundle is not in the
// initial chunk unless the user opens compare. The library is
// named 'html2canvas-pro' on npm.
async function loadHtml2Canvas() {
  const mod = await import('html2canvas-pro');
  return mod.default || mod;
}

export function CompareModal({ vendors, onClose, onToggleFavorite, favoriteIds }) {
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cols = Math.max(2, Math.min(3, vendors.length));

  async function handleExport() {
    if (!exportRef.current || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const html2canvas = await loadHtml2Canvas();
      const node = exportRef.current;
      const canvas = await html2canvas(node, {
        // Render at 2x for crisp output on retina + better print quality.
        scale: 2,
        // Use the actual node background; falls back to white if unset.
        backgroundColor: '#ffffff',
        // CORS-friendly: html2canvas-pro sets `crossOrigin="anonymous"`
        // on the relevant elements so cross-origin images don't taint
        // the canvas.
        useCORS: true,
        // Allow the bitmap to be larger than the viewport (we typically
        // only render up to 3 columns which fits, but this is a safety
        // net).
        windowWidth: Math.max(node.offsetWidth, 1024),
        // Lower the chance of image flickering in the captured frame.
        logging: false,
      });
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png', 0.95),
      );
      if (!blob) {
        throw new Error('toBlob produced null — try a smaller scale');
      }
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `SaveTheDay-compare-${ts}.png`;
      // Mobile-friendly path: Web Share API can handoff the file.
      const file = new File([blob], filename, { type: 'image/png' });
      if (
        typeof navigator !== 'undefined' &&
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            title: 'Save The Day — 商戶比較',
            text: '商戶比較結果 🛍️',
          });
          return;
        } catch (_) {
          // User cancelled or share failed — fall back to download.
        }
      }
      // Desktop path: anchor.click() to trigger download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('PNG export failed:', e?.message || e);
      setExportError(e?.message || '匯出失敗');
    } finally {
      setExporting(false);
    }
  }

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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${
                exporting
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-600'
              }`}
              title="將商戶比較結果儲存為 PNG 圖片"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {exporting ? '匯出中...' : '儲存為圖片'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="關閉比較"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inline export-error toast — non-blocking, dismissable */}
        {exportError && (
          <div className="bg-rose-50 text-rose-700 text-sm px-6 py-2 border-b border-rose-100 flex items-center justify-between gap-2">
            <span>⚠ {exportError}</span>
            <button
              type="button"
              onClick={() => setExportError(null)}
              className="text-rose-400 hover:text-rose-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Columns — `exportRef` wraps the renderable content so the
            PNG export only includes the columns (not the modal close
            button), with no truncation. */}
        <div className="flex-1 overflow-auto p-6">
          <div ref={exportRef} className="bg-white">
            <div className="px-2 pb-3 text-center border-b border-slate-100 mb-4">
              <div className="inline-flex items-center gap-2 text-slate-800">
                <span className="text-base font-black">📍 Save The Day</span>
                <span className="text-xs text-slate-400">商戶比較結果</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {new Date().toLocaleDateString('zh-HK', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
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
                  exportMode
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorColumn({ vendor, onToggleFavorite, isFavorited, exportMode }) {
  const catConfig = VENDOR_CATEGORIES[vendor.category];
  const subLabel = vendor.subcategory
    ? catConfig?.subs?.[vendor.subcategory]
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      {/* Image */}
      <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
        {vendor.portfolio?.[0] && (
          // crossOrigin=anonymous helps html2canvas-pro read the
          // pixels of cross-origin portraits without tainting the
          // canvas (e.g. images.unsplash.com).
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={vendor.portfolio[0]}
            alt={vendor.name}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        )}
        {vendor.featured && (
          <div className="absolute top-3 left-3 bg-amber-100/95 backdrop-blur-sm text-amber-700 rounded-full px-2.5 py-1 text-[11px] font-black shadow-sm flex items-center gap-1">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            推薦
          </div>
        )}
        {/* The heart inside the column is hidden during export so the
            final PNG looks clean. We let the bottom-of-modal CTA on
            the favorites view toggle hearts instead. */}
        {!exportMode && onToggleFavorite && (
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
        {/* Name + rating */}
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

        <CompareRow label="價錢">
          <span className="font-black text-rose-600 text-base">
            {formatVendorPrice(vendor)}
          </span>
        </CompareRow>

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

        <CompareRow label="簡介">
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-6">
            {vendor.description || '—'}
          </p>
        </CompareRow>

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
