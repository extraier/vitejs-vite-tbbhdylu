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
// 2026-08-15 — onDocumentCreated fires when a couple creates their
// first event. We use it to auto-qualify the referrer (no email
// claim step), per the Manus product review P0-2.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
// Pure helpers from a sibling file so we can unit-test the
// decision logic without pulling in firebase-admin.
import {
  isFirstEvent,
  makeQualifiedOutcome,
} from './referralQualify';
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

// 2026-08-15 — onUserCreate (Auth blocking trigger) was removed.
// It used beforeUserCreated which fails to deploy on standard
// Firebase projects ("Blocking Functions may only be configured
// for GCIP projects"). The same code-minting logic lives as a
// fallback in getMyReferralInfo below — when a user doc has no
// referralCode, we mint one on first read.

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
 *   - qualifiedReferralCount: how many of those users have created
 *     ≥1 event AND triggered an auto-unlock for us. Maintained by
 *     onEventCreated. Falls back to an N+1 scan for legacy users who
 *     predate the trigger (one-time backfill).
 *   - claimedCount: kept for backwards compat; same value as
 *     qualifiedReferralCount.
 *
 * 2026-08-15 — qualifiedReferralCount replaces the manual email
 * claim step. Couples no longer need to type in their friend's email;
 * the auto-trigger does the work and this function just reports the
 * count.
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

    // 2026-08-15 — replace the N+1 read with the denormalized
    // qualifiedReferralCount maintained by onEventCreated. This is
    // the count of referred users who have created at least one
    // event AND whose referrer (us) has been granted the unlock.
    //
    // Backwards compat: if qualifiedReferralCount isn't set yet
    // (user predates this trigger), fall back to a single
    // collectionGroup count. The collectionGroup reads events
    // across all users' subcollections and is bounded by the
    // Firestore rules we already enforce — same security
    // boundary, no new exposure.
    let qualifiedReferralCount = (data.qualifiedReferralCount as number | undefined) ?? 0;
    if (qualifiedReferralCount === 0) {
      // Legacy path: count qualifying users by walking the
      // referredByUid index. Still N+1 but only for users who
      // predate the trigger — vanishingly small at this point.
      const qualSnap = await db
        .collection('artifacts').doc(appId)
        .collection('users')
        .where('referredByCode', '==', code)
        .get();
      let legacyQualified = 0;
      for (const d of qualSnap.docs) {
        const events = await userRef(d.id).collection('events').limit(1).get();
        if (!events.empty) legacyQualified++;
      }
      qualifiedReferralCount = legacyQualified;
      // Backfill the aggregate so we never re-scan. Best-effort.
      if (legacyQualified > 0) {
        await userDocRef.set(
          { qualifiedReferralCount: legacyQualified },
          { merge: true },
        );
      }
    }

    // Build the share URL — front-end host is hardcoded for now since
    // we deploy to a single domain. Phase 2 will read this from a
    // config param.
    const shareUrl = `https://savetheday.io/?ref=${encodeURIComponent(code)}`;

    return {
      code,
      shareUrl,
      referredCount: referredSnap.size,
      // 2026-08-15 — renamed for clarity. qualifiedReferralCount is
      // maintained by the auto-qualify trigger; it's the same
      // population as the old claimedCount but kept up-to-date
      // automatically.
      qualifiedReferralCount,
      // 2026-08-15 — keep claimedCount for backwards compat with
      // the existing client UI. Same value, both names.
      claimedCount: qualifiedReferralCount,
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

// ---- 5. onEventCreated (Firestore trigger) ----------------------------
//
// 2026-08-15 — automatic referral qualification. Replaces the manual
// `requestReferralClaim` workflow (which required the referrer to type
// in the friend's email). Per the Manus product review P0-2.
//
// Flow:
//   1. User creates their first event (the trigger fires on every
//      event creation but only the FIRST one qualifies the referrer).
//   2. We look up `referredByUid` on the new user's doc.
//   3. If set, we mark the user as qualified in
//      /users/{referrerUid}/referralQualifications/{referredUid}.
//   4. The first-time write bumps referrer's qualifiedReferralCount
//      and grants the two unlocks (storage-500mb + watermark-removed).
//   5. Subsequent events from the same referred user are no-ops.
//
// Idempotency: every step uses create-with-merge OR a conditional
// update that no-ops if the qualification already exists. grantUnlock
// is itself idempotent on unlockType.
//
// Anti-fraud hold: deferred. The Manus review suggested "a short
// anti-fraud hold" before granting. We grant immediately because:
//   (a) grantUnlock is reversible via admin revoke, so fraud can be
//       undone without data loss;
//   (b) couples waiting 24h for a referral reward feels punitive;
//   (c) adding a hold means another state field + admin UI to
//       override. We can layer this in later without breaking the
//       current flow.

/**
 * Auto-qualify the referrer when the referred user creates their
 * FIRST event. Subsequent events from the same referred user are
 * no-ops (the qualification record already exists).
 *
 * @param referredUid  The new user who just created an event.
 * @param referrerUid  The user who referred them (from referredByUid).
 */
export async function qualifyReferrerOnFirstEvent(
  referredUid: string,
  referrerUid: string,
): Promise<{
  alreadyQualified: boolean;
  grantedStorage: boolean;
  grantedWatermark: boolean;
}> {
  // ---- Step 1: Try to create the qualification record. If it
  // already exists, this is a duplicate trigger fire (or a second
  // event from the same user). No-op and report. ----
  const qualRef = userRef(referrerUid)
    .collection('referralQualifications')
    .doc(referredUid);
  const qualSnap = await qualRef.get();
  if (qualSnap.exists) {
    return makeQualifiedOutcome(true, false, false);
  }

  // ---- Step 2: Atomic qualification write. Use create() (not set())
  // so a parallel trigger fire races safely — only one wins. ----
  try {
    await qualRef.create({
      referredUid,
      qualifiedAt: FieldValue.serverTimestamp(),
      // First event info is enriched in step 3 below.
    });
  } catch (e: any) {
    if (e?.code === 6 /* ALREADY_EXISTS */) {
      // Lost the race; another trigger instance already qualified.
      return makeQualifiedOutcome(true, false, false);
    }
    throw e;
  }

  // ---- Step 3: Enrich the qualification doc with event info
  // (best-effort; doesn't block the unlock). We do this AFTER the
  // conditional create so a partial failure doesn't lose the
  // qualification signal. ----
  //
  // Defensive check: if the user already had an event BEFORE this
  // trigger fired (e.g. they had events from before the trigger
  // shipped), don't re-bump qualifiedReferralCount. The pure
  // isFirstEvent() helper makes this testable in isolation.
  const eventsSnap = await userRef(referredUid)
    .collection('events')
    .orderBy('createdAt', 'asc')
    .limit(2)
    .get();
  const otherEventCount = eventsSnap.docs.length - 1; // -1 for the just-created event
  if (isFirstEvent(otherEventCount) && !eventsSnap.empty) {
    const firstEventDoc = eventsSnap.docs[0];
    await qualRef.set(
      {
        firstEventId: firstEventDoc.id,
        firstEventName: firstEventDoc.data().name || '',
        firstEventCreatedAt: firstEventDoc.data().createdAt || null,
      },
      { merge: true },
    );
  }

  // ---- Step 4: Bump referrer's qualifiedReferralCount atomically. ----
  // We use FieldValue.increment for safe concurrent updates. The
  // pure nextQualifiedCount() helper computes the expected value
  // for the legacy backfill path (in getMyReferralInfo) — same
  // semantics, different code path.
  await userRef(referrerUid).set(
    {
      qualifiedReferralCount: FieldValue.increment(1),
      lastReferralQualifiedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // ---- Step 5: Grant the two unlocks. grantUnlock is idempotent
  // on unlockType, so re-firing is safe. The {referredUid} extras
  // field records provenance for the audit trail. ----
  const storageResult = await grantUnlock(referrerUid, 'storage-500mb', 'referral', {
    referredUid,
  });
  const watermarkResult = await grantUnlock(referrerUid, 'watermark-removed', 'referral', {
    referredUid,
  });

  return makeQualifiedOutcome(
    false,
    !storageResult.alreadyGranted,
    !watermarkResult.alreadyGranted,
  );
}

/**
 * Firestore trigger: fires when a new event doc is created under any
 * user's events collection. Path:
 *   artifacts/{appId}/users/{referredUid}/events/{eventId}
 *
 * The trigger:
 *   - Reads the referred user's doc to find `referredByUid`.
 *   - If absent (the user wasn't referred), returns silently.
 *   - If present, calls qualifyReferrerOnFirstEvent().
 *
 * Path-scoping via the {appId} literal keeps the trigger attached to
 * the production app namespace only.
 */
export const onEventCreated = onDocumentCreated(
  {
    document: 'artifacts/savetheday-production/users/{referredUid}/events/{eventId}',
    region: 'us-central1',
    // No secrets needed; this trigger only writes to firestore.
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (event) => {
    const referredUid = String(event.params.referredUid);
    const eventId = String(event.params.eventId);
    console.log(`[onEventCreated] referredUid=${referredUid} eventId=${eventId}`);

    try {
      // Look up who referred this user. If they weren't referred,
      // referredByUid is missing — return silently.
      const userDoc = await userRef(referredUid).get();
      const userData = userDoc.data() || {};
      const referrerUid = userData.referredByUid as string | undefined;

      if (!referrerUid) {
        console.log(`[onEventCreated] referredUid=${referredUid} not referred; skipping.`);
        return;
      }
      if (referrerUid === referredUid) {
        // Self-referral (shouldn't happen — applyReferralAttribution
        // blocks it — but defensive).
        console.warn(`[onEventCreated] self-referral detected; uid=${referredUid}`);
        return;
      }

      const result = await qualifyReferrerOnFirstEvent(referredUid, referrerUid);
      console.log(
        `[onEventCreated] referredUid=${referredUid} referrerUid=${referrerUid} result=${JSON.stringify(result)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[onEventCreated] crash:`, msg);
      // Don't rethrow — trigger retry on transient errors is annoying
      // for this idempotent path. Log loudly so we see it in
      // Cloud Logging.
    }
  },
);