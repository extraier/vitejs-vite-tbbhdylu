// 2026-08-09 — useNotifications
//
// Unified notification feed for the header bell. Aggregates a small number
// of sources into a single sorted list, so one click shows the couple
// everything that's changed since they last looked.
//
// 2026-08-09 (later) — Simplified to per-event subscriptions. The earlier
// version used collectionGroup('comments') and collectionGroup('statusUpdates')
// to aggregate activity across the owner's OWN events, but the top-level
// rules for those collections referenced fields that don't exist on the
// comment/statusUpdate doc (assignedVendorUid / assignedHelperUid live on
// the PARENT task, not the comment itself). The rules returned false for
// every read, and the bell panel produced
// "Missing or insufficient permissions" errors on every refresh.
//
// The fix: drop the comments/statusUpdates aggregation entirely. The bell
// now shows:
//   1. **Vendor proposals** on /proposals filtered by coupleUid.
//   2. **New tasks** for the current event (owner creates one for the
//      couple's wedding; vendor/helper creates one as they engage).
//   3. **Helper accepted invitation** — per-helper doc flip on
//      /users/{ownerUid}/helpers/{helperUid}.status from 'invited' to 'active'.
//
// Sources that are deferred to follow-up commits (need new server-side
// fields or new rules):
//   - Task comments (visible at the task view in <TaskComments>)
//   - Task status updates (visible at the task view in <TaskActivityTimeline>)
//   - Vendor chat inbox messages (already has its own badge)
//   - Photo uploads (needs denormalized event-feed counter)
//   - Cron reminders (needs Cloud Scheduled function)
//
// Why per-event instead of collectionGroup:
//   - Each subscription is a single, narrow read against a path the
//     rule already allows. No new top-level rules needed.
//   - N subscriptions per event was never the right pattern — couples
//     have N events, not M tasks-per-event. Per-event is the right scope.
//
// Client-side sort:
//   - Each source subscribes to its own shape; we merge, sort by
//     createdAt, slice to 20. The merge happens on every snapshot —
//     React batches the state update so the panel rerenders once.
//
// Mark-read semantics:
//   - Per-source localStorage keys: lastSeenTasksAt_<ownerUid>_<eventId>,
//     lastSeenHelperAcceptAt_<ownerUid> (existing),
//     lastSeenProposalsCount_<ownerUid> (existing).
//   - "全部已讀" writes each source's marker to "now". The bell badge
//     computes per-source delta and sums them.

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  // 2026-08-20 — Bug fix: FieldValue.serverTimestamp() is undefined.
  // The modular firebase/firestore SDK exports `serverTimestamp` as its
  // own named symbol, not as a method on FieldValue (FieldValue is a
  // class for sentinel values). Importing `FieldValue` and calling
  // `.serverTimestamp()` on it throws `Si.serverTimestamp is not a
  // function`, which silently broke per-item mark-read on the bell
  // (see /Users/roger/Downloads/savetheday.io-1787158581672.log for the
  // user-reported symptom: clicking a notification item did nothing and
  // 全部已讀 did nothing). Use the named export.
  serverTimestamp,
  onSnapshot,
  query,
  where,
  limit as fsLimit,
  writeBatch,
} from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

