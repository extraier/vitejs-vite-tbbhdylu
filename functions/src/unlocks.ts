/**
 * Cloud Functions — Unlocks (Social Proof + Payment Path)
 * ========================================================
 *
 * Couples unlock four premium features by either social proof
 * OR paying:
 *
 *   1 IG/FB story/post with @savetheday.hk  → custom invite template
 *   1 friend referral who creates event     → +500MB + watermark off
 *   1 Instagram Reels featuring Save The Day → permanent archive
 *   Pay per-feature                          → watermark off ($29)
 *
 * This module is the single source of truth for granting unlocks.
 * Both paths call grantUnlock() with appropriate `source` field.
 * Frontend reads /artifacts/{appId}/users/{uid}/unlocks/{unlockId} to gate UI.
 *
 * 2026-07-21 — initial release.
 * 2026-08-02 — added 'watermark-removed' type. Until this commit
 * the banner promised "推介 1 位朋友 → +500MB + 移除浮水印" but
 * only the storage unlock was real; the watermark side required
 * an upload-path integration that didn't exist. The watermark
 * itself is applied on the NAS in photo_upload_server.py
 * (deploy/photo_upload_server.py — runs as the photo server on
 * the UGREEN NAS at /volume1/flight-scanner/wedding-photos).
 * The NAS-side upload server queries the owner's unlock doc via
 * Firebase Admin SDK (service-account key in
 * /home/openclaw/.config/firebase-admin-key.json on the NAS)
 * before deciding whether to watermark a new upload. If the
 * user has the 'watermark-removed' unlock, the upload lands
 * clean. Default-on watermark means every photo is watermarked
 * unless the user has this unlock (earned via referral or paid).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// Hardcoded appId to match client-side lib/firebase.ts.
const appId = 'savetheday-production';

// ---- Pricing -----------------------------------------------------------

export const UNLOCK_PRICING = {
  'custom-template': 49,
  'storage-500mb': 29,
  'permanent-archive': 39,
  // 2026-08-02 — watermark-removed is now its own paid feature.
  // Couples can earn it free via a referral (granted alongside
  // storage-500mb) or pay for it directly. $29 mirrors the
  // storage-500mb price point (same social-proof / paid split
  // applies to both).
  'watermark-removed': 29,
} as const;

// 2026-08-23 — Manus P4.2 (PDF Patch 4): HK$99 is the binding
// Premium bundle price. The UI has been rendering HK$99 since
// 2026-07-30, but deriveExpectedAmount previously summed the
// four individual SKUs (49+29+39+29 = HK$146). That mismatch
// meant a customer paying the displayed HK$99 was rejected by
// the server (amount $99 != expected $146). Make HK$99 the
// named server contract: the UI's `BUNDLE_PRICE = 99` constant
// must equal this. Change BOTH at once if the price ever moves.
export const PREMIUM_BUNDLE_PRICE = 99;

export const UNLOCK_TYPES = [
  'custom-template',
  'storage-500mb',
  'permanent-archive',
  'watermark-removed',
] as const;

export type UnlockType = typeof UNLOCK_TYPES[number];

// ---- Internal helpers --------------------------------------------------

function userRef(uid: string) {
  return db
    .collection('artifacts').doc(appId)
    .collection('users').doc(uid);
}

function unlockRef(uid: string, unlockId: string) {
  return userRef(uid).collection('unlocks').doc(unlockId);
}

/**
 * grantUnlock — the only function that writes to
 * /artifacts/{appId}/users/{uid}/unlocks/.
 * Both social-proof path and payment path route through here.
 * Source field tracks which path granted the unlock.
 *
 * 2026-08-20 — Manus P1.1 audit §4.1 + §6: grants are now
 * event-scoped. Each unlock doc carries `eventId`; idempotency
 * is (uid, type, eventId) so the same customer can purchase
 * the same feature for multiple events. For backwards compat,
 * unlocks WITHOUT an eventId (legacy docs written before this
 * commit) are treated as owner-wide and still satisfy any
 * event. New unlocks MUST carry eventId — the resolver and
 * the receipt/proof schemas propagate it. Admin grants
 * (admin-grant) are intentionally owner-wide and still pass
 * eventId=null.
 */
