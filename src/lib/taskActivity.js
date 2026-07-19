// Pure utility: builds a status-update doc to write into the
// `statusUpdates` subcollection and merges a stream of status-update +
// comment events into a single chronologically-sorted timeline.
//
// 2026-07-19 — added alongside /tasks/{taskId}/comments so the
// activity log on a task shows BOTH status changes (immutable)
// and discussion (mutable, threaded).

const STATUS_LABELS_ZH = {
  todo: '待辦',
  in_progress: '進行中',
  blocked: '受阻',
  negotiating: '議價中',
  done: '已完成',
  cancelled: '已取消',
};

const ROLE_LABELS_ZH = {
  owner: '主理新人',
  vendor: '商戶',
  helper: '助手',
};

/**
 * Build the merged activity feed for a task. Inputs are two Firestore
 * subcollections — the caller already has them via useFirestoreCollection
 * hooks. Output is a flat list of `{ kind, ts, ... }` entries sorted
 * oldest-to-newest.
 *
 * @param {Array<{id, authorUid?, authorName?, authorRole?, text?, parentCommentId?, createdAt}>} comments
 * @param {Array<{id, byUid?, byRole?, byName?, fromStatus, toStatus, reason?, createdAt}>} statusUpdates
 * @returns {Array<{kind: 'comment'|'status', ts:number, ...}>}
 */
export function mergeTaskActivity(comments, statusUpdates) {
  const toMs = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (v.toMillis) return v.toMillis();
    if (v.seconds) return v.seconds * 1000;
    return 0;
  };

  const events = [];
  (comments || []).forEach((c) => {
    events.push({
      kind: 'comment',
      id: c.id,
      ts: toMs(c.createdAt),
      authorUid: c.authorUid,
      authorName: c.authorName,
      authorRole: c.authorRole,
      text: c.text,
      parentCommentId: c.parentCommentId || null,
      raw: c,
    });
  });
  (statusUpdates || []).forEach((s) => {
    events.push({
      kind: 'status',
      id: s.id,
      ts: toMs(s.createdAt),
      byUid: s.byUid,
      byName: s.byName,
      byRole: s.byRole,
      fromStatus: s.fromStatus,
      toStatus: s.toStatus,
      reason: s.reason || null,
      raw: s,
    });
  });
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return events;
}

/**
 * Build the doc body for a new statusUpdate entry. Server stamps
 * createdAt for sub-second ordering when `serverTimestamp()` is
 * available.
 */
export function buildStatusUpdateDoc({ fromStatus, toStatus, byUid, byName, byRole, reason }) {
  return {
    byUid,
    byName,
    byRole,
    fromStatus,
    toStatus,
    reason: reason || null,
    createdAt: Date.now(),
  };
}

export function statusLabel(s) {
  return STATUS_LABELS_ZH[s] || s || '?';
}

export function roleLabel(r) {
  return ROLE_LABELS_ZH[r] || r || '?';
}

/**
 * True if the signed-in user is allowed to author a comment on this
 * task — i.e. owner, OR the assigned vendor, OR the assigned helper
 * (provided the helper has `canViewChecklist` perm). Mirrors the
 * firestore.rules for /comments/{commentId} so callers can decide
 * whether to show the input form.
 */
export function canCommentOnTask(task, currentUser, currentRole) {
  if (!task || !currentUser?.uid) return false;
  if (currentRole === 'owner') return true;
  if (currentRole === 'vendor' && task.assignedVendorUid === currentUser.uid) return true;
  if (
    currentRole === 'helper' &&
    task.assignedHelperUid === currentUser.uid &&
    task.helperCanViewChecklist !== false
  ) {
    return true;
  }
  return false;
}
