import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

/**
 * `recordTaskStatusUpdate` — write a single doc to
 * `tasks/{taskId}/statusUpdates/{autoId}` whenever the status field
 * on a task changes. The parent task update itself remains the
 * source of truth (`status`, `statusUpdatedAt`, `statusNote`); this
 * audit-trail entry is the per-change snapshot used by the
 * `<TaskActivityTimeline>` UI to render a chronological log of
 * "who, when, from → to, why".
 *
 * 2026-07-19 — added when the helper-can-comment feature required a
 * clean activity history.
 *
 * @param {object} args
 * @param {string} args.ownerUid
 * @param {string} args.taskId
 * @param {string} args.fromStatus   previous status id (may be null
 *                                   for the very first change)
 * @param {string} args.toStatus
 * @param {string} args.byUid        uid of the person making the change
 * @param {string} args.byName       denormalized display name
 * @param {string} args.byRole       'owner' | 'vendor' | 'helper'
 * @param {string} [args.reason]     optional free-text reason
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
    await setDoc(
      doc(
        db,
        'artifacts',
        appId,
        'users',
        ownerUid,
        'tasks',
        taskId,
        'statusUpdates',
        `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
      {
        byUid,
        byName: byName || null,
        byRole: byRole || 'owner',
        fromStatus: fromStatus || null,
        toStatus,
        reason: reason || null,
        createdAt: serverTimestamp(),
      },
    );
  } catch (err) {
    // Don't block the main write — the primary task update and the
    // UI's status field are still updated. Trail failure surfaces
    // in the console only.
    // eslint-disable-next-line no-console
    console.warn('[recordTaskStatusUpdate] trail write failed:', err?.message);
  }
}
