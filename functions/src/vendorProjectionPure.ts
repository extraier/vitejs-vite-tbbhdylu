/**
 * 2026-09-11 — Manus P12.1a.
 *
 * Pure helpers for the vendor-rundown snapshot projection
 * (`onRundownAssignedItemWritten` /
 * `onResourcesAssignedItemWritten` second leg).
 *
 * The projection is a sanitized per-vendor view of an event's
 * rundown/resources entry, written to:
 *
 *   /artifacts/savetheday-production/users/{ownerUid}/
 *     events/{eventId}/vendorViews/{vendorUid}/rundown/{entryId}
 *
 * Sanitization is allowlist-driven (Manus §1.6, A1): the only
 * fields copied into the projection are those the contract
 * lists. Anything the source doc carries beyond the allowlist
 * — `assignedVendorName`, owner notes, budget, guestIds,
 * paymentInfo, coOwner fields, privateNotes — is dropped on
 * the floor.
 *
 * Vendors who are NOT the assigned vendor for an entry still
 * get a (heavily trimmed) projection doc so they can see when
 * competitors are booked at the same time slot. Those
 * non-assigned vendors get ONLY the timeline-slice fields
 * (title, start/end, location, group, sequence) and the
 * `isAssignedToViewer` flag is false.
 *
 * All functions here are PURE. No Firebase Admin, no
 * `FieldValue`, no `serverTimestamp()`. Timestamps are typed
 * as `number | null` everywhere they're accepted so unit tests
 * can pin them without mocking.
 */

export type VendorOperationalStatus =
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'delayed'
  | 'cancelled';

/**
 * The vendor projection shape. WHAT the runtime actually
 * writes into the vendorViews subcollection — small enough
 * that the onSnapshot listener on the vendor's timeline view
 * doesn't burn mobile data.
 *
 * `sourceVersion` is monotonically increasing per
 * (ownerUid, eventId, entryId, vendorUid). The trigger derives
 * it from the source doc's `updatedAt` (Millis) — a stable
 * per-write identifier — so a Cloud Functions retry produces
 * the same `sourceVersion` and the projection doc id stays
 * deterministic (idempotent rewrite, no clobber of any
 * client-side `readAt`-equivalent).
 */
export interface VendorProjection {
  ownerUid: string;
  eventId: string;
  vendorUid: string;
  entryId: string;
  title: string | null;
  group: string | null;
  startTime: number | null;
  endTime: number | null;
  durationMinutes: number | null;
  location: string | null;
  sequence: number | null;
  isAssignedToViewer: boolean;
  operationalStatus: VendorOperationalStatus;
  reportedDelayMinutes: number;
  approvedDelayMinutes: number;
  updatedAt: number | null;
  sourceVersion: number;
}

/**
 * Source document fields the projection reads. The runtime
 * uses the raw trigger-snapshot data which may carry any
 * shape — we explicitly narrow here.
 */
export interface SourceDocInput {
  title?: unknown;
  group?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  durationMinutes?: unknown;
  location?: unknown;
  sequence?: unknown;
  /** The assigned vendor's auth UID; matches VendorProjection.vendorUid. */
  assignedVendorUid?: unknown;
  /** The source's status field used to drive `operationalStatus`. */
  status?: unknown;
  /** True iff the source has been marked completed. */
  isCompleted?: unknown;
  updatedAt?: unknown;
  /**
   * Pre-existing reported-delay minutes already stamped onto
   * the source by an earlier `reportVendorDelay` write. We
   * accept this so the trigger doesn't zero out a vendor's
   * open report when the parent doc is updated for unrelated
   * reasons.
   */
  reportedDelayMinutes?: unknown;
  /**
   * Owner-approved delay minutes already stamped onto the
   * source projection via `approveVendorDelay`. Carried
   * through unchanged on update.
   */
  approvedDelayMinutes?: unknown;
}

interface BuildVendorProjectionInput {
  ownerUid: string;
  eventId: string;
  vendorUid: string;
  entryId: string;
  sourceDoc: SourceDocInput;
  /**
   * True iff vendorUid == sourceDoc.assignedVendorUid. The
   * trigger derives this server-side from the AFTER-snapshot
   * (never from client input) and passes it down. Non-assigned
   * vendors get a stripped projection.
   */
  isAssignedToViewer: boolean;
}