export async function grantUnlock(
  uid: string,
  unlockType: UnlockType,
  source: 'social-proof' | 'referral' | 'paid' | 'paid-stripe' | 'paid-payme' | 'paid-fps' | 'admin-grant',
  extras: {
    price?: number;
    paymentId?: string;
    sourceUrl?: string;   // for social proof: the IG/FB post URL
    referredUid?: string; // for referral: the friend who signed up
    expiresAt?: number | null;
    // 2026-08-20 — audit §4.1: which event this unlock applies
    // to. Required for paid + referral unlocks; null for
    // owner-wide admin-grant. The resolver filters by eventId.
    eventId?: string | null;
  } = {},
): Promise<{ unlockId: string; alreadyGranted: boolean }> {
  // Idempotency: scoped to (uid, type, eventId). Owner-wide
  // legacy unlocks (eventId === null) share the (uid, type)
  // bucket — first one wins for the whole account. New
  // event-scoped unlocks have a per-event bucket so the same
  // type can be granted N times for N events.
  const existingQuery = userRef(uid)
    .collection('unlocks')
    .where('type', '==', unlockType);
  // Firestore composite queries need the field present. For
  // legacy grants (eventId unset) we use a single-field query;
  // for new grants we add the eventId filter.
  const existingSnap = extras.eventId
    ? await existingQuery.where('eventId', '==', extras.eventId).limit(1).get()
    : await existingQuery.limit(1).get();
  if (!existingSnap.empty) {
    return { unlockId: existingSnap.docs[0].id, alreadyGranted: true };
  }

  const unlockId = extras.eventId
    ? `${unlockType}-${extras.eventId}-${Date.now()}`
    : `${unlockType}-${Date.now()}`;
  const now = FieldValue.serverTimestamp();
  await unlockRef(uid, unlockId).set({
    type: unlockType,
    source,
    // 2026-08-20 — audit §4.1: persist the eventId so the
    // resolver can filter by event. Null for legacy/owner-wide
    // admin-grant unlocks.
    eventId: extras.eventId ?? null,
    price: extras.price ?? null,
    paymentId: extras.paymentId ?? null,
    sourceUrl: extras.sourceUrl ?? null,
    referredUid: extras.referredUid ?? null,
    grantedAt: now,
    expiresAt: extras.expiresAt ?? null,
  });

  // 2026-07-29 — auto-promote to premium tier on any unlock. This is
  // user-scoped (across all their events), while events/{eventId}.tier
  // remains a per-event override that admins can still set
  // independently. Idempotent: setting the same field is a no-op.
  //
  // 2026-08-20 — audit §4.1: this auto-promotion still fires for
  // any unlock (event-scoped or owner-wide). That's the
  // pre-existing behaviour; the tier badge is owner-level by
  // product intent. Individual features stay event-bound via
  // the resolver's eventId filter — see entitlementResolver.ts.
  await userRef(uid).set(
    { tier: 'premium', promotedAt: now },
    { merge: true },
  );

  return { unlockId, alreadyGranted: false };
}

// ---- Social Proof Path -------------------------------------------------

/**
 * submitSocialProof — couple submits an Instagram/Facebook post URL
 * that demonstrates they tagged @savetheday.hk. Admin verifies
 * manually and calls adminVerifySocialProof to grant the unlock.
 *
 * Three unlock types map to three different post requirements:
 *   • custom-template   → IG/FB story OR post
 *   • storage-500mb     → not used (referral-based)
 *   • permanent-archive → IG Reels
 *
 * Note: storage-500mb uses the referral path, not social proof.
 * For backwards compat we accept all three but reject storage-500mb here.
 *
 * 2026-08-20 — Manus P1.1 audit §4.1: social proofs now
 * persist `eventId` so the unlock grant can be bound to one
 * event. Optional for backwards compat (older submissions
 * before this commit have no eventId on the proof doc);
 * adminVerifySocialProof falls back to owner-wide when the
 * field is missing.
 */
