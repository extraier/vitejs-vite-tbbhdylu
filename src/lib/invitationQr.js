// 2026-08-25 — Manus P10.
//
// Pure helper that builds the canonical invitation QR URL used by
// QrCodeModal. Extracted so the URL construction logic can be unit
// tested without mounting React or touching the DOM.
//
// Invariant: QR must encode the *canonical* owner of the wedding's
// Firestore tree (dataOwnerUid), NOT the signed-in user's UID. A
// co-owner who generates a QR with their own UID will produce a
// URL that the reception scanner correctly rejects with 「其他
// 婚禮的 QR Code」.

/**
 * @param {object} params
 * @param {string | null | undefined} params.hostUrl
 *        Origin for the share URL (e.g. 'https://savetheday.io').
 *        Should NOT include a trailing path — this is `${host}/?...`.
 * @param {string | null | undefined} params.ownerUid
 *        Canonical owner UID for the wedding's Firestore tree.
 *        Trimmed; null/empty/whitespace → no canonical context.
 * @param {string | null | undefined} params.eventId
 *        Canonical event ID. Trimmed.
 * @param {string | null | undefined} params.guestId
 *        The selected guest's id. Trimmed.
 * @returns {{
 *   shareUrl: string,
 *   qrCodeImgUrl: string,
 *   hasCanonicalContext: boolean,
 *   canonicalOwnerUid: string,
 *   canonicalEventId: string,
 *   canonicalGuestId: string,
 * }}
 */
export function buildInvitationQr({ hostUrl, ownerUid, eventId, guestId }) {
  const canonicalOwnerUid =
    typeof ownerUid === 'string' ? ownerUid.trim() : '';
  const canonicalEventId =
    typeof eventId === 'string' ? eventId.trim() : '';
  const canonicalGuestId =
    typeof guestId === 'string' ? guestId.trim() : '';

  const hasCanonicalContext = Boolean(
    hostUrl &&
      canonicalOwnerUid &&
      canonicalEventId &&
      canonicalGuestId,
  );

  if (!hasCanonicalContext) {
    return {
      shareUrl: '',
      qrCodeImgUrl: '',
      hasCanonicalContext: false,
      canonicalOwnerUid,
      canonicalEventId,
      canonicalGuestId,
    };
  }

  const shareUrl =
    `${hostUrl}/?o=${encodeURIComponent(canonicalOwnerUid)}` +
    `&e=${encodeURIComponent(canonicalEventId)}` +
    `&g=${encodeURIComponent(canonicalGuestId)}`;

  const qrCodeImgUrl =
    `https://api.qrserver.com/v1/create-qr-code/` +
    `?size=250x250&data=${encodeURIComponent(shareUrl)}&color=312e81`;

  return {
    shareUrl,
    qrCodeImgUrl,
    hasCanonicalContext: true,
    canonicalOwnerUid,
    canonicalEventId,
    canonicalGuestId,
  };
}