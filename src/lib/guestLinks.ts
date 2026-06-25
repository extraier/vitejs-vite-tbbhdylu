// Guest link utilities — client side
// ==================================
// Implements the HMAC signing + redemption flow that pairs with the
// Firestore rules and Cloud Functions. Without these, the rules can't
// tell who's a legitimate guest and who's an attacker guessing UIDs.

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, appId } from './firebase';

// ---- HMAC signing (used by unit tests, not by the running app) ---------
//
// The server-side Cloud Function (functions/src/index.ts) is the canonical
// signer. This client-side helper exists so unit tests can verify
// round-trip signing against a known secret, and so we can later add
// offline QR verification (e.g. printing badges at the venue).
//
// Exported for testability.
export async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a signed QR-code URL for a single guest.
 * Owner-only. Returns a URL like:
 *   https://app.example/?t=<hex>&lid=<linkDocId>
 *
 * The Cloud Function does the canonical signing (this is just a client-side
 * preview helper for the future when we want offline verification).
 */
export async function buildGuestQrUrl(
  _ownerUid: string,
  eventId: string,
  guestId: string,
  ttlHours = 72,
): Promise<{ url: string; token: string; linkId: string; expiresAt: number }> {
  const fns = getFunctions();
  const issue = httpsCallable<
    { eventId: string; guestId: string; ttlHours?: number },
    { linkId: string; token: string; expiresAt: number }
  >(fns, 'issueGuestLink');
  const res = await issue({ eventId, guestId, ttlHours });

  // The QR URL embeds linkId + token (NOT ownerUid/eventId/guestId — those
  // are encoded into the signed token, verified server-side).
  const base = `${window.location.origin}/`;
  const params = new URLSearchParams({
    t: res.data.token,
    lid: res.data.linkId,
  });
  return {
    url: `${base}?${params.toString()}`,
    token: res.data.token,
    linkId: res.data.linkId,
    expiresAt: res.data.expiresAt,
  };
}

/**
 * Redeem a guest link — called by the guest app immediately after the QR
 * is scanned. Returns the (ownerUid, eventId, guestId) tuple the guest
 * can now act on.
 */
export async function redeemGuestLink(
  linkId: string,
  token: string,
): Promise<{ ownerUid: string; eventId: string; guestId: string }> {
  const fns = getFunctions();
  const redeem = httpsCallable<
    { linkId: string; token: string },
    { ownerUid: string; eventId: string; guestId: string }
  >(fns, 'redeemGuestLink');
  const res = await redeem({ linkId, token });
  return res.data;
}

/**
 * Persist the redeemed link locally so subsequent reloads don't need to
 * call the Cloud Function again.
 */
export async function saveRedeemedLink(
  ownerUid: string,
  eventId: string,
  guestId: string,
  redeemedByUid: string,
): Promise<void> {
  await setDoc(
    doc(db, 'artifacts', appId, 'users', ownerUid, 'guestLinks', redeemedByUid),
    {
      ownerUid,
      eventId,
      guestId,
      redeemedByUid,
      expiresAt: Date.now() + 72 * 3600 * 1000,
      createdAt: serverTimestamp(),
    },
  );
}

/**
 * Read the redeemed link for the current auth.uid, if any. Returns null
 * if the user hasn't redeemed a link.
 */
export async function loadRedeemedLink(
  ownerUid: string,
  redeemedByUid: string,
): Promise<{ eventId: string; guestId: string } | null> {
  const snap = await getDoc(
    doc(db, 'artifacts', appId, 'users', ownerUid, 'guestLinks', redeemedByUid),
  );
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.expiresAt < Date.now()) return null;
  return { eventId: data.eventId, guestId: data.guestId };
}