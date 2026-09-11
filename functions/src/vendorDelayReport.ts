/**
 * 2026-09-11 — Manus P12.1c.
 *
 * Vendor delay reporting callables.
 *
 *   reportVendorDelay — the assigned vendor uses this to
 *   self-report a delay on a rundown / resource slot. The
 *   doc lands at:
 *
 *     /artifacts/savetheday-production/users/{ownerUid}/
 *       events/{eventId}/rundown/{entryId}/
 *       vendorDelayReports/{reportId}
 *
 *   The report id is `${authUid}_${Date.now()}_${random}`
 *   to keep the doc path unique-per-request. Idempotency:
 *   if a `pending` report already exists for the same
 *   (entryId, vendorUid) within the last 60s, the callable
 *   returns that report id instead of creating a duplicate.
 *
 *   approveVendorDelay — the owner / co-owner approves or
 *   rejects a pending report. On approve the projection's
 *   `approvedDelayMinutes` is recomputed and merged onto:
 *
 *     /artifacts/savetheday-production/users/{ownerUid}/
 *       events/{eventId}/vendorViews/{vendorUid}/
 *       rundown/{entryId}
 *
 *   On reject no projection write occurs (the rejected
 *   report just shows up as `status: 'rejected'` in the
 *   timeline).
 *
 * Both callables verify authorization server-side using
 * Admin SDK reads (so they don't get tripped up by client
 * SDK rules-cache staleness, mirroring the pattern in
 * vendorComment.ts#vendorPostComment). Caller-provided
 * `vendorUid` is NEVER trusted; vendor identity comes from
 * `req.auth.uid` exclusively.
 *
 * Path-resolution security: callers pass ownerUid/eventId/entryId
 * explicitly. We use those to build the canonical path
 * server-side and reject any call whose parent doc doesn't
 * exist OR whose `assignedVendorUid` doesn't match the
 * caller (for reportVendorDelay) / whose owner's event
 * doesn't list the caller (for approveVendorDelay). This is
 * the same containment pattern vendorComment.ts uses.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  applyApprovalDecision,
  buildPendingVendorDelayReport,
  computeApprovedDelayMinutes,
  computeReportedDelayMinutes,
  validateDelayReportInput,
} from './vendorDelayReportPure';
import type { VendorDelayReport } from './vendorDelayReportPure';

try {
  initializeApp();
} catch (_) {
  // Admin SDK singleton — already initialized.
}

const APP_ID = 'savetheday-production';
const db = getFirestore();
const PARENT_KINDS = new Set(['rundown', 'resources'] as const);
type ParentKind = 'rundown' | 'resources';

const DUPE_WINDOW_MS = 60_000;
const MAX_NOTE_LENGTH = 1000;
const MAX_REASON_LENGTH = 1000;

// ---- shared helpers ----

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeForStorage(input: string | undefined | null): string {
  // Tight clamp at MAX_NOTE_LENGTH with explicit suffix.
  const cleaned = (input ?? '').toString().trim();
  if (cleaned.length <= MAX_NOTE_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_NOTE_LENGTH)}…`;
}

function resolveAssignedVendorUid(doc: Record<string, unknown>): string | null {
  return (
    safeString(doc.assignedVendorUid) ||
    safeString(doc.vendorUid)
  );
}

/**
 * Fetch the canonical rundown entry doc server-side. The
 * caller passes `parentKind` so we route to /rundown/ or
 * /resources/. Returns null on not-found / missing-path.
 */
