// 2026-08-09 — useNotifications
//
// Unified notification feed for the header bell. Aggregates multiple
// event sources into a single sorted list, so one click shows the
// couple everything that's changed since they last looked.
//
// Sources (v1):
//   1. **Vendor proposals** on /proposals filtered by coupleUid.
//      (Existing useRecentProposals logic, ported to the unified shape.)
//   2. **Task comments** by helpers/vendors — collectionGroup('comments')
//      where the author is NOT the owner.
//   3. **Task status updates** by helpers/vendors — collectionGroup('statusUpdates').
//   4. **Helper accepted invitation** — per-helper doc flip on
//      /users/{ownerUid}/helpers/{helperUid}.status from 'invited' to 'active'.
//
// Sources deferred to follow-up commits (need new server-side fields):
//   - Vendor chat inbox messages (already has its own badge; easy merge)
//   - Photo uploads (needs denormalized event-feed counter)
//   - Cron reminders (needs Cloud Scheduled function)
//
// Why client-side aggregate (not a single denormalized feed doc):
//   - No CF refactor needed. Wed 1-2 hours saved vs. doing it server-side.
//   - Each source's subscription is rule-permitted as-is for the owner.
//   - The downside is N subscriptions per panel-open. N=4 today. At
//     that scale it's fine. If a couple ever has 10K comments, this
//     needs to move server-side. Today's couples have ~0-50 each.
//
// Client-side sort:
//   - Each source subscribes to its own shape; we merge, sort by
//     createdAt, slice to 20. The merge happens on every snapshot —
//     React batches the state update so the panel rerenders once.
//
// Mark-read semantics:
//   - Per-source localStorage keys: lastSeenCommentsAt_<ownerUid>,
//     lastSeenStatusAt_<ownerUid>, lastSeenHelperAcceptAt_<ownerUid>,
//     lastSeenProposalsCount_<ownerUid> (existing).
//   - "全部已讀" writes each source's marker to "now". The bell badge
//     computes per-source delta and sums them.
//
// Categories + icons + colors:
//   - See CATEGORY_META below. The dropdown row picks the icon + tint
//     based on the item's category. Adding a new category = one entry
//     in the map + one subscription source. No render changes.

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

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
  comment: {
    icon: '💭',
    color: 'blue',
    label: '待辦新留言',
    pluralLabel: '待辦留言',
    bgClass: 'from-blue-400 to-cyan-400',
    hoverBgClass: 'hover:bg-blue-50/50',
    textClass: 'text-blue-600',
    badgeClass: 'bg-blue-500',
    borderClass: 'border-blue-200',
  },
  status: {
    icon: '✅',
    color: 'green',
    label: '待辦狀態更新',
    pluralLabel: '狀態更新',
    bgClass: 'from-green-400 to-emerald-400',
    hoverBgClass: 'hover:bg-green-50/50',
    textClass: 'text-green-600',
    badgeClass: 'bg-green-500',
    borderClass: 'border-green-200',
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
  comment: (ownerUid) => `lastSeenCommentsAt_${ownerUid}`,
  status: (ownerUid) => `lastSeenStatusAt_${ownerUid}`,
  invite: (ownerUid) => `lastSeenHelperAcceptAt_${ownerUid}`,
};

