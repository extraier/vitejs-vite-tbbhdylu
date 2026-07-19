/**
 * TaskActivityTimeline — merged view of status changes + threaded
 * comments on a single task.
 *
 * 2026-07-19 — the "comments + status updates" feature for the to-do
 * list. Renders three kinds of timeline entries in chronological
 * order:
 *
 *   1. STATUS event:  "Roger (主理新人) moved to「進行中」"
 *   2. COMMENT root:  "Joy (商戶): Can we discuss pricing tomorrow?"
 *   3. REPLY:         indented under root, with a small connector
 *
 * The comment layout matches `<TaskComments>` — i.e. the same bubble
 * colours per role. This component embeds the comment author + body
 * directly in the timeline rather than mount a separate chat panel.
 *
 * Subscribes to BOTH `/statusUpdates` and `/comments` and merges via
 * the helper in `src/lib/taskActivity.js`. Realtime via the standard
 * `useFirestoreCollection` hook.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { ArrowRight, Clock, Loader2, Reply, CornerUpRight, Send, Trash2 } from 'lucide-react';
import { db, appId } from '../lib/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import {
  mergeTaskActivity,
  buildStatusUpdateDoc,
  statusLabel,
  roleLabel,
  canCommentOnTask,
} from '../lib/taskActivity';

/**
 * Props:
 *   task            — task doc with at least { id, ownerUid, ... }
 *   currentUser     — { uid, displayName? }
 *   currentRole     — 'owner' | 'vendor' | 'helper'
 *   readOnly        — disable the input form
 */
