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

// Restore 2026-07-02: re-export sendInvitations (defined in invitations.ts)
export * from './invitations';

// 2026-07-03: admin-only invitation template editor.
// The callable lives in ./templates.ts (updateTemplate) — re-exported
// here so `firebase deploy --only functions` picks it up automatically.
export * from './templates';

// 2026-07-11: vendor onboarding & self-service (applyAsVendor,
// updateMyVendorProfile, uploadVendorPortfolio). Lives in ./vendors.ts.
export * from './vendors';
// 2026-07-17: vendor ratings & reviews (submitRating, deleteMyRating,
// listVendorRatings). Lives in ./ratings.ts.
export * from './ratings';

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

// admin_listUsers — admin-only list of all Firebase Auth users with their
// custom claims. Used by the Admin Users panel to show a master list and
// toggle admin/disabled state. Paginated via `pageToken` (Firestore
// listUsers returns up to 1000 per page; default 50 for snappy UI).
export const admin_listUsers = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { pageToken, pageSize = 50 } = req.data as { pageToken?: string; pageSize?: number };
  const auth = getAdminAuth();
  // firebase-admin's listUsers() rejects undefined as pageToken with
  // "The page token must be a valid non-empty string." — pass undefined only
  // when the caller is paging past page 1.
  const result = pageToken
    ? await auth.listUsers(Math.min(Math.max(pageSize, 1), 1000), pageToken)
    : await auth.listUsers(Math.min(Math.max(pageSize, 1), 1000));

  const users = result.users.map((u) => ({
    uid: u.uid,
    email: u.email || null,
    emailVerified: u.emailVerified || false,
    disabled: u.disabled || false,
    displayName: u.displayName || null,
    photoURL: u.photoURL || null,
    providerData: (u.providerData || []).map((p) => ({
      providerId: p.providerId,
      email: p.email || null,
      displayName: p.displayName || null,
    })),
    customClaims: u.customClaims || null,
    creationTime: u.metadata.creationTime,
    lastSignInTime: u.metadata.lastSignInTime,
  }));

  return {
    users,
    nextPageToken: result.pageToken || null,
  };
});

// admin_setDisabled — admin-only enable/disable toggle for a user account.
// Mirrors `auth.updateUser(uid, { disabled })`. Does not delete the account.
export const admin_setDisabled = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { uid, disabled } = req.data as { uid?: string; disabled?: boolean };
  if (!uid || typeof disabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'uid (string) and disabled (bool) required.');
  }
  if (uid === req.auth.uid) {
    throw new HttpsError('failed-precondition', 'Cannot disable your own admin account here.');
  }
  const auth = getAdminAuth();
  await auth.updateUser(uid, { disabled });
  return { ok: true, uid, disabled };
});

// =============================================================================
// Admin Vendor Console — read / update / delete vendor docs in /vendors/{uid}.
// =============================================================================
//
// Vendor profiles live at /artifacts/{appId}/public/data/vendors/{vendorUid}
// (per the existing firestore.rules match). Each vendor doc is owned by the
// user whose uid is the doc id. Admins get read + update + delete via these
// three callables so the 🛍️ 商戶控制台 screen can manage the marketplace.
//
// IMPORTANT: the current vendor UI is fed from a hardcoded DEFAULT_VENDORS
// array in src/lib/config.ts — vendors shown to couples are NOT yet wired to
// Firestore. These functions still work against any vendor docs that exist
// (e.g. ones vendors self-create once they sign up), and they're ready for
// when the frontend gets migrated to read from Firestore.
//
// Auth model: all three endpoints require the caller to have the `admin`
// custom claim. We do NOT soft-delete — admin_deleteVendor is hard delete
// (the vendor's Firebase Auth account is left alone; use admin_setDisabled
// for that).

// Allowed edit keys on a vendor doc. Anything else is rejected so we don't
// leak through arbitrary fields (e.g. internal flags added later).
const VENDOR_EDITABLE_KEYS = [
  'name',
  'category',
  'subcategory',
  'rating',
  'price',
  'tags',
  'description',
  'portfolio',
  // 2026-07-11 — vendor onboarding (applyAsVendor) added these.
  // Admin can edit them on existing vendors too (e.g. to approve a
  // pending application by setting status: 'approved').
  'status',
  'yearsInBusiness',
  'serviceArea',
  'priceMin',
  'priceMax',
  'currency',
  'openEnded',
] as const;

function validateVendorEditable(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!(VENDOR_EDITABLE_KEYS as readonly string[]).includes(key)) {
      throw new HttpsError('invalid-argument', `Unknown vendor field: ${key}`);
    }
  }
  if ('rating' in payload) {
    const r = payload.rating;
    if (typeof r !== 'number' || r < 0 || r > 5) {
      throw new HttpsError('invalid-argument', 'rating must be a number 0..5.');
    }
  }
  if ('name' in payload && typeof payload.name !== 'string') {
    throw new HttpsError('invalid-argument', 'name must be a string.');
  }
  if ('category' in payload && typeof payload.category !== 'string') {
    throw new HttpsError('invalid-argument', 'category must be a string.');
  }
  if (
    'subcategory' in payload &&
    payload.subcategory !== null &&
    typeof payload.subcategory !== 'string'
  ) {
    // Allow string or null; admin may clear sub by setting null.
    throw new HttpsError('invalid-argument', 'subcategory must be a string or null.');
  }
  if ('status' in payload) {
    const validStatuses = ['pending', 'approved', 'rejected', 'suspended'];
    if (typeof payload.status !== 'string' || !validStatuses.includes(payload.status)) {
      throw new HttpsError(
        'invalid-argument',
        `status must be one of: ${validStatuses.join(', ')}.`,
      );
    }
  }
  if ('price' in payload && typeof payload.price !== 'string') {
    throw new HttpsError('invalid-argument', 'price must be a string.');
  }
  if ('description' in payload && typeof payload.description !== 'string') {
    throw new HttpsError('invalid-argument', 'description must be a string.');
  }
  for (const arrKey of ['tags', 'portfolio'] as const) {
    if (arrKey in payload) {
      const v = payload[arrKey];
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
        throw new HttpsError('invalid-argument', `${arrKey} must be string[].`);
      }
    }
  }
}

