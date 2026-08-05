// photoDeleteToken.ts
//
// 2026-08-05 — Photo-delete authorization token.
//
// Background. The photo-delete flow has the same trust shape
// as the upload-preferences token (functions/src/uploadPreferencesToken.ts):
// the Vercel /api/photo-delete proxy forwards a signed DELETE to
// the NAS, but the NAS alone can't verify the caller's identity
// (it's a stateless binary that doesn't have firebase-admin).
// So the proxy needs a fresh HMAC token to forward, and the
// CF mints that token AFTER verifying the caller is allowed to
// delete the photo in question.
//
// Three call paths need to work:
//   1. Event owner → can delete any photo in their event.
//   2. Co-owner (the partner on the coOwnerUIDs list) → can
//      delete any photo. (Same scope as the owner.)
//   3. Guest (the original uploader) → can delete ONLY the
//      photos they themselves uploaded. We verify this via
//      the photo doc's `uploadAuthUid` field — the auth.uid
//      at the moment of upload. (Guests sign in anonymously
//      via the share link; the anon UID is bound to the
//      browser session. Re-clicking the share link produces
//      a fresh anon UID, so this only works while the
//      session is alive.)
//
// Token payload shape:
//
//   {
//     ownerUid:  string,   // who owns the event (the wedding owner)
//     photoDocId: string,  // Firestore doc id of the photo
//     eventId:   string,   // for defense in depth / audit
//     issuerUid: string,   // auth.uid of the caller (owner uploader)
//     issuedAt:  number,   // epoch ms
//     expiresAt: number,   // epoch ms — 5 minutes from issuedAt
//   }
//
// TTL: 5 minutes. The token is for a single delete action,
// not a session; the client mints a fresh one per click. This
// matches the upload token's TTL on the proxy side.
//
// The Vercel proxy reads issuerUid to ensure the rule's
// authorization semantic is preserved end-to-end: even if the
// token is replayed somehow, the issuerUid is the auth.uid of
// the caller who minted it, and the proxy can refuse to act
// on tokens that don't match an authorized delete.
//
// Token is signed with HMAC_KEY (same secret as the
// upload-preferences token + partner-invite tokens). The Vercel
// proxy mirrors this secret to its env
// (`UPLOAD_PREFERENCES_HMAC_SECRET` — variable name doesn't
// matter, the value MUST match Firebase's HMAC_KEY).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getHmacKey, signToken } from './hmac';

// Lazy-init admin (singleton — matches uploadPreferencesToken.ts).
if (getApps().length === 0) initializeApp();
const db = getFirestore();

// Hardcoded appId to match client-side lib/firebase.ts.
const APP_ID = 'savetheday-production';

// Mirror of HMAC_KEY already used by partner-invite + upload-prefs.
const HMAC_KEY = defineSecret('HMAC_KEY');

// 5 minutes. Short on purpose — the token authorises ONE delete
// call, not a session. If the user clicks "delete" twice in a
// row, the client re-fires the CF and gets a fresh token.
const TOKEN_TTL_MS = 5 * 60 * 1000;

// Same shape used elsewhere — defense in depth against caller
// passing arbitrary strings that could be index keys, etc.
const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;

/**
 * mintPhotoDeleteToken — caller asks for a token that
 * authorises them to delete a specific photo. The CF verifies
 * the caller is allowed (owner / co-owner / uploader) before
 * minting the token.
 *
 * Inputs: { eventId, photoDocId, ownerUid }
 *   - eventId:    the event the photo belongs to
 *   - photoDocId: the Firestore doc id of the photo
 *   - ownerUid:   the wedding owner (matches the event's parent
 *                 path); the photo doc lives at
 *                 /artifacts/{appId}/users/{ownerUid}/events/{eventId}/photos/{photoDocId}
 *
 * Auth: caller MUST be signed in AND one of:
 *   - the owner (auth.uid === ownerUid)
 *   - a co-owner of the event (auth.uid in event.coOwnerUIDs)
 *   - the original uploader (auth.uid === photoDoc.uploadAuthUid)
 *
 * Returns: { ok: true, token, expiresAt }
 */
export const mintPhotoDeleteToken = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [HMAC_KEY],
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

    const { eventId, photoDocId, ownerUid } = (req.data || {}) as {
      eventId?: string;
      photoDocId?: string;
      ownerUid?: string;
    };

    if (!eventId || !photoDocId || !ownerUid) {
      throw new HttpsError(
        'invalid-argument',
        'eventId, photoDocId, and ownerUid are required.',
      );
    }
    if (!SAFE_ID.test(eventId) || !SAFE_ID.test(photoDocId) || !SAFE_ID.test(ownerUid)) {
      throw new HttpsError(
        'invalid-argument',
        'bad eventId / photoDocId / ownerUid shape.',
      );
    }

    // Read the photo doc + the event doc in parallel. Both are
    // needed for the auth check; we don't reveal any of these
    // to the caller — only the signed token gets back out.
    const photoRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId)
      .collection('photos').doc(photoDocId);
    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId);

    const [photoSnap, eventSnap] = await Promise.all([
      photoRef.get(),
      eventRef.get(),
    ]);

    if (!photoSnap.exists) {
      // Photo doc not found — could be a stale UI listing a
      // photo that was already deleted. We surface a clean
      // error so the client knows to refresh its list.
      throw new HttpsError('not-found', 'photo not found.');
    }
    if (!eventSnap.exists) {
      throw new HttpsError('not-found', 'event not found.');
    }

    const photoData = photoSnap.data() || {};
    const eventData = eventSnap.data() || {};

    // Three allow paths:
    //   1. Owner (auth.uid === ownerUid)
    //   2. Co-owner (auth.uid ∈ event.coOwnerUIDs)
    //   3. Uploader (auth.uid === photoData.uploadAuthUid)
    //
    // Note: we do NOT rely on a `uploaderId` field here because
    // for guests that field holds the human-readable guestId
    // (like 'abc123'), not the Firebase Auth UID. The auth.uid
    // check uses the dedicated `uploadAuthUid` field written at
    // upload time.
    const isOwner = req.auth.uid === ownerUid;
    const coOwnerUIDs: string[] = Array.isArray(eventData.coOwnerUIDs)
      ? eventData.coOwnerUIDs
      : [];
    const isCoOwner = coOwnerUIDs.includes(req.auth.uid);
    const isUploader = photoData.uploadAuthUid === req.auth.uid;

    if (!isOwner && !isCoOwner && !isUploader) {
      throw new HttpsError(
        'permission-denied',
        '你只能刪除自己上載嘅相片。',
      );
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + TOKEN_TTL_MS;
    const token = signToken(
      {
        ownerUid,
        photoDocId,
        eventId,
        issuerUid: req.auth.uid,
        issuedAt,
        expiresAt,
      },
      getHmacKey(HMAC_KEY.value()),
    );

    return {
      ok: true,
      token,
      expiresAt,
    };
  },
);
