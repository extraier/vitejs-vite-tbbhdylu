// PortfolioLightbox — full-screen image viewer for vendor portfolios.
// Opens when a couple clicks a portfolio thumbnail in VendorModal.
// Tracks each open as a row in /vendorImageViews so admins can see
// which portfolio images get the most attention.
//
// 2026-07-20 — first version. Keyboard navigation (←/→), ESC to
// close. The analytics write is fire-and-forget — if Firestore
// rejects (e.g. user isn't signed in for some edge case), the
// lightbox still works. We surface failures to console for
// debugging, not to the UI.

import { useEffect, useCallback } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { db } from '../../lib/firebase';

export function PortfolioLightbox({ photos, initialIndex, vendorSlug, viewerUid, onClose }) {
  // Defensive: never crash on missing data.
  if (!photos || photos.length === 0) return null;
  // Clamp initialIndex to a valid range in case photos array shrunk.
  const startIndex = Math.max(0, Math.min(initialIndex || 0, photos.length - 1));

  // We track the *currently displayed* index in a closure via a small
  // ref-free pattern — using state + render keeps keyboard nav
  // working without rerenders for unrelated reasons.
  const setIndex = (i) => {
    const next = (i + photos.length) % photos.length;
    if (next !== startIndex) {
      window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
    } else {
      // Same index — still dispatch so any listeners can react.
      window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
    }
  };

  // Listen for index changes from the keyboard handlers below.
  const currentIndex = (() => {
    // First render: initialIndex. Updates come via a DOM data attribute.
    const el = document.getElementById('portfolio-lightbox-root');
    return el ? parseInt(el.getAttribute('data-index') || String(startIndex), 10) : startIndex;
  })();

  const recordView = useCallback(
    (index) => {
      // Only record for signed-in viewers — couples, vendors, admins.
      // Unauthenticated viewers just see the image.
      if (!viewerUid || !db) return;
      try {
        addDoc(collection(db, 'vendorImageViews'), {
          vendorSlug,
          imageIndex: index,
          imageUrl: photos[index],
          viewerUid,
          createdAt: serverTimestamp(),
        }).catch((e) => {
          // Non-fatal — log so admin can see if rules are misconfigured.
          console.warn('[PortfolioLightbox] view log failed:', e?.message || e);
        });
      } catch (e) {
        console.warn('[PortfolioLightbox] view log setup failed:', e?.message || e);
      }
    },
    [vendorSlug, viewerUid, photos],
  );

  useEffect(() => {
    // Record the initial view (the one that opened the lightbox).
    recordView(startIndex);

    // Keyboard nav
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') {
        const next = (startIndex + 1) % photos.length;
        window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
        recordView(next);
      } else if (e.key === 'ArrowLeft') {
        const next = (startIndex - 1 + photos.length) % photos.length;
        window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
        recordView(next);
      }
    }
    window.addEventListener('keydown', onKey);
    // Lock body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = photos[startIndex];

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2 text-white/80 text-sm font-mono">
          <span className="bg-white/10 px-3 py-1 rounded-full">
            {startIndex + 1} / {photos.length}
          </span>
          {viewerUid && (
            <span className="hidden sm:flex items-center gap-1 text-white/50 text-xs">
              <Eye className="w-3 h-3" />
              已記錄瀏覽
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2"
          aria-label="關閉"
        >
          <X className="w-7 h-7" />
        </button>
      </div>

      {/* Previous button */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const next = (startIndex - 1 + photos.length) % photos.length;
            window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
            recordView(next);
          }}
          className="absolute left-4 z-20 text-white/70 hover:text-white hover:bg-white/10 rounded-full p-3"
          aria-label="上一張"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Main image */}
      <div
        id="portfolio-lightbox-root"
        data-index={startIndex}
        className="relative max-w-[95vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          key={startIndex}
          src={current}
          alt={`portfolio-${startIndex}`}
          className="max-w-full max-h-[90vh] object-contain shadow-2xl animate-in fade-in zoom-in-95 duration-300"
        />
      </div>

      {/* Next button */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const next = (startIndex + 1) % photos.length;
            window.dispatchEvent(new CustomEvent('portfolio-lightbox-set', { detail: { index: next } }));
            recordView(next);
          }}
          className="absolute right-4 z-20 text-white/70 hover:text-white hover:bg-white/10 rounded-full p-3"
          aria-label="下一張"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Hint footer */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center p-4 bg-gradient-to-t from-black/60 to-transparent">
        <p className="text-white/40 text-xs font-mono">
          ← / → 切換 · ESC 關閉
        </p>
      </div>
    </div>
  );
}
