/**
 * 2026-09-11 — Manus P12.1a. Pure-helper unit tests for
 * `vendorProjectionPure`.
 *
 * Covers the sanitization rules + access-diff math so the
 * trigger logic can remain a thin wrapper over Admin SDK
 * reads/writes. The trigger integration is exercised by the
 * helperAssignmentTrigger.test.ts suite — this module just
 * pins the *policy* layer.
 */

import { describe, expect, it } from 'vitest';
import {
  buildVendorProjection,
  computeOperationalStatus,
  reconcileAccessMarkers,
  resolveVendorAccessDiff,
} from '../src/vendorProjectionPure';

describe('buildVendorProjection — sanitization (allowlist enforcement)', () => {
  const SOURCE_FULL = {
    ownerUid: 'should-not-leak',
    eventId: 'should-not-leak',
    assignedVendorUid: 'vendor-a',
    assignedVendorName: '阿龍攝影工作室',
    ownerNotes: 'private — owner only',
    budget: 50000,
    guestIds: ['g1', 'g2', 'g3'],
    paymentInfo: { paid: true, total: 50000 },
    coOwnerUids: ['co-1', 'co-2'],
    privateComments: 'very private',
    title: '敬茶',
    group: 'morning',
    startTime: 1700000000000,
    endTime: 1700000060000,
    durationMinutes: 10,
    location: '大宅',
    sequence: 3,
    status: 'in_progress',
    isCompleted: false,
    updatedAt: 1700000000000,
    sourceVersion: 1,
  };

  it('strips all sensitive fields from a vendor projection (assigned viewer)', () => {
    const projection = buildVendorProjection({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      vendorUid: 'vendor-a',
      entryId: 'entry-1',
      sourceDoc: SOURCE_FULL,
      isAssignedToViewer: true,
    });
    // Allowlisted fields are present.
    expect(projection.title).toBe('敬茶');
    expect(projection.group).toBe('morning');
    expect(projection.startTime).toBe(1700000000000);
    expect(projection.endTime).toBe(1700000060000);
    expect(projection.durationMinutes).toBe(10);
    expect(projection.location).toBe('大宅');
    expect(projection.sequence).toBe(3);
    // Forbidden fields are NOT on the projection object at all
    // (TypeScript already excludes them from the type; we
    // double-check the runtime shape).
    const projectionJson = JSON.stringify(projection);
    expect(projectionJson).not.toContain('assignedVendorName');
    expect(projectionJson).not.toContain('ownerNotes');
    expect(projectionJson).not.toContain('budget');
    expect(projectionJson).not.toContain('guestIds');
    expect(projectionJson).not.toContain('paymentInfo');
    expect(projectionJson).not.toContain('privateComments');
    expect(projectionJson).not.toContain('coOwnerUids');
  });

  it('carries the full assigned-viewer field set when isAssignedToViewer=true', () => {
    const projection = buildVendorProjection({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      vendorUid: 'vendor-a',
      entryId: 'entry-1',
      sourceDoc: { ...SOURCE_FULL, approvedDelayMinutes: 15 },
      isAssignedToViewer: true,
    });
    expect(projection.isAssignedToViewer).toBe(true);
    expect(projection.operationalStatus).toBe('in_progress');
    expect(projection.reportedDelayMinutes).toBe(0);
    expect(projection.approvedDelayMinutes).toBe(15);
    expect(projection.sourceVersion).toBe(1700000000000);
  });

  it('omits assignment-related fields when isAssignedToViewer=false', () => {
    const projection = buildVendorProjection({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      vendorUid: 'vendor-b', // a competitor seeing the same slot
      entryId: 'entry-1',
      sourceDoc: { ...SOURCE_FULL, approvedDelayMinutes: 15 },
      isAssignedToViewer: false,
    });
    // Timeline-slice fields ARE visible.
    expect(projection.title).toBe('敬茶');
    expect(projection.startTime).toBe(1700000000000);
    expect(projection.endTime).toBe(1700000060000);
    expect(projection.location).toBe('大宅');
    // Assignment-derived fields are zeroed out.
    expect(projection.isAssignedToViewer).toBe(false);
    expect(projection.operationalStatus).toBe('scheduled');
    expect(projection.reportedDelayMinutes).toBe(0);
    expect(projection.approvedDelayMinutes).toBe(0);
    // JSON shape must not contain any sensitive field.
    const projectionJson = JSON.stringify(projection);
    expect(projectionJson).not.toContain('阿龍');
    expect(projectionJson).not.toContain('15');
  });

  it('uses updatedAt as sourceVersion when present, 0 fallback otherwise', () => {
    expect(
      buildVendorProjection({
        ownerUid: 'o',
        eventId: 'e',
        vendorUid: 'v',
        entryId: 'i',
        sourceDoc: { updatedAt: 1700000000000 },
        isAssignedToViewer: true,
      }).sourceVersion,
    ).toBe(1700000000000);
    expect(
      buildVendorProjection({
        ownerUid: 'o',
        eventId: 'e',
        vendorUid: 'v',
        entryId: 'i',
        sourceDoc: {},
        isAssignedToViewer: true,
      }).sourceVersion,
    ).toBe(0);
  });
});

