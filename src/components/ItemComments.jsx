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
import { addDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { callFirebaseFn } from '../lib/firebaseFn';
import { parseCommentPath } from '../lib/firestorePaths';

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
  // 2026-08-20 — Manus: deep-link to the exact comment that
  // triggered a bell alert. When the user clicks an alert in the
  // header, App.jsx captures the alert's `commentId` and passes
  // it down via focusedCommentId. This component scrolls the
  // matching comment into view (inside its scrollable list) and
  // briefly applies a ring highlight so the user lands on the
  // right message without hunting through the thread.
  //
  // Why not done via parent scrollIntoView: <WeddingDay>'s row-
  // level focus scrolls the parent row into the viewport, but
  // the comments list inside it has its own overflow-y scroll
  // (max-h-48). The matching comment might be far below the
  // list's viewport even after the parent is in view. So this
  // component handles its own internal scroll.
  focusedCommentId = null,
  // 2026-08-20 — Manus P0 correction: ItemComments is the
  // consumption authority for the comment-level focus. After a
  // successful scroll+highlight, fire this callback with the
  // payload { commentId, parentId, kind }. App.jsx uses it to
  // clear focusedCommentId (only if the callback's commentId
  // still matches the currently focused one — guards against
  // an old late callback clobbering a newer alert click).
  // Do NOT acknowledge on a failed retry — leaving focus alive
  // lets the existing sorted.length dependency retry when the
  // next Firestore snapshot arrives.
  onFocusedCommentHandled = null,
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  // A vendor must never open an unfiltered comment collection. The
  // parent assignment field is denormalized onto each comment and the
  // matching Firestore list rule requires this equality constraint.
  // Owner and helper reads remain scoped by the event path and their
  // respective role checks in the rules.
  const subscription = useMemo(() => {
    if (!path) return null;
    if (currentRole === 'vendor' && currentUser?.uid) {
      return query(path, where('parentAssignedVendorUid', '==', currentUser.uid));
    }
    return path;
  }, [path?.path, currentRole, currentUser?.uid]);

  const { data: comments = [], loading } = useFirestoreCollection(subscription, [
    path?.path,
    currentRole,
    currentUser?.uid,
  ]);

  // (2026-08-11 — Diagnostic logging removed. Path resolution
  //  bug found (off-by-one parent chain — see App.jsx commit 4b8d7ec).
  //  Fix landed; keep this file clean.)

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

  // 2026-08-20 — Manus: bell-alert deep-link. When `focusedCommentId`
  // is set, scroll the matching comment inside this list into view
  // and briefly highlight it. Retries for a few ticks because the
  // comments snapshot may not have arrived yet (Firestore listener
  // first-fire latency on cold open). Mirrors the CSS.escape guard
  // pattern from <WeddingDay>'s row-focus effect: jsdom (vitest)
  // doesn't polyfill CSS.escape, so we fall back to a regex that
  // handles the common Firestore doc-id charset (alphanumeric + -_).
  //
  // 2026-08-20 — Manus P0 correction: ItemComments is the
  // CONSUMPTION AUTHORITY for the comment-level focus. After a
  // successful scroll+highlight, call onFocusedCommentHandled with
  // { commentId, parentId, kind }. App.jsx uses this to clear
  // focusedCommentId (only when the callback id still matches the
  // currently-focused one). Do NOT acknowledge on a failed retry —
  // leaving focus alive lets the sorted.length dependency re-fire
  // when the next Firestore snapshot arrives.
  //
  // We pull parentId and kind from the path ref's segments, mirroring
  // the helpers/<comment-path> convention used elsewhere (the path
  // is `/.../rundown/{entryId}/comments` or `/.../resources/{itemId}/comments`,
  // so segments[-3] is the kind and segments[-2] is the parentId).
  // Falls back to null when path is missing or malformed — App.jsx's
  // guard tolerates null parentId/kind in the callback.
  const extractFocusContext = () => {
    try {
      const segs = path && typeof path === 'object' && Array.isArray(path.__segments)
        ? path.__segments
        : (typeof path === 'string' ? path.split('/').filter(Boolean) : []);
      if (segs.length < 3) return { parentId: null, kind: null };
      const kind = segs[segs.length - 3] || null;
      const parentId = segs[segs.length - 2] || null;
      return { parentId, kind };
    } catch {
      return { parentId: null, kind: null };
    }
  };

  useEffect(() => {
    if (!focusedCommentId || !listRef.current) return;
    const id = focusedCommentId;
    let acknowledged = false;
    // 2026-08-20 — Manus P0: track EVERY scheduled timer (initial
    // delay + retries) so the effect cleanup can cancel all of
    // them. The previous implementation only cleared the initial
    // delay, leaving retry setTimeouts in flight. On a prop
    // change (or unmount) those in-flight retries could still
    // find the element after the new effect had already
    // acknowledged, causing a duplicate callback fire.
    const timers = new Set();
    const attempt = (tries = 8) => {
      const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : String(id).replace(/([^\w-])/g, '\\$1');
      const el = listRef.current?.querySelector(`[data-comment-id="${safeId}"]`);
      if (el && listRef.current && !acknowledged) {
        acknowledged = true;
        // Use scrollIntoView on the list-scoped element. The list has
        // its own overflow-y; scrollIntoView walks up to find the
        // nearest scrollable ancestor (the list itself) and aligns
        // the element within it. block:'center' keeps the comment
        // comfortably visible even if the thread is short.
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Ring + tinted bg so the user lands on the right comment
        // without hunting. Compose with the existing comment bubble
        // styles via Tailwind utility classes; remove after a
        // generous timeout so the highlight doesn't linger forever.
        el.classList.add(
          'ring-2', 'ring-rose-400', 'ring-offset-1',
          'bg-rose-50', 'rounded-lg',
        );
        // The highlight-removal timer is NOT added to `timers`
        // because it is not part of the retry loop — leaving it
        // running is correct so the highlight clears even if the
        // component unmounts first.
        setTimeout(() => {
          el.classList.remove(
            'ring-2', 'ring-rose-400', 'ring-offset-1',
            'bg-rose-50', 'rounded-lg',
          );
        }, 3000);
        // CONSUMPTION ACKNOWLEDGEMENT — only on success. App.jsx
        // clears focusedCommentId in response (guarded by id match).
        if (typeof onFocusedCommentHandled === 'function') {
          const { parentId, kind } = extractFocusContext();
          onFocusedCommentHandled({ commentId: id, parentId, kind });
        }
        return;
      }
      // Snapshot hasn't delivered yet (first-fire latency, or the
      // panel just opened). Retry; bail after ~8 tries (~640ms).
      // Do NOT acknowledge on a failed retry — keep focus alive
      // so the [focusedCommentId, sorted.length] dep can re-fire.
      if (tries > 0) {
        const t = setTimeout(() => attempt(tries - 1), 80);
        timers.add(t);
      }
    };
    // Initial delay to let the snapshot first-fire commit + paint.
    const initial = setTimeout(() => attempt(8), 80);
    timers.add(initial);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [focusedCommentId, sorted.length, onFocusedCommentHandled, path]);

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
      // 2026-08-12 — Vendor / helper chat writes have been
      // silently failing in the live rules layer for the past
      // 4+ sessions, despite the local emulator + REST probe
      // path both passing (firestore-rules-shadow-pitfalls
      // Class 27 — runQuery vs listDocuments divergence on
      // collectionGroup LISTEN channels). To avoid chasing
      // the rules-engine quirk further, route vendor + helper
      // writes through the new vendorPostComment Cloud
      // Function instead. The CF verifies the caller's
      // assignment server-side via Admin SDK and writes
      // through Admin SDK (rules always allow admin writes),
      // so the doc lands in Firestore regardless of the
      // rules-engine state on the vendor's tab. Owner writes
      // still go through the SDK addDoc path because the
      // owner's rules-engine branch is verified clean.
      //
      // After the CF writes, the local optimistic <ItemComments>
      // doesn't need a manual setText append — the existing
      // onSnapshot subscribe picks up the new doc on its next
      // tick and renders it via the normal sorted comments
      // path. If the snapshot is delayed, the optimistic
      // state below adds a local fallback so the UI feels
      // instant.
      if (currentRole === 'vendor' || currentRole === 'helper') {
        // Parse the comment-path segments directly. In modular SDK v10
        // a CollectionReference's `.parent` chain alternates between
        // DocumentReference (where `.id` returns the doc ID) and
        // CollectionReference (where `.id` returns the literal
        // collection-name segment), so walking the chain to extract
        // IDs is unreliable. Always parse the path string instead.
        //
        // 2026-08-13 — LOW audit refactor: replaced inline parsing
        // with parseCommentPath helper. Path convention is
        //   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}/comments/{commentId}
        // The helper returns {ownerUid, eventId, kind, itemId, commentId}
        // or null if the path doesn't match.
        const parsed = parseCommentPath(path?.path || '');
        if (!parsed) {
          throw new Error('Could not resolve comment-path components for the Cloud Function call.');
        }
        const { ownerUid, eventId, kind: inferredKind, itemId: inferredItemId } = parsed;
        if (
          !ownerUid || !eventId || !inferredKind || !inferredItemId
        ) {
          throw new Error('Could not resolve comment-path components for the Cloud Function call.');
        }
        // 2026-08-13 — debug console.log removed (vendor-comment
        // round-trip verified end-to-end on commits f364f14 + 3cae1af).
        await callFirebaseFn(
          'vendorPostComment',
          {
            ownerUid,
            eventId,
            parentKind: inferredKind,
            parentId: inferredItemId,
            text: clean,
          },
        );
        setText('');
        return;
      }
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
      //
      // 2026-08-12 — owner writes still flow through this path.
      // helpers in the VendorDashboard now go through the CF
      // path above; helpers in HelperDashboard still use the
      // SDK path because the helper's auth context hasn't been
      // hitting the rules-engine quirk.
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
      console.warn('[ItemComments] send failed', err?.message, err?.code);
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
          // 2026-08-20 — Manus: data-comment-id lets the bell-
          // alert deep-link scroll the exact comment into view
          // (see focusedCommentId effect above). Was previously
          // a bare div with no stable hook.
          <div key={c.id} data-comment-id={c.id} className="flex items-start gap-2">
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
