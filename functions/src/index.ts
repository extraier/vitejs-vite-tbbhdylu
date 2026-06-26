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
    const linkSnap = await findGuestLink(linkId);
    if (!linkSnap) throw new HttpsError('not-found', 'Invalid link.');

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

  const linkSnap = await findGuestLink(linkId);
  if (!linkSnap) throw new HttpsError('not-found', 'Invalid link.');
  if (linkSnap.data()!.ownerUid !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'Not your link.');
  }

  await linkSnap.ref.update({ revoked: true });
  return { ok: true };
});

// =============================================================================
// Helpers — 兄弟姊妹 permission system
// =============================================================================
//
// Unlike guests (who use single-use QR tokens), helpers register their own
// Firebase Auth account and sign in directly. The owner invites them by email,
// which creates a `helpers/{helperUid}` doc with their permissions. The rules
// engine then enforces per-tab access based on the perms flags.

import { getAuth } from 'firebase-admin/auth';

/**
 * findGuestLink — collectionGroup lookup by document ID.
 * Firestore's collectionGroup().doc() doesn't exist in the Admin SDK type
 * definitions (it's a known gap). We work around it by listing the group and
 * filtering by ID. Links are small (< 100 per wedding) so this is fine.
 */
async function findGuestLink(linkId: string) {
  const group = await db.collectionGroup('guestLinks').get();
  const match = group.docs.find((d) => d.id === linkId);
  return match ?? null;
}

// All possible helper permissions. Kept in sync with the client UI.
export const HELPER_PERMS = [
  'canScan',
  'canViewGuestList',
  'canViewBudget',
  'canViewChecklist',
  'canViewPhotos',
  'canUploadPhotos',
  'canEditGuests',
  'canViewGiftAmount',
] as const;

export type HelperPerm = (typeof HELPER_PERMS)[number];

export type HelperPerms = Record<HelperPerm, boolean>;

function defaultHelperPerms(): HelperPerms {
  return {
    canScan: false,
    canViewGuestList: false,
    canViewBudget: false,
    canViewChecklist: false,
    canViewPhotos: false,
    canUploadPhotos: false,
    canEditGuests: false,
    canViewGiftAmount: false,
  };
}

/**
 * inviteHelper — owner-only.
 * Looks up the Firebase Auth user by email, creates a helpers/{uid} doc.
 * The helper sees this doc when they next open the app (status='invited').
 * They can then call acceptHelperInvite to flip status to 'active'.
 *
 * If the email isn't registered yet, we still write a placeholder doc keyed
 * by email (not uid) — when the user later signs up with that email, the
 * client detects the placeholder and migrates it to a uid-keyed doc.
 */
export const inviteHelper = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { email, displayName, perms, phone } = req.data as {
    email: string;
    displayName: string;
    phone?: string;
    perms: Partial<HelperPerms>;
  };

  if (!email || !displayName) {
    throw new HttpsError('invalid-argument', 'email and displayName required.');
  }

  // Merge incoming perms with defaults (so missing flags are explicitly false).
  const mergedPerms = { ...defaultHelperPerms(), ...perms };

  const ownerUid = req.auth.uid;

  // Try to find an existing Firebase Auth user with this email.
  let helperUid: string | null = null;
  try {
    const userRecord = await getAuth().getUserByEmail(email);
    helperUid = userRecord.uid;
  } catch (err: unknown) {
    // User doesn't exist yet — that's OK, we'll write a placeholder.
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') {
      throw err;
    }
  }

  const helperDoc = {
    ownerUid,
    email,
    displayName,
    phone: phone ?? null,
    status: 'invited',
    perms: mergedPerms,
    invitedAt: FieldValue.serverTimestamp(),
    acceptedAt: null,
    revokedAt: null,
    invitedByUid: ownerUid,
    helperUid,  // null if user hasn't signed up yet
  };

  if (helperUid) {
    // User exists — write to helpers/{uid}.
    await db
      .collection('artifacts').doc()
      .collection('users').doc(ownerUid)
      .collection('helpers').doc(helperUid)
      .set(helperDoc);
  } else {
    // User not registered yet — write to a pendingInvites collection.
    // When they later sign up with this email, a client-side trigger
    // (or a Cloud Function onAuthCreate) migrates it.
    await db
      .collection('artifacts').doc()
      .collection('users').doc(ownerUid)
      .collection('pendingInvites').doc(email.toLowerCase())
      .set(helperDoc);
  }

  return { ok: true, helperUid, pendingEmailRegistration: !helperUid };
});

/**
 * acceptHelperInvite — called by the helper after signing in.
 * If the helper signed up using an email that has a pendingInvite, this
 * migrates it to helpers/{uid} and sets status='active'.
 */
