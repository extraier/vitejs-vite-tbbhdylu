/**
 * 2026-09-11 — Manus P12.1b. Pure-helper unit tests for
 * `vendorDelayReportPure`.
 *
 * Covers the validation gates + status transition math so
 * the runtime callables can rely on a tested policy layer.
 */

import { describe, expect, it } from 'vitest';
import {
  applyApprovalDecision,
  buildPendingVendorDelayReport,
  computeApprovedDelayMinutes,
  computeReportedDelayMinutes,
  validateDelayReportInput,
  type VendorDelayReport,
} from '../src/vendorDelayReportPure';

describe('validateDelayReportInput — delayMinutes bounds', () => {
  it('accepts 0 (vendor back on track)', () => {
    expect(validateDelayReportInput({ delayMinutes: 0, note: '' })).toEqual({ ok: true });
  });

  it('accepts a typical 30-min delay', () => {
    expect(validateDelayReportInput({ delayMinutes: 30, note: 'traffic' })).toEqual({ ok: true });
  });

  it('accepts the upper bound 720', () => {
    expect(validateDelayReportInput({ delayMinutes: 720, note: '12h cap' })).toEqual({ ok: true });
  });

  it('rejects 721 (above the upper bound)', () => {
    expect(validateDelayReportInput({ delayMinutes: 721, note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('720'),
    });
  });

  it('rejects negative delayMinutes', () => {
    expect(validateDelayReportInput({ delayMinutes: -1, note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('negative'),
    });
  });

  it('rejects fractional delayMinutes', () => {
    expect(validateDelayReportInput({ delayMinutes: 15.5, note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('integer'),
    });
  });

  it('rejects non-numeric delayMinutes', () => {
    expect(validateDelayReportInput({ delayMinutes: 'ten', note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('integer'),
    });
    expect(validateDelayReportInput({ delayMinutes: null, note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('integer'),
    });
    expect(validateDelayReportInput({ delayMinutes: undefined, note: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('integer'),
    });
  });

  it('accepts integer-encoded string delayMinutes', () => {
    expect(validateDelayReportInput({ delayMinutes: '30', note: '' })).toEqual({ ok: true });
  });
});

describe('validateDelayReportInput — note length', () => {
  it('accepts an empty note', () => {
    expect(validateDelayReportInput({ delayMinutes: 30, note: '' })).toEqual({ ok: true });
  });

  it('accepts a 1-char note', () => {
    expect(validateDelayReportInput({ delayMinutes: 30, note: 'x' })).toEqual({ ok: true });
  });

  it('accepts a 1000-char note', () => {
    expect(validateDelayReportInput({ delayMinutes: 30, note: 'a'.repeat(1000) })).toEqual({ ok: true });
  });

  it('rejects a 1001-char note', () => {
    expect(validateDelayReportInput({ delayMinutes: 30, note: 'a'.repeat(1001) })).toEqual({
      ok: false,
      error: expect.stringContaining('1000'),
    });
  });
});

describe('buildPendingVendorDelayReport', () => {
  it('creates a valid pending report', () => {
    const r = buildPendingVendorDelayReport({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      entryId: 'entry-1',
      vendorUid: 'vendor-1',
      delayMinutes: 30,
      note: '  traffic on 通州街  ',
      idempotencyKey: '1700000000000_abc',
    });
    expect(r.ownerUid).toBe('owner-1');
    expect(r.eventId).toBe('event-1');
    expect(r.entryId).toBe('entry-1');
    expect(r.vendorUid).toBe('vendor-1');
    expect(r.delayMinutes).toBe(30);
    expect(r.note).toBe('traffic on 通州街'); // trimmed
    expect(r.status).toBe('pending');
    expect(r.id).toBe('vendor-1_1700000000000_abc');
    expect(r.createdAt).toBe(0);
    expect(r.updatedAt).toBe(0);
  });
});

describe('applyApprovalDecision', () => {
  const baseReport: VendorDelayReport = {
    id: 'rpt-1',
    ownerUid: 'owner-1',
    eventId: 'event-1',
    entryId: 'entry-1',
    vendorUid: 'vendor-1',
    delayMinutes: 30,
    note: 'traffic',
    status: 'pending',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('transitions to approved on approve decision', () => {
    const r = applyApprovalDecision(
      baseReport,
      { decision: 'approve', approverUid: 'owner-1' },
      1700000010000,
    );
    expect(r.status).toBe('approved');
    expect(r.approvedBy).toBe('owner-1');
    expect(r.approvedAt).toBe(1700000010000);
    expect(r.updatedAt).toBe(1700000010000);
    expect(r.rejectionReason).toBeUndefined();
  });

  it('transitions to rejected on reject decision', () => {
    const r = applyApprovalDecision(
      baseReport,
      { decision: 'reject', approverUid: 'owner-1', reason: '備註時間不對' },
      1700000010000,
    );
    expect(r.status).toBe('rejected');
    expect(r.approvedBy).toBe('owner-1');
    expect(r.approvedAt).toBe(1700000010000);
    expect(r.rejectionReason).toBe('備註時間不對');
  });

  it('rejection without reason omits the rejectionReason field', () => {
    const r = applyApprovalDecision(
      baseReport,
      { decision: 'reject', approverUid: 'owner-1' },
      1700000010000,
    );
    expect(r.status).toBe('rejected');
    expect(r.rejectionReason).toBeUndefined();
  });

  it('does not mutate the input report', () => {
    const original: VendorDelayReport = { ...baseReport };
    applyApprovalDecision(
      baseReport,
      { decision: 'approve', approverUid: 'owner-1' },
      1700000010000,
    );
    expect(baseReport).toEqual(original);
  });
});

describe('computeApprovedDelayMinutes', () => {
  it('returns 0 when no reports exist', () => {
    expect(computeApprovedDelayMinutes([])).toBe(0);
  });

  it('returns 0 when no reports are approved (all pending / rejected)', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'pending', delayMinutes: 30 }),
      mkReport({ id: '2', status: 'rejected', delayMinutes: 99 }),
    ];
    expect(computeApprovedDelayMinutes(reports)).toBe(0);
  });

  it('returns the max approved value across multiple approvals', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'approved', delayMinutes: 15, approvedAt: 1000 }),
      mkReport({ id: '2', status: 'approved', delayMinutes: 45, approvedAt: 2000 }),
    ];
    expect(computeApprovedDelayMinutes(reports)).toBe(45);
  });

  it('picks the most-recent approval when earlier approvals are smaller', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'approved', delayMinutes: 60, approvedAt: 1000 }),
      mkReport({ id: '2', status: 'approved', delayMinutes: 15, approvedAt: 2000 }),
    ];
    expect(computeApprovedDelayMinutes(reports)).toBe(15);
  });

  it('breaks ties by picking the larger value at the same approvedAt', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'approved', delayMinutes: 15, approvedAt: 2000 }),
      mkReport({ id: '2', status: 'approved', delayMinutes: 45, approvedAt: 2000 }),
    ];
    expect(computeApprovedDelayMinutes(reports)).toBe(45);
  });
});