// ---- Notification envelope (single shape for every source) ----
//
// All sources normalize to this so the dropdown can render any item
// without per-source branch logic.
//
//   id:           stable id (source-kind + db-doc-id)
//   category:     one of CATEGORY_META keys
//   actorRole:    'vendor' | 'helper' | 'partner' | 'system' | 'guest'
//   actorName:    display name (vendor name, helper name, etc.)
//   title:        short label ('商戶報價', '待辦新留言', etc.)
//   preview:      <100 chars body excerpt
//   href:         { view: <AppViewId>, ...params } — what clicking opens
//   createdAt:    epoch ms (for sort + "X時間前")
//   sourceKey:    which marker the "已讀" state belongs to
//   seenKey:      localStorage key for "last seen" marker
//   meta:         source-specific extra (price, commentId, etc.) — optional
export const CATEGORY_META = {
  proposal: {
    icon: '💬',
    color: 'amber',
    label: '商戶報價',
    pluralLabel: '商戶報價',
    bgClass: 'from-amber-400 to-rose-400',
    hoverBgClass: 'hover:bg-amber-50/50',
    textClass: 'text-amber-600',
    badgeClass: 'bg-amber-500',
    borderClass: 'border-amber-200',
  },
  task: {
    icon: '📋',
    color: 'cyan',
    label: '待辦事項',
    pluralLabel: '待辦事項',
    bgClass: 'from-cyan-400 to-blue-400',
    hoverBgClass: 'hover:bg-cyan-50/50',
    textClass: 'text-cyan-600',
    badgeClass: 'bg-cyan-500',
    borderClass: 'border-cyan-200',
  },
  invite: {
    icon: '🤝',
    color: 'purple',
    label: '邀請已被接受',
    pluralLabel: '邀請接受',
    bgClass: 'from-purple-400 to-fuchsia-400',
    hoverBgClass: 'hover:bg-purple-50/50',
    textClass: 'text-purple-600',
    badgeClass: 'bg-purple-500',
    borderClass: 'border-purple-200',
  },
  // 2026-08-17 — Vendor / helper post a comment on 大日流程 /
  // 物資 (Big Day rundown entry / resource item). The vendor's
  // comment lives at
  //   /events/{eventId}/{rundown|resources}/{parentId}/comments/{commentId}
  // and the cloud function emits a small owner-scoped notification
  // doc at
  //   /events/{eventId}/commentsAlerts/{alertId}
  // which this hook subscribes to. The 'comment' category is the
  // bell-visible item the couple taps to jump back to the parent.
  comment: {
    icon: '💬',
    color: 'indigo',
    label: '待辦新留言',
    pluralLabel: '新留言',
    bgClass: 'from-indigo-400 to-violet-400',
    hoverBgClass: 'hover:bg-indigo-50/50',
    textClass: 'text-indigo-600',
    badgeClass: 'bg-indigo-500',
    borderClass: 'border-indigo-200',
  },
  chat: {
    icon: '✉️',
    color: 'pink',
    label: '商戶新訊息',
    pluralLabel: '商戶訊息',
    bgClass: 'from-pink-400 to-rose-400',
    hoverBgClass: 'hover:bg-pink-50/50',
    textClass: 'text-pink-600',
    badgeClass: 'bg-pink-500',
    borderClass: 'border-pink-200',
  },
  system: {
    icon: 'ℹ️',
    color: 'gray',
    label: '系統',
    pluralLabel: '系統通知',
    bgClass: 'from-slate-400 to-slate-500',
    hoverBgClass: 'hover:bg-slate-50/50',
    textClass: 'text-slate-600',
    badgeClass: 'bg-slate-500',
    borderClass: 'border-slate-200',
  },
};

// ---- localStorage keys for per-source "last seen" markers ----
const SEEN_KEYS = {
  proposal: (ownerUid) => `lastSeenProposalsCount_${ownerUid}`,
  task: (ownerUid, eventId) => `lastSeenTasksAt_${ownerUid}_${eventId || '0'}`,
  invite: (ownerUid) => `lastSeenHelperAcceptAt_${ownerUid}`,
  // 2026-08-17 — per-event timestamp for vendor / helper comments.
  // Same shape as `task` because we want "新留言 since X" semantics,
  // not absolute count. The commentsAlerts subcollection is
  // pruned on the client only when the user clicks 全部已讀
  // (which writes lastSeenCommentsAt_<ownerUid>_<eventId>=now).
  comment: (ownerUid, eventId) => `lastSeenCommentsAt_${ownerUid}_${eventId || '0'}`,
};