export function TaskActivityTimeline({ task, currentUser, currentRole = 'owner', readOnly = false }) {
  const ownerUid = task?.ownerUid;
  const taskId = task?.id;

  // Subscribe to both subcollections, parallel.
  const commentsPath =
    ownerUid && taskId
      ? collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks', taskId, 'comments')
      : null;
  const statusPath =
    ownerUid && taskId
      ? collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks', taskId, 'statusUpdates')
      : null;
  const { data: comments = [] } = useFirestoreCollection(commentsPath, [ownerUid, taskId]);
  const { data: statusUpdates = [], loading: loadingStatus } = useFirestoreCollection(
    statusPath,
    [ownerUid, taskId],
  );

  const events = useMemo(
    () => mergeTaskActivity(comments, statusUpdates),
    [comments, statusUpdates],
  );

  // Same threaded-tree flattening we use in <TaskComments>.
  const tree = useMemo(() => {
    const byId = new Map();
    const childrenByParent = new Map();
    const roots = [];
    events.forEach((e) => {
      byId.set(e.id, e);
      if (e.kind === 'comment') {
        const p = e.parentCommentId;
        if (p && byId.get(p)) {
          if (!childrenByParent.has(p)) childrenByParent.set(p, []);
          childrenByParent.get(p).push(e);
        } else {
          roots.push(e);
        }
      }
    });
    const flat = [];
    const walk = (ev, depth) => {
      flat.push({ ...ev, depth });
      if (ev.kind !== 'comment') return;
      const kids = (childrenByParent.get(ev.id) || []).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      kids.forEach((k) => walk(k, depth + 1));
    };
    // Keep status events alongside comment roots in the overall order
    // (so timeline reads as a true chronology). Renderings interleave
    // them; we accomplish that by inserting STATUS events at their
    // natural sorted position into a roots-comments-then-insert list.
    const allRoots = [...statusUpdates.map((s) => ({ kind: 'status', id: s.id, ts: ((s.createdAt && (s.createdAt.toMillis ? s.createdAt.toMillis() : s.createdAt.seconds * 1000)) || s.createdAt || 0), _s: s })), ...comments.filter((c) => !c.parentCommentId).map((c) => ({ kind: 'comment', id: c.id, ts: ((c.createdAt && (c.createdAt.toMillis ? c.createdAt.toMillis() : c.createdAt.seconds * 1000)) || c.createdAt || 0), _c: c }))];
    // Map each root into the event shape so we can use walk().
    const eventRoots = allRoots.sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((r) => {
      if (r.kind === 'status') {
        const s = r._s;
        return {
          kind: 'status',
          id: r.id,
          ts: r.ts,
          byUid: s.byUid,
          byName: s.byName,
          byRole: s.byRole,
          fromStatus: s.fromStatus,
          toStatus: s.toStatus,
          reason: s.reason || null,
          raw: s,
        };
      }
      // comment root
      const c = r._c;
      return {
        kind: 'comment',
        id: r.id,
        ts: r.ts,
        authorUid: c.authorUid,
        authorName: c.authorName,
        authorRole: c.authorRole,
        text: c.text,
        parentCommentId: c.parentCommentId || null,
        raw: c,
      };
    });
    eventRoots.forEach((e) => walk(e, 0));
    return flat;
  }, [events, statusUpdates, comments]);

  // Composer state.
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  // Auto-scroll on growth.
  useEffect(() => {
    if (tree.length > prevCountRef.current && listRef.current) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    }
    prevCountRef.current = tree.length;
  }, [tree]);

  const allowed = canCommentOnTask(task, currentUser, currentRole);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!allowed) return;
    const clean = text.trim();
    if (!clean || !ownerUid || !taskId || !currentUser?.uid) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks', taskId, 'comments'), {
        authorUid: currentUser.uid,
        authorName:
          currentUser.displayName ||
          currentUser.email ||
          (currentRole === 'vendor' ? '商戶' : currentRole === 'helper' ? '助手' : '主理新人'),
        authorRole: currentRole,
        text: clean,
        parentCommentId: replyTo?.id || null,
        createdAt: Date.now(),
      });
      setText('');
      setReplyTo(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('TaskActivityTimeline: send failed', err?.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (c) => {
    if (!ownerUid || !taskId || !c?.id) return;
    if (!confirm('刪除呢條留言？')) return;
    await deleteDoc(
      doc(db, 'artifacts', appId, 'users', ownerUid, 'tasks', taskId, 'comments', c.id),
    );
  };

  const canDelete = (ev) => {
    if (ev.kind !== 'comment') return false;
    if (!currentUser?.uid) return false;
    return ev.authorUid === currentUser.uid || currentRole === 'owner';
  };
  const canReply = (ev) => {
    if (readOnly) return false;
    if (!allowed) return false;
    if (ev.kind !== 'comment') return false;
    return ev.authorUid !== currentUser?.uid;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <Clock className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-bold text-slate-700">活動時間線 ({tree.length})</span>
        {loadingStatus && (
          <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
        )}
      </div>

      <div
        ref={listRef}
        className="max-h-[420px] overflow-y-auto px-3 py-3 space-y-3 custom-scrollbar"
      >
        {tree.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">未有活動記錄</div>
        )}
        {tree.map((ev) => {
          const indent = Math.min(ev.depth || 0, 3) * 12;
          const mine = ev.kind === 'comment' && ev.authorUid === currentUser?.uid;
          if (ev.kind === 'status') {
            return (
              <div
                key={`status-${ev.id}`}
                className="flex items-center gap-2 text-[11px] text-slate-600 py-1 px-2 bg-slate-50 border border-slate-200 rounded-lg"
                style={{ paddingLeft: indent + 8 }}
              >
                <span className="font-bold text-slate-700">{ev.byName || roleLabel(ev.byRole)}</span>
                <span className="text-slate-500">（{roleLabel(ev.byRole)}）</span>
                <span className="ml-1">將狀態改為</span>
                <span className="font-bold text-emerald-700">「{statusLabel(ev.toStatus)}」</span>
                {ev.fromStatus && ev.fromStatus !== ev.toStatus && (
                  <span className="text-slate-400 text-[10px]">
                    （由「{statusLabel(ev.fromStatus)}」變更）
                  </span>
                )}
                <ArrowRight className="w-3 h-3 text-slate-400 ml-auto" />
                <span className="text-slate-400">{formatRelativeTime(ev.ts)}</span>
              </div>
            );
          }
          // comment event
          const roleColor =
            ev.authorRole === 'vendor'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : ev.authorRole === 'helper'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900';
          const roleNameColor =
            ev.authorRole === 'vendor'
              ? 'text-emerald-700'
              : ev.authorRole === 'helper'
                ? 'text-amber-700'
                : 'text-rose-700';
          return (
            <div
              key={`c-${ev.id}`}
              className="flex flex-col"
              style={{ paddingLeft: indent }}
            >
              {ev.parentCommentId && ev.depth > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 px-1">
                  <CornerUpRight className="w-3 h-3" />
                  回覆
                </div>
              )}
              <div
                className={`flex items-baseline gap-2 text-[10px] mb-0.5 px-1 ${
                  mine ? 'self-end' : ''
                }`}
              >
                <span className={`font-bold ${roleNameColor}`}>
                  {ev.authorName}
                  <span className="text-slate-400 font-normal ml-1">
                    {roleLabel(ev.authorRole)}
                  </span>
                </span>
                <span className="text-slate-400">{formatRelativeTime(ev.ts)}</span>
                {canDelete(ev) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(ev.raw)}
                    className="text-slate-300 hover:text-red-500"
                    title="刪除留言"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div
                className={`rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap inline-block max-w-full border ${roleColor} ${
                  mine ? 'self-end' : 'self-start'
                }`}
                style={{ wordBreak: 'break-word' }}
              >
                {ev.text}
              </div>
              {canReply(ev) && (
                <button
                  type="button"
                  onClick={() => setReplyTo(replyTo?.id === ev.id ? null : ev)}
                  className="self-start text-[10px] text-slate-500 hover:text-rose-600 inline-flex items-center gap-1 mt-1 px-1"
                  title="回覆"
                >
                  <Reply className="w-3 h-3" />
                  {replyTo?.id === ev.id ? '取消回覆' : '回覆'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && allowed && (
        <form onSubmit={handleSend} className="border-t border-slate-200 bg-white">
          {replyTo && replyTo.kind === 'comment' && (
            <div className="flex items-center gap-2 px-3 pt-2 text-[10px] text-slate-500">
              <Reply className="w-3 h-3" />
              <span className="truncate">
                回覆 <b>{replyTo.authorName}</b>：{replyTo.text?.slice(0, 80)}
                {replyTo.text?.length > 80 && '…'}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="ml-auto text-slate-400 hover:text-slate-700"
                title="取消回覆"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                currentRole === 'vendor'
                  ? '回覆主理新人...'
                  : currentRole === 'helper'
                    ? '留言畀主理新人或商戶...'
                    : '留言畀商戶或助手...'
              }
              disabled={sending}
              maxLength={2000}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-rose-300 outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold flex items-center gap-1 hover:bg-rose-700 disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              傳送
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function formatRelativeTime(ms) {
  if (!ms) return '';
  const diffMs = Date.now() - ms;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 日前`;
  return new Date(ms).toLocaleDateString('zh-HK');
}

/**
 * Helper: client-side call to write a status-update trail entry.
 * Caller is responsible for the parent-task update (status field)
 * itself — this just appends to the audit collection.
 *
 * Returns a Promise<void>; rejects silently if rules block it
 * (caller's primary write to parent task may still succeed).
 */
export async function recordTaskStatusUpdate({
  ownerUid,
  taskId,
  fromStatus,
  toStatus,
  byUid,
  byName,
  byRole,
  reason,
}) {
  if (!ownerUid || !taskId || !byUid || !toStatus) return;
  try {
    await addDoc(
      collection(
        db,
        'artifacts',
        appId,
        'users',
        ownerUid,
        'tasks',
        taskId,
        'statusUpdates',
      ),
      buildStatusUpdateDoc({ fromStatus, toStatus, byUid, byName, byRole, reason }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('recordTaskStatusUpdate: trail write failed', err?.message);
  }
}