async function fetchEntry(opts: {
  ownerUid: string;
  eventId: string;
  parentKind: ParentKind;
  entryId: string;
}): Promise<{
  data: Record<string, unknown>;
  refPath: string;
} | null> {
  const ref = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(opts.ownerUid)
    .collection('events').doc(opts.eventId)
    .collection(opts.parentKind)
    .doc(opts.entryId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { data: snap.data() || {}, refPath: ref.path };
}

async function fetchEvent(opts: {
  ownerUid: string;
  eventId: string;
}): Promise<Record<string, unknown> | null> {
  const ref = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(opts.ownerUid)
    .collection('events').doc(opts.eventId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() || {};
}

function fieldErrors(label: string, conditions: Array<[boolean, string]>): string[] {
  const errors: string[] = [];
  for (const [ok, msg] of conditions) {
    if (!ok) errors.push(`${label}: ${msg}`);
  }
  return errors;
}

// ---- reportVendorDelay ----

interface ReportVendorDelayInput {
  ownerUid?: unknown;
  eventId?: unknown;
  parentKind?: unknown;
  entryId?: unknown;
  delayMinutes?: unknown;
  note?: unknown;
}

function randomSuffix(): string {
  // Six base36 chars is plenty for collision avoidance in a 60s window.
  return Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
}

export const reportVendorDelay = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req): Promise<{ ok: true; reportId: string; deduped?: boolean }> => {
    try {
      if (!req.auth) {
        throw new HttpsError('unauthenticated', 'Sign in first.');
      }
      const callerUid = req.auth.uid;

      const {
        ownerUid,
        eventId,
        parentKind,
        entryId,
        delayMinutes,
        note,
      } = (req.data || {}) as ReportVendorDelayInput;

      // Field-by-field validation mirrors the live-rules
      // shape exactly so the projection can be deserialized
      // uniformly regardless of write path. Length checks are
      // stricter than the trigger-derived ones — these are
      // client-supplied fields so we don't trust them.
      const errors: string[] = [];
      errors.push(...fieldErrors('ownerUid', [
        [typeof ownerUid === 'string' && ownerUid.length >= 4, 'string >= 4 chars required'],
      ]));
      errors.push(...fieldErrors('eventId', [
        [typeof eventId === 'string' && eventId.length >= 4, 'string >= 4 chars required'],
      ]));
      errors.push(...fieldErrors('entryId', [
        [typeof entryId === 'string' && entryId.length >= 2, 'string >= 2 chars required'],
      ]));
      errors.push(...fieldErrors('parentKind', [
        [typeof parentKind === 'string' && PARENT_KINDS.has(parentKind as ParentKind),
          `must be 'rundown' or 'resources', got ${JSON.stringify(parentKind)}`],
      ]));
      if (errors.length > 0) {
        throw new HttpsError(
          'invalid-argument',
          `bad input: ${errors.join('; ')}.`,
        );
      }

      const oUid = (ownerUid as string).trim();
      const eId = (eventId as string).trim();
      const pKind = parentKind as ParentKind;
      const eId_ = (entryId as string).trim();

      const cleanNote = typeof note === 'string' ? note.trim() : '';
      if (cleanNote.length > MAX_NOTE_LENGTH) {
        throw new HttpsError(
          'invalid-argument',
          `note exceeds ${MAX_NOTE_LENGTH} chars.`,
        );
      }

      const validation = validateDelayReportInput({ delayMinutes, note: cleanNote });
      if (!validation.ok) {
        throw new HttpsError('invalid-argument', validation.error);
      }

      // 1) Server-side parent lookup. Confirms the entry
      // exists AND the caller is the assigned vendor — we
      // NEVER read a vendorUid from the request body.
      const fetched = await fetchEntry({
        ownerUid: oUid,
        eventId: eId,
        parentKind: pKind,
        entryId: eId_,
      });
      if (!fetched) {
        throw new HttpsError('not-found', 'Parent entry not found.');
      }
      const assignedVendorUid = resolveAssignedVendorUid(fetched.data);
      if (assignedVendorUid !== callerUid) {
        // Mask the actual mismatch from the caller — they
        // should treat this as "not your slot". We log the
        // real values server-side for incident triage.
        console.warn(
          '[reportVendorDelay] not assigned:',
          { callerUid, ownerUid: oUid, eventId: eId, entryId: eId_, parentKind: pKind, assignedVendorUid },
        );
        throw new HttpsError(
          'permission-denied',
          'You are not assigned to this slot.',
        );
      }

      // 2) Idempotency: if a PENDING report already exists
      // for the same (entryId, vendorUid) within the last
      // 60s, return it instead of creating a duplicate.
      // We bound the dedup check to the entry subcollection
      // only (not event-wide) — multiple slots in one event
      // are independent.
      const reportsColRef = db
        .collection('artifacts').doc(APP_ID)
        .collection('users').doc(oUid)
        .collection('events').doc(eId)
        .collection(pKind)
        .doc(eId_)
        .collection('vendorDelayReports');

      const recentCutoff = Date.now() - DUPE_WINDOW_MS;
      try {
        const recent = await reportsColRef
          .where('vendorUid', '==', callerUid)
          .where('status', '==', 'pending')
          .where('createdAt', '>=', Timestamp.fromMillis(recentCutoff))
          .limit(1)
          .get();
        if (!recent.empty) {
          const existingId = recent.docs[0].id;
          console.log(
            '[reportVendorDelay] dedup hit:',
            { ownerUid: oUid, eventId: eId, entryId: eId_, existingId },
          );
          return { ok: true, reportId: existingId, deduped: true };
        }
      } catch (e) {
        // If the dedup query fails (e.g. transient), fall
        // through and create a new doc — duplicates are
        // tolerable here because the report ids are random.
        console.warn(
          '[reportVendorDelay] dedup query failed, proceeding:',
          { error: (e as Error)?.message },
        );
      }

      // 3) Build + write the new report.
      const now = Date.now();
      const reportId = `${callerUid}_${now}_${randomSuffix()}`;
      const draft = buildPendingVendorDelayReport({
        ownerUid: oUid,
        eventId: eId,
        entryId: eId_,
        vendorUid: callerUid,
        delayMinutes: delayMinutes as number,
        note: cleanNote,
        idempotencyKey: `${now}_${randomSuffix()}`,
      });

      const ref = reportsColRef.doc(reportId);
      await ref.set(
        {
          ...draft,
          note: sanitizeForStorage(cleanNote),
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          source: 'cf:reportVendorDelay',
        },
        { merge: true },
      );

      // 4) Recompute the projection's reportedDelayMinutes.
      // Read all reports (any status — we want a single
      // shared sum so the timeline card reflects total
      // open delay). Then merge just the reported-number
      // onto the projection doc.
      const allReportsSnap = await reportsColRef.get();
      const reports = allReportsSnap.docs.map((d) => {
        const data = d.data() || {};
        return {
          ...(data as VendorDelayReport),
          id: d.id,
          createdAt: tsToMillis(data.createdAt) ?? 0,
          updatedAt: tsToMillis(data.updatedAt) ?? 0,
        } as VendorDelayReport;
      });
      const reportedDelayMinutes = computeReportedDelayMinutes(reports);
      const approvedDelayMinutes = computeApprovedDelayMinutes(reports);

      const projectionRef = db
        .collection('artifacts').doc(APP_ID)
        .collection('users').doc(oUid)
        .collection('events').doc(eId)
        .collection('vendorViews')
        .doc(callerUid)
        .collection('rundown')
        .doc(eId_);

      await projectionRef.set(
        {
          reportedDelayMinutes,
          approvedDelayMinutes,
          updatedAt: FieldValue.serverTimestamp(),
          source: 'cf:reportVendorDelay',
        },
        { merge: true },
      );

      console.log(
        '[reportVendorDelay] report written:',
        { reportId, ownerUid: oUid, eventId: eId, entryId: eId_, reportedDelayMinutes, approvedDelayMinutes },
      );

      return { ok: true, reportId };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[reportVendorDelay] unexpected failure:', { msg });
      throw new HttpsError('internal', 'Could not record the delay report.');
    }
  },
);

