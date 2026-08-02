// uploadPreferencesToken.ts
//
// 2026-08-02 — Owner upload-preferences token (Option 1).
//
// Background. Every guest-photo upload goes through
// /api/photo-upload (Vercel proxy) → photo_upload_server.py on
// the NAS. Until this commit the NAS had no way to know whether
// the wedding owner had the `watermark-removed` unlock, so the
// default-on watermark applied to every photo regardless of
// premium status — the banner's "推介 1 位朋友 → 移除浮水印"
// promise was a lie.
//
// What this file does. Mints a short-lived HMAC-signed token
// that the OWNER passes with every photo upload (their own +
// their guests'). The Vercel proxy verifies the token's
// signature (against the shared HMAC_KEY secret mirrored to the
// Vercel env) and forwards `X-Watermark-Disabled: true|false`
// to the NAS. The NAS reads that header and skips the watermark
// step when set.
//
// Why the OWNER and not the GUEST. Guests don't have UIDs and
// don't have unlocks — the unlock belongs to the wedding owner.
// When the owner grants their unlock, they want it applied to
// ALL uploads of their wedding, including guest uploads. So
// every upload carries the OWNER's preferences token.
//
// Trust model. The token is signed with HMAC_KEY (same secret
// used for partner-invite tokens). The Vercel proxy verifies
// the signature using its env-mirrored copy of HMAC_KEY; only a
// token that:
//   1. Has a valid signature (HMAC_KEY integrity)
//   2. Hasn't expired (< now + 1 hour)
//   3. Has `ownerUid === the actual owner of this event`
// can flip the watermark off. Tampered tokens fall through to
// the default (watermark on).
//
// Token payload shape:
//   {
//     ownerUid: string,        // Firebase UID of the wedding owner
//     watermarkDisabled: bool, // true iff the owner has the
//                              // 'watermark-removed' unlock AT
//                              // the moment of minting
//     issuedAt: number,        // epoch ms — for debugging / logs
//     expiresAt: number,       // epoch ms — 1 hour from issuedAt
//   }
//
// TTL: 1 hour. The token is only valid for the duration of an
// upload session; the client refreshes it (re-fires the CF)
// whenever the owner's unlocks change.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getHmacKey, signToken } from './hmac';

// Lazy-init admin (singleton — matches vendorInviteTrigger.ts
// pattern). getApps() avoids the "already initialized" warning
// when multiple CF modules in the same deployment import this.
if (getApps().length === 0) initializeApp();
const db = getFirestore();

// Hardcoded appId to match client-side lib/firebase.ts.
const APP_ID = 'savetheday-production';

// HMAC_KEY is the same secret already used for partner-invite
// tokens. The Vercel proxy needs a copy of this secret in its
// env to verify. Mirror via:
//   vercel env add HMAC_KEY production
//   firebase functions:secrets:set HMAC_KEY   # already set
const HMAC_KEY = defineSecret('HMAC_KEY');

// 1 hour. Short enough that abandoned tokens expire before the
// owner's unlock status can meaningfully change again.
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * getUploadPreferencesToken — owner calls this to mint an
 * upload-preferences token for the given event. The token
 * carries the owner's current `watermark-removed` unlock status,
 * signed with HMAC_KEY.
 *
 * Auth: caller MUST be signed in AND own the event whose photos
 * they're about to upload. Anyone else gets 'permission-denied'
 * so a malicious guest can't mint a "watermark off" token for
 * someone else's wedding.
 */
export const getUploadPreferencesToken = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [HMAC_KEY],
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

    const { ownerUid, eventId } = (req.data || {}) as {
      ownerUid?: string;
      eventId?: string;
    };

    if (!ownerUid || typeof ownerUid !== 'string') {
      throw new HttpsError('invalid-argument', 'ownerUid required.');
    }
    if (!eventId || typeof eventId !== 'string') {
      throw new HttpsError('invalid-argument', 'eventId required.');
    }
    // Defense in depth — same SAFE_ID shape the Vercel proxy and
    // the NAS receiver use. Anyone passing arbitrary strings gets
    // rejected before we even read their unlocks.
    const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;
    if (!SAFE_ID.test(ownerUid) || !SAFE_ID.test(eventId)) {
      throw new HttpsError('invalid-argument', 'bad ownerUid or eventId.');
    }

    // The caller MUST be the owner of the event. We verify by
    // reading the event doc — the eventId lives at
    // /artifacts/{appId}/users/{ownerUid}/events/{eventId}. If
    // the doc doesn't exist under the claimed ownerUid, this
    // isn't their event and we 403.
    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError('not-found', 'event not found.');
    }
    if (req.auth.uid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        '你只能拎自己婚禮嘅 upload token。',
      );
    }

    // Look up the owner's unlocks. We only care about the
    // 'watermark-removed' type, but the same query also serves
    // as proof that the owner exists.
    const unlocksSnap = await db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('unlocks')
      .where('type', '==', 'watermark-removed')
      .limit(1)
      .get();

    const watermarkDisabled = !unlocksSnap.empty;

    const issuedAt = Date.now();
    const expiresAt = issuedAt + TOKEN_TTL_MS;
    const token = signToken(
      { ownerUid, watermarkDisabled, issuedAt, expiresAt },
      getHmacKey(HMAC_KEY.value()),
    );

    return {
      token,
      expiresAt,
      watermarkDisabled,
    };
  },
);