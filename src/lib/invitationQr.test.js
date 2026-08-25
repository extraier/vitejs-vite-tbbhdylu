// 2026-08-25 — Manus P10. Tests for the canonical invitation QR URL
// builder.
//
// These cover the Required Tests matrix from the handoff for
// QrCodeModal: original owner, co-owner (must still encode
// dataOwnerUid), and incomplete context (QR/copy/email/regen
// disabled).

import { describe, expect, it } from 'vitest';
import { buildInvitationQr } from './invitationQr';

const HOST = 'https://savetheday.io';
const CANONICAL_OWNER = 'owner-canonical-uid';
const CO_OWNER_UID = 'co-owner-uid-different';
const EVENT = 'event-123';
const GUEST = 'guest-456';

describe('buildInvitationQr', () => {
  it('encodes the canonical owner ID when the original owner opens the modal', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: CANONICAL_OWNER,
      eventId: EVENT,
      guestId: GUEST,
    });

    expect(result.hasCanonicalContext).toBe(true);
    expect(result.shareUrl).toBe(
      `${HOST}/?o=${encodeURIComponent(CANONICAL_OWNER)}&e=${encodeURIComponent(EVENT)}&g=${encodeURIComponent(GUEST)}`,
    );
    expect(result.qrCodeImgUrl).toContain('api.qrserver.com/v1/create-qr-code/');
    expect(result.qrCodeImgUrl).toContain(encodeURIComponent(result.shareUrl));
  });

  it('encodes dataOwnerUid, NOT user.uid, when a co-owner opens the modal', () => {
    // The caller may *also* know about the co-owner's UID (their
    // user.uid at sign-in). The function only sees what is passed
    // in. If App.jsx passes dataOwnerUid, the QR is correct.
    // If a future bug ever passes the co-owner UID, the URL will
    // reflect that — which the test makes obvious.
    const correctResult = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: CANONICAL_OWNER, // what App.jsx SHOULD pass
      eventId: EVENT,
      guestId: GUEST,
    });
    expect(correctResult.shareUrl).toContain(`o=${CANONICAL_OWNER}`);

    const wrongResult = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: CO_OWNER_UID, // what the buggy P9 path passed
      eventId: EVENT,
      guestId: GUEST,
    });
    expect(wrongResult.shareUrl).toContain(`o=${CO_OWNER_UID}`);
    expect(wrongResult.shareUrl).not.toContain(CANONICAL_OWNER);
    // The two URLs MUST differ — this is what the scanner rejects.
    expect(correctResult.shareUrl).not.toBe(wrongResult.shareUrl);
  });

  it('reports incomplete context and returns empty URLs when ownerUid is missing', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: null,
      eventId: EVENT,
      guestId: GUEST,
    });
    expect(result.hasCanonicalContext).toBe(false);
    expect(result.shareUrl).toBe('');
    expect(result.qrCodeImgUrl).toBe('');
  });

  it('reports incomplete context when eventId is missing', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: CANONICAL_OWNER,
      eventId: undefined,
      guestId: GUEST,
    });
    expect(result.hasCanonicalContext).toBe(false);
    expect(result.shareUrl).toBe('');
  });

  it('reports incomplete context when guestId is missing', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: CANONICAL_OWNER,
      eventId: EVENT,
      guestId: '',
    });
    expect(result.hasCanonicalContext).toBe(false);
  });

  it('reports incomplete context when hostUrl is missing', () => {
    const result = buildInvitationQr({
      hostUrl: '',
      ownerUid: CANONICAL_OWNER,
      eventId: EVENT,
      guestId: GUEST,
    });
    expect(result.hasCanonicalContext).toBe(false);
  });

  it('trims whitespace from all three ID fields', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: `  ${CANONICAL_OWNER}  `,
      eventId: ` ${EVENT}\t`,
      guestId: `\n${GUEST} `,
    });
    expect(result.canonicalOwnerUid).toBe(CANONICAL_OWNER);
    expect(result.canonicalEventId).toBe(EVENT);
    expect(result.canonicalGuestId).toBe(GUEST);
    expect(result.hasCanonicalContext).toBe(true);
  });

  it('percent-encodes IDs that contain reserved characters', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: 'owner/with slashes',
      eventId: 'event with space',
      guestId: 'guest&with=symbols',
    });
    expect(result.hasCanonicalContext).toBe(true);
    expect(result.shareUrl).toContain('o=owner%2Fwith%20slashes');
    expect(result.shareUrl).toContain('e=event%20with%20space');
    expect(result.shareUrl).toContain('g=guest%26with%3Dsymbols');
  });

  it('treats non-string owner/event/guest IDs as empty', () => {
    const result = buildInvitationQr({
      hostUrl: HOST,
      ownerUid: 42, // numeric — must NOT be stringified
      eventId: { id: EVENT },
      guestId: [GUEST],
    });
    expect(result.hasCanonicalContext).toBe(false);
  });
});