export const acceptHelperInvite = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const authUid = req.auth.uid;
  const authEmail = req.auth.token.email?.toLowerCase();
  if (!authEmail) {
    throw new HttpsError('invalid-argument', 'Auth user has no email.');
  }

  // Find any owner who invited this email.
  const pending = await db
    .collectionGroup('pendingInvites')
    .where('email', '==', authEmail)
    .get();

  if (pending.empty) {
    throw new HttpsError('not-found', 'No invite found for this email.');
  }

  // Accept all matching invites (a helper could be invited by multiple couples).
  const batch = db.batch();
  const accepted: { ownerUid: string; perms: HelperPerms }[] = [];

  for (const doc of pending.docs) {
    const data = doc.data();
    const ownerUid = data.ownerUid;
    const newRef = db
      .collection('artifacts').doc()
      .collection('users').doc(ownerUid)
      .collection('helpers').doc(authUid);

    batch.set(newRef, {
      ...data,
      helperUid: authUid,
      status: 'active',
      acceptedAt: FieldValue.serverTimestamp(),
    });
    batch.delete(doc.ref);

    accepted.push({ ownerUid, perms: data.perms as HelperPerms });
  }

  await batch.commit();
  return { ok: true, accepted };
});

/**
 * revokeHelper — owner-only. Marks a helper's status as 'revoked'.
 * The helper can no longer access the owner's data (rules check status == 'active').
 */
export const revokeHelper = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { helperUid } = req.data as { helperUid: string };
  if (!helperUid) throw new HttpsError('invalid-argument', 'helperUid required.');

  const helperRef = db
    .collection('artifacts').doc()
    .collection('users').doc(req.auth.uid)
    .collection('helpers').doc(helperUid);

  const snap = await helperRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Helper not found.');

  await helperRef.update({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * updateHelperPerms — owner-only. Updates the perms on a helper's doc.
 * The helper sees the new perms on their next page refresh.
 */
export const updateHelperPerms = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { helperUid, perms } = req.data as {
    helperUid: string;
    perms: Partial<HelperPerms>;
  };

  if (!helperUid || !perms) {
    throw new HttpsError('invalid-argument', 'helperUid and perms required.');
  }

  // Validate all keys are valid perm names.
  for (const key of Object.keys(perms)) {
    if (!(HELPER_PERMS as readonly string[]).includes(key)) {
      throw new HttpsError('invalid-argument', `Unknown perm: ${key}`);
    }
  }

  const helperRef = db
    .collection('artifacts').doc()
    .collection('users').doc(req.auth.uid)
    .collection('helpers').doc(helperUid);

  const snap = await helperRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Helper not found.');

  // Merge into existing perms (don't unset flags the owner didn't touch).
  const currentPerms = snap.data()!.perms as HelperPerms;
  await helperRef.update({
    perms: { ...currentPerms, ...perms },
  });

  return { ok: true };
});
// ─── Admin Bootstrap ─────────────────────────────────────────────────────
//
// First-call: NO admin exists yet. Anyone signed in can call this once
// to grant themselves admin (bootstrap pattern — there's no way out of
// the chicken-and-egg problem otherwise).
//
// Subsequent calls: require the caller to already be admin. Admin can
// promote/demote any other user.
//
// Usage from the browser console while signed in:
//   const { getFunctions, httpsCallable } = await import('firebase/functions');
//   const fn = httpsCallable(getFunctions(), 'grantAdmin');
//   const r = await fn({ uid: 'TARGET_UID', admin: true });
//   console.log(r.data);
//
// To find a UID: Firebase Console → Authentication → Users → copy
// the "User UID" column for the row matching the email.

import { getAuth as getAdminAuth } from 'firebase-admin/auth';

export const grantAdmin = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const { uid, admin } = req.data as { uid?: string; admin?: boolean };
  if (!uid || typeof admin !== 'boolean') {
    throw new HttpsError('invalid-argument', 'uid (string) and admin (bool) required.');
  }
  if (uid === req.auth.uid) {
    throw new HttpsError('invalid-argument', 'Use setMyAdminSelf to self-promote.');
  }

  // Authorization: caller must already be admin.
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Only existing admins can grant admin.');
  }

  const auth = getAdminAuth();
  await auth.setCustomUserClaims(uid, { admin });
  await auth.revokeRefreshTokens(uid);
  return { ok: true, uid, admin };
});

// selfPromoteAdmin — bootstrap call when NO admin exists yet.
// Hard-gated: only works if there are currently zero admins in the
// project. Once any admin exists, this function refuses (use grantAdmin).
export const selfPromoteAdmin = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  const auth = getAdminAuth();
  // Check if any admin already exists.
  const list = await auth.listUsers(1000);
  const anyAdmin = list.users.some((u) => u.customClaims && (u.customClaims as { admin?: boolean }).admin === true);
  if (anyAdmin) {
    throw new HttpsError('already-exists', 'An admin already exists. Ask them to grant you admin via grantAdmin.');
  }

  await auth.setCustomUserClaims(req.auth.uid, { admin: true });
  await auth.revokeRefreshTokens(req.auth.uid);
  return { ok: true, uid: req.auth.uid, bootstrapped: true };
});