export const submitSocialProof = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const { unlockType, postUrl, caption, screenshotUrl, eventId } = req.data as {
      unlockType: UnlockType;
      postUrl: string;
      caption?: string;
      // 2026-08-10 — optional screenshot upload. Couples attach an
      // image (screenshot of their IG story / FB post) when the post
      // is private / expired / not publicly viewable. The client
      // uploads to /social-proofs/{uid}/{proofId}.{ext} BEFORE
      // calling this CF, then passes the resulting download URL.
      // Owner+admin can read it (storage.rules gates it). Server-
      // side validation: must be under the user's own folder.
      screenshotUrl?: string;
      // 2026-08-20 — audit §4.1: which event the proof is for.
      // Optional; adminVerifySocialProof falls back to
      // owner-wide when missing.
      eventId?: string;
    };

    // ---- Validation ----
    if (!['custom-template', 'permanent-archive'].includes(unlockType)) {
      throw new HttpsError('invalid-argument', 'Use referral path for storage-500mb.');
    }
    if (!postUrl || typeof postUrl !== 'string') {
      throw new HttpsError('invalid-argument', 'postUrl required.');
    }
    // Light URL validation: must be instagram.com or facebook.com
    const lower = postUrl.toLowerCase();
    if (!lower.includes('instagram.com') && !lower.includes('facebook.com') && !lower.includes('fb.com')) {
      throw new HttpsError('invalid-argument', 'URL must be Instagram or Facebook.');
    }
    if (postUrl.length > 500) {
      throw new HttpsError('invalid-argument', 'postUrl too long.');
    }
    if (caption && (typeof caption !== 'string' || caption.length > 500)) {
      throw new HttpsError('invalid-argument', 'caption must be <= 500 chars.');
    }
    // 2026-08-10 — screenshot validation. If provided, must be a
    // Firebase Storage download URL under the user's own folder.
    // (Matches the payment-receipt validation pattern at line 384
    // below — same security model, same folder-namespace check.)
    if (screenshotUrl !== undefined && screenshotUrl !== null && screenshotUrl !== '') {
      if (typeof screenshotUrl !== 'string') {
        throw new HttpsError('invalid-argument', 'screenshotUrl must be a string.');
      }
      if (screenshotUrl.length > 2000) {
        throw new HttpsError('invalid-argument', 'screenshotUrl too long.');
      }
      if (!screenshotUrl.includes(`/social-proofs/${uid}/`)) {
        throw new HttpsError('permission-denied', 'screenshotUrl must be under your own folder.');
      }
    }

    // ---- Create pending social proof doc ----
    const proofId = `${unlockType}-${Date.now()}`;
    await userRef(uid).collection('socialProofs').doc(proofId).set({
      unlockType,
      postUrl,
      caption: caption || '',
      screenshotUrl: screenshotUrl || null,
      // 2026-08-20 — audit §4.1: persist eventId so the
      // grant on approval is bound to this event. Optional
      // for backwards compat with older submissions; missing
      // means owner-wide (legacy behaviour).
      eventId: eventId || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
    });

    return {
      proofId,
      estimatedReviewTime: '管理員會喺 24 小時內人手核實',
    };
  },
);

/**
 * adminVerifySocialProof — admin approves or rejects a pending
 * social proof. On approve: grantUnlock() is called.
 */
export const adminVerifySocialProof = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (req.auth.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { uid, proofId, decision, rejectionReason } = req.data as {
      uid: string;
      proofId: string;
      decision: 'approve' | 'reject';
      rejectionReason?: string;
    };
    if (!uid || !proofId || !['approve', 'reject'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'uid, proofId, decision required.');
    }

    const proofRef = userRef(uid).collection('socialProofs').doc(proofId);
    const proofDoc = await proofRef.get();
    if (!proofDoc.exists) {
      throw new HttpsError('not-found', 'Social proof not found.');
    }
    const proof = proofDoc.data()!;
    if (proof.status === 'approved' || proof.status === 'rejected') {
      throw new HttpsError('failed-precondition', 'Already processed.');
    }

    if (decision === 'approve') {
      // 2026-08-20 — Manus P1.1 audit §4.1: bind the grant
      // to the proof doc's eventId (if present). Older
      // proofs without eventId fall through to owner-wide
      // (legacy behaviour). The resolver and the entitlement
      // token both honor eventId binding, so a customer who
      // posts IG for event A cannot get the unlock applied
      // to event B.
      await grantUnlock(uid, proof.unlockType as UnlockType, 'social-proof', {
        sourceUrl: proof.postUrl,
        eventId: proof.eventId || null,
      });

      await proofRef.update({
        status: 'approved',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
      });
    } else {
      await proofRef.update({
        status: 'rejected',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
        rejectionReason: rejectionReason || '',
      });
    }

    return { ok: true };
  },
);

/**
 * listSocialProofs — owner fetches their own submitted proofs with
 * current status. Powers the "進度" tab of SocialProofModal.
 *
 * Returns rows with timestamps converted from Firestore Timestamp
 * objects to epoch ms so the front-end doesn't need firebase-admin
 * knowledge. Limited to 50 most-recent docs to avoid unbounded scans.
 */
