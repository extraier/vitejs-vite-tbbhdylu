/**
 * Cloud Functions — Referral Codes & Attribution
 * ===============================================
 *
 * Two surfaces:
 *
 *   1. onUserCreate (Auth trigger) — auto-mints `referralCode` on every
 *      newly-created user. Format: `STD-XXXXX` where XXXXX is 5 uppercase
 *      alphanumeric chars from crypto.randomBytes. Idempotent — if the
 *      user doc already has a referralCode, we leave it alone (e.g. for
 *      users that existed before this trigger shipped; their codes come
 *      from the backfill script instead).
 *
 *   2. applyReferralAttribution (callable) — called by the front-end
 *      during sign-up. The user landed on savetheday.io via a `?ref=STD-XXXXX`
 *      URL and we need to record who referred them on their user doc so
 *      that the referrer can later claim them via requestReferralClaim.
 *      Validates: code exists; not self-referral; not already attributed;
 *      writes `referredByCode` + `referredAt`.
 *
 *   3. getMyReferralInfo (callable) — returns the caller's referralCode,
 *      shareUrl, referredCount (users with referredByCode === my code),
 *      and claimedCount (those who have ≥1 event). Powers the share UI
 *      in ReferralModal.tsx.
 *
 * 2026-07-29 — initial release (Phase 1 of the premium-user build).
 */

import {
  onCall,
  HttpsError,
} from 'firebase-functions/v2/https';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as crypto from 'crypto';
import { grantUnlock } from './unlocks';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();
const authAdmin = getAuth();

// Hardcoded appId to match client-side lib/firebase.ts.
const appId = 'savetheday-production';

const REFERRAL_PREFIX = 'STD';
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 (avoid confusion)
const REFERRAL_CODE_LEN = 5;

// ---- Internal helpers --------------------------------------------------

function userRef(uid: string) {
  return db
    .collection('artifacts').doc(appId)
    .collection('users').doc(uid);
}

/**
 * Generate a referral code like "STD-7K9M2".
 * Uses crypto.randomBytes so it's cryptographically random (not
 * predictable like Math.random). The alphabet excludes I/O/0/1 so
 * users don't misread codes when sharing them verbally.
 */
export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LEN);
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    out += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return `${REFERRAL_PREFIX}-${out}`;
}

/**
 * Verify a referral code looks well-formed. Does NOT check existence
 * (that's the caller's job — we want a single source of truth for
 * "does this code exist" via Firestore).
 */
export function isWellFormedReferralCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const re = new RegExp(`^${REFERRAL_PREFIX}-[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LEN}}$`);
  return re.test(code);
}

// ---- 1. onCreate Auth trigger ----------------------------------------

/**
 * Auto-mint a referralCode on every new Firebase Auth user.
 * Runs before the user signs in for the first time, so the user doc
 * exists when they first land on the app and the code is ready to share.
 *
 * Idempotency: only writes referralCode if the user doc doesn't already
 * have one (covers the edge case where this trigger is re-deployed and
 * processes users that already had a doc created some other way).
 */
export const onUserCreate = beforeUserCreated(
  { region: 'us-central1' },
  async (event) => {
    const uid = event.data?.uid;
    if (!uid) return;

    // Sanity check — is this a real new user? event.data is non-null on
    // create, but TS doesn't know that.
    const userDocRef = userRef(uid);
    const existing = await userDocRef.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    if (existingData.referralCode) return; // already has a code; skip the whole flow

    // Generate a unique code. With 31^5 = ~28M codes, collisions are
    // negligible for our scale (<100k users), but we still check + retry
    // up to 5 times to be safe.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode();
      // Check uniqueness by querying users with this code (cheap because
      // we'll add a composite index in firestore.indexes.json).
      const dupes = await db
        .collection('artifacts').doc(appId)
        .collection('users')
        .where('referralCode', '==', code)
        .limit(1)
        .get();
      if (dupes.empty) {
        // Upsert so we handle the "user doc doesn't exist yet" case.
        // 2026-07-31 — also write createdAt so the profile screen can
        // display 註冊時間. We only stamp it when the doc has no
        // existing createdAt; once stamped, never overwrite (signup
        // date is immutable).
        const update: Record<string, unknown> = {
          referralCode: code,
          referralCodeCreatedAt: FieldValue.serverTimestamp(),
        };
        if (!existingData.createdAt) {
          update.createdAt = FieldValue.serverTimestamp();
        }
        await userDocRef.set(update, { merge: true });
        return;
      }
    }
    // 5 collisions in a row is statistically impossible at our scale.
    // Surface as a hard failure so we notice in logs.
    throw new Error(`Could not generate unique referral code after 5 attempts for uid=${uid}`);
  },
);

