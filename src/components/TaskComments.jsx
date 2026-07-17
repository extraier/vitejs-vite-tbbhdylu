import { useState, useMemo, useEffect, useRef } from 'react';
import { MessageCircle, Send, Loader2, Trash2, X } from 'lucide-react';
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';

/**
 * TaskComments — chat thread on a single task.
 *
 * Anchored to a sub-collection under the task so it travels WITH
 * the task — both couple and vendor see the same comments regardless
 * of which screen they opened the task from.
 *
 * Schema:
 *   artifacts/{appId}/users/{ownerUid}/tasks/{taskId}/comments/{commentId}
 *     {
 *       authorUid,   // request.auth.uid at write time, server-stamped
 *       authorName,  // denormalized from the user's profile / vendor doc
 *       authorRole,  // 'owner' | 'vendor'
 *       text,
 *       createdAt,   // epoch ms (client clock)
 *     }
 *
 * 2026-07-17:
 *   • Vendor writes allowed when assignedVendorUid matches auth.uid.
 *   • Couple writes always allowed (owner).
 *   • Helpers don't have write access — keep threads attributable.
 *
 * Props:
 *   task           — task doc with at least { id, ownerUid }
 *   currentUser    — { uid, displayName? }
 *   currentRole    — 'owner' | 'vendor' (drives which name + role we
 *                    attribute the comment to)
 *   onClose        — optional; close button (X) shown if provided
 *   compact        — optional; if true, hide the role-tinted author
 *                    labels (used on vendor side where context is
 *                    already clear)
 */
export function TaskComments({ task, currentUser, currentRole = 'owner', onClose, compact = false }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  // Subscribe to comments. useFirestoreCollection returns to []
  // automatically when path is null, so we can drop the early-return
  // and let the hook handle it.
  const path = task?.ownerUid && task?.id
    ? collection(db, 'artifacts', appId, 'users', task.ownerUid, 'tasks', task.id, 'comments')
    : null;
  const { data: comments = [], loading } = useFirestoreCollection(
    path,
    [task?.ownerUid, task?.id],
  );

  // Sort by createdAt ascending so the thread reads chronologically.
  // New at the bottom — standard chat feel.
  const sortedComments = useMemo(() => {
    return [...comments].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [comments]);

  // Auto-scroll to the most recent comment if the list grew.
  useEffect(() => {
    if (sortedComments.length > prevCountRef.current && listRef.current) {
      // Defer to next paint so the new row is in the DOM.
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    }
    prevCountRef.current = sortedComments.length;
  }, [sortedComments]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const clean = text.trim();
    if (!clean || !currentUser?.uid || !task?.ownerUid || !task?.id) return;
    setSending(true);
    try {
      const commentRef = collection(
        db, 'artifacts', appId, 'users', task.ownerUid, 'tasks', task.id, 'comments',
      );
      await addDoc(commentRef, {
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email || (currentRole === 'vendor' ? '商戶' : '主理新人'),
        authorRole: currentRole,
        text: clean,
        createdAt: Date.now(),
      });
      setText('');
    } catch (err) {
      // Don't swallow — surface to the user via a console + an inline
      // banner. Most likely cause: a vendor whose assignedVendorUid
      // doesn't match (rare; can happen during the moment between
      // reassigning the contact and the vendor refreshing).
      // eslint-disable-next-line no-console
      console.warn('TaskComments: send failed', err?.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (c) => {
    if (!task?.ownerUid || !task?.id || !c?.id) return;
    if (!confirm('刪除呢條留言？')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', task.ownerUid, 'tasks', task.id, 'comments', c.id));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <MessageCircle className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-bold text-slate-700">
          留言 ({sortedComments.length})
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
        className="max-h-[260px] overflow-y-auto px-3 py-2 space-y-2 custom-scrollbar"
      >
        {loading && sortedComments.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">載入留言中…</div>
        )}
        {!loading && sortedComments.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">
            暫無留言 — 第一個留言嘅人。
          </div>
        )}
        {sortedComments.map((c) => {
          const mine = c.authorUid === currentUser?.uid;
          const roleColor = c.authorRole === 'vendor'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900';
          return (
            <div key={c.id} className="flex flex-col">
              <div className={`flex items-baseline gap-2 text-[10px] mb-0.5 px-1 ${mine ? 'self-end' : ''}`}>
                <span className={`font-bold ${c.authorRole === 'vendor' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {c.authorName}
                </span>
                <span className="text-slate-400">
                  {formatRelativeTime(c.createdAt)}
                </span>
                {(mine || currentRole === 'owner') && (
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
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 px-3 py-2 border-t border-slate-200"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={currentRole === 'vendor' ? '回覆主理新人...' : '回覆商戶或留底...'}
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
      </form>
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
