import { useState, useMemo, useEffect, useRef } from 'react';
import { MessageCircle, Send, Loader2, Trash2, X, Reply, CornerUpRight } from 'lucide-react';
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';

/**
 * TaskComments — chat thread on a single task.
 *
 * Anchored to a sub-collection under the task so it travels WITH
 * the task — couple, vendor, AND assigned helper all see the same
 * comments regardless of which screen they opened the task from.
 *
 * Schema:
 *   artifacts/{appId}/users/{ownerUid}/tasks/{taskId}/comments/{commentId}
 *     {
 *       authorUid,        // request.auth.uid at write time
 *       authorName,       // denormalized from the user's profile
 *       authorRole,       // 'owner' | 'vendor' | 'helper'
 *       text,
 *       parentCommentId,  // OPTIONAL — id of comment this replies to
 *       createdAt,        // epoch ms (client clock)
 *     }
 *
 * 2026-07-19:
 *   • Threaded replies — set `parentCommentId` to nest under another
 *     comment; omit for top-level.
 *   • Helpers (when assigned via `assignedHelperUid`) can author —
 *     surfaced in the UI with a distinct amber role-tinted bubble.
 *
 * Props:
 *   task           — task doc with at least { id, ownerUid }
 *   currentUser    — { uid, displayName? }
 *   currentRole    — 'owner' | 'vendor' | 'helper'
 *   onClose        — optional; close button (X) shown if provided
 *   compact        — optional; if true, hide the role-tinted author
 *                    labels (used on vendor/helper side where context is
 *                    already clear)
 *   readOnly       — optional; hides the input form (read-only review)
 */
export function TaskComments({
  task,
  currentUser,
  currentRole = 'owner',
  onClose,
  compact = false,
  readOnly = false,
}) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // comment object or null
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  const path =
    task?.ownerUid && task?.id
      ? collection(
          db,
          'artifacts',
          appId,
          'users',
          task.ownerUid,
          'tasks',
          task.id,
          'comments',
        )
      : null;
  const { data: comments = [], loading } = useFirestoreCollection(path, [
    task?.ownerUid,
    task?.id,
  ]);

  // Build threaded tree: roots first, replies underneath their parent.
  // We render in a single pass: sort by createdAt, then for each comment
  // produce a node whose `indentation` is "depth in reply tree".
  const commentTree = useMemo(() => {
    const sorted = [...comments].sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    );
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const childrenByParent = new Map();
    const roots = [];
    sorted.forEach((c) => {
      const p = c.parentCommentId;
      if (p && byId.get(p)) {
        if (!childrenByParent.has(p)) childrenByParent.set(p, []);
        childrenByParent.get(p).push(c);
      } else {
        roots.push(c);
      }
    });
    // Flatten the tree so the renderer can scroll a single list while
    // still knowing indentation. Roots in createdAt order; each reply
    // directly after its parent (siblings by createdAt).
    const out = [];
    const walk = (c, depth) => {
      out.push({ ...c, depth });
      const kids = (childrenByParent.get(c.id) || []).sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      );
      kids.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  }, [comments]);

  // Auto-scroll to the most recent comment if the list grew.
  useEffect(() => {
    if (commentTree.length > prevCountRef.current && listRef.current) {
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    }
    prevCountRef.current = commentTree.length;
  }, [commentTree]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const clean = text.trim();
    if (!clean || !currentUser?.uid || !task?.ownerUid || !task?.id) return;
    setSending(true);
    try {
      const commentRef = collection(
        db,
        'artifacts',
        appId,
        'users',
        task.ownerUid,
        'tasks',
        task.id,
        'comments',
      );
      await addDoc(commentRef, {
        authorUid: currentUser.uid,
        authorName:
          currentUser.displayName ||
          currentUser.email ||
          (currentRole === 'vendor'
            ? '商戶'
            : currentRole === 'helper'
              ? '助手'
              : '主理新人'),
        authorRole: currentRole,
        text: clean,
        // Optional: only set if the sender actually clicked "reply".
        parentCommentId: replyTo?.id || null,
        createdAt: Date.now(),
      });
      setText('');
      setReplyTo(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('TaskComments: send failed', err?.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (c) => {
    if (!task?.ownerUid || !task?.id || !c?.id) return;
    if (!confirm('刪除呢條留言？')) return;
    await deleteDoc(
      doc(
        db,
        'artifacts',
        appId,
        'users',
        task.ownerUid,
        'tasks',
        task.id,
        'comments',
        c.id,
      ),
    );
  };

  const canDelete = (c) => {
    if (!currentUser?.uid) return false;
    return c.authorUid === currentUser.uid || currentRole === 'owner';
  };
  const canReply = (c) => currentUser?.uid && !readOnly && c.authorUid !== currentUser.uid;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <MessageCircle className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-bold text-slate-700">
          留言 ({commentTree.length})
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 text-slate-400 hover:text-slate-700 rounded"
            title="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="max-h-[320px] overflow-y-auto px-3 py-2 space-y-2 custom-scrollbar"
      >
        {loading && commentTree.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">
            載入留言中…
          </div>
        )}
        {!loading && commentTree.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">
            暫無留言 — 第一個留言嘅人。
          </div>
        )}
        {commentTree.map((c) => {
          const mine = c.authorUid === currentUser?.uid;
          // Per-role bubble colour. Compact mode (vendor/helper side
          // where context is already clear) shows muted grey.
          const roleColor = compact
            ? 'bg-slate-50 border-slate-200 text-slate-900'
            : c.authorRole === 'vendor'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : c.authorRole === 'helper'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900';
          const indent = Math.min(c.depth || 0, 3); // 0..3 → 0px..36px
          return (
            <div
              key={c.id}
              className="flex flex-col"
              style={{ paddingLeft: indent * 12 }}
            >
              {c.parentCommentId && replyTo?.id !== c.id && c.depth > 0 && (
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
                <span
                  className={`font-bold ${
                    c.authorRole === 'vendor'
                      ? 'text-emerald-700'
                      : c.authorRole === 'helper'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {c.authorName}
                  {!compact && (
                    <span className="text-slate-400 font-normal ml-1 text-[9px]">
                      {c.authorRole === 'owner'
                        ? '主理新人'
                        : c.authorRole === 'vendor'
                          ? '商戶'
                          : '助手'}
                    </span>
                  )}
                </span>
                <span className="text-slate-400">
                  {formatRelativeTime(c.createdAt)}
                </span>
                {canDelete(c) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
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
                {c.text}
              </div>
              {canReply(c) && (
                <button
                  type="button"
                  onClick={() =>
                    setReplyTo(replyTo?.id === c.id ? null : c)
                  }
                  className="self-start text-[10px] text-slate-500 hover:text-rose-600 inline-flex items-center gap-1 mt-1 px-1"
                  title="回覆"
                >
                  <Reply className="w-3 h-3" />
                  {replyTo?.id === c.id ? '取消回覆' : '回覆'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <form
          onSubmit={handleSend}
          className="border-t border-slate-200 bg-white"
        >
          {replyTo && (
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
                <X className="w-3 h-3" />
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
                    ? '回覆主理新人或商戶...'
                    : '回覆商戶或助手...'
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
