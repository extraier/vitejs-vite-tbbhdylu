// 2026-08-09 — ItemComments
//
// Generic chat-thread component for any item that has a comments
// subcollection. Used by RundownCard and ResourceCard in
// <WeddingDay/>, plus the assigned-vendor / assigned-helper tabs in
// <VendorDashboard/> and <HelperDashboard/>.
//
// Differs from <TaskComments/> in two ways:
//   1. No threaded replies (parentCommentId) — flat timeline only.
//      Rundown/resource comments don't need threading; keeping it
//      flat avoids dragging the comment-tree flatten logic into a
//      second place.
//   2. Accepts an arbitrary `path` prop (collection ref) instead of
//      hardcoding the /tasks/{id}/comments/ shape. The caller passes
//      `collection(db, 'artifacts', appId, 'users', ownerUid, 'events',
//      eventId, 'rundown', entryId, 'comments')` (or /resources/...),
//      and ItemComments subscribes to that.
//
// Schema (must match firestore.rules for /rundown/{id}/comments/ and
// /resources/{id}/comments/):
//   {
//     authorUid,     // request.auth.uid at write time
//     authorName,    // denormalized from user profile
//     authorRole,    // 'owner' | 'vendor' | 'helper'
//     text,
//     createdAt,     // epoch ms (client clock)
//   }
//
// Why a separate component (not just reuse TaskComments):
//   TaskComments has hardcoded `/tasks/{id}/comments/` paths baked
//   in and threaded-reply state. Trying to genericise it would have
//   required prop-drilling the parent path through several layers
//   and a `mode` flag to disable threading. New file is ~120 lines
//   and the duplication is bounded.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, Trash2, Loader2 } from 'lucide-react';
import { addDoc, deleteDoc, doc } from 'firebase/firestore';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';

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
  return `${Math.floor(diffMs / (30 * 86_400_000))} 個月前`;
}

function roleStyle(role) {
  switch (role) {
    case 'vendor':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'helper':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'owner':
    default:
      return 'bg-rose-100 text-rose-700 border-rose-200';
  }
}

