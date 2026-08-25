// 2026-08-25 — Manus P10.
//
// Pure helper that builds the Firestore update payload for
// "regenerate this guest's QR code" and the path it must be
// written under. Extracted so the audit-write logic can be
// unit tested without touching Firestore.
//
// Invariants:
//   * Path is under the canonical owner/event pair, NOT the
//     signed-in user's UID. A co-owner regenerating a QR must
//     write to dataOwnerUid's tree.
//   * Only the four QR-regeneration audit fields are touched.
//     No other guest field is mutated, so reception scanLogs
//     remain intact.
//   * qrRegeneratedByUid is the *current user* — the staff
//     doing the regeneration. The QR itself encodes
//     canonicalOwnerUid (a separate value).

const QR_REGENERATION_FIELDS = [
  'qrRegeneratedAt',
  'qrRegeneratedByUid',
  'qrCanonicalOwnerUid',
  'qrCanonicalEventId',
];

/**
 * @param {object} params
 * @param {string} params.canonicalOwnerUid  Required.
 * @param {string} params.canonicalEventId    Required.
 * @param {string | null | undefined} params.guestDocId  guest.id or guest.guestId.
 * @param {string | null | undefined} params.regeneratorUid  auth.currentUser?.uid.
 * @returns {{ path: string, payload: object, fields: string[], ready: boolean, reason?: string }}
 */
export function buildQrRegenerationUpdate({
  canonicalOwnerUid,
  canonicalEventId,
  guestDocId,
  regeneratorUid,
}) {
  if (!canonicalOwnerUid || !canonicalOwnerUid.trim()) {
    return {
      path: '',
      payload: {},
      fields: QR_REGENERATION_FIELDS,
      ready: false,
      reason: 'missing-canonical-owner',
    };
  }
  if (!canonicalEventId || !canonicalEventId.trim()) {
    return {
      path: '',
      payload: {},
      fields: QR_REGENERATION_FIELDS,
      ready: false,
      reason: 'missing-canonical-event',
    };
  }
  if (!guestDocId) {
    return {
      path: '',
      payload: {},
      fields: QR_REGENERATION_FIELDS,
      ready: false,
      reason: 'missing-guest',
    };
  }

  const path =
    `artifacts/{appId}/users/${canonicalOwnerUid}/events/${canonicalEventId}` +
    `/guests/${guestDocId}`;

  // IMPORTANT: only the four audit fields are touched. The
  // serverTimestamp() marker is left as a function so the caller
  // can pass it through to Firestore unchanged. Tests assert on
  // the field set and the path; the actual server-side write is
  // a Firestore concern.
  const payload = {
    qrRegeneratedAt: '__SERVER_TIMESTAMP__',
    qrRegeneratedByUid: regeneratorUid || null,
    qrCanonicalOwnerUid: canonicalOwnerUid,
    qrCanonicalEventId: canonicalEventId,
  };

  return {
    path,
    payload,
    fields: QR_REGENERATION_FIELDS,
    ready: true,
  };
}

export const QR_REGENERATION_AUDIT_FIELDS = QR_REGENERATION_FIELDS;