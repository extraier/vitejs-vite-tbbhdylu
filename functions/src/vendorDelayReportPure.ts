/**
 * 2026-09-11 — Manus P12.1b.
 *
 * Pure helpers for vendor self-reported delays on rundown /
 * resources entries.
 *
 * The `reportVendorDelay` callable lets an assigned vendor say
 * "I'm running X minutes behind on this slot." The owner then
 * approves or rejects the report via `approveVendorDelay`,
 * which on-approve recomputes the projection's
 * `approvedDelayMinutes` field and pushes the number to the
 * vendor's per-vendor projection doc.
 *
 * The delay lifecycle:
 *
 *   vendor creates pending report
 *      -> write /rundown/{entryId}/vendorDelayReports/{reportId}
 *      -> projection.reportedDelayMinutes = sum(pending)
 *      owner approves
 *         -> projection.approvedDelayMinutes = sum(approved)
 *         -> projection.operationalStatus = 'delayed'
 *      owner rejects
 *         -> projection: no change (the report just shows
 *            rejected in the timeline)
 *
 * All helpers here are PURE — no Firebase, no Date.now().
 * Timestamps are passed in as numbers so the unit tests can
 * pin them deterministically.
 */

export type VendorDelayReportStatus = 'pending' | 'approved' | 'rejected';

export interface VendorDelayReport {
  id: string;
  ownerUid: string;
  eventId: string;
  entryId: string;
  vendorUid: string;
  delayMinutes: number;
  note: string;
  status: VendorDelayReportStatus;
  createdAt: number;
  updatedAt: number;
  /** Auth UID of the owner/co-owner who approved or rejected. */
  approvedBy?: string;
  /** Millis when approved/rejected; absent on `pending`. */
  approvedAt?: number;
  /** Owner's rejection note (only populated on rejected). */
  rejectionReason?: string;
}

export interface ValidateDelayReportInput {
  delayMinutes: unknown;
  note: unknown;
}

export type ValidateDelayReportResult =
  | { ok: true }
  | { ok: false; error: string };

export interface BuildPendingInput {
  ownerUid: string;
  eventId: string;
  entryId: string;
  vendorUid: string;
  delayMinutes: number;
  note: string;
  /**
   * Optional caller-supplied id suffix (the run-time uses
   * `Date.now() + random`). When present, the resulting id is
   * deterministic for tests.
   */
  idempotencyKey?: string | number;
}

export interface ApprovalDecision {
  decision: 'approve' | 'reject';
  approverUid: string;
  /** Trimmed reason; stored verbatim on rejected reports. */
  reason?: string;
}

// ---- internals --------------------------------------------------------

const MAX_DELAY_MINUTES = 720;       // 12h cap per report.
const MAX_NOTE_LENGTH = 1000;

/**
 * Coerce a string-or-number to an integer, returning null
 * for anything else. Used for both delayMinutes validation
 * and note-length sanitization downstream.
 */
function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

function safeStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ---- public surface ---------------------------------------------------

/**
 * Validate a vendor-submitted delay report BEFORE creating
 * the doc. Returns `{ ok: true }` on success or a stable error
 * string on failure. The callable wraps this and throws
 * HttpsError with the message; the pure helper exists so the
 * unit tests don't depend on the Firebase runtime.
 *
 * Rules:
 *   - delayMinutes: integer, 0..720 inclusive.
 *     0 means "we're back on track" — clamped at upper
 *     bound but NOT at lower (negative is always rejected).
 *   - note: string, <= 1000 chars (trimmed first; empty is
 *     allowed).
 */
export function validateDelayReportInput(
  input: ValidateDelayReportInput,
): ValidateDelayReportResult {
  const minutes = intOrNull(input.delayMinutes);
  if (minutes === null) {
    return {
      ok: false,
      error: `delayMinutes must be an integer 0..${MAX_DELAY_MINUTES}.`,
    };
  }
  if (minutes < 0) {
    return { ok: false, error: 'delayMinutes cannot be negative.' };
  }
  if (minutes > MAX_DELAY_MINUTES) {
    return {
      ok: false,
      error: `delayMinutes cannot exceed ${MAX_DELAY_MINUTES}.`,
    };
  }
  const note = safeStr(input.note).trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `note exceeds ${MAX_NOTE_LENGTH} chars.`,
    };
  }
  return { ok: true };
}

