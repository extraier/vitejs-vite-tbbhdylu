/**
 * Cloud Functions — Guest Link Issuance & Redemption
 * ==================================================
 *
 * Why this exists
 * ---------------
 * Without server-side signing, the guest URL ?o=UID&e=EID&g=GID is trivial
 * to tamper with: anyone who learns one couple's Firebase UID can read
 * their guests list. This module replaces that with a single signed token
 * ?t=<HMAC> that the client redeems into a guestLinks document. From that
 * point on, auth.uid IS the credential — no more raw UIDs in URLs.
 *
 * HMAC secret
 * -----------
 * Configure via:
 *   firebase functions:secrets:set HMAC_KEY
 * Default falls back to a built-in dev secret if not set (DO NOT ship that).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import type { Request } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();

const HMAC_KEY = defineSecret('LINK_SECRET');

// HMAC-SHA256 of `${ownerUid}|${eventId}|${guestId}|${expiresAt}`.
// Mirrors the client-side token signer so QR codes can be verified offline
// (e.g. for a future printer integration).
export function signGuestLink(
  secret: string,
  ownerUid: string,
  eventId: string,
  guestId: string,
  expiresAt: number,
): string {
  const payload = `${ownerUid}|${eventId}|${guestId}|${expiresAt}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyGuestLink(
  secret: string,
  token: string,
  ownerUid: string,
  eventId: string,
  guestId: string,
  expiresAt: number,
): boolean {
  const expected = signGuestLink(secret, ownerUid, eventId, guestId, expiresAt);
  // Constant-time compare
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
}

/**
 * issueGuestLink — owner-only.
 * Generates a signed token and writes a guestLinks document.
 * Client then embeds ?t=<token> in the QR-code URL.
 */
export const issueGuestLink = onCall(
  { secrets: [HMAC_KEY] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { eventId, guestId, ttlHours = 72 } = req.data as {
      eventId: string;
      guestId: string;
      ttlHours?: number;
    };
    if (!eventId || !guestId) {
      throw new HttpsError('invalid-argument', 'eventId and guestId required.');
    }

    const ownerUid = req.auth.uid;
    const expiresAt = Date.now() + ttlHours * 3600 * 1000;
    const secret = HMAC_KEY.value();
    const token = signGuestLink(secret, ownerUid, eventId, guestId, expiresAt);

    // Persist as a doc keyed by a random ID (NOT auth.uid — the guest
    // hasn't redeemed yet). The client receives the docId + token and
    // embeds them in the QR URL.
    const linkRef = db
      .collection('artifacts').doc() // any appId
      .collection('users').doc(ownerUid)
      .collection('guestLinks').doc();

    await linkRef.set({
      ownerUid,
      eventId,
      guestId,
      expiresAt,
      token,
      redeemedByUid: null,
      redeemedAt: null,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { linkId: linkRef.id, token, expiresAt };
  },
);

/**
 * redeemGuestLink — guest calls this after scanning the QR.
 * Verifies the HMAC, checks expiry, and atomically claims the link by
 * setting redeemedByUid = auth.uid. Then the rules engine takes over:
 * every subsequent read/write uses auth.uid == redeemedByUid.
 */
export const redeemGuestLink = onCall(
  { secrets: [HMAC_KEY] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { linkId, token } = req.data as { linkId: string; token: string };
    if (!linkId || !token) {
      throw new HttpsError('invalid-argument', 'linkId and token required.');
    }

    const authUid = req.auth.uid;
    const linkSnap = await db.collectionGroup('guestLinks').doc(linkId).get();
    if (!linkSnap.exists) throw new HttpsError('not-found', 'Invalid link.');

    const link = linkSnap.data()!;
    if (link.revoked) throw new HttpsError('permission-denied', 'Link revoked.');
    if (link.expiresAt < Date.now()) {
      throw new HttpsError('deadline-exceeded', 'Link expired.');
    }
    if (link.redeemedByUid && link.redeemedByUid !== authUid) {
      throw new HttpsError('already-exists', 'Link already redeemed by another device.');
    }
    if (!verifyGuestLink(
      HMAC_KEY.value(),
      token,
      link.ownerUid,
      link.eventId,
      link.guestId,
      link.expiresAt,
    )) {
      throw new HttpsError('permission-denied', 'Invalid signature.');
    }

    // Atomic claim. The rules check `auth.uid == doc.id` for guestLinks,
    // so we MUST move the doc into a slot keyed by auth.uid. We do this
    // by copying the data into a new doc owned by auth.uid and deleting
    // the old one (best-effort).
    const ownerUid = link.ownerUid;
    const newRef = db
      .collection('artifacts').doc()
      .collection('users').doc(ownerUid)
      .collection('guestLinks').doc(authUid);

    const batch = db.batch();
    batch.set(newRef, {
      ...link,
      redeemedByUid: authUid,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    batch.delete(linkSnap.ref);
    await batch.commit();

    return {
      ownerUid,
      eventId: link.eventId,
      guestId: link.guestId,
    };
  },
);

/**
 * revokeGuestLink — owner can kill a leaked link before redemption.
 */
export const revokeGuestLink = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { linkId } = req.data as { linkId: string };
  if (!linkId) throw new HttpsError('invalid-argument', 'linkId required.');

  const linkSnap = await db.collectionGroup('guestLinks').doc(linkId).get();
  if (!linkSnap.exists) throw new HttpsError('not-found', 'Invalid link.');
  if (linkSnap.data()!.ownerUid !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'Not your link.');
  }

  await linkSnap.ref.update({ revoked: true });
  return { ok: true };
});