// Read a "last seen" marker from localStorage. Returns 0 if missing.
function readSeen(ownerUid, sourceKey) {
  if (!ownerUid) return 0;
  try {
    const raw = window.localStorage.getItem(SEEN_KEYS[sourceKey](ownerUid));
    if (!raw) return 0;
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(ownerUid, sourceKey, value) {
  if (!ownerUid) return;
  try {
    window.localStorage.setItem(SEEN_KEYS[sourceUid ? sourceKey(ownerUid) : sourceKey](ownerUid), String(value));
  } catch {
    // ignore
  }
}

// Writer exported for the bell's "全部已讀" button. The caller passes
// the value to use for each source — for proposals it's the absolute
// count (so the marker is exact), for others it's a timestamp (so
// "last seen" semantics work). Caller's responsibility to pass the
// right shape.
export function markAllNotificationsSeen(ownerUid, badges) {
  if (!ownerUid) return;
  for (const [sourceKey, value] of Object.entries(badges)) {
    try {
      window.localStorage.setItem(SEEN_KEYS[sourceKey](ownerUid), String(value));
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

function commentItems(docs) {
  return docs.map((d) => ({
    id: `comment:${d.id}`,
    category: 'comment',
    actorRole: d.authorRole || 'helper',
    actorName: d.authorName || (d.authorRole === 'vendor' ? '商戶' : '兄弟姊妹'),
    actorInitial: initialOf(d.authorName),
    title: '待辦新留言',
    preview: summarize(d.text) || '已新增留言',
    meta: {
      taskId: d.taskId,
      eventId: d.eventId,
      ownerUid: d.ownerUid,
    },
    href: {
      view: 'couple-checklist',
      taskId: d.taskId,
      eventId: d.eventId,
      source: 'comment',
    },
    createdAt: toMillis(d.createdAt),
    sourceKey: 'comment',
  }));
}

function statusItems(docs) {
  return docs.map((d) => {
    const newStatus = d.newStatus || d.status || '已更新';
    return {
      id: `status:${d.id}`,
      category: 'status',
      actorRole: d.authorRole || 'helper',
      actorName: d.authorName || (d.authorRole === 'vendor' ? '商戶' : '兄弟姊妹'),
      actorInitial: initialOf(d.authorName),
      title: '待辦狀態更新',
      preview: summarize(d.text) || `狀態變更為 ${newStatus}`,
      meta: {
        taskId: d.taskId,
        eventId: d.eventId,
        ownerUid: d.ownerUid,
        newStatus,
      },
      href: {
        view: 'couple-checklist',
        taskId: d.taskId,
        eventId: d.eventId,
        source: 'status',
      },
      createdAt: toMillis(d.createdAt),
      sourceKey: 'status',
    };
  });
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
const COMMENTS_LIMIT = 50;
const STATUS_LIMIT = 50;

export function useNotifications({
  ownerUid,
  coupleUid,
  selfUid,
  enabled = true,
}) {
  const [proposals, setProposals] = useState(null); // null = loading
  const [comments, setComments] = useState([]);
  const [statusUpdates, setStatusUpdates] = useState([]);
  const [helpers, setHelpers] = useState([]);
  const [errors, setErrors] = useState({});

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

  // ---- Source 2 + 3: collectionGroup comments + statusUpdates ----
  // We subscribe to BOTH at once but only filter by date > window. The
  // owner reads her own comments via the per-event subscription; what
  // we want here is the GLOBAL feed of "anyone else wrote something
  // on your tasks". Filter authorUid != self in memory.
  useEffect(() => {
    if (!enabled || !ownerUid) {
      setComments([]);
      setStatusUpdates([]);
      return undefined;
    }
    let cancelledC = false;
    let cancelledS = false;

    // Comments
    const cQ = query(
      collectionGroup(db, 'comments'),
      orderBy('createdAt', 'desc'),
      fsLimit(COMMENTS_LIMIT),
    );
    const unsubC = onSnapshot(
      cQ,
      (snap) => {
        if (cancelledC) return;
        const list = snap.docs
          .map((d) => {
            const data = d.data();
            // d.ref.path = artifacts/{appId}/users/{ownerUid}/events/{eventId}/tasks/{taskId}/comments/{commentId}
            const m = d.ref.path.match(/users\/([^/]+)\/events\/([^/]+)\/tasks\/([^/]+)\/comments\/([^/]+)$/);
            if (!m) return null;
            const [, docOwnerUid, eventId, taskId] = m;
            return {
              id: d.id,
              ownerUid: docOwnerUid,
              eventId,
              taskId,
              authorUid: data.authorUid,
              authorRole: data.authorRole,
              authorName: data.authorName,
              text: data.text,
              createdAt: data.createdAt,
            };
          })
          .filter((x) => {
            if (!x) return false;
            // Only show comments on tasks owned by this user
            if (x.ownerUid !== ownerUid) return false;
            // Skip comments authored by the owner herself (she's reacting
            // to someone else's note, not the other way around)
            if (selfUid && x.authorUid === selfUid) return false;
            return true;
          });
        setComments(list);
      },
      (err) => {
        if (cancelledC) return;
        console.error('[useNotifications] comments error:', err);
        setErrors((s) => ({ ...s, comment: err.message || '讀取失敗' }));
        setComments([]);
      },
    );

    // Status updates
    const sQ = query(
      collectionGroup(db, 'statusUpdates'),
      orderBy('createdAt', 'desc'),
      fsLimit(STATUS_LIMIT),
    );
    const unsubS = onSnapshot(
      sQ,
      (snap) => {
        if (cancelledS) return;
        const list = snap.docs
          .map((d) => {
            const data = d.data();
            const m = d.ref.path.match(/users\/([^/]+)\/events\/([^/]+)\/tasks\/([^/]+)\/statusUpdates\/([^/]+)$/);
            if (!m) return null;
            const [, docOwnerUid, eventId, taskId] = m;
            return {
              id: d.id,
              ownerUid: docOwnerUid,
              eventId,
              taskId,
              authorUid: data.authorUid,
              authorRole: data.authorRole,
              authorName: data.authorName,
              text: data.note || data.text || '',
              newStatus: data.newStatus || data.status,
              createdAt: data.createdAt,
            };
          })
          .filter((x) => {
            if (!x) return false;
            if (x.ownerUid !== ownerUid) return false;
            if (selfUid && x.authorUid === selfUid) return false;
            return true;
          });
        setStatusUpdates(list);
      },
      (err) => {
        if (cancelledS) return;
        console.error('[useNotifications] statusUpdates error:', err);
        setErrors((s) => ({ ...s, status: err.message || '讀取失敗' }));
        setStatusUpdates([]);
      },
    );

    return () => {
      cancelledC = true;
      cancelledS = true;
      unsubC();
      unsubS();
    };
  }, [ownerUid, selfUid, enabled]);

  // ---- Source 4: helpers (any "active" flip is a notification) ----
  // We subscribe to the owner's helpers collection. The docs are kept
  // around even after acceptance (they're the perms record), so we
  // detect "newly active" by comparing against the lastSeen timestamp.
  useEffect(() => {
    if (!enabled || !ownerUid) {
      setHelpers([]);
      return undefined;
    }
    let cancelled = false;
    const q = query(collection(db, 'users', ownerUid, 'helpers'));
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
      ...commentItems(comments),
      ...statusItems(statusUpdates),
      ...inviteItems(helpers.filter((h) => h.status === 'active')),
    ];
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return items.slice(0, MAX_ITEMS);
  }, [proposals, comments, statusUpdates, helpers, ownerUid]);

  // ---- Per-source "new since last seen" counts ----
  const badges = useMemo(() => {
    if (!ownerUid) return { proposal: 0, comment: 0, status: 0, invite: 0 };

    // Proposals: marker is the last-seen *count*. New = current count - marker.
    const lastSeenProposalCount = readSeen(ownerUid, 'proposal');
    const proposalCount = (proposals || []).length;
    const proposalNew = Math.max(0, proposalCount - lastSeenProposalCount);

    // Comments + status + invite: marker is a timestamp. New = items createdAt > marker.
    const lastSeenCommentAt = readSeen(ownerUid, 'comment');
    const lastSeenStatusAt = readSeen(ownerUid, 'status');
    const lastSeenInviteAt = readSeen(ownerUid, 'invite');

    const commentNew = comments.filter((c) => toMillis(c.createdAt) > lastSeenCommentAt).length;
    const statusNew = statusUpdates.filter((s) => toMillis(s.createdAt) > lastSeenStatusAt).length;
    // For invites we only count helpers whose acceptedAt > lastSeenInviteAt
    // AND status == 'active'
    const inviteNew = helpers.filter((h) => {
      if (h.status !== 'active') return false;
      const ts = toMillis(h.acceptedAt) || toMillis(h.updatedAt) || 0;
      return ts > lastSeenInviteAt;
    }).length;

    return {
      proposal: proposalNew,
      comment: commentNew,
      status: statusNew,
      invite: inviteNew,
    };
  }, [ownerUid, proposals, comments, statusUpdates, helpers]);

  const totalNew = badges.proposal + badges.comment + badges.status + badges.invite;

  const loading = proposals === null && totalNew === 0;

  return {
    items: merged,
    badges,
    totalNew,
    loading,
    errors,
  };
}