describe('computeReportedDelayMinutes', () => {
  it('returns 0 when no pending reports exist', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'approved', delayMinutes: 60 }),
      mkReport({ id: '2', status: 'rejected', delayMinutes: 30 }),
    ];
    expect(computeReportedDelayMinutes(reports)).toBe(0);
  });

  it('returns the max pending value', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'pending', delayMinutes: 15, createdAt: 2000 }),
      mkReport({ id: '2', status: 'pending', delayMinutes: 45, createdAt: 3000 }),
    ];
    expect(computeReportedDelayMinutes(reports)).toBe(45);
  });

  it('accepts pending reports even without an approvedAt (createdAt is the sort key)', () => {
    const reports: VendorDelayReport[] = [
      mkReport({ id: '1', status: 'pending', delayMinutes: 15 }),
      mkReport({ id: '2', status: 'pending', delayMinutes: 45 }),
    ];
    expect(computeReportedDelayMinutes(reports)).toBe(45);
  });
});

// ---- helpers ----

function mkReport(overrides: Partial<VendorDelayReport>): VendorDelayReport {
  return {
    id: 'mk',
    ownerUid: 'owner-1',
    eventId: 'event-1',
    entryId: 'entry-1',
    vendorUid: 'vendor-1',
    delayMinutes: 0,
    note: '',
    status: 'pending',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
