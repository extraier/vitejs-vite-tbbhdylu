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

  const cols = Math.max(2, Math.min(5, vendors.length));

  // Render the exportRef subtree to a canvas using html2canvas-pro.
  // Returns the canvas so the caller can decide whether to encode
  // PNG, add it to a PDF page, or do something else.
  async function renderToCanvas() {
    const html2canvas = await loadHtml2Canvas();
    const node = exportRef.current;
    if (!node) throw new Error('exportRef not mounted');
    return await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: Math.max(node.offsetWidth, 1024),
      logging: false,
    });
  }

  function tsFilename(ext) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `SaveTheDay-compare-${ts}.${ext}`;
  }

  function shareOrDownloadBlob(blob, filename, mime) {
    const file = new File([blob], filename, { type: mime });
    if (
      typeof navigator !== 'undefined' &&
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        // Use IIFE for async/await inside the synchronous path so the
        // caller can `return` early.
        (async () => {
          try {
            await navigator.share({
              files: [file],
              title: 'Save The Day — 商戶比較',
              text: '商戶比較結果 🛍️',
            });
          } catch (_) {
            downloadAnchor(blob, filename);
          }
        })();
        return true;
      } catch (_) {
        // canShare threw — fall through
      }
    }
    return false;
  }

  function downloadAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handlePngExport() {
    if (!exportRef.current || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const canvas = await renderToCanvas();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png', 0.95),
      );
      if (!blob) throw new Error('toBlob 失敗 (try reducing scale)');
      const filename = tsFilename('png');
      const shared = shareOrDownloadBlob(blob, filename, 'image/png');
      if (!shared) downloadAnchor(blob, filename);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('PNG export failed:', e?.message || e);
      setExportError(e?.message || 'PNG 匯出失敗');
    } finally {
      setExporting(false);
    }
  }

  async function handlePdfExport() {
    if (!exportRef.current || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const canvas = await renderToCanvas();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (!dataUrl || dataUrl === 'data:,') {
        throw new Error('toDataURL 失敗 — 圖片可能 CORS 污染');
      }
      // Lazy-load jspdf so the heavy bundle isn't in the initial chunk.
      const { jsPDF } = await import('jspdf');
      // Match canvas aspect ratio: jpeg dimensions
      const w = canvas.width;
      const h = canvas.height;
      // A4 landscape — but we want the PDF page to fit the comparison
      // image regardless of orientation. Use the image's intrinsic
      // width / 2 (canvas is at 2x scale) as the page width in mm,
      // and proportion the height similarly.
      const pageWidthMm = Math.min(420, Math.max(180, w / 4)); // cap so it fits landscape A4
      const pageHeightMm = (h / w) * pageWidthMm;
      const orientation =
        pageWidthMm > pageHeightMm ? 'landscape' : 'portrait';
      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format: [pageWidthMm, pageHeightMm],
      });
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
      const blob = pdf.output('blob');
      const filename = tsFilename('pdf');
      const shared = shareOrDownloadBlob(blob, filename, 'application/pdf');
      if (!shared) downloadAnchor(blob, filename);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('PDF export failed:', e?.message || e);
      setExportError(e?.message || 'PDF 匯出失敗');
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
            <ExportButton
              onClick={handlePngExport}
              label="PNG"
              title="將商戶比較結果儲存為 PNG 圖片"
              exporting={exporting}
              tone="emerald"
            />
            <ExportButton
              onClick={handlePdfExport}
              label="PDF"
              title="將商戶比較結果儲存為 PDF 文件"
              exporting={exporting}
              tone="indigo"
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

// Small button primitive for PNG/PDF export actions.
function ExportButton({ onClick, label, title, exporting, tone }) {
  const toneClasses =
    tone === 'indigo'
      ? 'hover:border-indigo-400 hover:text-indigo-600'
      : 'hover:border-emerald-400 hover:text-emerald-600';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={exporting}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${
        exporting
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait'
          : `bg-white text-slate-600 border-slate-200 ${toneClasses}`
      }`}
    >
      {exporting ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">
        {exporting ? '匯出中...' : label}
      </span>
    </button>
  );
}
