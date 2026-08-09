// 2026-08-09 — BellNotifications
//
// Header bell button + dropdown notifications panel. Replaces the
// earlier "click → navigate to 徵求報價 board" pattern with the
// standard "click → inspect without leaving context" pattern
// (Linear, Slack, GitHub, Notion, WhatsApp all do this).
//
// 2026-08-09 — third iteration: multi-source. The first version only
// surfaced vendor proposals. The second iteration (Aug 8) added a
// persistent panel. This third iteration wires useNotifications
// which aggregates 4 sources (proposals, task comments, task status
// updates, helper accepted invitations) into a single sorted feed.
//
// Layout (right edge of header, anchored to the bell button):
//   ┌─────────────────────────────────────┐
//   │  🔔  通知              全部已讀       │  ← header
//   ├─────────────────────────────────────┤
//   │  💬  Sky Photo            $25,000    │  ← item (proposal)
//   │     場地佈置呢邊報價…   • 2 小時前    │
//   │  ─────────────────────────────────── │
//   │  💭  兄弟姊妹 阿明                 │  ← item (comment)
//   │     道具已送到場地…    • 20 分鐘前   │
//   │  ─────────────────────────────────── │
//   │  🤝  Tiger                    • 剛剛  │  ← item (helper joined)
//   │     已加入您的婚禮                    │
//   ├─────────────────────────────────────┤
//   │            查看全部 中心 →            │  ← footer
//   └─────────────────────────────────────┘
//
// Per-item click:
//   - proposal → opens ProposalsModal pre-loaded with that jobId
//   - comment / status → opens the checklist with that task focused
//   - invite → opens the helpers overview
//   - chat/system → caller-supplied handler
//
// "Mark all as read":
//   - Writes each source's localStorage marker to "now". The bell
//     badge recomputes per-source delta and hides when sum is 0.
//
// "View all":
//   - Closes the panel + navigates to the dashboard (configurable).
//
// Empty state:
//   - "✨ 暫時無新通知"

import { useEffect, useRef, useState } from 'react';
import { Bell, Check, ExternalLink, Loader2 } from 'lucide-react';
import {
  useNotifications,
  markAllNotificationsSeen,
  CATEGORY_META,
} from '../hooks/useNotifications';

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

// Pick the dominant gradient color for the avatar circle based on
// category. Lazy lookup so adding a category is one entry in CATEGORY_META.
function avatarGradient(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META.system;
  return `bg-gradient-to-br ${meta.bgClass}`;
}