// ---- approveVendorDelay ----

interface ApproveVendorDelayInput {
  ownerUid?: unknown;
  eventId?: unknown;
  parentKind?: unknown;
  entryId?: unknown;
  reportId?: unknown;
  decision?: unknown;
  reason?: unknown;
}

export const approveVendorDelay = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req): Promise<{ ok: true; status: 'approved' | 'rejected' }> => {
    try {
      if (!req.auth) {
        throw new HttpsError('unauthenticated', 'Sign in first.');
      }
      const callerUid = req.auth.uid;

      const {
        ownerUid,
        eventId,
        parentKind,
        entryId,
        reportId,
        decision,
        reason,
      } = (req.data || {}) as ApproveVendorDelayInput;

      const errors: string[] = [];
      errors.push(...fieldErrors('ownerUid', [
        [typeof ownerUid === 'string' && ownerUid.length >= 4, 'string >= 4 chars required'],
      ]));
      errors.push(...fieldErrors('eventId', [
        [typeof eventId === 'string' && eventId.length >= 4, 'string >= 4 chars required'],
      ]));
      errors.push(...fieldErrors('entryId', [
        [typeof entryId === 'string' && entryId.length >= 2, 'string >= 2 chars required'],
      ]));
      errors.push(...fieldErrors('reportId', [
        [typeof reportId === 'string' && reportId.length >= 2, 'string >= 2 chars required'],
      ]));
      errors.push(...fieldErrors('parentKind', [
        [typeof parentKind === 'string' && PARENT_KINDS.has(parentKind as ParentKind),
          `must be 'rundown' or 'resources', got ${JSON.stringify(parentKind)}`],
      ]));
      errors.push(...fieldErrors('decision', [
        [decision === 'approve' || decision === 'reject', "must be 'approve' or 'reject'"],
      ]));
      if (errors.length > 0) {
        throw new HttpsError(
          'invalid-argument',
          `bad input: ${errors.join('; ')}.`,
        );
      }

      const oUid = (ownerUid as string).trim();
      const eId = (eventId as string).trim();
      const pKind = parentKind as ParentKind;
      const eId_ = (entryId as string).trim();
      const reportIdStr = (reportId as string).trim();
      const decisionStr = decision as 'approve' | 'reject';

      const cleanReason = typeof reason === 'string' ? reason.trim() : '';
      if (cleanReason.length > MAX_REASON_LENGTH) {
        throw new HttpsError(
          'invalid-argument',
          `reason exceeds ${MAX_REASON_LENGTH} chars.`,
        );
      }

      // 1) Verify the caller is the owner or an active
      // co-owner of the event. We DO NOT trust any client-
      // supplied owner-coOwner claim — we read the event
      // doc server-side and compare.
      const event = await fetchEvent({ ownerUid: oUid, eventId: eId });
      if (!event) {
        throw new HttpsError('not-found', 'Event not found.');
      }
      const ownerUidOnEvent = safeString(event.ownerUid) || oUid;
      if (ownerUidOnEvent !== oUid) {
        // ownerUid mismatch between caller-supplied and the
        // event doc — reject.
        throw new HttpsError(
          'permission-denied',
          'Caller is not the owner of this event.',
        );
      }
      const coOwners = Array.isArray(event.coOwners)
        ? (event.coOwners as unknown[]).filter(
            (v): v is string => typeof v === 'string' && v.trim().length > 0,
          )
        : [];
      const isOwner = callerUid === ownerUidOnEvent;
      const isCoOwner = coOwners.includes(callerUid);
      if (!isOwner && !isCoOwner) {
        console.warn(
          '[approveVendorDelay] caller not authorized:',
          { callerUid, ownerUid: oUid, eventId: eId },
        );
        throw new HttpsError(
          'permission-denied',
          'Only the owner or a co-owner can approve a delay.',
        );
      }

      // 2) Load the parent entry so we know which vendor's
      // projection to update.
      const fetched = await fetchEntry({
        ownerUid: oUid,
        eventId: eId,
        parentKind: pKind,
        entryId: eId_,
      });
      if (!fetched) {
        throw new HttpsError('not-found', 'Parent entry not found.');
      }
      const vendorUid = resolveAssignedVendorUid(fetched.data);
      if (!vendorUid) {
        throw new HttpsError(
          'failed-precondition',
          'Parent entry has no assigned vendor.',
        );
      }

      // 3) Load the report, apply the decision.
      const reportRef = db
        .collection('artifacts').doc(APP_ID)
        .collection('users').doc(oUid)
        .collection('events').doc(eId)
        .collection(pKind)
        .doc(eId_)
        .collection('vendorDelayReports')
        .doc(reportIdStr);
      const reportSnap = await reportRef.get();
      if (!reportSnap.exists) {
        throw new HttpsError('not-found', 'Delay report not found.');
      }
      const reportData = reportSnap.data() || {};
      const currentReport: VendorDelayReport = {
        ...(reportData as VendorDelayReport),
        id: reportSnap.id,
        createdAt: tsToMillis(reportData.createdAt) ?? 0,
        updatedAt: tsToMillis(reportData.updatedAt) ?? 0,
      };
      if (currentReport.status !== 'pending') {
        // Idempotent: report already decided — return the
        // existing status instead of clobbering.
        return {
          ok: true,
          status: currentReport.status === 'approved' ? 'approved' : 'rejected',
        };
      }

      const updatedReport = applyApprovalDecision(
        currentReport,
        { decision: decisionStr, approverUid: callerUid, reason: cleanReason },
        Date.now(),
      );

      const reportWrite: Record<string, unknown> = {
        status: updatedReport.status,
        approvedBy: updatedReport.approvedBy,
        approvedAt: updatedReport.approvedAt,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (updatedReport.rejectionReason) {
        reportWrite.rejectionReason = updatedReport.rejectionReason;
      }
      await reportRef.set(reportWrite, { merge: true });

      // 4) On approve, recompute the projection's
      // approvedDelayMinutes from ALL reports, and merge it
      // onto the projection doc. On reject, skip the
      // projection write (the report itself records the
      // decision).
      if (decisionStr === 'approve') {
        const allReportsSnap = await db
          .collection('artifacts').doc(APP_ID)
          .collection('users').doc(oUid)
          .collection('events').doc(eId)
          .collection(pKind)
          .doc(eId_)
          .collection('vendorDelayReports')
          .get();
        const reports = allReportsSnap.docs.map((d) => {
          const data = d.data() || {};
          return {
            ...(data as VendorDelayReport),
            id: d.id,
            createdAt: tsToMillis(data.createdAt) ?? 0,
            updatedAt: tsToMillis(data.updatedAt) ?? 0,
            approvedAt: tsToMillis(data.approvedAt),
          } as VendorDelayReport;
        });
        const approvedDelayMinutes = computeApprovedDelayMinutes(reports);
        const reportedDelayMinutes = computeReportedDelayMinutes(reports);

        const projectionRef = db
          .collection('artifacts').doc(APP_ID)
          .collection('users').doc(oUid)
          .collection('events').doc(eId)
          .collection('vendorViews')
          .doc(vendorUid)
          .collection('rundown')
          .doc(eId_);

        await projectionRef.set(
          {
            approvedDelayMinutes,
            reportedDelayMinutes,
            updatedAt: FieldValue.serverTimestamp(),
            operationalStatus: approvedDelayMinutes > 0 ? 'delayed' : null,
            source: 'cf:approveVendorDelay',
          },
          { merge: true },
        );

        console.log(
          '[approveVendorDelay] projection updated:',
          {
            ownerUid: oUid,
            eventId: eId,
            entryId: eId_,
            vendorUid,
            approvedDelayMinutes,
            reportedDelayMinutes,
          },
        );
      }

      return { ok: true, status: decisionStr === 'approve' ? 'approved' : 'rejected' };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[approveVendorDelay] unexpected failure:', { msg });
      throw new HttpsError('internal', 'Could not record the approval decision.');
    }
  },
);

// ---- helpers exposed for unit tests ----

function tsToMillis(value: unknown): number | null {
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
