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
  onSnapshot,
  query,
  where,
  limit as fsLimit,
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

// ---- The main hook ----

const MAX_ITEMS = 20;
const PROPOSALS_LIMIT = 50;
const TASKS_LIMIT = 50;

export function useNotifications({
  ownerUid,
  coupleUid,
  selfUid,
  eventId,
  // 2026-08-09 — refreshKey is an opaque counter the caller bumps
  // whenever they want to force a badges recomputation (e.g. after
  // writing localStorage markers via markAllNotificationsSeen). The
  // hook also listens for a window event for the same purpose, but
  // the local refreshKey is synchronous and removes any race with
  // the event listener mount.
  refreshKey = 0,
  enabled = true,
}) {
  const [proposals, setProposals] = useState(null); // null = loading
  const [tasks, setTasks] = useState([]);
  const [helpers, setHelpers] = useState([]);
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
    if (!enabled || !coupleUid) {
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
  }, [coupleUid, enabled]);

  // ---- Source 2: new tasks for the current event (per-event subscription) ----
  // Reads /users/{ownerUid}/events/{eventId}/tasks — the path the existing
  // /events/{eventId}/tasks/{taskId} read rule already covers (owner /
  // co-owner / vendor / helper). No new top-level rule needed.
  useEffect(() => {
    if (!enabled || !ownerUid || !eventId) {
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
  }, [ownerUid, eventId, enabled]);

  // ---- Source 3: helpers (any "active" flip is a notification) ----
  // We subscribe to the owner's helpers collection. The docs are kept
  // around even after acceptance (they're the perms record), so we
  // detect "newly active" by comparing against the lastSeen timestamp.
  useEffect(() => {
    if (!enabled || !ownerUid) {
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
  }, [ownerUid, enabled]);

  // ---- Merge + sort + slice ----
  const merged = useMemo(() => {
    const items = [
      ...proposalItems(proposals || [], ownerUid),
      ...taskItems(tasks, ownerUid, eventId),
      ...inviteItems(helpers.filter((h) => h.status === 'active')),
    ];
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return items.slice(0, MAX_ITEMS);
  }, [proposals, tasks, helpers, ownerUid, eventId]);

  // ---- Per-source "new since last seen" counts ----
  const badges = useMemo(() => {
    if (!ownerUid) return { proposal: 0, task: 0, invite: 0 };

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

    return {
      proposal: proposalNew,
      task: taskNew,
      invite: inviteNew,
    };
  }, [ownerUid, eventId, proposals, tasks, helpers, seenTick, refreshKey]);

  const totalNew = badges.proposal + badges.task + badges.invite;

  const loading = proposals === null && totalNew === 0;

  return {
    items: merged,
    badges,
    totalNew,
    loading,
    errors,
  };
}