// Read a "last seen" marker from localStorage. Returns 0 if missing.
function readSeen(ownerUid, sourceKey, eventId) {
  if (!ownerUid || typeof SEEN_KEYS[sourceKey] !== 'function') return 0;
  try {
    const raw = window.localStorage.getItem(SEEN_KEYS[sourceKey](ownerUid, eventId));
    if (!raw) return 0;
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

// 2026-08-09 — `bell:mark-all-seen` is dispatched on `window` whenever
// the user clicks 全部已讀. The useNotifications hook listens for it
// and bumps an internal tick so the badges useMemo recomputes against
// the fresh localStorage markers. Without this, writing to localStorage
// silently does nothing — React doesn't know the storage changed.
const MARK_SEEN_EVENT = 'bell:mark-all-seen';

function writeSeen(ownerUid, sourceKey, value, eventId) {
  if (!ownerUid || typeof SEEN_KEYS[sourceKey] !== 'function') return;
  try {
    window.localStorage.setItem(SEEN_KEYS[sourceKey](ownerUid, eventId), String(value));
  } catch {
    // ignore
  }
}

// Writer exported for the bell's "全部已讀" button. The caller passes
// the value to use for each source — for proposals it's the absolute
// count (so the marker is exact), for others it's a timestamp (so
// "last seen" semantics work). Caller's responsibility to pass the
// right shape.
//
// After writing, dispatch the window event so any mounted
// useNotifications hook re-evaluates its badges useMemo against the
// fresh markers. (localStorage writes don't trigger React renders.)
export function markAllNotificationsSeen(ownerUid, badges, eventId) {
  if (!ownerUid) return;
  for (const [sourceKey, value] of Object.entries(badges || {})) {
    if (typeof SEEN_KEYS[sourceKey] !== 'function') continue;
    try {
      window.localStorage.setItem(SEEN_KEYS[sourceKey](ownerUid, eventId), String(value));
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(MARK_SEEN_EVENT, { detail: { ownerUid, eventId } }));
    } catch {
      // ignore
    }
  }
}

// 2026-08-17 — Manus A10. Marks every unread Big Day comment
// alert as read on Firestore (per-recipient inbox). The rules
// permit this: client `update` is allowed when ONLY `readAt`
// changes. We batch the writes so cross-device sync is atomic
// per-tick — the bell on every other device will clear within
// one snapshot.
//
// `alerts` is the current `commentAlerts` array (with `id` and
// `readAt` fields already populated from the inbox snapshot).
// We skip entries that already have a `readAt` to avoid pointless
// writes (and to keep the rules' `request.resource.data.diff(
// resource.data).affectedKeys().hasOnly(['readAt'])` happy when
// the new value equals the existing value — actually that's fine,
// but no point burning a write).
//
// Returns the number of alerts that were marked read.
export async function markCommentAlertsRead(selfUid, alerts, eventId) {
  if (!selfUid || !Array.isArray(alerts) || alerts.length === 0) return 0;
  const unread = alerts.filter((a) => !a.readAt && a.id);
  if (unread.length === 0) return 0;
  const batch = writeBatch(db);
  for (const a of unread) {
    const ref = doc(
      db,
      'artifacts',
      appId,
      'users',
      selfUid,
      'notifications',
      a.id,
    );
    // 2026-08-20 — was FieldValue.serverTimestamp(), which is undefined
    // in the modular firebase/firestore SDK. See comment on the import.
    batch.update(ref, { readAt: serverTimestamp() });
  }
  // Also bump the localStorage hydration gate so subsequent
  // cold starts don't suddenly show historical alerts as unread
  // (the Firestore write covers the cross-device case; this
  // covers the cold-start-from-clean-localStorage case).
  const markerKey = SEEN_KEYS.comment(selfUid, eventId);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(markerKey, String(Date.now()));
    }
  } catch {
    // ignore
  }
  try {
    await batch.commit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[useNotifications] markCommentAlertsRead batch failed', err?.message);
    return 0;
  }
  // Notify other mounted bells in this tab so their badges
  // recompute synchronously (Firestore snapshot will catch
  // up async but this is instant).
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(MARK_SEEN_EVENT, { detail: { selfUid, eventId } }));
    } catch {
      // ignore
    }
  }
  return unread.length;
}

// ---- Helpers to build notification items from raw docs ----

function summarize(text, max = 50) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

