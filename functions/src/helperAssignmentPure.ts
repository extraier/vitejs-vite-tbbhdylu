/**
 * 2026-08-31 — Manus P11.
 *
 * Pure helpers for `helperAssignmentTrigger` and `taskStatusTrigger`.
 *
 * Extracted so the trigger logic can be unit-tested without a
 * Firestore emulator (functions/test/* patterns). Every function
 * here has no external dependencies — just data in, data out —
 * and is exercised by a dedicated *.test.ts in functions/test/.
 *
 * The pure functions cover four concerns:
 *
 *   1. Path validation — confirm a doc write came from the
 *      production app namespace with the expected parent kinds,
 *      before any recipient resolution happens.
 *
 *   2. Recipient resolution for assignment / item-update events —
 *      derive the helper UID that should be notified from the
 *      POST-write document, never from a client-supplied list.
 *      Per the handoff's behavior matrix:
 *        no helper → helper        => notify new helper
 *        helper A → helper B       => notify helper B (NOT A)
 *        helper A → helper A       => notify helper A only when a
 *                                    meaningful field changed
 *        helper A → no helper     => no helper alert
 *        doc created with helper  => notify helper (assignment)
 *        doc deleted              => no alert (delete = no recipient)
 *
 *   3. Status-change detection for task updates — compare before
 *      and after status, suppress helper self-notification when
 *      the helper wrote their own status change, refuse to fan
 *      out when no helper is assigned.
 *
 *   4. Deterministic notification ID builder — same input => same
 *      ID, so retries cannot duplicate alerts and re-reading the
 *      inbox never produces duplicates (Manus A5).
 */

const APP_ID = 'savetheday-production';

export type BigDayParentKind = 'rundown' | 'resources';

export type AssignmentAction = 'assigned' | 'updated';

/**
 * 2026-08-31 — Manus P11: the fields whose change should produce
 * an "update" alert. Allowlist semantics — anything not in this
 * set (updatedAt, updatedByUid, local bookkeeping) is silent.
 *
 * assignedHelperUid is INCLUDED in the allowlist because the
 * helper-replacement case (helper A → helper B) routes through
 * this matrix. assignedHelperName follows it for display parity.
 */
export const MEANINGFUL_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'startTime',
  'endTime',
  'location',
  'address',
  'notes',
  'description',
  'assignedHelperUid',
  'assignedHelperName',
  'order',
]);

/**
 * 2026-08-31 — Manus P11: minimal path validation for both
 * helperAssignmentTrigger and taskStatusTrigger.
 *
 * Returns null if the path is acceptable, or a short skip-reason
 * string the trigger should log and return on.
 *
 * Note: the helperAssignmentTrigger further constrains parentKind
 * to 'rundown' | 'resources'; the taskStatusTrigger only accepts
 * parentKind === 'tasks'. The caller passes its own allowed-kinds
 * set so this helper is shared without leaking one trigger's
 * semantics into the other.
 */
export function validateTriggerPath(opts: {
  appId: string | undefined;
  ownerUid: string | undefined;
  eventId: string | undefined;
  parentKind: string | undefined;
  parentId: string | undefined;
  allowedParentKinds: readonly string[];
  expectedAppId?: string;
}): null | 'foreign-app' | 'missing-params' | 'unknown-parent-kind' {
  const expected = opts.expectedAppId ?? APP_ID;
  if (!opts.appId || opts.appId !== expected) return 'foreign-app';
  if (
    !opts.ownerUid || !opts.ownerUid.trim() ||
    !opts.eventId || !opts.eventId.trim() ||
    !opts.parentKind || !opts.parentKind.trim() ||
    !opts.parentId || !opts.parentId.trim()
  ) {
    return 'missing-params';
  }
  if (!opts.allowedParentKinds.includes(opts.parentKind)) {
    return 'unknown-parent-kind';
  }
  return null;
}

/**
 * 2026-08-31 — Manus P11: derive the helper recipient for a
 * rundown/resources write event.
 *
 * Returns `{ recipient: string | null, action: AssignmentAction }`
 * where recipient === null means "do not write a helper alert".
 *
 * This is the per-call decision-tree. The trigger wraps it with
 * the actual Firestore reads; this function only sees the two
 * doc snapshots (before/after) and the change delta.
 */
