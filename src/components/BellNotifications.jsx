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
// which aggregates 3 sources (proposals, NEW tasks for the current
// event, helper accepted invitations) into a single sorted feed.
//
// 2026-08-09 (later) — task comments + status updates dropped from the
// bell. The collectionGroup queries for those collections referenced
// fields that didn't exist on the comment/statusUpdate doc (the
// assignedVendorUid / assignedHelperUid live on the parent task, not
// the comment itself). The bell now shows proposals + new tasks + new
// helpers, and the user opens a task to see comments/status updates.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, ExternalLink, Loader2, X } from 'lucide-react';
// 2026-08-17 — Manus step 17: animated bell badge. Count tweens
// up/down between renders instead of snapping. Lives in /hooks
// so it's unit-testable in isolation (see useCountUp.test.js).
import { useCountUp } from '../hooks/useCountUp';
import {
  useNotifications,
  markAllNotificationsSeen,
  // 2026-08-17 — Manus A10: per-device readAt sync via Firestore.
  markCommentAlertsRead,
  CATEGORY_META,
  MAX_BELL_DROPDOWN_ITEMS,
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
  eventId,
  onOpenProposal,
  onOpenComment,
  // 2026-08-17 — Big Day comment-alert click handler. Routes the
  // couple to the WeddingDay view instead of the checklist.
  onOpenCommentAlert,
  onOpenStatus,
  onOpenInvite,
  onOpenDashboard,
  // 2026-08-23 — Manus P3 (PDF Patch 3): role forwarding. The
  // useNotifications hook accepts a userRole parameter that gates
  // owner-only sources (proposals / tasks / helper-invites). Bell
  // callers used to omit it and silently fall into the default
  // 'owner' path — vendor / helper bells were opening listeners
  // they never needed. Add userRole as a typed prop, default to
  // 'owner' so existing single-role callers keep their behaviour,
  // and forward it to the hook.
  userRole = 'owner',
  // 2026-08-17 — Manus A9: explicit `enabled` flag from the caller.
  // Defaults to true so the bell subscribes eagerly (the badge needs
  // to appear the moment an alert arrives, without waiting for the
  // user to open the dropdown). App.jsx passes false for
  // reception / guest_portal roles that have no inbox.
  enabled: enabledProp = true,
  // 2026-08-20 — Manus bell observability (audit §vendor-bell):
  // diagnostic transport. The bell emits structured triage
  // signals at four points (private-inbox-state, private-inbox-error,
  // item-click, item-click-failed, per-item-mark-read-failed).
  // Caller decides where to ship — App.jsx console.error's only.
  diagnosticRole = null,
  onDiagnostic,
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
  // 2026-08-20 — Manus: visible feedback when an item-click
  // throws. Rendered at the top of the dropdown body, alongside
  // the existing source-error banner.
  const [interactionError, setInteractionError] = useState(null);
  // 2026-08-09 — localSeenTick forces an immediate re-render when the
  // user clicks 全部已讀. The hook also dispatches a window event for
  // the same purpose (so other open panels stay in sync), but the
  // event listener inside the hook subscribes asynchronously after
  // mount — there can be a tick of latency on first interaction.
  // The local state update is synchronous, so the badge clears on
  // the very next render no matter what.
  const [localSeenTick, setLocalSeenTick] = useState(0);
  // 2026-08-20 — Manus bell observability (audit §vendor-bell).
  // emitDiagnostic: structured triage signal for the bell's four
  // failure modes (private-inbox error, item-click exception,
  // per-item mark-read failure). Always fires the optional
  // onDiagnostic callback if the parent provided one; we never
  // throw inside the bell on missing callbacks.
  const emitDiagnostic = useCallback(
    (stage, extra = {}, error = null) => {
      const diagnostic = {
        area: 'vendor-notification-bell',
        stage,
        at: new Date().toISOString(),
        uid: selfUid || null,
        role: diagnosticRole || null,
        ...extra,
        // Error is its own field; keep it last so it doesn't
        // collide with `extra` keys.
        ...(error
          ? { errorMessage: String(error?.message || error).slice(0, 240) }
          : null),
      };
      if (typeof onDiagnostic === 'function') onDiagnostic(diagnostic);
    },
    [selfUid, diagnosticRole, onDiagnostic],
  );
  const { items, badges, totalNew, loading, errors, commentAlerts } = useNotifications({
    ownerUid,
    coupleUid,
    selfUid,
    eventId,
    // 2026-08-23 — Manus P3: forward the caller-supplied role so
    // vendor / helper bells don't open owner-only listeners. See
    // useNotifications userRole gate (P0.4) for the gate logic.
    userRole,
    // Bump a localSeenTick on 全部已讀 so this consumer re-renders
    // immediately even if the hook's window-event listener hasn't
    // fired yet (first interaction, event listener async-mount race).
    // The hook also reads from localStorage, so the fresh markers are
    // already there when this re-render runs.
    refreshKey: localSeenTick,
    // 2026-08-17 — Manus A9: honor the caller's enabled flag. The
    // bell used to gate subscriptions on `open || liveTotalNew > 0`
    // which made vendors/helpers invisible until the first alert
    // arrived. Now App.jsx computes `enabled` per-role and we use
    // it directly. The `open || liveTotalNew > 0` heuristic is no
    // longer needed: the cost of 1-4 onSnapshot listeners per
    // signed-in user is acceptable for the badge to be live.
    enabled: enabledProp,
  });
  // 2026-08-17 — Manus step 17: animated badge. `useCountUp` returns
  // a tweened integer that interpolates from the previous `totalNew`
  // to the current one over ~420ms. Each render the bell passes the
  // latest `totalNew`; the hook handles the rest.
  //
  // We also compute `displayedTotal` here (the rounded animated
  // value) so the badge renders the tweened number, not the snap-to
  // target. `9+` is preserved when the animated value crosses 9.
  //
  // TDZ note: this MUST come AFTER the useNotifications destructure
  // above, because we read `totalNew` from it. The 2026-08-09 TDZ
  // regression test (smoke.test.jsx) catches a similar pattern; the
  // ordering here is intentional.
  const animatedTotal = useCountUp(totalNew, { durationMs: 420 });
  const displayedTotal = Math.min(99, Math.max(0, Math.round(animatedTotal)));
  const badgeText = displayedTotal > 9 ? '9+' : displayedTotal;
  // 2026-08-17 — Manus step 17: brief scale pulse on new-arrival.
  // We track the previous displayed value via a ref. When the count
  // goes UP (new alert arrived) we toggle a CSS class for ~600ms
  // so the badge pops. We do NOT pulse on count-down (mark-read)
  // because that's expected behavior, not a "new!" moment.
  const [pulseKey, setPulseKey] = useState(0);
  const prevDisplayedRef = useRef(displayedTotal);
  useEffect(() => {
    if (displayedTotal > prevDisplayedRef.current) {
      setPulseKey((k) => k + 1);
    }
    prevDisplayedRef.current = displayedTotal;
  }, [displayedTotal]);
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
      // The proposal marker is the absolute count of proposals in
      // the bell (not the badge delta). Without this the badge
      // would persist: if 3 proposals exist and the user has marked
      // 2 as read, the marker would jump from "2" to "1" (the badge
      // count) and the next render would show badges.proposal = 3
      // - 1 = 2 — WRONG. The marker must equal the total count so
      // proposalCount - marker = 0.
      //
      // For task + invite the marker is a timestamp; the badge logic
      // filters by "newer than marker", so Date.now() at click time
      // is correct.
      proposal: proposalCount,
      task: Date.now(),
      invite: Date.now(),
      // 2026-08-17 — per-event timestamp, same shape as task.
      comment: Date.now(),
    });
    // 2026-08-17 — Manus A10: also mark every unread comment alert
    // as read on Firestore. The localStorage marker above is for
    // cold-start hydration; this batch write is the live sync
    // (cross-device, cross-tab). Fire-and-forget — the onSnapshot
    // on the inbox will pick up the readAt flips within one tick
    // and the badges useMemo recomputes against the new state.
    if (selfUid && Array.isArray(commentAlerts)) {
      markCommentAlertsRead(selfUid, commentAlerts, eventId).catch(() => {
        // Already logged inside the helper; nothing else to do.
      });
    }
    // Bump local tick so this component re-renders immediately
    // against the fresh localStorage markers. The hook also listens
    // for the dispatched event, but using local state here is
    // synchronous and removes any race with the async listener mount.
    setLocalSeenTick((t) => t + 1);
  };

  const handleItemClick = (item) => {
    // 2026-08-20 — Manus bell observability (audit §vendor-bell):
    // React error boundaries DO NOT catch event-handler exceptions,
    // so handleItemClick must wrap its own try/catch. Failure
    // mode: a thrown navigation handler (e.g. a downstream
    // callback that reads a now-stale currentEvent) would otherwise
    // surface as a raw exception to the browser console + leave
    // the bell open without feedback.
    if (!item) return;
    setOpen(false);
    setInteractionError(null);
    try {
      // 2026-08-20 — Manus bell observability: item-click success
      // signal. We emit BEFORE the side effects so a downstream
      // throw still produces a paired `item-click` + `item-click-failed`
      // pair for triage (otherwise we'd only see the failure).
      emitDiagnostic('item-click', {
        category: item.category || null,
        alertDocId: item.alertDocId || null,
        parentId: item.meta?.parentId || null,
        commentId: item.meta?.commentId || null,
      });
      // 2026-08-17 — Manus step 16: per-item mark-as-read. When the
      // user clicks a `comment`-category bell item that is still
      // unread, optimistically update Firestore so the badge drops
      // on this device + every other device the user has open.
      //
      // For non-comment categories (proposal / task / invite) the
      // mark-all-seen model still applies — there's no per-doc
      // readAt to set. Clicking those just navigates.
      if (
        item.category === 'comment' &&
        !item.readAt &&
        item.alertDocId &&
        selfUid
      ) {
        // Fire-and-forget: the Firestore snapshot will catch up on
        // its own and the localStorage hydration gate is bumped
        // inside markCommentAlertsRead for cold-start safety. We
        // don't await here so the navigation feels instant.
        markCommentAlertsRead(selfUid, [{ id: item.alertDocId }], eventId).catch(
          (err) => {
            // 2026-08-20 — Manus: route through emitDiagnostic so
            // triage sees both the success item-click and this
            // follow-up failure in one stream.
            emitDiagnostic(
              'per-item-mark-read-failed',
              { alertDocId: item.alertDocId || null },
              err,
            );
          },
        );
      }
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
        // Also seeds focusedParent* for A8 deep-link.
        case 'comment':
          // 2026-08-17 — Manus step 16: prefer onOpenCommentAlert if
          // provided (deep-links to wedding-day + scrolls). Fall
          // back to onOpenComment for callers that haven't migrated
          // to the alert handler yet.
          if (onOpenCommentAlert) onOpenCommentAlert(item.meta);
          else if (onOpenComment) onOpenComment(item.meta);
          break;
        case 'invite':
          if (onOpenInvite) onOpenInvite(item.meta);
          break;
        default:
          break;
      }
    } catch (error) {
      // 2026-08-20 — Manus: catch + show user-visible fallback.
      // Re-open the dropdown so the user can try again; emit a
      // paired item-click-failed diagnostic with the original
      // error message (truncated to 240 chars for triage safety).
      setInteractionError('未能打開通知，請再試一次。');
      setOpen(true);
      emitDiagnostic(
        'item-click-failed',
        { category: item?.category || null, alertDocId: item?.alertDocId || null },
        error,
      );
    }
  };

  // 2026-08-17 — Manus step 16: per-item "X" dismiss. Stops event
  // propagation so the X click doesn't also trigger the row's
  // main onClick (which would navigate + mark-read as a side
  // effect). Only meaningful for `comment` items because other
  // categories don't have a per-doc readAt to write — for those,
  // the X is hidden so the user isn't tempted to use it.
  const handleDismiss = (item, e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!item || item.category !== 'comment') return;
    if (item.readAt || !item.alertDocId || !selfUid) return;
    markCommentAlertsRead(selfUid, [{ id: item.alertDocId }], eventId).catch(
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[BellNotifications] dismiss mark-read failed', err?.message);
      },
    );
  };

  // 2026-08-20 — Manus bell observability: emit a private-inbox
  // signal on every render where errors.comment is set, so triage
  // can correlate a permission-denied inbox with the surrounding
  // bell state.
  if (diagnosticRole === 'vendor') {
    if (errors?.comment) {
      emitDiagnostic(
        'private-inbox-error',
        {},
        new Error(errors.comment),
      );
    } else {
      emitDiagnostic('private-inbox-state', {
        alertCount: commentAlerts.length,
        unreadCount: totalNew,
        loading: Boolean(loading),
      });
    }
  }
  // 2026-08-20 — Manus bell observability (audit §vendor-bell):
  // mount/unmount lifecycle diagnostics. Fires for vendor bell
  // mounts + cleanups so triage can distinguish "bell never
  // mounted" (component-level bug) from "bell mounted but
  // errored" (boundary / hook failure). The cleanup runs on
  // every unmount, including HMR / role-switch transitions.
  useEffect(() => {
    if (diagnosticRole !== 'vendor') return undefined;
    emitDiagnostic('mount');
    return () => emitDiagnostic('unmount');
  }, [diagnosticRole, emitDiagnostic]);
  const proposalCount = items.filter((i) => i.category === 'proposal').length;
  // 2026-08-09 — bell dropdown truncates to MAX_BELL_DROPDOWN_ITEMS (20)
  // for visual density. The full notifications-center view shows every
  // item; the "查看全部" footer navigates there. We slice here, NOT in
  // the hook, so both consumers share the same subscription cost.
  const bellItems = items.slice(0, MAX_BELL_DROPDOWN_ITEMS);
  const hasMore = items.length > MAX_BELL_DROPDOWN_ITEMS;

  // 2026-08-09 — 查看全部 navigates to the full notifications-center
  // view (always shown when there are items, regardless of truncation).
  const handleViewAll = () => {
    setOpen(false);
    if (onOpenDashboard) onOpenDashboard();
  };

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
        className={`relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors`}
      >
        <Bell
          className={`w-5 h-5 ${totalNew > 0 ? 'text-rose-500 fill-rose-200' : ''}`}
        />
        {/* 2026-08-17 — Manus step 17: animated badge. Renders
            the tweened `displayedTotal` instead of the snap
            `totalNew` so the count rolls up/down smoothly.
            `pulseKey` is bumped on count-up to retrigger the
            CSS scale-pulse animation per arrival (vs. playing
            once and never again). */}
        {displayedTotal > 0 && (
          <span
            key={pulseKey}
            data-testid="bell-badge"
            className={`absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white ${
              pulseKey > 0 ? 'animate-bell-pulse' : ''
            }`}
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="通知"
          className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[150] overflow-hidden"
        >
          {/* 2026-08-20 — Manus: event-handler failure banner.
              Visible only when handleItemClick catches an exception. */}
          {interactionError && (
            <div
              role="alert"
              className="px-4 py-3 text-center text-xs text-rose-700 border-b border-rose-100 bg-rose-50"
            >
              {interactionError}
            </div>
          )}
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
              {badges.task > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-white ${CATEGORY_META.task.badgeClass}`}>
                  📋 {badges.task} 個新待辦
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

            {loading && bellItems.length === 0 && (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                載入中...
              </div>
            )}

            {!loading && bellItems.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="text-3xl mb-2">✨</div>
                <div className="text-sm font-bold text-slate-700">暫時無新通知</div>
                <div className="text-xs text-slate-500 mt-1">
                  商戶報價、新待辦、邀請接受會即刻顯示
                </div>
              </div>
            )}

            {bellItems.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {bellItems.map((item) => {
                  const meta = CATEGORY_META[item.category] || CATEGORY_META.system;
                  // 2026-08-17 — Manus step 16: unread styling.
                  // `comment` items have a per-doc readAt; other
                  // categories use localStorage hydration so we
                  // can't render a per-item unread dot for them.
                  // Proposal items always feel "fresh" since they
                  // require explicit click — no dot.
                  const isUnread =
                    item.category === 'comment' && !item.readAt;
                  // 2026-08-17 — Manus step 16: refactored the row
                  // from <button> to <div role="button"> so the
                  // X-dismiss child can also be a real <button>
                  // (was previously <span role="button">, which
                  // triggered an HTML "button in button" dev-mode
                  // warning). <div role="button"> keeps the same
                  // click + keyboard surface without the nesting
                  // problem. Mouse + Enter / Space are handled here.
                  const onRowKeyDown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleItemClick(item);
                    }
                  };
                  return (
                    <li key={item.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleItemClick(item)}
                        onKeyDown={onRowKeyDown}
                        className={`w-full text-left px-4 py-3 transition-colors flex gap-3 items-start cursor-pointer ${meta.hoverBgClass}`}
                      >
                        {/* Avatar circle — first letter, tinted by category */}
                        <div className={`w-9 h-9 rounded-full text-white text-sm font-black flex items-center justify-center flex-shrink-0 ${avatarGradient(item.category)}`}>
                          {item.category === 'proposal' ? meta.icon : item.actorInitial || meta.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-bold text-slate-800 text-sm truncate flex items-center gap-1">
                              {/* 2026-08-17 — Manus step 16: small unread
                              dot to the left of the actor name. Only
                              shown for comment items with readAt
                              null. Uses rose-500 so it pops on a
                              white background without competing with
                              the avatar tint. */}
                              {isUnread && (
                                <span
                                  aria-label="未讀"
                                  className="inline-block w-2 h-2 rounded-full bg-rose-500 flex-shrink-0"
                                />
                              )}
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
                        {/* 2026-08-17 — Manus step 16: per-item X
                        dismiss. Only on unread `comment` items.
                        Real <button> (not span role="button") — the
                        outer row is now a div with role="button"
                        so HTML nesting is valid. */}
                        {isUnread && (
                          <button
                            type="button"
                            aria-label="標為已讀"
                            title="標為已讀"
                            onClick={(e) => handleDismiss(item, e)}
                            className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
                            data-testid={`bell-dismiss-${item.id}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer — 查看全部 navigates to the full notifications-center
              view. Only shown when there are items (would be confusing
              to click "view all" on an empty dropdown). The label
              hints at the dropdown truncation when relevant. */}
          {items.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50">
              <button
                onClick={handleViewAll}
                data-testid="bell-view-all"
                className="w-full text-sm font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg py-1.5 flex items-center justify-center gap-1.5 transition-colors"
              >
                查看全部
                {hasMore && (
                  <span className="text-xs text-slate-500 font-normal">
                    （共 {items.length} 個，呢度只顯示頭 {MAX_BELL_DROPDOWN_ITEMS} 個）
                  </span>
                )}
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
