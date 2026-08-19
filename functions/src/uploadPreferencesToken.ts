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
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getHmacKey, signToken } from './hmac';
import {
  resolveStorageQuota,
  buildStorageIncrement,
  type EventEntitlement,
} from './storageQuota';
import { computeEntitlement } from './entitlementResolver';

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

// ---- Path helpers ---------------------------------------------------

function userRef(uid: string) {
  return db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(uid);
}

function unlocksCol(uid: string) {
  return userRef(uid).collection('unlocks');
}

function eventRef(uid: string, eventId: string) {
  return userRef(uid).collection('events').doc(eventId);
}

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
    const eventDocRef = eventRef(ownerUid, eventId);
    const eventSnap = await eventDocRef.get();
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
    const unlocksSnap = await unlocksCol(ownerUid)
      .where('type', '==', 'watermark-removed')
      .limit(1)
      .get();

    const watermarkDisabled = !unlocksSnap.empty;

    // 2026-08-19 — Manus P1.4.a: also compute the entitlement
    // and surface the storage quota + current usage so the
    // photo drop can render a real "X MB / Y MB" indicator
    // instead of the per-photo estimate. The entitlement
    // resolver is the source of truth for the limit; the
    // counter on the event doc is the source of truth for
    // usage. We also seed the quota into the event doc on
    // first read so the proxy can read it directly without
    // a second resolver round-trip.
    const allUnlocksSnap = await unlocksCol(ownerUid).get();
    const entitlement: EventEntitlement = computeEntitlement(
      ownerUid,
      eventId,
      allUnlocksSnap.docs.map((d) => {
        const data = d.data() || {};
        const grantedAt = data.grantedAt;
        let grantedAtMs = 0;
        if (typeof grantedAt === 'number') {
          grantedAtMs = grantedAt;
        } else if (grantedAt && typeof grantedAt.toMillis === 'function') {
          grantedAtMs = grantedAt.toMillis();
        }
        return {
          type: data.type || d.id,
          source: data.source,
          paymentId: data.paymentId,
          grantedAt: grantedAtMs,
        };
      }),
    );
    const eventData = eventSnap.data() || {};
    const storageUsageBytes = Number.isFinite(eventData.storageUsageBytes)
      ? eventData.storageUsageBytes
      : 0;
    const storageQuotaBytes = resolveStorageQuota(entitlement);
    if (eventData.storageQuotaBytes !== storageQuotaBytes) {
      try {
        await eventDocRef.update({
          storageQuotaBytes,
          storageQuotaSetAt: FieldValue.serverTimestamp(),
        });
      } catch (seedErr) {
        // 2026-08-19 — Don't fail the upload-prefs call if the
        // seed write loses a race to a concurrent unlock grant.
        // The proxy will fall back to reading the entitlement
        // directly when quota is missing. Log + continue.
        console.warn('[uploadPreferencesToken] storageQuotaBytes seed failed:', seedErr);
      }
    }

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
      // 2026-08-19 — Manus P1.4.a: surface the quota so the
      // client can render "X MB / Y MB" with real numbers.
      // Field names are deliberately byte-aligned with the
      // event doc fields so the proxy and the client agree.
      storageUsageBytes,
      storageQuotaBytes,
      remainingBytes: Math.max(storageQuotaBytes - storageUsageBytes, 0),
    };
  },
);

/**
 * recordUploadBytesUsed — 2026-08-19 — Manus P1.4.a: callable
 * the proxy hits AFTER a successful NAS upload to atomically
 * increment the storageUsageBytes counter.
 *
 * Auth: caller MUST be the event owner (cross-checked against
 * the event ref). Co-owners / assigned vendors use a different
 * surface (the proxy validates membership before calling here
 * and uses the OWNER's uid for the counter).
 *
 * addBytes: the recorded payload. The proxy passes the
 * Content-Length of the multipart body minus a small
 * multipart overhead estimate. The helper floors the value
 * and rejects anything <= 0.
 */
export const recordUploadBytesUsed = onCall(
  {
    cors: true,
    region: 'us-central1',
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { eventId, ownerUid, addBytes } = (req.data || {}) as {
      eventId?: string;
      ownerUid?: string;
      addBytes?: number;
    };
    const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;
    if (!eventId || !SAFE_ID.test(eventId)) {
      throw new HttpsError('invalid-argument', 'eventId required.');
    }
    if (!ownerUid || !SAFE_ID.test(ownerUid)) {
      throw new HttpsError('invalid-argument', 'ownerUid required.');
    }
    if (!Number.isFinite(addBytes) || (addBytes as number) <= 0) {
      throw new HttpsError('invalid-argument', 'addBytes must be > 0.');
    }
    if (req.auth.uid !== ownerUid) {
      throw new HttpsError('permission-denied', 'caller is not this event owner.');
    }
    const inc = buildStorageIncrement(addBytes as number);
    await eventRef(ownerUid, eventId).update({
      storageUsageBytes: FieldValue.increment(inc.storageUsageBytes),
      storageUsageUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, addedBytes: inc.storageUsageBytes };
  },
);