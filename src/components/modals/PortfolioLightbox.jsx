// PortfolioLightbox — full-screen image viewer for vendor portfolios.
// Opens when a couple clicks a portfolio thumbnail in VendorModal.
// Tracks each unique photo visit as a row in /vendorImageViews.
//
// 2026-07-27 — RED→GREEN refactor.
// Two bugs in the prior implementation:
//
//   1. (broken feature) The displayed image never advanced on
//      ArrowRight / ArrowLeft. The keyboard handler computed
//      `next = (startIndex + 1) % length` but `startIndex` was the
//      constant prop, and the event was propagated only via a
//      `CustomEvent('portfolio-lightbox-set')` whose only consumer
//      was a no-op DOM attribute reader (setIndex was dead code;
//      currentIndex was a re-parse of that DOM attribute on every
//      render). The <img> rendered was always `photos[startIndex]`.
//
//   2. (write amplification) Each onClick / onKeyDown fired
//      `recordView(next)` synchronously. A user who opened a vendor
//      gallery with 10 photos and paged through every one
//      produced 10 writes — including re-records on the same photo
//      via the back button.
//
// The fix:
//   • Drive the displayed index with `useState`. Re-render on
//     change so the <img> actually advances.
//   • Record analytics exactly once per photo via a useEffect
//     keyed on `[index, viewerUid, vendorSlug]` that records when
//     the index changes (not when the user mashes keys).
//   • Drop the dead `data-index` attribute + `portfolio-lightbox-set`
//     CustomEvent bridge. The keyboard handler now calls the same
//     `go()` setter the chevron buttons do.
//
// Writes still fail loudly (visible to admins via console.warn),
// and unsigned viewers still skip the write entirely.

import { useEffect, useCallback, useRef, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { db } from '../../lib/firebase';

export function PortfolioLightbox({ photos, initialIndex, vendorSlug, viewerUid, onClose }) {
  // Defensive: never crash on missing data.
  if (!photos || photos.length === 0) return null;
  // Clamp initialIndex to a valid range in case photos array shrunk.
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex || 0, photos.length - 1)),
  );
  // Track indices visited IN THIS SESSION. The first photo the user
  // sees (initialIndex) IS visited, unconditionally, and recorded
  // exactly once. Subsequent transitions only re-record when the
  // destination index is new. Revisiting a known photo is a no-op.
  //
  // The Set lives in a ref so re-renders don't churn state. Seeded
  // empty — the first-mount effect run is what marks `initialIndex`
  // as visited.
  const visitedRef = useRef(new Set());

  // Wrap-around navigation. Same setter for keyboard + chevron + future
  // swipe — keeps the displayed image in sync with what the user clicked.
  const go = useCallback(
    (delta) => {
      setIndex((i) => (i + delta + photos.length) % photos.length);
    },
    [photos.length],
  );

  // Record analytics exactly once per UNIQUE photo visit. The effect
  // runs once on initial mount (recording the entry photo), and
  // again on every index change. The visited set gates re-records.
  //
  // Deps intentionally use `photos.length` (NOT `photos`) so a
  // parent passing a fresh array reference each render doesn't
  // re-fire the effect. The visited set still keys by index, so
  // a photo count change won't replay writes either.
  //
  // Anonymous viewers (no viewerUid) skip the write entirely.
  useEffect(() => {
    if (!viewerUid || !db) return;
    if (visitedRef.current.has(index)) return;
    visitedRef.current.add(index);
    let cancelled = false;
    (async () => {
      try {
        await addDoc(collection(db, 'vendorImageViews'), {
          vendorSlug,
          imageIndex: index,
          imageUrl: photos[index],
          viewerUid,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        if (cancelled) return;
        // Non-fatal — log so admin can see if rules are misconfigured.
        // eslint-disable-next-line no-console
        console.warn('[PortfolioLightbox] view log failed:', e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, vendorSlug, viewerUid, photos.length]);

  // Body-scroll lock + keyboard navigation. Bound to current `index`
  // via a ref-less closure pattern: the handler reads `index` from
  // state at the time the keypress fires, then calls go() to advance.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // go is stable for the lifetime of the lightbox (deps don't change
    // once photos is constant). Re-binding on every index change would
    // re-attach the listener pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go]);

  const current = photos[index];

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2 text-white/80 text-sm font-mono">
          <span className="bg-white/10 px-3 py-1 rounded-full">
            {index + 1} / {photos.length}
          </span>
          {viewerUid && (
            <span className="hidden sm:flex items-center gap-1 text-white/50 text-xs">
              <Eye className="w-3 h-3" /> 已記錄瀏覽
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
            go(-1);
          }}
          className="absolute left-4 z-20 text-white/70 hover:text-white hover:bg-white/10 rounded-full p-3"
          aria-label="上一張"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Main image */}
      <div
        className="relative max-w-[95vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          key={index}
          src={current}
          alt={`portfolio-${index}`}
          className="max-w-full max-h-[90vh] object-contain shadow-2xl animate-in fade-in zoom-in-95 duration-300"
        />
      </div>

      {/* Next button */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
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