/**
 * admin_listVendors — paginated list of vendor profiles (admin only).
 * Mirrors admin_listUsers' pagination shape (pageToken + pageSize).
 * Joins each vendor's email via Firebase Auth when the vendorUid exists
 * as an auth user; returns null otherwise (the vendor may have been
 * deleted from auth while their vendor doc lingers).
 */
export const admin_listVendors = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  const { pageSize = 50, pageToken } = req.data as {
    pageSize?: number;
    pageToken?: string;
  };

  // Vendors are not under artifacts/{appId} — they're flat at /vendors/{uid}
  // per firestore.rules. listDocuments() enumerates WITHOUT reading, so it
  // succeeds on missing collections (unlike .get() which throws).
  let docRefs: FirebaseFirestore.DocumentReference[];
  try {
    docRefs = await db.collection('vendors').listDocuments();
  } catch (err: unknown) {
    // Even listDocuments can theoretically fail (e.g. IAM); surface cleanly.
    throw new HttpsError('internal', `Vendor enumerate failed: ${(err as Error).message}`);
  }

  // Sort for deterministic pagination, then fetch snapshots in parallel.
  docRefs.sort((a, b) => a.id.localeCompare(b.id));
  const start = pageToken ? Math.max(0, docRefs.findIndex((d) => d.id === pageToken) + 1) : 0;
  const end = Math.min(docRefs.length, start + Math.min(Math.max(pageSize, 1), 200));
  const slice = docRefs.slice(start, end);
  const nextPageToken = end < docRefs.length ? docRefs[end - 1].id : null;

  const snaps = await Promise.all(slice.map((d) => d.get()));
  const auth = getAdminAuth();
  const vendors = await Promise.all(
    snaps.map(async (snap) => {
      const data = snap.data() || {};
      let email: string | null = null;
      let disabled = false;
      try {
        const u = await auth.getUser(snap.id);
        email = u.email || null;
        disabled = !!u.disabled;
      } catch {
        // Auth user gone — leave email null, disabled unknown.
      }
      return {
        vendorUid: snap.id,
        name: typeof data.name === 'string' ? data.name : null,
        category: typeof data.category === 'string' ? data.category : null,
        rating: typeof data.rating === 'number' ? data.rating : null,
        price: typeof data.price === 'string' ? data.price : null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: typeof data.description === 'string' ? data.description : null,
        portfolio: Array.isArray(data.portfolio) ? data.portfolio : [],
        // 2026-07-11 — vendor onboarding (applyAsVendor) writes these.
        // Pre-onboarding vendor docs don't have status/years/area; treat as
        // null so the UI can show a sensible "未提交申請" badge.
        status: typeof data.status === 'string' ? data.status : null,
        yearsInBusiness: typeof data.yearsInBusiness === 'number' ? data.yearsInBusiness : null,
        serviceArea: typeof data.serviceArea === 'string' ? data.serviceArea : null,
        email,
        authDisabled: disabled,
        updatedAt: data.updatedAt || null,
        createdAt: data.createdAt || null,
      };
    }),
  );

  return { vendors, nextPageToken, total: docRefs.length };
});

/**
 * admin_updateVendor — admin-only. Patches whitelisted fields on a vendor doc.
 * Rejects unknown keys so the frontend can't widen the surface.
 */
export const admin_updateVendor = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  const { vendorUid, updates } = req.data as {
    vendorUid?: string;
    updates?: Record<string, unknown>;
  };
  if (!vendorUid || !updates) {
    throw new HttpsError('invalid-argument', 'vendorUid and updates required.');
  }
  validateVendorEditable(updates);

  const ref = db.collection('vendors').doc(vendorUid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Vendor not found.');
  }

  await ref.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: req.auth.uid,
  });

  return { ok: true, vendorUid };
});

/**
 * admin_deleteVendor — admin-only. Hard-deletes a vendor doc.
 * The vendor's Firebase Auth account is NOT touched (use admin_setDisabled
 * to also kill their login ability — a separate action by design).
 */
export const admin_deleteVendor = onCall(async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const callerClaims = (req.auth.token as { admin?: boolean }) || {};
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  const { vendorUid } = req.data as { vendorUid?: string };
  if (!vendorUid) {
    throw new HttpsError('invalid-argument', 'vendorUid required.');
  }

  const ref = db.collection('vendors').doc(vendorUid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Vendor not found.');
  }

  await ref.delete();
  return { ok: true, vendorUid };
});