/**
 * Build a freshly-submitted `pending` delay report. Pure
 * factory — no writes. The callable passes the result to
 * `firestore.set(..., { merge: true })` against the run-time
 * id.
 *
 * `idempotencyKey` lets the caller decide what to put in the
 * doc id. The run-time passes `${authUid}_${Date.now()}_${rand}`
 * which is unique-per-request; tests pass a number/string.
 *
 * `createdAt` and `updatedAt` default to 0 (caller-supplied
 * millis); the run-time normally passes `Date.now()` for both.
 */
export function buildPendingVendorDelayReport(
  input: BuildPendingInput,
): VendorDelayReport {
  const trimmedNote = (input.note ?? '').toString().trim();
  const idSuffix =
    input.idempotencyKey === undefined || input.idempotencyKey === null
      ? 'pending'
      : String(input.idempotencyKey);
  return {
    id: `${input.vendorUid}_${idSuffix}`,
    ownerUid: input.ownerUid,
    eventId: input.eventId,
    entryId: input.entryId,
    vendorUid: input.vendorUid,
    delayMinutes: input.delayMinutes,
    note: trimmedNote,
    status: 'pending',
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Apply an approval/rejection to a pending report. Pure
 * transition — same input => same output. Returns a NEW
 * report object (no input mutation), so the caller can
 * pass either result straight to `set(merge: true)`.
 *
 * Decision semantics:
 *   - approve → status='approved', approvedBy, approvedAt set.
 *   - reject  → status='rejected', approvedBy, approvedAt set,
 *              rejectionReason set when supplied.
 */
export function applyApprovalDecision(
  report: VendorDelayReport,
  decision: ApprovalDecision,
  now: number,
): VendorDelayReport {
  const base: VendorDelayReport = {
    ...report,
    updatedAt: now,
    approvedBy: decision.approverUid,
    approvedAt: now,
  };
  if (decision.decision === 'approve') {
    return { ...base, status: 'approved' };
  }
  const reason = (decision.reason ?? '').toString().trim();
  return {
    ...base,
    status: 'rejected',
    ...(reason ? { rejectionReason: reason } : {}),
  };
}

/**
 * Compute the projection's `approvedDelayMinutes` from a list
 * of delay reports.
 *
 * Policy (Manus §1.6): there's exactly ONE number on the
 * projection. When multiple approved reports exist, we pick
 * the maximum of the most-recently-approved values — the
 * intent is "what's the largest active delay the owner has
 * signed off on?". `pending` and `rejected` reports never
 * contribute; pending only lights up `reportedDelayMinutes`.
 *
 * Returns 0 when no approved reports exist.
 */
export function computeApprovedDelayMinutes(
  reports: readonly VendorDelayReport[],
): number {
  let best = 0;
  let bestAt = -1;
  for (const r of reports) {
    if (r.status !== 'approved') continue;
    const at = typeof r.approvedAt === 'number' ? r.approvedAt : 0;
    if (at < bestAt) continue;
    // Tie-breaker: at the same approvedAt, the larger value wins.
    if (at === bestAt && r.delayMinutes <= best) continue;
    best = r.delayMinutes;
    bestAt = at;
  }
  return best;
}

/**
 * Sum of pending reports (the vendor's open delay
 * declarations). Mirrors `computeApprovedDelayMinutes` so the
 * callable can paint both numbers symmetrically on the
 * projection.
 */
export function computeReportedDelayMinutes(
  reports: readonly VendorDelayReport[],
): number {
  let best = 0;
  let bestAt = -1;
  for (const r of reports) {
    if (r.status !== 'pending') continue;
    const at = typeof r.createdAt === 'number' ? r.createdAt : 0;
    if (at < bestAt) continue;
    if (at === bestAt && r.delayMinutes <= best) continue;
    best = r.delayMinutes;
    bestAt = at;
  }
  return best;
}