// ---- internals --------------------------------------------------------

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * Coerce a Firestore-ish Timestamp-like value to millis. The
 * snapshot arrives from `event.data.after.data()` which may be
 * a real Firestore Timestamp, a number (admin SDK returns
 * Timestamp by default but tests pass numbers), or absent. We
 * accept all three shapes so unit tests don't need to mock
 * Firestore.
 */
function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; _seconds?: number };
    if (typeof ts.toMillis === 'function') {
      try { return ts.toMillis(); } catch { return null; }
    }
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  }
  return null;
}

/**
 * Operational-status precedence (highest to lowest):
 *   cancelled > done > in_progress > delayed > scheduled
 *
 * `delayed` requires `approvedDelayMinutes > 0` — pending
 * reports that haven't been approved yet must NOT move the
 * projection to `delayed`, otherwise the vendor sees a
 * red-banged timeline while the owner is still reviewing.
 */
function pickOperationalStatus(args: {
  sourceStatus: string | null;
  approvedDelayMinutes: number;
  isCompleted: boolean;
}): VendorOperationalStatus {
  const s = (args.sourceStatus ?? '').toString().toLowerCase().trim();
  const delayed = args.approvedDelayMinutes > 0;
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'done' || s === 'completed' || args.isCompleted) return 'done';
  if (s === 'in_progress' || s === 'in-progress' || s === 'inprogress') {
    return 'in_progress';
  }
  if (delayed) return 'delayed';
  return 'scheduled';
}

// ---- public surface ---------------------------------------------------

/**
 * Build the sanitized vendor projection. The allowlist is
 * literal — every field NOT mentioned in VendorProjection is
 * dropped, including `assignedVendorName`, `ownerNotes`,
 * `budget`, `guestIds`, `paymentInfo`, `privateComments`,
 * `coOwners`, etc.
 *
 * For non-assigned vendors, `isAssignedToViewer` is false and
 * the assignment-derived fields (vendorUid-specific bits,
 * status-driven bits) are zeroed out so the vendor still gets
 * a timeline view but cannot reverse-engineer who is assigned
 * to the slot.
 */
export function buildVendorProjection(
  input: BuildVendorProjectionInput,
): VendorProjection {
  const { ownerUid, eventId, vendorUid, entryId, sourceDoc, isAssignedToViewer } = input;

  const updatedAt = toMillis(sourceDoc.updatedAt);
  // sourceVersion is the snapshot's updatedAt-in-millis when
  // present — gives us idempotency on retry. Fallback to 0
  // (rather than Date.now()) so the pure helper stays
  // deterministic and testable. Runtime callers don't hit
  // the fallback because the trigger ALWAYS carries updatedAt.
  const sourceVersion = updatedAt ?? 0;

  // Timeline-slice fields — ALL viewers see these (both
  // assigned and non-assigned vendors get the same title/time
  // string so they can see "is this slot free?").
  const title = safeString(sourceDoc.title);
  const group = safeString(sourceDoc.group);
  const startTime = toMillis(sourceDoc.startTime);
  const endTime = toMillis(sourceDoc.endTime);
  const durationMinutes = safeNumber(sourceDoc.durationMinutes);
  const location = safeString(sourceDoc.location);
  const sequence = safeNumber(sourceDoc.sequence);

  if (!isAssignedToViewer) {
    // Non-assigned view: only the timeline-slice fields.
    // Note vendorUid is still set to the viewer so the
    // client-side collectionGroup query can scope to a
    // specific vendor (the owner of the projection doc is
    // the viewer, regardless of whether they're assigned).
    return {
      ownerUid,
      eventId,
      vendorUid,
      entryId,
      title,
      group,
      startTime,
      endTime,
      durationMinutes,
      location,
      sequence,
      isAssignedToViewer: false,
      // Locked-in defaults for non-assigned viewers — they
      // can't see the source's status / delay fields.
      operationalStatus: 'scheduled',
      reportedDelayMinutes: 0,
      approvedDelayMinutes: 0,
      updatedAt,
      sourceVersion,
    };
  }

  // Assigned view: carry the operational status + delay
  // minutes through verbatim.
  const approvedDelayMinutes =
    safeNumber(sourceDoc.approvedDelayMinutes) ?? 0;
  const reportedDelayMinutes =
    safeNumber(sourceDoc.reportedDelayMinutes) ?? 0;
  const isCompleted = sourceDoc.isCompleted === true;
  const sourceStatus = safeString(sourceDoc.status);
  const operationalStatus = pickOperationalStatus({
    sourceStatus,
    approvedDelayMinutes,
    isCompleted,
  });

  return {
    ownerUid,
    eventId,
    vendorUid,
    entryId,
    title,
    group,
    startTime,
    endTime,
    durationMinutes,
    location,
    sequence,
    isAssignedToViewer: true,
    operationalStatus,
    reportedDelayMinutes,
    approvedDelayMinutes,
    updatedAt,
    sourceVersion,
  };
}