// ---- 2. applyReferralAttribution (callable) ---------------------------

/**
 * Called by the front-end during sign-up when the user landed on
 * `savetheday.io?ref=STD-XXXXX`. Writes `referredByCode` on the new
 * user's doc.
 *
 * Server-side validation:
 *   - Code must be well-formed
 *   - Code must resolve to an existing user (the referrer)
 *   - Referrer cannot be the same as the new user (self-referral guard)
 *   - The user must not already have a `referredByCode` (one-shot
 *     attribution — they can't be referred twice)
 *
 * Returns the referrer's display name so the front-end can show
 * "Referred by Alice 🎉" on the welcome screen.
 */
export const applyReferralAttribution = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const { code } = req.data as { code?: string };

    if (!isWellFormedReferralCode(code)) {
      throw new HttpsError('invalid-argument', 'Referral code malformed.');
    }

    // Find the referrer by code
    const referrerSnap = await db
      .collection('artifacts').doc(appId)
      .collection('users')
      .where('referralCode', '==', code)
      .limit(1)
      .get();

    if (referrerSnap.empty) {
      throw new HttpsError('not-found', '推薦碼唔存在，請檢查一下。');
    }

    const referrerDoc = referrerSnap.docs[0];
    const referrerUid = referrerDoc.id;

    if (referrerUid === uid) {
      throw new HttpsError('failed-precondition', '你不能推薦自己。');
    }

    // Check that the new user hasn't already been attributed
    const newUserSnap = await userRef(uid).get();
    const newUserData = newUserSnap.data() || {};
    if (newUserData.referredByCode) {
      // Already attributed — return referrer info silently so the
      // front-end doesn't need to handle two branches
      const referrerData = referrerDoc.data();
      return {
        alreadyAttributed: true,
        referrerUid,
        referrerName: referrerData?.displayName || referrerData?.name || '',
      };
    }

    // Write the attribution
    await userRef(uid).set(
      {
        referredByCode: code,
        referredByUid: referrerUid,
        referredAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const referrerData = referrerDoc.data();
    return {
      alreadyAttributed: false,
      referrerUid,
      referrerName: referrerData?.displayName || referrerData?.name || '',
    };
  },
);

// ---- 3. getMyReferralInfo (callable) ----------------------------------

/**
 * Returns the caller's referral metadata for the share UI.
 *
 *   - code: their own referralCode (may be missing if the onUserCreate
 *     trigger hasn't run yet for very new accounts — we generate one
 *     here as a fallback so the share UI always has something to show)
 *   - shareUrl: full URL the caller should share with friends
 *   - referredCount: how many users have referredByCode === my code
 *     (signed up but haven't necessarily created an event yet)
 *   - claimedCount: how many of those users have created ≥1 event
 *     (eligible to be claimed)
 */
export const getMyReferralInfo = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const userDocRef = userRef(uid);
    const snap = await userDocRef.get();
    const data = snap.data() || {};

    let code: string | null = data.referralCode || null;

    // Fallback: if onUserCreate didn't run (e.g. legacy user predating
    // the trigger), mint one now. Idempotent — write only if missing.
    if (!code) {
      // Try up to 5 times to find a unique code
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateReferralCode();
        const dupes = await db
          .collection('artifacts').doc(appId)
          .collection('users')
          .where('referralCode', '==', candidate)
          .limit(1)
          .get();
        if (dupes.empty) {
          await userDocRef.set(
            { referralCode: candidate, referralCodeCreatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          code = candidate;
          break;
        }
      }
      if (!code) {
        throw new HttpsError('internal', 'Could not generate referral code.');
      }
    }

    // Count how many users were referred by this code
    const referredSnap = await db
      .collection('artifacts').doc(appId)
      .collection('users')
      .where('referredByCode', '==', code)
      .get();

    // For each referred user, check if they have at least one event.
    // We do this by getting all their events subcollections. For our
    // scale (max ~10k referred users per referrer) this is acceptable;
    // if it becomes hot we can denormalize a `claimedByReferrer` flag.
    let claimedCount = 0;
    for (const d of referredSnap.docs) {
      const events = await userRef(d.id).collection('events').limit(1).get();
      if (!events.empty) claimedCount++;
    }

    // Build the share URL — front-end host is hardcoded for now since
    // we deploy to a single domain. Phase 2 will read this from a
    // config param.
    const shareUrl = `https://savetheday.io/?ref=${encodeURIComponent(code)}`;

    return {
      code,
      shareUrl,
      referredCount: referredSnap.size,
      claimedCount,
    };
  },
);

