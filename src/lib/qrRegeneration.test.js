// 2026-08-25 — Manus P10. Tests for the QR regeneration audit
// update helper. These exercise the buildQrRegenerationUpdate()
// pure helper. The actual Firestore write is mocked at the test
// boundary in the QrCodeModal component test below.

import { describe, expect, it } from 'vitest';
import {
  buildQrRegenerationUpdate,
  QR_REGENERATION_AUDIT_FIELDS,
} from './qrRegeneration';

describe('buildQrRegenerationUpdate', () => {
  it('builds a path under the canonical owner/event and the four audit fields', () => {
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: 'owner-canonical',
      canonicalEventId: 'event-1',
      guestDocId: 'guest-1',
      regeneratorUid: 'co-owner-uid',
    });

    expect(result.ready).toBe(true);
    expect(result.path).toBe(
      'artifacts/{appId}/users/owner-canonical/events/event-1/guests/guest-1',
    );
    expect(result.fields).toEqual([
      'qrRegeneratedAt',
      'qrRegeneratedByUid',
      'qrCanonicalOwnerUid',
      'qrCanonicalEventId',
    ]);
    expect(Object.keys(result.payload).sort()).toEqual(
      [...result.fields].sort(),
    );
    expect(result.payload.qrRegeneratedAt).toBe('__SERVER_TIMESTAMP__');
    expect(result.payload.qrRegeneratedByUid).toBe('co-owner-uid');
    expect(result.payload.qrCanonicalOwnerUid).toBe('owner-canonical');
    expect(result.payload.qrCanonicalEventId).toBe('event-1');
  });

  it('uses the canonical owner UID even when a co-owner regenerates', () => {
    // The regenerator's UID is recorded in qrRegeneratedByUid,
    // but the *path* — and the QR itself — must be under the
    // canonical owner.
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: 'owner-canonical',
      canonicalEventId: 'event-1',
      guestDocId: 'guest-1',
      regeneratorUid: 'co-owner-uid-different',
    });
    expect(result.path).toContain('/users/owner-canonical/');
    expect(result.path).not.toContain('co-owner-uid-different');
    expect(result.payload.qrCanonicalOwnerUid).toBe('owner-canonical');
  });

  it('records null as the regenerator UID when auth.currentUser is missing', () => {
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: 'owner-canonical',
      canonicalEventId: 'event-1',
      guestDocId: 'guest-1',
      regeneratorUid: undefined,
    });
    expect(result.ready).toBe(true);
    expect(result.payload.qrRegeneratedByUid).toBeNull();
  });

  it('refuses to build when canonical owner is missing', () => {
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: '',
      canonicalEventId: 'event-1',
      guestDocId: 'guest-1',
      regeneratorUid: 'co-owner-uid',
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing-canonical-owner');
  });

  it('refuses to build when canonical event is missing', () => {
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: 'owner-canonical',
      canonicalEventId: null,
      guestDocId: 'guest-1',
      regeneratorUid: 'co-owner-uid',
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing-canonical-event');
  });

  it('refuses to build when the guest doc id is missing', () => {
    const result = buildQrRegenerationUpdate({
      canonicalOwnerUid: 'owner-canonical',
      canonicalEventId: 'event-1',
      guestDocId: null,
      regeneratorUid: 'co-owner-uid',
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing-guest');
  });

  it('exposes the canonical audit-field list for rules allowlist checks', () => {
    expect(QR_REGENERATION_AUDIT_FIELDS).toEqual([
      'qrRegeneratedAt',
      'qrRegeneratedByUid',
      'qrCanonicalOwnerUid',
      'qrCanonicalEventId',
    ]);
  });
});