/**
 * Diff helper for two vendor-uid arrays. Vendor-uid arrays
 * are the *assignment-history* lists the trigger maintains
 * — `before` is what the BEFORE-snapshot carried,
 * `after` is what the AFTER-snapshot carries. This helper is
 * exported for testability only; the trigger uses its own
 * inline loop because it has to issue admin reads.
 */
export function resolveVendorAccessDiff(opts: {
  beforeVendors: readonly string[];
  afterVendors: readonly string[];
}): { added: string[]; removed: string[] } {
  const before = new Set(opts.beforeVendors);
  const after = new Set(opts.afterVendors);
  const added: string[] = [];
  const removed: string[] = [];
  for (const v of after) {
    if (v && !before.has(v)) added.push(v);
  }
  for (const v of before) {
    if (v && !after.has(v)) removed.push(v);
  }
  return { added: added.sort(), removed: removed.sort() };
}

/**
 * Compute the projection's `operationalStatus` from the source
 * doc's `status` + `approvedDelayMinutes` + `isCompleted`.
 *
 * Precedence: cancelled > done > in_progress > delayed > scheduled.
 *
 * `delayed` is only emitted when `approvedDelayMinutes > 0`
 * (a vendor PENDING report that's not yet approved must NOT
 * flip the timeline to "delayed"). This is also what the
 * `approveVendorDelay` callable counts on when it computes
 * the projected delay AFTER the owner hits approve.
 */
export function computeOperationalStatus(opts: {
  sourceStatus: string | null | undefined;
  approvedDelayMinutes: number | null | undefined;
  isCompleted: boolean | null | undefined;
}): VendorOperationalStatus {
  return pickOperationalStatus({
    sourceStatus: safeString(opts.sourceStatus ?? null),
    approvedDelayMinutes: typeof opts.approvedDelayMinutes === 'number' && Number.isFinite(opts.approvedDelayMinutes)
      ? opts.approvedDelayMinutes
      : 0,
    isCompleted: opts.isCompleted === true,
  });
}

/**
 * Reconcile access-marker state between two snapshots
 * (previous + next). Each marker records whether the vendor
 * currently has any assignment to the event. Returns the
 * diffs so the trigger can grant / revoke vendorAccess docs
 * independently of the projection writes.
 *
 * The trigger uses this to:
 *   - grant `vendorAccess/{vendorUid}` when a vendor becomes
 *     newly-assigned to ANY entry in an event
 *   - revoke `vendorAccess/{vendorUid}` when a vendor's last
 *     assignment in an event is removed
 *
 * Note: a vendor can have MULTIPLE assignments in one event
 * (3 slots across the day). The trigger already maintains an
 * aggregate "any assignment" view per event; this helper
 * just diffs those aggregates.
 */
export function reconcileAccessMarkers(
  prev: Record<string, { hasAssignment: boolean }>,
  next: Record<string, { hasAssignment: boolean }>,
): { toGrant: string[]; toRevoke: string[] } {
  const toGrant: string[] = [];
  const toRevoke: string[] = [];
  const seen = new Set<string>();
  for (const uid of Object.keys(next)) {
    seen.add(uid);
    const was = prev[uid]?.hasAssignment === true;
    const is = next[uid]?.hasAssignment === true;
    if (!was && is) toGrant.push(uid);
    if (was && !is) toRevoke.push(uid);
  }
  for (const uid of Object.keys(prev)) {
    if (seen.has(uid)) continue;
    const was = prev[uid]?.hasAssignment === true;
    if (was) toRevoke.push(uid);
  }
  return { toGrant: toGrant.sort(), toRevoke: toRevoke.sort() };
}
