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
//   - 🖨️ 列印 / 儲存為 PDF  — uses the browser's native
//     window.print(). The @media print stylesheet at the bottom
//     of this file hides everything except the export content,
//     so the operator gets a clean printable view that they
//     can either send to a printer or "Save as PDF" via the
//     browser's print dialog.
//   - × close
//
// Closing: × + ESC + click backdrop.
//
// 2026-09-20 — V2 #2 follow-up #3: removed html2canvas-pro + jspdf
// (200 KB gz combined). Replaced the two export buttons (PNG, PDF)
// with a single "列印 / 儲存為 PDF" button that uses window.print().
// Same operator outcome (a file on disk they can email / share),
// zero JS bundle cost on the open path.

import { useEffect, useRef, useState } from 'react';
import { X, Star, Heart, Printer, Loader2 } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../lib/config';
import { formatVendorPrice } from '../lib/format';

export function CompareModal({ vendors, onClose, onToggleFavorite, favoriteIds }) {
  const printRef = useRef(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cols = Math.max(2, Math.min(5, vendors.length));

  // Print flow:
  //   1. Set body class — `.printing-compare` triggers the @media
  //      print rules in the embedded stylesheet (hides everything
  //      except the printRef content; forces white background;
  //      removes backdrop blur).
  //   2. window.print() is synchronous-ish; modern browsers fire
  //      `afterprint` when the dialog closes.
  //   3. We tear the body class down on afterprint so the next
  //      render is back to screen layout. Fallback cleanup: a
  //      setTimeout(1500) clears the class even if afterprint
  //      never fires (some mobile browsers, private windows).
  //
  // Why this is faster than html2canvas:
  //   - Browser print pipeline is native; ~50ms to render the
  //     print preview vs 1-3s for the canvas-based PNG.
  //   - No canvas conversion, no CORS proxy dance, no image
  //     re-encoding. The print subsystem renders the DOM as-is.
  //   - Output quality matches screen resolution at any DPI.
  function handlePrint() {
    if (printing) return;
    setPrinting(true);
    document.body.classList.add('printing-compare');
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-compare');
      setPrinting(false);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    // Safety net — see comment above.
    setTimeout(cleanup, 1500);
    try {
      window.print();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('print failed:', e?.message || e);
      cleanup();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl w-full max-w-6xl xl:max-w-[1500px] 2xl:max-w-[1700px] shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-hidden flex flex-col"
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
            <PrintButton
              onClick={handlePrint}
              printing={printing}
            />
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

        {/* Columns — `printRef` wraps the renderable content so the
            print stylesheet can target it via `body.printing-compare
            #compare-print-root`. */}
        <div className="flex-1 overflow-auto p-6">
          <div
            id="compare-print-root"
            ref={printRef}
            className="bg-white"
          >
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
                  : vendors.length === 3
                  ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                  : vendors.length === 4
                  ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5'
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

      {/* Print stylesheet — keeps the modal layout intact on screen
          but, when `body.printing-compare` is set by handlePrint(),
          hides everything except the compare-print-root and forces
          white background. Loaded inline so it ships with the lazy
          CompareModal chunk, no extra HTTP request. */}
      <style>{`
        @media print {
          body.printing-compare * {
            visibility: hidden !important;
          }
          body.printing-compare #compare-print-root,
          body.printing-compare #compare-print-root * {
            visibility: visible !important;
          }
          body.printing-compare #compare-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: white !important;
            padding: 12mm !important;
          }
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
        }
      `}</style>
    </div>
  );
}

function VendorColumn({ vendor, onToggleFavorite, isFavorited }) {
  const catConfig = VENDOR_CATEGORIES[vendor.category];
  const subLabel = vendor.subcategory
    ? catConfig?.subs?.[vendor.subcategory]
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white print:break-inside-avoid">
      {/* Image */}
      <div className="h-48 w-full overflow-hidden bg-slate-100 relative print:h-32">
        {vendor.portfolio?.[0] && (
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
        {/* The heart is hidden during print so the output looks
            clean. We let the bottom-of-modal CTA on the favorites
            view toggle hearts instead. */}
        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(vendor)}
            className={`absolute top-3 right-3 w-9 h-9 rounded-full shadow-sm flex items-center justify-center transition-all print:hidden ${
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
              {vendor.ratingCount ? (
                <span className="text-slate-400 ml-0.5">
                  ({vendor.ratingCount} 個評分)
                </span>
              ) : null}
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

// Single print button — replaces the previous PNG + PDF buttons.
// Operator clicks → browser print dialog opens → choose "Save as
// PDF" destination (Chrome / Safari / Edge all support this) →
// file lands on disk. Same outcome as before, zero JS bundle cost.
function PrintButton({ onClick, printing }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={printing}
      title="列印 / 儲存為 PDF（瀏覽器原生列印對話框）"
      aria-label="列印 / 儲存為 PDF"
      data-testid="compare-print-btn"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${
        printing
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait'
          : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-600'
      }`}
    >
      {printing ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Printer className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">
        {printing ? '列印中...' : '列印 / PDF'}
      </span>
    </button>
  );
}