export const listSocialProofs = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;

    const snap = await userRef(uid)
      .collection('socialProofs')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const rows = snap.docs.map((d) => {
      const data = d.data();
      // Firestore Timestamps → epoch ms; null when unset.
      const tsToMs = (v: any): number | null => {
        if (!v) return null;
        if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
        if (typeof v.toMillis === 'function') return v.toMillis();
        if (typeof v._seconds === 'number') return v._seconds * 1000;
        return null;
      };
      return {
        id: d.id,
        unlockType: data.unlockType,
        postUrl: data.postUrl,
        status: data.status,
        // 2026-08-10 — surface the optional screenshot URL so the
        // owner's "進度" tab can show what they uploaded alongside
        // the post URL. Admin sees the same in AdminQueue.
        screenshotUrl: data.screenshotUrl || null,
        createdAt: tsToMs(data.createdAt),
        verifiedAt: tsToMs(data.verifiedAt),
        rejectionReason: data.rejectionReason || null,
      };
    });

    return { ok: true, rows };
  },
);

// ---- Referral Path ----------------------------------------------------

/**
 * claimReferral — couple claims that a friend signed up using their
 * referral code AND that friend created an event. Admin verifies and
 * grants the +500MB unlock.
 *
 * Referral codes are stored on the user doc as `referralCode`. Friends
 * sign up with ?ref={code} which is captured on their user doc as
 * `referredByCode`. We check that the claimed friend:
 *   1. Has `referredByCode === user.referralCode`
 *   2. Has at least one event under their user doc
 */
export const claimReferral = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    // 2026-08-20 — Manus P1.1 audit §4.1: which event the
    // referrer wants the bonus applied to. The client passes
    // its currently-selected eventId; adminVerifyReferral
    // carries it into grantUnlock. Optional for backwards
    // compat (legacy claims without eventId fall through to
    // owner-wide).
    const { friendUid, eventId } = req.data as { friendUid: string; eventId?: string };

    if (!friendUid || typeof friendUid !== 'string') {
      throw new HttpsError('invalid-argument', 'friendUid required.');
    }

    // Self-referral guard
    if (friendUid === uid) {
      throw new HttpsError('invalid-argument', '你不能推薦自己。');
    }

    // Check that the friend exists and was referred by us
    const myDoc = await userRef(uid).get();
    const myData = myDoc.data() || {};
    const myReferralCode = myData.referralCode;
    if (!myReferralCode) {
      throw new HttpsError('failed-precondition', '你未有推薦碼，請聯絡管理員。');
    }

    const friendDoc = await userRef(friendUid).get();
    if (!friendDoc.exists) {
      throw new HttpsError('not-found', '找不到呢位朋友嘅帳戶。');
    }
    const friendData = friendDoc.data() || {};

    if (friendData.referredByCode !== myReferralCode) {
      throw new HttpsError('failed-precondition', '呢位朋友唔係用你嘅推薦碼註冊嘅。');
    }

    // Check that the friend has at least one event
    const eventsSnap = await userRef(friendUid)
      .collection('events')
      .limit(1)
      .get();
    if (eventsSnap.empty) {
      throw new HttpsError('failed-precondition', '你嘅朋友仲未建立任何婚禮，請等佢哋建立之後再嚟。');
    }

    // Create pending claim for admin verification
    const claimId = `storage-500mb-${Date.now()}`;
    await userRef(uid).collection('referralClaims').doc(claimId).set({
      unlockType: 'storage-500mb',
      friendUid,
      friendName: friendData.displayName || friendData.name || '',
      friendEventCount: eventsSnap.size,
      // 2026-08-20 — Manus P1.1 audit §4.1: which event the
      // referrer wants the bonus applied to. The client
      // passes the currently-selected event; adminVerifyReferral
      // carries it into grantUnlock. Older claims without
      // eventId fall through to owner-wide (legacy).
      eventId: eventId || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: null,
      verifiedBy: null,
    });

    return {
      claimId,
      estimatedReviewTime: '管理員會喺 24 小時內核實',
    };
  },
);

/**
 * adminVerifyReferral — admin approves or rejects a pending
 * referral claim. On approve: grantUnlock() is called.
 */
