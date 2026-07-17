// ReviewsPanel — vendor reviews surface in the directory.
// Renders a stacked list of reviews + an inline rating composer.
// Couples see a "✏️ 我嘅評分" button (changes to update / remove if
// they've already rated), and vendors + helpers don't see the composer.
//
// The vendor aggregate (rating + ratingCount) lives on the vendor doc
// itself (kept in sync by the Cloud Function). The actual rating
// entries are paged from the listVendorRatings callable function.
//
// 2026-07-17 — initial implementation.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Star, X, Loader2, MessageSquare, Trash2 } from 'lucide-react';
import {
  submitVendorRating,
  deleteMyVendorRating,
  listVendorRatings,
} from '../lib/vendorRatings';

const WEDDING_YEARS = (() => {
  const now = new Date().getFullYear();
  const arr = [];
  for (let y = now + 2; y >= now - 4; y--) arr.push(y);
  return arr;
})();

export function ReviewsPanel({ vendor, currentUser, currentUserRole }) {
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // ---- initial load ----
  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const res = await listVendorRatings({
        vendorId: vendor.id,
        limit: 5,
      });
      setRatings(res.ratings || []);
      setNextCursor(res.nextCursor || null);
    } catch (e) {
      setError(e?.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.id]);

  // ---- pagination ----
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listVendorRatings({
        vendorId: vendor.id,
        limit: 5,
        startAfterId: nextCursor,
      });
      setRatings((prev) => [...prev, ...(res.ratings || [])]);
      setNextCursor(res.nextCursor || null);
    } catch (e) {
      setError(e?.message || '載入更多失敗');
    } finally {
      setLoadingMore(false);
    }
  }

  const myRating = useMemo(
    () => ratings.find((r) => r.coupleUid === currentUser?.uid),
    [ratings, currentUser?.uid],
  );

  const isCouple = ['couple', 'owner', 'helper'].includes(currentUserRole);
  const canReview = isCouple && !!currentUser?.uid;

  return (
    <div className="space-y-4">
      {/* Header — aggregate + composer trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <StarRating value={Math.round(vendor.rating || 0)} size="md" />
          </div>
          <span className="text-sm font-bold text-slate-700">
            {(vendor.rating || 0).toFixed(1)}
          </span>
          <span className="text-xs text-slate-500">
            ({vendor.ratingCount || 0} 個評分)
          </span>
        </div>
        {canReview && (
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="text-sm font-bold text-emerald-600 hover:text-emerald-700 underline"
          >
            {myRating ? '✏️ 修改我嘅評分' : '✏️ 寫個評分'}
          </button>
        )}
      </div>

      {/* Composer modal */}
      {composerOpen && (
        <ComposerModal
          vendor={vendor}
          myRating={myRating}
          coupleUid={currentUser.uid}
          coupleName={currentUser.displayName || currentUser.email?.split('@')[0] || '準新人'}
          submitting={submitting}
          error={error}
          onClose={() => setComposerOpen(false)}
          onSubmit={async ({ rating, review, weddingYear, coupleName }) => {
            setSubmitting(true);
            setError(null);
            try {
              await submitVendorRating({
                vendorId: vendor.id,
                rating,
                review,
                weddingYear,
                coupleName,
              });
              // Refresh aggregates (parent might listen to vendor.onChange)
              // — simplest path: refetch the list.
              await loadInitial();
              setComposerOpen(false);
            } catch (e) {
              setError(e?.message || '提交失敗');
            } finally {
              setSubmitting(false);
            }
          }}
          onDelete={myRating ? async () => {
            if (!window.confirm('確定要刪除你嘅評分？')) return;
            setSubmitting(true);
            setError(null);
            try {
              await deleteMyVendorRating(vendor.id);
              await loadInitial();
              setComposerOpen(false);
            } catch (e) {
              setError(e?.message || '刪除失敗');
            } finally {
              setSubmitting(false);
            }
          } : null}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-6 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
          載入中...
        </div>
      ) : ratings.length === 0 ? (
        <div className="bg-slate-50 rounded-2xl p-6 text-center text-sm text-slate-500">
          <MessageSquare className="w-6 h-6 inline mb-1 opacity-50" />
          <div>仲未有評分 — {canReview ? '做第一個啦!' : '做第一個'}</div>
        </div>
      ) : (
        <ul className="space-y-3">
          {ratings.map((r) => (
            <li
              key={r.ratingId}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold text-slate-800">
                    {r.coupleName}
                  </div>
                  {r.weddingYear && (
                    <span className="text-xs text-slate-400">
                      · {r.weddingYear} 婚禮
                    </span>
                  )}
                </div>
                <StarRating value={r.rating} size="sm" />
              </div>
              {r.review && (
                <p className="text-sm text-slate-600 whitespace-pre-wrap">
                  {r.review}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-1.5 rounded-full text-sm font-bold text-slate-600 border border-slate-200 hover:border-slate-400 disabled:opacity-50"
          >
            {loadingMore ? '載入中...' : '載入更多'}
          </button>
        </div>
      )}
    </div>
  );
}

function ComposerModal({
  vendor,
  myRating,
  coupleUid,
  coupleName,
  submitting,
  error,
  onClose,
  onSubmit,
  onDelete,
}) {
  const [rating, setRating] = useState(myRating?.rating || 5);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState(myRating?.review || '');
  const [weddingYear, setWeddingYear] = useState(
    myRating?.weddingYear || new Date().getFullYear(),
  );
  const [name, setName] = useState(myRating?.coupleName || coupleName);

  // ESC to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  function handleSubmit(e) {
    e.preventDefault();
    if (rating < 1 || rating > 5) return;
    onSubmit({
      rating,
      review: review.trim(),
      weddingYear: Number(weddingYear) || null,
      coupleName: name.trim(),
    });
  }

  const display = hovered || rating;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200"
      onClick={() => !submitting && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-lg font-black text-slate-800">
            {myRating ? '✏️ 修改評分' : '✍️ 為 '}{!myRating && (
              <span className="text-rose-600">{vendor.name}</span>
            )}{!myRating && ' 評分'}
          </h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-auto">
          {error && (
            <div className="bg-rose-50 text-rose-700 text-sm px-4 py-2 rounded-lg border border-rose-200">
              ⚠ {error}
            </div>
          )}

          {/* Star input */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              評分
            </label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = n <= display;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setRating(n)}
                      className="p-1 transition-transform hover:scale-110"
                      aria-label={`${n} 星`}
                    >
                      <Star
                        className={`w-7 h-7 ${
                          active
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-300'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <span className="text-lg font-black text-amber-600">
                {display}.0
              </span>
            </div>
          </div>

          {/* Review text */}
          <div>
            <label
              htmlFor="review-text"
              className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2"
            >
              評價 ({review.length}/500)
            </label>
            <textarea
              id="review-text"
              value={review}
              onChange={(e) => setReview(e.target.value.slice(0, 500))}
              rows={4}
              placeholder="分享你嘅婚禮經驗..."
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-medium focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 outline-none resize-none"
            />
          </div>

          {/* Wedding year + couple name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="wedding-year"
                className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2"
              >
                婚禮年份
              </label>
              <select
                id="wedding-year"
                value={weddingYear}
                onChange={(e) => setWeddingYear(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium"
              >
                {WEDDING_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="couple-name"
                className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2"
              >
                你嘅名 / 花名
              </label>
              <input
                id="couple-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 60))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium"
                placeholder="Roger & Peggy"
              />
            </div>
          </div>

          {/* Action row */}
          <div className="flex items-center justify-between pt-3 gap-3">
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                移除評分
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={submitting || rating < 1}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? '提交中...' : myRating ? '更新評分' : '提交評分'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StarRating({ value, size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${sz} ${
            n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
          }`}
        />
      ))}
    </div>
  );
}