export function BellNotifications({
  ownerUid,
  coupleUid,
  selfUid,
  onOpenProposal,
  onOpenComment,
  onOpenStatus,
  onOpenInvite,
  onOpenDashboard,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  // 2026-08-09 — TDZ fix: don't reference `totalNew` (which is being
  // declared in this very destructure) inside the `enabled` arg. The
  // hook returns `totalNew`, so reading it before the assignment
  // completes throws `Cannot access 'p' before initialization` and
  // unmounts the header. We switch to a local mirror so the panel
  // stays subscribed while the badge itself is non-zero — without the
  // circular destructure.
  const [liveTotalNew, setLiveTotalNew] = useState(0);
  const { items, badges, totalNew, loading, errors } = useNotifications({
    ownerUid,
    coupleUid,
    selfUid,
    enabled: open || liveTotalNew > 0,
  });
  useEffect(() => {
    setLiveTotalNew(totalNew);
  }, [totalNew]);

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
    if (!ownerUid) return;
    markAllNotificationsSeen(ownerUid, {
      // Use the actual current counts so the marker is exact,
      // not "now". Otherwise the next render would still show
      // a tiny delta for items created in the same millisecond.
      proposal: (badges.proposal ?? 0),
      comment: Date.now(),
      status: Date.now(),
      invite: Date.now(),
    });
  };

  const handleItemClick = (item) => {
    setOpen(false);
    if (!item) return;
    switch (item.category) {
      case 'proposal':
        if (item.href?.jobId && onOpenProposal) onOpenProposal(item.href.jobId);
        break;
      case 'comment':
        if (onOpenComment) onOpenComment(item.meta);
        break;
      case 'status':
        if (onOpenStatus) onOpenStatus(item.meta);
        break;
      case 'invite':
        if (onOpenInvite) onOpenInvite(item.meta);
        break;
      default:
        break;
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    if (onOpenDashboard) onOpenDashboard();
  };

  // Compute the proposal count for the mark-all-read marker.
  // (Other sources use timestamp markers, this one uses absolute count.)
  const proposalCount = items.filter((i) => i.category === 'proposal').length;

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          totalNew > 0 ? `通知，有 ${totalNew} 個新` : '通知'
        }
        title={totalNew > 0 ? `有 ${totalNew} 個新通知` : '通知'}
        className={`relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors ${
          totalNew > 0 ? 'animate-pulse' : ''
        }`}
      >
        <Bell
          className={`w-5 h-5 ${totalNew > 0 ? 'text-rose-500 fill-rose-200' : ''}`}
        />
        {totalNew > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white">
            {totalNew > 9 ? '9+' : totalNew}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="通知"
          className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[150] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-br from-rose-50/60 to-white">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-rose-500" />
              <span className="font-bold text-slate-800 text-sm">通知</span>
              {totalNew > 0 && (
                <span className="text-[10px] font-bold text-white bg-rose-500 rounded-full px-1.5 py-0.5">
                  {totalNew} 新
                </span>
              )}
            </div>
            {totalNew > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md px-2 py-1 flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                全部已讀
              </button>
            )}
          </div>

          {/* Per-source breakdown chips (only show when something is new) */}
          {totalNew > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold">
              {badges.proposal > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-white ${CATEGORY_META.proposal.badgeClass}`}>
                  💬 {badges.proposal} 個新報價
                </span>
              )}
              {badges.comment > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-white ${CATEGORY_META.comment.badgeClass}`}>
                  💭 {badges.comment} 個新留言
                </span>
              )}
              {badges.status > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-white ${CATEGORY_META.status.badgeClass}`}>
                  ✅ {badges.status} 個狀態更新
                </span>
              )}
              {badges.invite > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-white ${CATEGORY_META.invite.badgeClass}`}>
                  🤝 {badges.invite} 個兄弟姊妹加入
                </span>
              )}
            </div>
          )}

          {/* Body — scrollable */}
          <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
            {Object.keys(errors).length > 0 && (
              <div className="px-4 py-3 text-center text-xs text-rose-600 border-b border-rose-100 bg-rose-50/50">
                部分通知載入失敗：{Object.values(errors).join('；')}
              </div>
            )}

            {loading && items.length === 0 && (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                載入中...
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="text-3xl mb-2">✨</div>
                <div className="text-sm font-bold text-slate-700">暫時無新通知</div>
                <div className="text-xs text-slate-500 mt-1">
                  商戶報價、留言、狀態更新會即刻顯示
                </div>
              </div>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => {
                  const meta = CATEGORY_META[item.category] || CATEGORY_META.system;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => handleItemClick(item)}
                        className={`w-full text-left px-4 py-3 transition-colors flex gap-3 items-start ${meta.hoverBgClass}`}
                      >
                        {/* Avatar circle — first letter, tinted by category */}
                        <div className={`w-9 h-9 rounded-full text-white text-sm font-black flex items-center justify-center flex-shrink-0 ${avatarGradient(item.category)}`}>
                          {item.category === 'proposal' ? meta.icon : item.actorInitial || meta.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-bold text-slate-800 text-sm truncate flex items-center gap-1">
                              <span className="text-[10px]">{meta.icon}</span>
                              {item.actorName}
                            </span>
                            {item.category === 'proposal' && item.meta?.price && (
                              <span className={`font-bold text-sm whitespace-nowrap flex-shrink-0 ${meta.textClass}`}>
                                {item.meta.price}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 leading-snug line-clamp-2">
                            {item.preview}
                          </p>
                          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                            <span className={`font-bold ${meta.textClass}`}>{item.title}</span>
                            <span>·</span>
                            <span>{formatTimeAgo(item.createdAt)}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50">
            <button
              onClick={handleViewAll}
              className="w-full text-sm font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg py-1.5 flex items-center justify-center gap-1.5 transition-colors"
            >
              查看全部 中心
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