function initialOf(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '商';
  const first = trimmed[0];
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

function proposalItems(docs, ownerUid) {
  return docs.map((d) => ({
    id: `proposal:${d.id}`,
    category: 'proposal',
    actorRole: 'vendor',
    actorName: d.vendorName || '商戶',
    actorInitial: initialOf(d.vendorName),
    title: '商戶報價',
    preview: summarize(d.message) || '已發送報價',
    meta: { price: d.price || '待定', jobId: d.jobId || '' },
    href: { view: 'couple-jobboard', jobId: d.jobId || '', source: 'proposal' },
    createdAt: toMillis(d.createdAt),
    sourceKey: 'proposal',
  }));
}

function taskItems(docs, ownerUid, eventId) {
  return docs.map((d) => ({
    id: `task:${d.id}`,
    category: 'task',
    actorRole: d.assignedVendorUid ? 'vendor' : (d.assignedHelperUid ? 'helper' : 'owner'),
    actorName: d.assignedVendorName || d.assignedHelperName || '待辦',
    actorInitial: initialOf(d.assignedVendorName || d.assignedHelperName || '待'),
    title: '新待辦事項',
    preview: summarize(d.title) || '已新增待辦',
    meta: { taskId: d.id, eventId },
    href: { view: 'couple-checklist', taskId: d.id, eventId, source: 'task' },
    createdAt: toMillis(d.createdAt),
    sourceKey: 'task',
  }));
}

function inviteItems(docs) {
  return docs.map((d) => ({
    id: `invite:${d.id}`,
    category: 'invite',
    actorRole: 'helper',
    actorName: d.name || d.email || '兄弟姊妹',
    actorInitial: initialOf(d.name || d.email),
    title: '邀請已被接受',
    preview: summarize(d.email) || '已加入您的婚禮',
    meta: {
      helperUid: d.id,
      perms: d.perms || {},
      status: d.status,
    },
    href: { view: 'helpers-overview', source: 'invite' },
    createdAt: toMillis(d.acceptedAt) || toMillis(d.updatedAt) || Date.now(),
    sourceKey: 'invite',
  }));
}

// 2026-08-17 — Bidirectional recipient-private inbox (Manus step 11).
//
// Cloud Function writes alerts to:
//   /artifacts/{appId}/users/{recipientUid}/notifications/
//     bigday-comment_{commentId}_{recipientUid}
//
// Each role participant (owner, co-owner, assigned vendor, helper)
// gets their own per-tenant inbox. The hook now subscribes to the
// SIGNED-IN USER's inbox via `selfUid` (not the owner's `ownerUid`),
// with a `where('type', '==', 'bigday-comment')` filter so we don't
// pick up other notification categories that may share the
// /notifications/ collection later.
//
// The hook no longer requires `eventId` for the comment source —
// the inbox is per-user, not per-event. Multiple events the user
// participates in all flow into the same inbox.
//
// The doc shape (what the CF writes, see functions/src/vendorComment.ts):
//   {
//     type: 'bigday-comment',         // notification category
//     notificationVersion: 1,         // schema version (per Manus 1.3)
//     recipientUid,                   // inbox owner
//     kind: 'rundown' | 'resources',  // parent kind for click routing
//     parentId, parentTitle,          // rundown / resource item ref
//     commentId,                      // idempotency trace + deep-link
//     authorUid, authorName, authorRole, // sender presentation
//     text,                           // 120-char preview (CF-truncated)
//     createdAt,                      // server timestamp (millis)
//     readAt intentionally absent — absence == unread (Manus A10).
//   }
// 2026-08-19 — Exported for unit tests. The P0.2 normalizer
// fix needs to be tested with multiple eventId permutations
// (data.eventId present, missing, with/without hook fallback).
export function commentItems(docs, ownerUid, eventId) {
  return docs.map((d) => {
    const kind = d.kind === 'resources' ? 'resources' : 'rundown';
    const actorName = d.authorName || (d.authorRole === 'vendor' ? '商戶' : '助手');
    // 2026-08-19 — Manus P0.2: prefer the alert doc's own eventId
    // (which the trigger writes from event.params.eventId at
    // fan-out time) over the hook's currently selected event.
    // Why: a vendor bell commonly has no currentEvent set (the
    // vendor views jobs across many weddings), and a user with
    // multiple events could be on event B while a comment lands
    // on event A. Clicking the alert in that state previously
    // routed to event B (the hook's eventId) instead of event A
    // (the alert's actual event). `data.eventId` is the
    // authoritative source; the hook's eventId is only a
    // fallback for legacy docs that pre-date the trigger writing
    // eventId.
    const resolvedEventId = d.eventId || eventId || null;
    return {
      id: `comment:${d.id}`,
      category: 'comment',
      actorRole: d.authorRole === 'vendor' ? 'vendor' : 'helper',
      actorName,
      actorInitial: initialOf(actorName),
      title:
        kind === 'rundown'
          ? `${actorName} 喺大日流程留言`
          : `${actorName} 喺物資留言`,
      preview: summarize(d.text) || d.parentTitle || '已留言',
      meta: {
        alertId: d.id,
        commentId: d.commentId || null,
        parentId: d.parentId || null,
        parentTitle: d.parentTitle || null,
        kind,
        eventId: resolvedEventId,
      },
      href: {
        view: 'wedding-day',
        eventId: resolvedEventId,
        kind,
        parentId: d.parentId || null,
        parentTitle: d.parentTitle || null,
        source: 'comment',
      },
      createdAt: toMillis(d.createdAt),
      sourceKey: 'comment',
      // 2026-08-17 — Manus step 16: surface `readAt` on the bell
      // item so the dropdown can render an unread dot AND the
      // click handler can mark just THIS alert read (vs the
      // existing mark-all-read which nukes the whole inbox's
      // unread state). `null` means unread.
      //
      // Other categories (proposal / task / invite) are
      // mark-all-seen via localStorage only — there's no
      // per-doc readAt for them, so this field is intentionally
      // omitted from those item shapes.
      readAt: d.readAt || null,
      // The alert doc id (without the `comment:` prefix the
      // hook adds to make it unique per category). Used by
      // markCommentAlertsRead(selfUid, [alert], eventId) which
      // takes the underlying doc ids.
      alertDocId: d.id,
    };
  });
}

// ---- The main hook ----

export const MAX_BELL_DROPDOWN_ITEMS = 20;
const PROPOSALS_LIMIT = 200;
const TASKS_LIMIT = 200;

export function useNotifications({
  ownerUid,
  coupleUid,
  selfUid,
  eventId,
  // 2026-08-19 — Manus P0.4: role-gate the owner-only sources
  // (proposals, tasks, helper-invites) so vendor / helper
  // sessions don't open their listeners. Defaults to 'owner' so
  // existing callers keep the current behaviour. The Big Day
  // comment inbox (Source 4) stays open for every role because
  // it's selfUid-scoped and serves the bell across roles.
  userRole = 'owner',
  // 2026-08-09 — refreshKey is an opaque counter the caller bumps
  // whenever they want to force a badges recomputation (e.g. after
  // writing localStorage markers via markAllNotificationsSeen). The
  // hook also listens for a window event for the same purpose, but
  // the local refreshKey is synchronous and removes any race with
  // the event listener mount.
  refreshKey = 0,
  enabled = true,
}) {
  // 2026-08-19 — Manus P0.4: explicit predicate. Co-owner mirrors
  // owner for the purposes of the proposals/tasks/invites sources
  // because both roles own the wedding. Vendor / helper / partner
  // / reception only get the comment inbox.
  const isOwner = userRole === 'owner' || userRole === 'co-owner';
  const [proposals, setProposals] = useState(null); // null = loading
  const [tasks, setTasks] = useState([]);
  const [helpers, setHelpers] = useState([]);
  // 2026-08-17 — vendor / helper comment alerts (see Source 4 below)
  const [commentAlerts, setCommentAlerts] = useState([]);
  const [errors, setErrors] = useState({});
  // 2026-08-09 — bumped by the `bell:mark-all-seen` window event so the
  // badges useMemo recomputes against the fresh localStorage markers
  // when the user clicks 全部已讀. Without this the marker writes succeed
  // but the badge stays put (React doesn't see localStorage changes).
  const [seenTick, setSeenTick] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setSeenTick((t) => t + 1);
    window.addEventListener(MARK_SEEN_EVENT, handler);
    return () => window.removeEventListener(MARK_SEEN_EVENT, handler);
  }, []);

  // ---- Source 1: vendor proposals (coupleUid scoped) ----
  useEffect(() => {
    // 2026-08-19 — Manus P0.4: gate on isOwner. Proposals are an
    // owner-only concern (the inbox is logged in as the couple);
    // vendor / helper sessions shouldn't pay the cost of
    // subscribing or the noise of empty results.
    if (!enabled || !isOwner || !coupleUid) {
      setProposals([]);
      return undefined;
    }
    let cancelled = false;
    setProposals(null);
    const q = query(
      collection(db, 'proposals'),
      where('coupleUid', '==', coupleUid),
      fsLimit(PROPOSALS_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => ({
          id: d.id,
          jobId: d.data().jobId || '',
          vendorName: d.data().vendorName || '商戶',
          price: d.data().price || '',
          message: d.data().message || '',
          createdAt: d.data().createdAt,
        }));
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setProposals(list);
      },
      (err) => {
        if (cancelled) return;
        console.error('[useNotifications] proposals error:', err);
        setErrors((s) => ({ ...s, proposal: err.message || '讀取失敗' }));
        setProposals([]);
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [coupleUid, enabled, isOwner]);

  // ---- Source 2: new tasks for the current event (per-event subscription) ----
  // Reads /users/{ownerUid}/events/{eventId}/tasks — the path the existing
  // /events/{eventId}/tasks/{taskId} read rule already covers (owner /
  // co-owner / vendor / helper). No new top-level rule needed.
  useEffect(() => {
    // 2026-08-19 — Manus P0.4: tasks are an owner-only notification
    // source. The vendor / helper already sees their assignments
    // through their role-specific dashboard subcollections; the
    // "new task" bell entry is meant for the couple and their co-owner.
    if (!enabled || !isOwner || !ownerUid || !eventId) {
      setTasks([]);
      return undefined;
    }
    let cancelled = false;
    const q = query(
      collection(db, 'artifacts', appId, 'users', ownerUid, 'events', eventId, 'tasks'),
      fsLimit(TASKS_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: data.title || '',
            assignedVendorUid: data.assignedVendorUid || null,
            assignedHelperUid: data.assignedHelperUid || null,
            assignedVendorName: data.assignedVendorName || null,
            assignedHelperName: data.assignedHelperName || null,
            createdAt: data.createdAt,
            eventId,
          };
        });
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setTasks(list);
      },
      (err) => {
        if (cancelled) return;
        console.error('[useNotifications] tasks error:', err);
        setErrors((s) => ({ ...s, task: err.message || '讀取失敗' }));
        setTasks([]);
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [ownerUid, eventId, enabled, isOwner]);

  // ---- Source 3: helpers (any "active" flip is a notification) ----
  // We subscribe to the owner's helpers collection. The docs are kept
  // around even after acceptance (they're the perms record), so we
  // detect "newly active" by comparing against the lastSeen timestamp.
  useEffect(() => {
    // 2026-08-19 — Manus P0.4: helper-invite notifications are
    // owner-only; the accepting vendor / helper doesn't need a
    // self-ping and the couple wants the "X just joined" alert.
    if (!enabled || !isOwner || !ownerUid) {
      setHelpers([]);
      return undefined;
    }
    let cancelled = false;
    const q = query(collection(db, 'artifacts', appId, 'users', ownerUid, 'helpers'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setHelpers(list);
      },
      (err) => {
        if (cancelled) return;
        console.error('[useNotifications] helpers error:', err);
        setErrors((s) => ({ ...s, invite: err.message || '讀取失敗' }));
        setHelpers([]);
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [ownerUid, enabled, isOwner]);

  // ---- Source 4 (2026-08-17): Big Day comment alerts ----
  //
  // Subscribes to the SIGNED-IN USER's PRIVATE notification inbox:
  //   /artifacts/{appId}/users/{selfUid}/notifications/
  //   where type == 'bigday-comment'
  //
  // Each recipient (owner, co-owner, vendor, helper) has their own
  // inbox; the hook is now role-agnostic. The bell subscriber is
  // whichever user is currently signed in (`selfUid`), so the same
  // hook backs owner, vendor, and helper bells with no special-casing
  // in the source.
  //
  // Filter `type == 'bigday-comment'` so other notification
  // categories that may eventually share the /notifications/
  // collection (e.g. future 'proposal-reply', 'task-reminder') don't
  // leak into the Big Day bell.
  //
  // `where` requires a Firestore composite index — see the rule
  // block added in firestore.rules. Index: collection-id
  // 'notifications', fields: type ASC, createdAt DESC.
  //
  // `eventId` is intentionally NOT a dependency here — the inbox is
  // per-user and includes alerts from every event they participate
  // in. Earlier code subscribed to a per-event subcollection and
  // missed alerts when the user switched event contexts.
  useEffect(() => {
    if (!enabled || !selfUid) {
      setCommentAlerts([]);
      return undefined;
    }
    let cancelled = false;
    const inboxRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      selfUid,
      'notifications',
    );
    const q = query(
      inboxRef,
      where('type', '==', 'bigday-comment'),
      fsLimit(TASKS_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            // notificationVersion: 1 — schema version. Hook currently
            // reads no versioned fields, but reserve the slot so a
            // future migration can branch.
            kind: data.kind === 'resources' ? 'resources' : 'rundown',
            parentId: data.parentId || null,
            parentTitle: data.parentTitle || null,
            commentId: data.commentId || null,
            eventId: data.eventId || null,
            ownerUid: data.ownerUid || null,
            authorUid: data.authorUid || null,
            authorName: data.authorName || null,
            authorRole: data.authorRole || 'vendor',
            text: data.text || '',
            createdAt: data.createdAt,
            readAt: data.readAt || null,
            // Source the cross-device unread state — Manus A10.
          };
        });
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setCommentAlerts(list);
      },
      (err) => {
        if (cancelled) return;
        console.error('[useNotifications] notifications error:', err);
        setErrors((s) => ({ ...s, comment: err.message || '讀取失敗' }));
        setCommentAlerts([]);
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [selfUid, enabled]);

  // ---- Merge + sort ----
  // Returns ALL items (no truncation). The bell dropdown caps the
  // rendered list to 20 client-side for visual density; the full
  // notifications-center view shows every item. Source-level Firestore
  // limits (PROPOSALS_LIMIT, TASKS_LIMIT) still cap how many docs the
  // hook can fetch — bump those if a single event has more than 50
  // tasks or 50 proposals in active conversation.
  const merged = useMemo(() => {
    const items = [
      ...proposalItems(proposals || [], ownerUid),
      ...taskItems(tasks, ownerUid, eventId),
      ...inviteItems(helpers.filter((h) => h.status === 'active')),
      ...commentItems(commentAlerts, ownerUid, eventId),
    ];
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return items;
  }, [proposals, tasks, helpers, commentAlerts, ownerUid, eventId]);

  // ---- Per-source "new since last seen" counts ----
  const badges = useMemo(() => {
    if (!ownerUid) return { proposal: 0, task: 0, invite: 0, comment: 0 };

    // Proposals: marker is the last-seen *count*. New = current count - marker.
    const lastSeenProposalCount = readSeen(ownerUid, 'proposal');
    const proposalCount = (proposals || []).length;
    const proposalNew = Math.max(0, proposalCount - lastSeenProposalCount);

    // Tasks: marker is a timestamp. New = tasks createdAt > marker.
    const lastSeenTaskAt = readSeen(ownerUid, 'task', eventId);
    const taskNew = tasks.filter((t) => toMillis(t.createdAt) > lastSeenTaskAt).length;

    // Invites: marker is a timestamp. New = helpers whose acceptedAt > marker.
    const lastSeenInviteAt = readSeen(ownerUid, 'invite');
    const inviteNew = helpers.filter((h) => {
      if (h.status !== 'active') return false;
      const ts = toMillis(h.acceptedAt) || toMillis(h.updatedAt) || 0;
      return ts > lastSeenInviteAt;
    }).length;

    // 2026-08-17 — Manus A10: unread state lives on Firestore
    // (`readAt == null`), NOT localStorage. The query is realtime;
    // mark-all-read writes `readAt: serverTimestamp()` on every
    // unread alert (see markCommentAlertsRead below) and the bell
    // recomputes instantly on the next snapshot tick. Cross-device
    // sync is automatic — open the bell on phone after marking
    // read on desktop and the badge clears on the phone too.
    //
    // The localStorage marker is retained ONLY as a one-time
    // hydration gate so the FIRST sync doesn't show "99 unread"
    // to a long-time user whose historical alerts are all unread
    // in Firestore. Once the user clicks 全部已讀 (or any
    // individual alert), the marker catches up and Firestore
    // takes over.
    const lastSeenCommentAt = readSeen(ownerUid, 'comment', eventId);
    const commentNew = (commentAlerts || []).filter((c) => {
      if (c.readAt) return false; // server-side acknowledged read
      const createdMs = toMillis(c.createdAt);
      // Hydration gate: ignore historical alerts from before the
      // first time this device saw the inbox. After hydration,
      // the localStorage marker should be >= every unread alert's
      // createdAt — so a non-zero marker filters them all.
      if (lastSeenCommentAt > 0 && createdMs <= lastSeenCommentAt) {
        return false;
      }
      return true;
    }).length;

    return {
      proposal: proposalNew,
      task: taskNew,
      invite: inviteNew,
      comment: commentNew,
    };
  }, [ownerUid, eventId, proposals, tasks, helpers, commentAlerts, seenTick, refreshKey]);

  const totalNew = badges.proposal + badges.task + badges.invite + badges.comment;

  const loading = proposals === null && totalNew === 0;

  return {
    items: merged,
    badges,
    totalNew,
    loading,
    errors,
    // 2026-08-17 — Manus A10: expose the raw comment-alert list so
    // the bell can call markCommentAlertsRead on click. The merged
    // `items` is the labeled/aggregated form (it strips `readAt`
    // and renames fields for display), so passing it directly to
    // markCommentAlertsRead wouldn't work — the writer needs the
    // raw doc id + readAt field.
    commentAlerts,
  };
}
