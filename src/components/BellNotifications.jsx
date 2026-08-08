// 2026-08-08 — BellNotifications
//
// Header bell button + dropdown notifications panel. Replaces the
// earlier "click → navigate to 徵求報價 board" pattern with the
// standard "click → inspect without leaving context" pattern
// (Linear, Slack, GitHub, Notion, WhatsApp all do this).
//
// Layout (right edge of header, anchored to the bell button):
//   ┌─────────────────────────────────────┐
//   │  🔔  商戶報價通知      全部已讀      │  ← header
//   ├─────────────────────────────────────┤
//   │  [icon] Testing Studio    $10,000    │  ← item
//   │  已經睇到你嘅要求…         • 剛剛    │
//   │  ────────────────────────────────    │
//   │  [icon] Sky Photo         $25,000    │
//   │  場地佈置呢邊報價俾你參考… • 2小時前  │
//   │  ...                                │
//   ├─────────────────────────────────────┤
//   │            查看全部 徵求報價 →        │  ← footer
//   └─────────────────────────────────────┘
//
// Per-item click:
//   - If the proposal has a jobId → opens ProposalsModal for that
//     job (existing setViewingProposals(jobId) handler from App.jsx).
//   - Closes the panel.
//
// "Mark all as read":
//   - Sets the localStorage marker to current proposal total.
//   - Bell badge hides immediately on next header render.
//
// "View all":
//   - Closes the panel + navigates to couple-jobboard.
//
// Empty state:
//   - "暫時無新通知 ✨"
//
// 2026-08-08 — second iteration: the previous version navigated
// straight to the 徵求報價 board on bell click. User pointed out
// the normal-app pattern is to show a notification summary panel
// first so you can scan + decide. This rewrite follows that.

import { useEffect, useRef, useState } from 'react';
import { Bell, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useProposalBell, markProposalsSeenExact } from '../hooks/useProposalBell';
import { useRecentProposals } from '../hooks/useRecentProposals';

function formatTimeAgo(ts) {
  if (!ts) return '剛剛';
  let date = null;
  try {
    if (typeof ts === 'object' && typeof ts.toDate === 'function') date = ts.toDate();
    else if (ts && typeof ts.seconds === 'number') date = new Date(ts.seconds * 1000);
    else if (typeof ts === 'number') date = new Date(ts);
  } catch {
    return '剛剛';
  }
  if (!date || Number.isNaN(date.getTime())) return '剛剛';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return '剛剛';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分鐘前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小時前`;
  return `${Math.floor(diffMs / 86_400_000)} 日前`;
}

// Compact one-line summary of a proposal message. Most proposals
// start with a friendly greeting + the body — we trim to ~50 chars
// and ellipsize. Keeps the panel scannable.
function summarize(message, max = 50) {
  const t = (message || '').replace(/\s+/g, ' ').trim();
  if (!t) return '已發送報價';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// First non-ASCII letter for the avatar circle, fallback to ASCII.
function vendorInitial(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '商';
  // CJK letters render fine; ASCII uppercased for consistency.
  const first = trimmed[0];
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

export function BellNotifications({ jobs, ownerUid, coupleUid, onOpenProposal, onOpenBoard }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const { sum, delta } = useProposalBell(jobs, ownerUid);
  const { proposals, error } = useRecentProposals({ coupleUid, enabled: open });

  // Click-outside + Escape close — mirrors UserMenu's pattern.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleMarkAllRead = (e) => {
    e.stopPropagation();
    markProposalsSeenExact(ownerUid, sum);
    // No setState needed — the badge recomputes on next render via
    // the localStorage marker.
  };

  const handleItemClick = (p) => {
    setOpen(false);
    if (p?.jobId && onOpenProposal) onOpenProposal(p.jobId);
  };

  const handleViewAll = () => {
    setOpen(false);
    if (onOpenBoard) onOpenBoard();
  };

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={delta > 0 ? `商戶報價通知，有 ${delta} 個新` : '商戶報價通知'}
        title={delta > 0 ? `有 ${delta} 個新報價` : '商戶報價通知'}
        className={`relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors ${
          delta > 0 ? 'animate-pulse' : ''
        }`}
      >
        <Bell
          className={`w-5 h-5 ${delta > 0 ? 'text-rose-500 fill-rose-200' : ''}`}
        />
        {delta > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white">
            {delta > 9 ? '9+' : delta}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="商戶報價通知"
          className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[150] overflow-hidden"
          // Above toast (z-200) is too high — toast is below header. Match
          // the inbox icon's existing panel z-index for consistency.
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-br from-rose-50/60 to-white">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-rose-500" />
              <span className="font-bold text-slate-800 text-sm">商戶報價通知</span>
              {delta > 0 && (
                <span className="text-[10px] font-bold text-white bg-rose-500 rounded-full px-1.5 py-0.5">
                  {delta} 新
                </span>
              )}
            </div>
            {delta > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md px-2 py-1 flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                全部已讀
              </button>
            )}
          </div>

          {/* Body — scrollable */}
          <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
            {error && (
              <div className="px-4 py-6 text-center text-sm text-rose-600">{error}</div>
            )}

            {proposals === null && !error && (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                載入中...
              </div>
            )}

            {Array.isArray(proposals) && proposals.length === 0 && !error && (
              <div className="px-4 py-10 text-center">
                <div className="text-3xl mb-2">✨</div>
                <div className="text-sm font-bold text-slate-700">暫時無新通知</div>
                <div className="text-xs text-slate-500 mt-1">
                  商戶發送報價後會即刻喺度顯示
                </div>
              </div>
            )}

            {Array.isArray(proposals) && proposals.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {proposals.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(p)}
                      className="w-full text-left px-4 py-3 hover:bg-rose-50/50 transition-colors flex gap-3 items-start"
                    >
                      {/* Avatar circle — first letter of vendor name */}
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-400 to-amber-400 text-white text-sm font-black flex items-center justify-center flex-shrink-0">
                        {vendorInitial(p.vendorName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold text-slate-800 text-sm truncate">
                            {p.vendorName}
                          </span>
                          <span className="font-bold text-rose-600 text-sm whitespace-nowrap flex-shrink-0">
                            {p.price || '待定'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5 leading-snug line-clamp-2">
                          {summarize(p.message)}
                        </p>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                          <span>{formatTimeAgo(p.createdAt)}</span>
                          <span>·</span>
                          <span className="text-rose-500 font-bold">點擊查看報價</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50">
            <button
              onClick={handleViewAll}
              className="w-full text-sm font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg py-1.5 flex items-center justify-center gap-1.5 transition-colors"
            >
              查看全部 徵求報價
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
