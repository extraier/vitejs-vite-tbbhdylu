/**
 * Cloud Functions — Unlocks (Social Proof + Payment Path)
 * ========================================================
 *
 * Couples unlock three premium features by either social proof
 * OR paying:
 *
 *   1 IG/FB story/post with @savetheday.hk  → custom invite template
 *   1 friend referral who creates event     → +500MB + watermark off
 *   1 Instagram Reels featuring Save The Day → permanent archive
 *
 *   Or pay per-feature: $49 / $29 / $39 (bundle = $99)
 *
 * This module is the single source of truth for granting unlocks.
 * Both paths call grantUnlock() with appropriate `source` field.
 * Frontend reads /users/{uid}/unlocks/{unlockId} to gate UI.
 *
 * 2026-07-21 — initial release.
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
} as const;

export const UNLOCK_TYPES = [
  'custom-template',
  'storage-500mb',
  'permanent-archive',
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
 * grantUnlock — the only function that writes to /users/{uid}/unlocks/.
 * Both social-proof path and payment path route through here.
 * Source field tracks which path granted the unlock.
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
  } = {},
): Promise<{ unlockId: string; alreadyGranted: boolean }> {
  // Idempotency: if an unlock of this type already exists, return early.
  const existing = await userRef(uid)
    .collection('unlocks')
    .where('type', '==', unlockType)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { unlockId: existing.docs[0].id, alreadyGranted: true };
  }

  const unlockId = `${unlockType}-${Date.now()}`;
  const now = FieldValue.serverTimestamp();
  await unlockRef(uid, unlockId).set({
    type: unlockType,
    source,
    price: extras.price ?? null,
    paymentId: extras.paymentId ?? null,
    sourceUrl: extras.sourceUrl ?? null,
    referredUid: extras.referredUid ?? null,
    grantedAt: now,
    expiresAt: extras.expiresAt ?? null,
  });

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
 */
export const submitSocialProof = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const { unlockType, postUrl, caption } = req.data as {
      unlockType: UnlockType;
      postUrl: string;
      caption?: string;
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

    // ---- Create pending social proof doc ----
    const proofId = `${unlockType}-${Date.now()}`;
    await userRef(uid).collection('socialProofs').doc(proofId).set({
      unlockType,
      postUrl,
      caption: caption || '',
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
      await grantUnlock(uid, proof.unlockType as UnlockType, 'social-proof', {
        sourceUrl: proof.postUrl,
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
    const { friendUid } = req.data as { friendUid: string };

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
      await grantUnlock(uid, 'storage-500mb', 'referral', {
        referredUid: claim.friendUid,
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
    } = req.data as {
      unlockType: UnlockType | 'bundle';
      amount: number;
      paymentMethod: 'payme' | 'fps';
      screenshotUrl: string;
      reference?: string;
    };

    if (!['custom-template', 'storage-500mb', 'permanent-archive', 'bundle'].includes(unlockType)) {
      throw new HttpsError('invalid-argument', 'invalid unlockType.');
    }
    if (!['payme', 'fps'].includes(paymentMethod)) {
      throw new HttpsError('invalid-argument', 'paymentMethod must be payme or fps.');
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be > 0.');
    }
    if (!screenshotUrl || !screenshotUrl.includes(`/payment-receipts/${uid}/`)) {
      throw new HttpsError('permission-denied', 'screenshotUrl must be under your own folder.');
    }

    const receiptId = `${unlockType}-${paymentMethod}-${Date.now()}`;
    await userRef(uid).collection('paymentReceipts').doc(receiptId).set({
      unlockType,
      amount,
      paymentMethod,
      screenshotUrl,
      reference: reference || '',
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
      const unlockTypes: UnlockType[] = receipt.unlockType === 'bundle'
        ? ['custom-template', 'storage-500mb', 'permanent-archive']
        : [receipt.unlockType as UnlockType];

      for (const t of unlockTypes) {
        await grantUnlock(uid, t, `paid-${receipt.paymentMethod}` as any, {
          price: UNLOCK_PRICING[t],
          paymentId: receiptId,
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