// ---- 4. requestReferralClaim (callable) ------------------------------
//
// 2026-07-29 — auto-grant path. Replaces the old admin-mediated
// `claimReferral` flow in unlocks.ts. The caller (the referrer)
// provides their friend's email; we resolve it, verify the friend
// signed up via the caller's referralCode, and verify the friend has
// at least one event. If all checks pass we auto-grant the
// `storage-500mb` unlock with `source: 'referral'` — no admin step.
// This is the moment the user "becomes premium" via referral.

export const requestReferralClaim = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const callerUid = req.auth.uid;
    const { friendEmail } = req.data as { friendEmail?: string };

    if (!friendEmail || typeof friendEmail !== 'string') {
      throw new HttpsError('invalid-argument', 'friendEmail required.');
    }
    const normalizedEmail = friendEmail.trim().toLowerCase();

    // ---- 1. Resolve caller → must have a referralCode ----
    const callerDoc = await userRef(callerUid).get();
    const callerData = callerDoc.data() || {};
    const myCode: string | undefined = callerData.referralCode;
    if (!myCode) {
      throw new HttpsError('failed-precondition', '你未有推薦碼，請聯絡管理員。');
    }

    // ---- 2. Resolve email → uid ----
    const friendUid = await resolveEmailToUid(normalizedEmail);
    if (!friendUid) {
      throw new HttpsError('not-found', '搵唔到用呢個 email 註冊嘅帳戶。請確認你朋友用咗呢個 email。');
    }
    if (friendUid === callerUid) {
      throw new HttpsError('failed-precondition', '你不能推薦自己。');
    }

    // ---- 3. Verify attribution chain ----
    const friendDoc = await userRef(friendUid).get();
    if (!friendDoc.exists) {
      throw new HttpsError('not-found', '搵唔到呢位朋友嘅帳戶。');
    }
    const friendData = friendDoc.data() || {};
    if (friendData.referredByCode !== myCode) {
      throw new HttpsError(
        'failed-precondition',
        '呢位朋友唔係用你嘅推薦碼註冊嘅，請確認佢哋用咗你分享嘅連結。',
      );
    }

    // ---- 4. Verify the friend has at least one event ----
    const eventsSnap = await userRef(friendUid)
      .collection('events')
      .limit(1)
      .get();
    if (eventsSnap.empty) {
      throw new HttpsError(
        'failed-precondition',
        '你嘅朋友仲未建立任何婚禮，請等佢哋建立之後再嚟 claim。',
      );
    }

    // ---- 5. Auto-grant the unlock (idempotent) ----
    // 2026-08-02 — one referral grants BOTH storage-500mb AND
    // watermark-removed. Both grantUnlock calls are idempotent,
    // so re-firing on every claim is safe.
    await grantUnlock(callerUid, 'storage-500mb', 'referral', {
      referredUid: friendUid,
    });
    const result = await grantUnlock(callerUid, 'watermark-removed', 'referral', {
      referredUid: friendUid,
    });

    return {
      ok: true,
      unlockId: result.unlockId,
      alreadyGranted: result.alreadyGranted,
      friendName: friendData.displayName || friendData.name || '',
    };
  },
);

// ---- Helper: resolve email → uid (used by Phase 2's claim CF) --------
// Exported here so Phase 2 can use it without re-implementing.
export async function resolveEmailToUid(email: string): Promise<string | null> {
  try {
    const u = await authAdmin.getUserByEmail(email);
    return u.uid;
  } catch (e: any) {
    if (e?.code === 'auth/user-not-found') return null;
    throw e;
  }
}