export const adminVerifyReferral = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (req.auth.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { uid, claimId, decision, rejectionReason } = req.data as {
      uid: string;
      claimId: string;
      decision: 'approve' | 'reject';
      rejectionReason?: string;
    };
    if (!uid || !claimId || !['approve', 'reject'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'uid, claimId, decision required.');
    }

    const claimRef = userRef(uid).collection('referralClaims').doc(claimId);
    const claimDoc = await claimRef.get();
    if (!claimDoc.exists) {
      throw new HttpsError('not-found', 'Claim not found.');
    }
    const claim = claimDoc.data()!;
    if (claim.status === 'approved' || claim.status === 'rejected') {
      throw new HttpsError('failed-precondition', 'Already processed.');
    }

    if (decision === 'approve') {
      // 2026-08-02 — one referral now grants BOTH storage-500mb
      // AND watermark-removed. The RewardsBanner has been
      // promising "推介 1 位朋友 → +500MB + 移除浮水印" since
      // launch; until this commit only the storage half worked.
      // Both grants are idempotent (grantUnlock short-circuits on
      // existing docs of the same type), so this is safe to
      // re-fire on every approval.
      //
      // 2026-08-20 — Manus P1.1 audit §4.1: bind both grants
      // to the claim's eventId (set by submitReferralClaim from
      // the client's currently-selected event). Legacy claims
      // without eventId fall through to owner-wide.
      await grantUnlock(uid, 'storage-500mb', 'referral', {
        referredUid: claim.friendUid,
        eventId: claim.eventId || null,
      });
      await grantUnlock(uid, 'watermark-removed', 'referral', {
        referredUid: claim.friendUid,
        eventId: claim.eventId || null,
      });
      await claimRef.update({
        status: 'approved',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
      });
    } else {
      await claimRef.update({
        status: 'rejected',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
        rejectionReason: rejectionReason || '',
      });
    }

    return { ok: true };
  },
);

// ---- Payment Path (PayMe / FPS) ---------------------------------------

/**
 * submitPaymentReceipt — couple pays via PayMe/FPS and uploads a
 * screenshot. Status starts as 'pending'; admin verifies.
 */
// 2026-08-19 — Manus P1.1: extracted from submitPaymentReceipt
// so the price-derivation logic is unit-testable without an
// emulator. Returns either { expectedAmount } or throws an error
// string (caller maps to HttpsError).
export function deriveExpectedAmount(
  unlockType: UnlockType | 'bundle' | 'premium',
  amount: number,
  adminOverride: boolean,
  overrideReason: string | undefined,
): { expectedAmount: number } {
  const expectedAmount =
    unlockType === 'bundle' || unlockType === 'premium'
      // 2026-08-23 — Manus P4.2 (PDF Patch 4): use the named
      // HK$99 Premium bundle price instead of summing the four
      // individual SKUs (49+29+39+29 = 146). The UI has been
      // rendering HK$99 since 2026-07-30; this mismatch meant a
      // customer paying the displayed $99 was rejected by the
      // server with "amount does not match expected $146". The
      // named constant also makes future price moves a one-line
      // change instead of a four-line refactor.
      ? PREMIUM_BUNDLE_PRICE
      : UNLOCK_PRICING[unlockType as UnlockType];
  const amtDelta = Math.abs(amount - expectedAmount);
  if (amtDelta > 1 && !adminOverride) {
    throw new Error(
      `amount ${amount} does not match expected ${expectedAmount}; ` +
      `use adminOverride if intentional.`,
    );
  }
  if (adminOverride && (!overrideReason || !overrideReason.trim())) {
    throw new Error('overrideReason is required when adminOverride is true.');
  }
  return { expectedAmount };
}