export function resolveAssignmentRecipient(opts: {
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedKeys: readonly string[];
  previousHelperUid: string | null;
  currentHelperUid: string | null;
}): { recipient: string | null; action: AssignmentAction } {
  // Case: document deleted. afterData null => no alert.
  if (!opts.afterData) {
    return { recipient: null, action: 'updated' };
  }

  const currentHelper = opts.currentHelperUid;

  // Case: helper was just REMOVED (previousHelperUid set,
  // currentHelperUid empty). No helper alert — that's an owner
  // / co-owner concern, not a helper one.
  if (opts.previousHelperUid && !currentHelper) {
    return { recipient: null, action: 'updated' };
  }

  // No helper assigned (was empty, still empty) => no alert.
  if (!currentHelper) {
    return { recipient: null, action: 'updated' };
  }

  // New document created with a helper assigned => assignment alert.
  if (!opts.beforeData) {
    return { recipient: currentHelper, action: 'assigned' };
  }

  // Helper just newly assigned (was empty, now set). The helper
  // exists in the changedKeys list because the diff is real, and
  // we want to classify this as 'assigned' regardless of whether
  // other meaningful fields also changed in the same write.
  if (!opts.previousHelperUid) {
    return { recipient: currentHelper, action: 'assigned' };
  }

  // Helper replaced (A → B): notify B only. A is no longer the
  // recipient for this item, so A does NOT get an "unassigned"
  // alert — that would be noise.
  if (opts.previousHelperUid !== currentHelper) {
    return { recipient: currentHelper, action: 'assigned' };
  }

  // Same helper, assignment unchanged: an "update" alert fires
  // only when a MEANINGFUL field changed. Internal-only fields
  // (updatedAt, updatedByUid, statusUpdatedAt, etc.) must not
  // trigger alerts.
  const meaningfulChanged = opts.changedKeys.some((k) =>
    MEANINGFUL_ITEM_FIELDS.has(k),
  );
  if (meaningfulChanged) {
    return { recipient: currentHelper, action: 'updated' };
  }

  return { recipient: null, action: 'updated' };
}

/**
 * 2026-08-31 — Manus P11: compute the diff between two doc
 * snapshots for the trigger's changedKeys list.
 *
 * Uses Firestore's `affectedKeys()` semantics (keys present in
 * either snapshot, excluding pure deletions whose counterpart
 * is also gone). For our purposes — change detection — we just
 * union the keys, then narrow to meaningful ones downstream.
 *
 * NOTE: The trigger uses the real `request.resource.data.diff(
 * resource.data).affectedKeys()` from the Firestore event. This
 * helper is for unit tests and for the synthetic-event path the
 * tests drive; the production trigger does NOT call this.
 */
export function diffKeys(
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(beforeData || {})) keys.add(k);
  for (const k of Object.keys(afterData || {})) keys.add(k);
  return Array.from(keys);
}

/**
 * 2026-08-31 — Manus P11: deterministic notification ID builder
 * for assignment / item-update alerts. Same input => same ID,
 * so a Cloud Functions retry cannot produce a duplicate alert.
 *
 * Format:
 *   bigday-{kind}_{eventId}_{parentKind}_{parentId}_{version}_{recipientUid}
 *
 * `version` should be a stable per-source-write identifier — the
 * handoff recommends the source document's `updatedAt` normalized
 * to millis. If `version` is missing, the trigger falls back to
 * 'noversion' (which still gives idempotent IDs as long as the
 * source-doc `updatedAt` is set on every meaningful write).
 */
export function buildAssignmentNotificationId(opts: {
  kind: AssignmentAction;
  eventId: string;
  parentKind: BigDayParentKind;
  parentId: string;
  version: string | number | null;
  recipientUid: string;
}): string {
  const version =
    opts.version === null || opts.version === undefined
      ? 'noversion'
      : String(opts.version);
  return (
    `bigday-${opts.kind}_${opts.eventId}_${opts.parentKind}` +
    `_${opts.parentId}_${version}_${opts.recipientUid}`
  );
}

/**
 * 2026-08-31 — Manus P11: extract a stable per-write version
 * from the after-snapshot. The handoff prefers the source's
 * `updatedAt` (millis) so the same write produces the same ID
 * on retry. Falls back to Date.now() when the source has no
 * updatedAt — the trigger logs this and accepts the ID as
 * best-effort.
 */
export function sourceVersion(afterData: Record<string, unknown> | null): number {
  if (!afterData) return Date.now();
  const v = afterData.updatedAt;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try { return (v as { toMillis: () => number }).toMillis(); }
    catch { /* fall through */ }
  }
  return Date.now();
}