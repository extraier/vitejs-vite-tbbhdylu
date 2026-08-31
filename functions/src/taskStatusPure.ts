/**
 * 2026-08-31 — Manus P11.
 *
 * Pure helpers for `taskStatusTrigger`. Extracted so the trigger
 * logic is unit-testable without a Firestore emulator.
 *
 * The trigger listens to:
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     tasks/{taskId}
 *
 * and writes one private notification to the assigned helper's
 * inbox when:
 *   - The task was previously assigned to a helper
 *   - The status actually changed (before !== after)
 *   - The actor is NOT the assigned helper themselves
 *
 * Idempotency: the notification ID is derived from the task ID
 * and the AFTER snapshot's status revision (`statusUpdatedAt` or
 * `updatedAt`). Retries produce the same ID; the deterministic
 * merge in the trigger prevents duplicates.
 */

const APP_ID = 'savetheday-production';

export type TaskStatusPayload = {
  title?: unknown;
  status?: unknown;
  statusUpdatedAt?: unknown;
  updatedAt?: unknown;
  statusUpdatedByUid?: unknown;
  statusUpdatedByRole?: unknown;
  assignedHelperUid?: unknown;
};

/**
 * 2026-08-31 — Manus P11: shared path validation. The
 * taskStatusTrigger only accepts parentKind === 'tasks', but
 * the helper is reused from helperAssignmentPure's pattern
 * (where parentKind is a wildcard). Exported here so the
 * trigger can validate without coupling to that module.
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
 * 2026-08-31 — Manus P11: detect whether a task write should
 * produce a status-change alert for the assigned helper.
 *
 * Returns `{ recipient, fromStatus, toStatus }` where
 * `recipient === null` means "do not fan out". The trigger
 * handles the actual Firestore write; this function only sees
 * the two doc snapshots.
 *
 * The four skip reasons per the handoff:
 *   1. afterData missing (delete): no alert.
 *   2. beforeData missing AND no status change (rare / data
 *      import): no alert — there's no prior status to record.
 *   3. beforeStatus === afterStatus: no change.
 *   4. !afterData.assignedHelperUid: no recipient.
 *   5. statusUpdatedByUid === assignedHelperUid: self-suppress
 *      (the helper wrote their own status).
 *
 * IMPORTANT: if `statusUpdatedByUid` is missing entirely, we
 * fail CLOSED for the helper's case. The handoff says "either
 * notify the helper or fail closed according to the product
 * decision, but add a test for the chosen behavior." We choose
 * fail-closed — the helper does NOT get an alert when the
 * writer's identity is unknown. This is safer than firing an
 * alert that may be the helper's own action.
 */
export function resolveTaskStatusRecipient(opts: {
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}): {
  recipient: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  taskTitle: string;
  actorUid: string | null;
  skipReason:
    | null
    | 'after-missing'
    | 'before-missing'
    | 'status-unchanged'
    | 'no-helper-assigned'
    | 'self-update'
    | 'actor-unknown';
} {
  const after = opts.afterData as TaskStatusPayload | null;
  if (!after) {
    return {
      recipient: null,
      fromStatus: null,
      toStatus: null,
      taskTitle: '',
      actorUid: null,
      skipReason: 'after-missing',
    };
  }

  const before = opts.beforeData as TaskStatusPayload | null;
  if (!before) {
    // First write — there's no prior status to compare. The
    // handoff does not require an alert on creation; only on
    // transitions.
    return {
      recipient: null,
      fromStatus: null,
      toStatus: null,
      taskTitle: safeTitle(after.title),
      actorUid: null,
      skipReason: 'before-missing',
    };
  }

  const helperUid = safeString(after.assignedHelperUid);
  if (!helperUid) {
    return {
      recipient: null,
      fromStatus: null,
      toStatus: null,
      taskTitle: safeTitle(after.title),
      actorUid: null,
      skipReason: 'no-helper-assigned',
    };
  }

  const fromStatus = safeString(before.status);
  const toStatus = safeString(after.status);
  if (fromStatus === toStatus) {
    return {
      recipient: null,
      fromStatus,
      toStatus,
      taskTitle: safeTitle(after.title),
      actorUid: null,
      skipReason: 'status-unchanged',
    };
  }

  const actorUid = safeString(after.statusUpdatedByUid);
  if (!actorUid) {
    // Fail closed: the writer didn't declare who they are. We
    // can't tell if the helper wrote their own status, so we
    // don't notify anyone. The status-write rules enforce that
    // a valid actor field must be present on every direct write
    // (firestore.rules — see the helper update branch). A
    // missing actor field is a malformed write.
    return {
      recipient: null,
      fromStatus,
      toStatus,
      taskTitle: safeTitle(after.title),
      actorUid: null,
      skipReason: 'actor-unknown',
    };
  }

  if (actorUid === helperUid) {
    return {
      recipient: null,
      fromStatus,
      toStatus,
      taskTitle: safeTitle(after.title),
      actorUid,
      skipReason: 'self-update',
    };
  }

  return {
    recipient: helperUid,
    fromStatus,
    toStatus,
    taskTitle: safeTitle(after.title),
    actorUid,
    skipReason: null,
  };
}

/**
 * 2026-08-31 — Manus P11: deterministic notification ID for
 * task-status alerts.
 *
 * Format: `task-status_{eventId}_{taskId}_{statusRevision}_{recipientUid}`
 *
 * `statusRevision` is the AFTER-snapshot's `statusUpdatedAt` or
 * `updatedAt` normalized to millis. Same source write on retry
 * => same revision => same ID => idempotent fan-out (Manus A5).
 */
export function buildTaskStatusNotificationId(opts: {
  eventId: string;
  taskId: string;
  statusRevision: number | null;
  recipientUid: string;
}): string {
  const rev =
    opts.statusRevision === null || opts.statusRevision === undefined
      ? 'noversion'
      : String(opts.statusRevision);
  return (
    `task-status_${opts.eventId}_${opts.taskId}` +
    `_${rev}_${opts.recipientUid}`
  );
}

/**
 * 2026-08-31 — Manus P11: extract the stable status revision
 * from the after-snapshot. Prefers `statusUpdatedAt` (more
 * semantically meaningful for our use), falls back to
 * `updatedAt`, then Date.now() as a last resort.
 */
export function statusRevision(afterData: Record<string, unknown> | null): number {
  if (!afterData) return Date.now();
  const v = afterData.statusUpdatedAt ?? afterData.updatedAt;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try { return (v as { toMillis: () => number }).toMillis(); }
    catch { /* fall through */ }
  }
  return Date.now();
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTitle(value: unknown): string {
  return safeString(value) || '任務';
}

export { APP_ID as TASK_STATUS_APP_ID };