export const submitPaymentReceipt = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const {
      unlockType,
      amount,
      paymentMethod,
      screenshotUrl,
      reference,
      eventId,
      adminOverride,
      overrideReason,
    } = req.data as {
      // 2026-07-30 — 'premium' replaces 'bundle' as the premium
      // membership label. Both accepted for backward compat with
      // pre-2026-07-30 in-flight receipts.
      unlockType: UnlockType | 'bundle' | 'premium';
      amount: number;
      paymentMethod: 'payme' | 'fps';
      screenshotUrl: string;
      reference?: string;
      // 2026-08-19 — Manus P1.3: eventId is now required on
      // receipts. The entitlement resolver is event-scoped, so
      // a receipt without an event cannot be approved into a
      // specific entitlement. Legacy callers (pre-2026-08-19)
      // that don't send eventId land in the rare-but-honest
      // bucket: they pass adminOverride=true AND provide a
      // justification note. Without adminOverride, the request
      // fails with INVALID_EVENT.
      eventId?: string;
      adminOverride?: boolean;
      overrideReason?: string;
    };

    if (!['custom-template', 'storage-500mb', 'permanent-archive', 'watermark-removed', 'bundle', 'premium'].includes(unlockType)) {
      throw new HttpsError('invalid-argument', 'invalid unlockType.');
    }
    if (!['payme', 'fps'].includes(paymentMethod)) {
      throw new HttpsError('invalid-argument', 'paymentMethod must be payme or fps.');
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be > 0.');
    }

    // 2026-08-19 — Manus P1.1: server-side price derivation.
    // Use the shared helper so the unit tests cover the policy.
    let expectedAmount: number;
    try {
      const out = deriveExpectedAmount(
        unlockType as UnlockType,
        amount,
        !!adminOverride,
        overrideReason,
      );
      expectedAmount = out.expectedAmount;
    } catch (err: any) {
      throw new HttpsError('invalid-argument', err.message);
    }

    // 2026-08-19 — Manus P1.3: eventId is required except under
    // admin override. Validate that the event exists under the
    // caller (don't leak ownership info via 404 vs 403).
    if (!eventId || typeof eventId !== 'string') {
      if (!adminOverride) {
        throw new HttpsError(
          'invalid-argument',
          'eventId is required so the entitlement can be scoped to a wedding.',
        );
      }
    } else {
      const eventDoc = await userRef(uid).collection('events').doc(eventId).get();
      if (!eventDoc.exists) {
        throw new HttpsError('not-found', 'event not found');
      }
    }

    if (!screenshotUrl || !screenshotUrl.includes(`/payment-receipts/${uid}/`)) {
      throw new HttpsError('permission-denied', 'screenshotUrl must be under your own folder.');
    }

    const receiptId = `${unlockType}-${paymentMethod}-${Date.now()}`;
    await userRef(uid).collection('paymentReceipts').doc(receiptId).set({
      unlockType,
      amount,
      expectedAmount,
      paymentMethod,
      screenshotUrl,
      reference: reference || '',
      eventId: eventId || null,
      adminOverride: !!adminOverride,
      overrideReason: adminOverride ? (overrideReason || '').trim() : null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
    });

    return {
      receiptId,
      estimatedReviewTime: '24 小時內管理員人手審核',
    };
  },
);

/**
 * adminVerifyPayment — admin approves or rejects a pending receipt.
 */
export const adminVerifyPayment = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (req.auth.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { uid, receiptId, decision, rejectionReason } = req.data as {
      uid: string;
      receiptId: string;
      decision: 'approve' | 'reject';
      rejectionReason?: string;
    };
    if (!uid || !receiptId || !['approve', 'reject'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'uid, receiptId, decision required.');
    }

    const receiptRef = userRef(uid).collection('paymentReceipts').doc(receiptId);
    const receiptDoc = await receiptRef.get();
    if (!receiptDoc.exists) {
      throw new HttpsError('not-found', 'Receipt not found.');
    }
    const receipt = receiptDoc.data()!;
    if (receipt.status === 'approved' || receipt.status === 'rejected') {
      throw new HttpsError('failed-precondition', 'Already processed.');
    }

    if (decision === 'approve') {
      // 2026-07-30 — 'premium' is the new label for the bundle.
      // 'bundle' is kept for backward compat with receipts submitted
      // before the 2026-07-30 rename. Both run the same "grant all 4"
      // path so the user gets the full premium experience.
      // 2026-08-02 — bundle now also grants watermark-removed (the
      // default-on photo watermark is a premium feature too; paying
      // for the bundle should give the same outcome as the
      // referral that previously promised "+500MB + 移除浮水印").
      const unlockTypes: UnlockType[] =
        receipt.unlockType === 'bundle' || receipt.unlockType === 'premium'
          ? ['custom-template', 'storage-500mb', 'permanent-archive', 'watermark-removed']
          : [receipt.unlockType as UnlockType];

      for (const t of unlockTypes) {
        // 2026-08-20 — Manus P1.1 audit §4.1: bind the grant
        // to the receipt's eventId so the unlock applies
        // only to that event. Without this, a customer who
        // paid for watermark removal on event A would get
        // clean uploads on event B too. The receipt already
        // carries eventId (line 591 above).
        await grantUnlock(uid, t, `paid-${receipt.paymentMethod}` as any, {
          price: UNLOCK_PRICING[t],
          paymentId: receiptId,
          eventId: receipt.eventId || null,
        });
      }

      await receiptRef.update({
        status: 'approved',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
      });
    } else {
      await receiptRef.update({
        status: 'rejected',
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: req.auth.uid,
        rejectionReason: rejectionReason || '',
      });
    }

    return { ok: true };
  },
);