describe('resolveVendorAccessDiff', () => {
  it('detects newly added vendors', () => {
    expect(
      resolveVendorAccessDiff({
        beforeVendors: ['vendor-a'],
        afterVendors: ['vendor-a', 'vendor-b'],
      }),
    ).toEqual({ added: ['vendor-b'], removed: [] });
  });

  it('detects removed vendors', () => {
    expect(
      resolveVendorAccessDiff({
        beforeVendors: ['vendor-a', 'vendor-b'],
        afterVendors: ['vendor-a'],
      }),
    ).toEqual({ added: [], removed: ['vendor-b'] });
  });

  it('returns both when the swap moves in both directions', () => {
    expect(
      resolveVendorAccessDiff({
        beforeVendors: ['vendor-a', 'vendor-b'],
        afterVendors: ['vendor-b', 'vendor-c'],
      }),
    ).toEqual({ added: ['vendor-c'], removed: ['vendor-a'] });
  });

  it('returns empty for unchanged lists (including order permutes)', () => {
    expect(
      resolveVendorAccessDiff({
        beforeVendors: ['a', 'b'],
        afterVendors: ['b', 'a'],
      }),
    ).toEqual({ added: [], removed: [] });
  });
});

describe('computeOperationalStatus — precedence matrix', () => {
  it('cancelled beats everything', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'cancelled',
        approvedDelayMinutes: 30,
        isCompleted: true,
      }),
    ).toBe('cancelled');
  });

  it('done beats delayed + in_progress', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'done',
        approvedDelayMinutes: 30,
        isCompleted: false,
      }),
    ).toBe('done');
  });

  it('in_progress beats delayed + scheduled', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'in-progress',
        approvedDelayMinutes: 30,
        isCompleted: false,
      }),
    ).toBe('in_progress');
  });

  it('delayed appears only when status is scheduled + approvedDelayMinutes > 0', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'scheduled',
        approvedDelayMinutes: 10,
        isCompleted: false,
      }),
    ).toBe('delayed');
  });

  it('scheduled by default (no status, no delay)', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: null,
        approvedDelayMinutes: 0,
        isCompleted: false,
      }),
    ).toBe('scheduled');
  });

  it('treats approvedDelayMinutes=0 as scheduled even with status=scheduled', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'scheduled',
        approvedDelayMinutes: 0,
        isCompleted: false,
      }),
    ).toBe('scheduled');
  });

  it('isCompleted=true alone flips status to done', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: '',
        approvedDelayMinutes: 30,
        isCompleted: true,
      }),
    ).toBe('done');
  });

  it('accepts string-encoded numbers for approvedDelayMinutes', () => {
    expect(
      computeOperationalStatus({
        sourceStatus: 'scheduled',
        approvedDelayMinutes: 10 as unknown as number,
        isCompleted: false,
      }),
    ).toBe('delayed');
  });
});

describe('reconcileAccessMarkers', () => {
  it('returns toGrant for newly-active vendors', () => {
    expect(
      reconcileAccessMarkers(
        { 'vendor-a': { hasAssignment: false } },
        { 'vendor-a': { hasAssignment: true } },
      ),
    ).toEqual({ toGrant: ['vendor-a'], toRevoke: [] });
  });

  it('returns toRevoke for newly-inactive vendors', () => {
    expect(
      reconcileAccessMarkers(
        { 'vendor-a': { hasAssignment: true } },
        { 'vendor-a': { hasAssignment: false } },
      ),
    ).toEqual({ toGrant: [], toRevoke: ['vendor-a'] });
  });

  it('handles vendor removal (key absent from next)', () => {
    expect(
      reconcileAccessMarkers(
        { 'vendor-a': { hasAssignment: true } },
        {},
      ),
    ).toEqual({ toGrant: [], toRevoke: ['vendor-a'] });
  });

  it('handles both directions in one call', () => {
    expect(
      reconcileAccessMarkers(
        {
          'vendor-a': { hasAssignment: true },
          'vendor-b': { hasAssignment: true },
        },
        {
          'vendor-a': { hasAssignment: true },
          'vendor-c': { hasAssignment: true },
        },
      ),
    ).toEqual({ toGrant: ['vendor-c'], toRevoke: ['vendor-b'] });
  });
});