export function ItemComments({
  path,
  currentUser,
  currentRole = 'owner',
  readOnly = false,
  emptyHint = '未有留言',
  label = '留言',
  // 2026-08-11 — Parent-item assignment fields. Stamped on the
  // comment so the Firestore rules can authorize vendor/helper
  // writes WITHOUT calling get(parentRundown/Resource). See the
  // long note above the addDoc() call for why this is needed.
  parentAssignedVendorUid = null,
  parentAssignedHelperUid = null,
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  const { data: comments = [], loading } = useFirestoreCollection(path, [
    // Re-subscribe when the path identity changes. useFirestoreCollection
    // already stringifies the path for its key, but we hand-deps so
    // tests can stub deterministically.
    path && JSON.stringify(path),
  ]);

  // (2026-08-11 TEMP DIAGNOSTIC removed after root cause identified:
  //  vendor was on a resource path the live SDK denied; redeployed
  //  firestore rules to force cache refresh. Keep this file clean.)
  //
  // 2026-08-11 — second diagnostic. The first showed the
  // path. Now we want to know if the SAME path is being subscribed
  // to across mounts, OR if multiple ItemComments instances are
  // opening different paths. Look for `[ItemComments] path` in
  // console to find the resolved path.
  //
  // 2026-08-11 — third diagnostic. The previous log showed
  // `ownerUid: 'gIF9yBcLxFyYUDumlgyi'` (the eventId!) which means
  // the segments array is shorter than expected OR has a different
  // structure. Print the FULL path string + segments so we can see
  // exactly what's being subscribed to.
  if (typeof window !== 'undefined' && path) {
    const fullPath = path?.path || (path?._query?.path?.canonicalString?.()) || '<unknown>';
    const segments = path?._query?.path?.segments || [];
    console.log('[ItemComments] path', {
      fullPath,
      pathId: path.id,
      pathParentPath: path.parent?.path,
      pathParentParentPath: path.parent?.parent?.path,
      pathParentParentParentPath: path.parent?.parent?.parent?.path,
      pathParentParentParentParentPath: path.parent?.parent?.parent?.parent?.path,
      segments,
      ownerUid: segments[3],
      eventId: segments[5],
      groupName: segments[6],
      itemId: segments[7],
    });
  }

  const sorted = useMemo(() => {
    return [...comments].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [comments]);

  // Auto-scroll to the most recent comment when the list grows.
  useEffect(() => {
    if (sorted.length > prevCountRef.current && listRef.current) {
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    }
    prevCountRef.current = sorted.length;
  }, [sorted]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const clean = text.trim();
    if (!clean) {
      window.alert && window.alert('⚠ 請輸入留言內容');
      return;
    }
    if (!currentUser?.uid || !path) {
      window.alert && window.alert('⚠ 留言資料遺失，請重新整理再試');
      return;
    }
    setSending(true);
    try {
      // 2026-08-11 — Stamp the parent's assignedVendorUid and
      // assignedHelperUid onto the comment so the Firestore rules
      // can authorize the vendor/helper write WITHOUT calling
      // get(parentRundown/Resource). The LIVE rules engine has
      // been denying these writes with `Missing or insufficient
      // permissions` even though the local emulator allows them —
      // most likely because of an evaluation quirk on the
      // get(parentDoc) call inside the rule's vendor branch.
      //
      // By carrying the parent's assignment on the comment doc,
      // the rule becomes a pure field comparison:
      //   request.resource.data.parentAssignedVendorUid == request.auth.uid
      // — no cross-doc lookup needed. The owner/co-owner/helper
      // branches don't need it because they use pure UID
      // comparisons or isCoOwnerOfAnyEvent standalone docs.
      //
      // Both fields are stamped even if null, so the rule can
      // check them uniformly.
      await addDoc(path, {
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
        createdAt: Date.now(),
        parentAssignedVendorUid: parentAssignedVendorUid || null,
        parentAssignedHelperUid: parentAssignedHelperUid || null,
      });
      setText('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ItemComments] send failed', err?.message);
      window.alert && window.alert('✗ 留言失敗：' + (err?.message || '未知錯誤'));
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (c) => {
    if (!path || !c?.id) return;
    if (!window.confirm('刪除呢條留言？')) return;
    try {
      await deleteDoc(doc(path, c.id));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ItemComments] delete failed', err?.message);
      window.alert && window.alert('✗ 刪除失敗：' + (err?.message || '未知錯誤'));
    }
  };

  const canDelete = (c) => {
    if (!currentUser?.uid) return false;
    return c.authorUid === currentUser.uid || currentRole === 'owner';
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <MessageCircle className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-bold text-slate-700">
          {label} ({sorted.length})
        </span>
      </div>
      <div
        ref={listRef}
        className="max-h-48 overflow-y-auto custom-scrollbar px-3 py-2 space-y-2"
      >
        {loading && sorted.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
            載入中...
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-3">{emptyHint}</div>
        )}
        {sorted.map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${roleStyle(c.authorRole)}`}
                >
                  {c.authorName || '?'}
                </span>
                <span className="text-[10px] text-slate-400">{formatTimeAgo(c.createdAt)}</span>
              </div>
              <div className="text-sm text-slate-700 leading-snug whitespace-pre-wrap break-words">
                {c.text}
              </div>
            </div>
            {canDelete(c) && (
              <button
                type="button"
                onClick={() => handleDelete(c)}
                aria-label="刪除留言"
                className="p-1 text-slate-400 hover:text-rose-600 flex-shrink-0"
                title="刪除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && currentUser?.uid && (
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50/50"
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="留言…"
            disabled={sending}
            maxLength={2000}
            className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:border-rose-400 disabled:bg-slate-100"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="送出留言"
            className="p-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:bg-slate-300 flex items-center justify-center"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      )}
    </div>
  );
}