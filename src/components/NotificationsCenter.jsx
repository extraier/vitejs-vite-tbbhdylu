// 2026-08-09 — NotificationsCenter
//
// Full-page view of every notification the couple has received since
// the event was created. Lives at the bell's "查看全部" footer.
//
// Why a dedicated view (vs. just showing 20 in the dropdown):
//   The bell dropdown truncates at MAX_BELL_DROPDOWN_ITEMS (20) for
//   visual density. The couple may have missed notifications from
//   earlier in the wedding, and scrolling through the dropdown's 60vh
//   body is fiddly. This view renders the FULL list from
//   useNotifications (no cap), with per-source filter tabs.
//
// Layout (right under the header, full-width):
//   ┌─────────────────────────────────────────────────┐
//   │  通知中心                    全部已讀              │  ← header
//   ├─────────────────────────────────────────────────┤
//   │  [全部] [報價 N] [待辦 N] [邀請 N]              │  ← filter tabs
//   ├─────────────────────────────────────────────────┤
//   │  💬 Sky Photo Studio        $25,000  • 2 小時前  │  ← item
//   │     場地佈置呢邊報價…                          │
//   │  ────────────────────────────────────────────  │
//   │  💬 Tiger Photo             $18,000  • 1 日前   │
//   │     婚紗攝影套餐報價…                          │
//   │  ────────────────────────────────────────────  │
//   │  📋 待辦：訂蛋糕                              │
//   │     揀選蛋糕設計…           • 3 小時前         │
//   │  ...                                            │
//   └─────────────────────────────────────────────────┘
//
// Per-item click:
//   - proposal → opens ProposalsModal pre-loaded with that jobId
//   - task → opens the checklist with that task focused
//   - invite → opens the helpers overview
//
// Mark-all-read:
//   - Same localStorage markers as the dropdown. The bell badge clears
//     automatically because both consumers share the same hook.
//
// Back button:
//   - onBack (provided by App.jsx) returns to the previous view.

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  Loader2,
} from 'lucide-react';
import {
  useNotifications,
  markAllNotificationsSeen,
  // 2026-08-17 — Manus A10.
  markCommentAlertsRead,
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
  if (diffMs < 30 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)} 日前`;
  if (diffMs < 365 * 86_400_000) return `${Math.floor(diffMs / (30 * 86_400_000))} 個月前`;
  return `${Math.floor(diffMs / (365 * 86_400_000))} 年前`;
}

function avatarGradient(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META.system;
  return `bg-gradient-to-br ${meta.bgClass}`;
}

// 2026-08-19 — Manus P0.3: extend the centre to vendor / helper
// roles. Owner / co-owner see all four tabs; vendor / helper
// see only the "全部" + "留言" tabs because their private
// inbox contains comment alerts only (proposals, tasks, and
// helper-invites are owner-only sources per P0.4).
const ALL_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'proposal', label: '商戶報價' },
  { key: 'task', label: '待辦事項' },
  { key: 'invite', label: '兄弟姊妹邀請' },
  { key: 'comment', label: '留言通知' },
];
const NON_OWNER_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'comment', label: '留言通知' },
];

export function NotificationsCenter({
  ownerUid,
  coupleUid,
  selfUid,
  eventId,
  // 2026-08-19 — Manus P0.3: pass the current role so we can
  // scope the visible filter tabs. Default 'owner' so existing
  // callers don't accidentally land in the non-owner tab set.
  userRole = 'owner',
  onBack,
  onOpenProposal,
  onOpenComment,
  // 2026-08-17 — Big Day comment-alert click handler. Routes to
  // WeddingDay instead of the checklist.
  onOpenCommentAlert,
  onOpenInvite,
}) {
  const [filter, setFilter] = useState('all');
  const [liveTotalNew, setLiveTotalNew] = useState(0);
  // 2026-08-19 — Manus P0.3: scope the visible filter tabs by
  // role. Owner / co-owner get the full set (proposals, tasks,
  // invites, comments); vendor / helper get a stripped-down
  // set because their private inbox is comments-only (the
  // proposal / task / invite sources are role-gated at the
  // hook level per P0.4, so they'd never appear in items[]).
  const activeFilters =
    userRole === 'owner' || userRole === 'co-owner'
      ? ALL_FILTERS
      : NON_OWNER_FILTERS;
  const { items, badges, totalNew, loading, errors, commentAlerts } = useNotifications({
    ownerUid,
    coupleUid,
    selfUid,
    eventId,
    // 2026-08-23 — Manus P3 (PDF Patch 3): forward userRole to the
    // hook. The prop is already in scope and already gates the
    // visible filter tabs; the hook call just wasn't using it. Owner
    // / co-owner keep the full source set; vendor / helper get only
    // the comment inbox (which is the only source that can actually
    // have items for them, given the P0.4 source gate).
    userRole,
    refreshKey: 0,
    enabled: true,
  });
  useEffect(() => {
    setLiveTotalNew(totalNew);
  }, [totalNew]);

  // Filter items client-side. "全部" shows everything (sorted newest-first
  // by the hook); category tabs filter by category.
  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  // Per-filter counts so the tab badges reflect what's actually inside
  // each section.
  const filterCounts = useMemo(() => {
    const counts = { all: items.length, proposal: 0, task: 0, invite: 0 };
    for (const i of items) {
      if (counts[i.category] !== undefined) counts[i.category] += 1;
    }
    return counts;
  }, [items]);

  const handleMarkAllRead = () => {
    if (!ownerUid) return;
    const proposalTotal = items.filter((i) => i.category === 'proposal').length;
    markAllNotificationsSeen(ownerUid, {
      // Same logic as the dropdown: absolute proposal count, Date.now()
      // for timestamp-keyed sources.
      proposal: proposalTotal,
      task: Date.now(),
      invite: Date.now(),
      // 2026-08-17 — per-event timestamp, same shape as task.
      comment: Date.now(),
    });
    // 2026-08-17 — Manus A10: per-device readAt sync via Firestore.
    if (selfUid && Array.isArray(commentAlerts)) {
      markCommentAlertsRead(selfUid, commentAlerts, eventId).catch(() => {});
    }
  };

  const handleItemClick = (item) => {
    if (!item) return;
    switch (item.category) {
      case 'proposal':
        if (item.href?.jobId && onOpenProposal) onOpenProposal(item.href.jobId);
        break;
      case 'task':
        if (onOpenComment) onOpenComment(item.meta);
        break;
      // 2026-08-17 — Vendor / helper comment on 大日流程 / 物資.
      // Routes to the Big Day view (wedding-day) instead of the
      // checklist because rundown / resource comments live there.
      case 'comment':
        if (onOpenCommentAlert) onOpenCommentAlert(item.meta);
        else if (onOpenComment) onOpenComment(item.meta);
        break;
      case 'invite':
        if (onOpenInvite) onOpenInvite(item.meta);
        break;
      default:
        break;
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="返回"
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <Bell className="w-6 h-6 text-rose-500" />
              通知中心
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              商戶報價、待辦事項、邀請接受 — 全部一覽無遺
            </p>
          </div>
        </div>
        {liveTotalNew > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="text-sm font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg px-3 py-2 flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            全部已讀
          </button>
        )}
      </div>

      {/* Per-source breakdown chips */}
      {liveTotalNew > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs font-bold">
          {badges.proposal > 0 && (
            <span className={`px-3 py-1 rounded-full text-white ${CATEGORY_META.proposal.badgeClass}`}>
              💬 {badges.proposal} 個新報價
            </span>
          )}
          {badges.task > 0 && (
            <span className={`px-3 py-1 rounded-full text-white ${CATEGORY_META.task.badgeClass}`}>
              📋 {badges.task} 個新待辦
            </span>
          )}
          {badges.invite > 0 && (
            <span className={`px-3 py-1 rounded-full text-white ${CATEGORY_META.invite.badgeClass}`}>
              🤝 {badges.invite} 個兄弟姊妹加入
            </span>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-1">
        {activeFilters.map((f) => {
          const isActive = filter === f.key;
          const count = filterCounts[f.key] || 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors ${
                isActive
                  ? 'bg-rose-50 text-rose-700 border-b-2 border-rose-500'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    isActive ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {Object.keys(errors || {}).length > 0 && (
          <div className="px-4 py-3 text-center text-sm text-rose-600 border-b border-rose-100 bg-rose-50/50">
            部分通知載入失敗：{Object.values(errors).join('；')}
          </div>
        )}

        {loading && filteredItems.length === 0 && (
          <div className="px-4 py-16 text-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            載入中...
          </div>
        )}

        {!loading && filteredItems.length === 0 && (
          <div className="px-4 py-16 text-center">
            <div className="text-4xl mb-2">✨</div>
            <div className="text-base font-bold text-slate-700">
              {filter === 'all' ? '暫時無通知' : `暫時無${activeFilters.find((f) => f.key === filter)?.label || '通知'}`}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              新嘅商戶報價、待辦、邀請接受會即刻顯示
            </div>
          </div>
        )}

        {filteredItems.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.system;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left px-5 py-4 transition-colors flex gap-3 items-start ${meta.hoverBgClass}`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full text-white text-sm font-black flex items-center justify-center flex-shrink-0 ${avatarGradient(item.category)}`}
                    >
                      {item.category === 'proposal' ? meta.icon : item.actorInitial || meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-bold text-slate-800 truncate flex items-center gap-1">
                          <span className="text-xs">{meta.icon}</span>
                          {item.actorName}
                        </span>
                        {item.category === 'proposal' && item.meta?.price && (
                          <span
                            className={`font-bold text-sm whitespace-nowrap flex-shrink-0 ${meta.textClass}`}
                          >
                            {item.meta.price}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1 leading-snug line-clamp-2">
                        {item.preview}
                      </p>
                      <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
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

      {/* Footer summary */}
      {!loading && filteredItems.length > 0 && (
        <div className="text-center text-xs text-slate-400 mt-4">
          共 {filteredItems.length} 個通知
          {filter !== 'all' && filterCounts.all > filteredItems.length && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="ml-2 text-rose-600 hover:text-rose-800 font-bold"
            >
              查看全部
            </button>
          )}
        </div>
      )}
    </div>
  );
}