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

// 2026-07-18 — Cloud functions were reading/writing under
// `.collection('artifacts').doc(appId)` (random doc ID). Every Firestore
// read+write from the client SDK goes to
// `.doc('savetheday-production')`. So the functions were creating
// docs in a parallel, isolated namespace that no client could
// ever see. Fix: every CF that touches /artifacts must hard-code
// `appId = 'savetheday-production'` (matching the constant in the
// front-end lib/firebase.ts) so the function writes land where
// the client reads. Without this, `inviteHelper`, `acceptHelperInvite`,
// issueGuestLink, redeemGuestLink, vendor profile sync, etc.
// silently fail to land data the user can see.
const appId = 'savetheday-production';

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
  { secrets: [HMAC_KEY], cors: true, region: "us-central1" },
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
      .collection('artifacts').doc(appId) // any appId
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
  { secrets: [HMAC_KEY], cors: true, region: "us-central1" },
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
      .collection('artifacts').doc(appId)
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
export const revokeGuestLink = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const inviteHelper = onCall({ cors: true, region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { email, displayName, perms, phone, eventId } = req.data as {
    email: string;
    displayName: string;
    phone?: string;
    perms: Partial<HelperPerms>;
    // 2026-08-15 — Vendor and Helper Onboarding & Assignment
    // Architecture Audit (P0-B). eventId is required: every
    // helper invitation must scope to a specific wedding so
    // the Helper Dashboard's event-scoped queries can find
    // the assigned work. Without eventId the helper lands in
    // an empty workspace after accepting.
    eventId: string;
  };

  if (!email || !displayName) {
    throw new HttpsError('invalid-argument', 'email and displayName required.');
  }

  // 2026-08-15 — Helper onboarding audit (P0-B). Require eventId
  // on every invite. The dashboard's per-event queries would
  // silently no-op without it. Validate ownership too so a
  // malicious client can't invite helpers into another owner's
  // event.
  if (!eventId || typeof eventId !== 'string') {
    throw new HttpsError('invalid-argument', 'eventId required. Pick a current wedding first.');
  }
  const eventRef = db
    .collection('artifacts').doc(appId)
    .collection('users').doc(req.auth.uid)
    .collection('events').doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', 'Event not found or not owned by caller.');
  }
  const eventName = (eventSnap.data()?.name as string | undefined) || '';

  // Merge incoming perms with defaults (so missing flags are explicitly false).
  const mergedPerms = { ...defaultHelperPerms(), ...perms };

  const ownerUid = req.auth.uid;

  // Try to find an existing Firebase Auth user with this email.
  let helperUid: string | null = null;
  try {
    const userRecord = await getAuth().getUserByEmail(email);
    helperUid = userRecord.uid;
  } catch (err: unknown) {
    // User not registered yet — write to a placeholder.
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') {
      throw err;
    }
  }

  const helperDoc = {
    ownerUid,
    // 2026-08-15 — Helper onboarding audit (P0-B). Stash eventId
    // + eventName on every helper doc. acceptHelperInvite copies
    // these through to the helpers/{uid} collection via the
    // `...data` spread, so the active assignment has them too.
    eventId,
    eventName,
    // 2026-08-15 — Helper onboarding audit (P1 — pendingInvites
    // collision). Stamp `kind: 'helper'` so acceptHelperInvite's
    // collection-group scan can filter out vendor pending invites
    // that share the same generic collection name. Vendors stamp
    // `kind: 'vendor'` (or remain unset for legacy records). The
    // acceptance path requires `kind == 'helper'`.
    kind: 'helper' as const,
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
      .collection('artifacts').doc(appId)
      .collection('users').doc(ownerUid)
      .collection('helpers').doc(helperUid)
      .set(helperDoc);
  } else {
    // User not registered yet — write to a pendingInvites collection.
    // When they later sign up with this email, a client-side trigger
    // (or a Cloud Function onAuthCreate) migrates it.
    await db
      .collection('artifacts').doc(appId)
      .collection('users').doc(ownerUid)
      .collection('pendingInvites').doc(email.toLowerCase())
      .set(helperDoc);
  }

  // 2026-07-18 — Note on email delivery. We intentionally do NOT
  // generate the email magic link from the cloud function for two
  // reasons:
  //   1. `getAuth().generateSignInWithEmailLink()` returns a deep
  //      link but does NOT auto-send email. Sending requires either
  //      a third-party email provider (SendGrid/Resend) or the
  //      client-side `sendSignInLinkToEmail()` which auto-delivers
  //      through Firebase's built-in templates.
  //   2. Calling sendSignInLinkToEmail from a CF requires admin
  //      SDK's `sendCustomEmailVerification` or building our own
  //      SMTP — out of scope for this fix.
  // The actual email delivery happens client-side right after this
  // CF returns — see `handleInvite` in HelperManager.jsx.

  return {
    ok: true,
    helperUid,
    pendingEmailRegistration: !helperUid,
  };
});

/**
 * acceptHelperInvite — called by the helper after signing in.
 * If the helper signed up using an email that has a pendingInvite, this
 * migrates it to helpers/{uid} and sets status='active'.
 */
export const acceptHelperInvite = onCall({ cors: true, region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const authUid = req.auth.uid;
  const authEmail = req.auth.token.email?.toLowerCase();
  if (!authEmail) {
    throw new HttpsError('invalid-argument', 'Auth user has no email.');
  }

  // Find any owner who invited this email.
  //
  // 2026-08-15 — Helper onboarding audit (P1 — pendingInvites
  // collision). The collection-group scan used to match every
  // document named `pendingInvites` by email — including vendor
  // outreach invitations at /vendors/{slug}/pendingInvites.
  // A same-email vendor invite would be picked up here, fail to
  // construct a valid helper doc path, and either 500 or
  // silently corrupt the helper doc. Two safeguards:
  //   1. Filter by `kind == 'helper'` (vendor invites either
  //      stamp `kind: 'vendor'` or remain unset; either way
  //      excluded).
  //   2. Defensive: skip docs that lack the required helper
  //      shape (ownerUid, perms, eventId) so legacy records
  //      without `kind` still don't poison acceptance.
  const pending = await db
    .collectionGroup('pendingInvites')
    .where('email', '==', authEmail)
    .where('kind', '==', 'helper')
    .get();

  if (pending.empty) {
    // Fall back to the legacy lookup (no kind field on old
    // docs) — but only if there's at least one matching
    // document that ALSO has the helper-shaped fields.
    const legacy = await db
      .collectionGroup('pendingInvites')
      .where('email', '==', authEmail)
      .get();
    const legacyHelpers = legacy.docs.filter((d) => {
      const x = d.data();
      return (
        x &&
        typeof x.ownerUid === 'string' &&
        x.perms &&
        typeof x.eventId === 'string' &&
        x.kind !== 'vendor' // exclude explicit vendor invites
      );
    });
    if (legacyHelpers.length === 0) {
      throw new HttpsError('not-found', 'No helper invite found for this email.');
    }
    return acceptHelperDocs(legacyHelpers, authUid);
  }

  return acceptHelperDocs(pending.docs, authUid);
});

// Shared acceptance body — extracted so the kind-filtered and
// legacy paths share the same migration logic. (2026-08-15)
async function acceptHelperDocs(
  pendingDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  authUid: string,
) {
  // Accept all matching invites (a helper could be invited by multiple couples).
  const batch = db.batch();
  const accepted: { ownerUid: string; perms: HelperPerms; eventId: string }[] = [];

  for (const doc of pendingDocs) {
    const data = doc.data();
    const ownerUid = data.ownerUid;
    const newRef = db
      .collection('artifacts').doc(appId)
      .collection('users').doc(ownerUid)
      .collection('helpers').doc(authUid);

    batch.set(newRef, {
      ...data,
      helperUid: authUid,
      status: 'active',
      acceptedAt: FieldValue.serverTimestamp(),
    });
    batch.delete(doc.ref);

    accepted.push({
      ownerUid,
      perms: data.perms as HelperPerms,
      eventId: data.eventId as string,
    });
  }

  await batch.commit();
  return { ok: true, accepted };
}

/**
 * revokeHelper — owner-only. Marks a helper's status as 'revoked'.
 * The helper can no longer access the owner's data (rules check status == 'active').
 */
export const revokeHelper = onCall({ cors: true, region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { helperUid } = req.data as { helperUid: string };
  if (!helperUid) throw new HttpsError('invalid-argument', 'helperUid required.');

  const helperRef = db
    .collection('artifacts').doc(appId)
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
export const updateHelperPerms = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
    .collection('artifacts').doc(appId)
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
/**
 * linkVendorContact — owner-only. Re-stamps `linkedVendorUid` on a
 * vendorContact whose catalog link was previously erased (e.g. the
 * 2026-08-09 incident where `handleAddVendorContact` defaulted
 * `linkedVendorUid` to null instead of preserving the picked
 * vendor's id). Same validation as a fresh link: the vendor doc
 * must exist at `/vendors/{vendorUid}`. The owner can also pass
 * `dryRun: true` to preview which vendor would be linked without
 * writing — useful for a "重新連結商戶" UI control that lets the
 * couple confirm before stamping.
 *
 * Audit fields stamped on write:
 *   linkedVendorUid   — the vendor's uid (slug)
 *   invitationAccepted — true (the link is restored)
 *   linkedAt          — server timestamp
 *   linkSource        — 'manual-relink' (vs 'catalog-pick' for fresh adds)
 */
export const linkVendorContact = onCall({ cors: true, region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { contactId, vendorUid, dryRun } = req.data as {
    contactId: string;
    vendorUid: string;
    dryRun?: boolean;
  };

  if (!contactId || !vendorUid) {
    throw new HttpsError('invalid-argument', 'contactId and vendorUid required.');
  }

  const ownerUid = req.auth.uid;

  // Validate ownership of the contact. Path-bound ownerUid matches
  // the caller for owner-scoped reads (rules check `isOwner(ownerUid)`).
  const contactRef = db
    .collection('artifacts').doc(appId)
    .collection('users').doc(ownerUid)
    .collection('vendorContacts').doc(contactId);

  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) {
    throw new HttpsError('not-found', 'Contact not found.');
  }
  const contactData = contactSnap.data()!;

  // Validate the vendor exists at /vendors/{vendorUid}. The
  // vendor directory is publicly readable so this is a cheap
  // existence check.
  const vendorRef = db.collection('vendors').doc(vendorUid);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) {
    throw new HttpsError('not-found', `Vendor ${vendorUid} not found in directory.`);
  }
  const vendorData = vendorSnap.data()!;

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      wouldLink: {
        contactId,
        vendorUid,
        vendorName: vendorData.name || vendorUid,
        vendorCategory: vendorData.category || '',
        currentLinkedVendorUid: contactData.linkedVendorUid || null,
      },
    };
  }

  await contactRef.update({
    linkedVendorUid: vendorUid,
    invitationAccepted: true,
    linkedAt: FieldValue.serverTimestamp(),
    linkSource: 'manual-relink',
    // 2026-08-15 — also stamp vendorName from the directory
    // doc so the contact card shows the canonical name (in
    // case the contact's local vendorName had been hand-edited
    // or stale). Don't overwrite the contact's own notes.
    vendorName: vendorData.name || contactData.vendorName || vendorUid,
  });

  return {
    ok: true,
    linked: {
      contactId,
      vendorUid,
      vendorName: vendorData.name || vendorUid,
      vendorCategory: vendorData.category || '',
    },
  };
});

/**
 * searchVendorsByName — owner-only. Lightweight lookup against the
 * `/vendors` directory for the "重新連結商戶" picker. Filters by
 * case-insensitive substring on `name` and optional `category`.
 * Caps results at 20 to keep payloads small; the UI does the
 * rest of the matching.
 */
export const searchVendorsByName = onCall({ cors: true, region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { name, category, limit } = req.data as {
    name?: string;
    category?: string;
    limit?: number;
  };

  const cap = Math.min(Number(limit) || 20, 50);

  // /vendors is publicly readable; no per-owner filter needed.
  let q = db.collection('vendors').limit(cap);
  if (category && typeof category === 'string') {
    q = q.where('category', '==', category);
  }
  const snap = await q.get();

  // Filter by case-insensitive substring on name. Firestore
  // doesn't support `contains` natively without a 3rd-party
  // search service, so we filter in-memory after the category
  // query (which is index-supported). Cap stays on the
  // post-filter set.
  const needle = String(name || '').trim().toLowerCase();
  const hits = snap.docs
    .filter((d) => {
      if (!needle) return true;
      const n = (d.data().name || '').toLowerCase();
      return n.includes(needle);
    })
    .slice(0, cap)
    .map((d) => {
      const v = d.data();
      return {
        uid: d.id,
        name: v.name || d.id,
        category: v.category || '',
        serviceAreaCity: v.serviceAreaCity || '',
      };
    });

  return { ok: true, hits };
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

// 2026-08-23 — Manus P2a: server-authoritative guestExperience
// callables. See ./guestExperience.ts for the four callables
// (publishGuestExperience, getGuestPortalBootstrap, respondToRsvp,
// saveGuestMessage). Pure helpers live in ./guestExperience.pure.ts
// and are unit-tested in ./test/guestExperience.pure.test.ts.
export {
  publishGuestExperience,
  getGuestPortalBootstrap,
  respondToRsvp,
  saveGuestMessage,
} from './guestExperience';

// 2026-08-23 — Manus P2c: confirmRedPacket callable. PDF §3.3:
// "Do not retain the direct handleGiveRedPacket write: map its
// successful payment confirmation to a new server callable that
// verifies the same guest link and creates a payment/audit record."
// Pure helpers live in ./redPacket.pure.ts (amount validation +
// audit-record shape).
export { confirmRedPacket } from './redPacket';

// 2026-07-18: helper invite SMTP email (Traditional-Chinese rich HTML).
// The callable lives in ./helpersMail.ts — re-exported here so
// `firebase deploy --only functions` picks it up automatically. The
// front-end calls sendHelperInviteEmail right after inviteHelper when
// pendingEmailRegistration === true, falling back to the client-side
// sendSignInLinkToEmail path if this callable throws.
export * from './helpersMail';

// 2026-07-03: admin-only invitation template editor.
// The callable lives in ./templates.ts (updateTemplate) — re-exported
// here so `firebase deploy --only functions` picks it up automatically.
export * from './templates';

// 2026-07-11: vendor onboarding & self-service (applyAsVendor,
// updateMyVendorProfile, uploadVendorPortfolio). Lives in ./vendors.ts.
export * from './vendors';
// 2026-08-01: per-event owner names (boyName / girlName on
// users/{uid}/events/{eventId}). Recreated from deployed bytecode
// — see functions/src/userProfile.ts. CF also accepts co-owners
// so the partner can edit the couple's display names on shared
// events.
export * from './userProfile';
// 2026-07-17: vendor ratings & reviews (submitRating, deleteMyRating,
// listVendorRatings). Lives in ./ratings.ts.
export * from './ratings';
// 2026-07-20: vendor popularity aggregation trigger + daily
// scheduled sweep. Maintains /vendors/{uid}.popularity.{24h,7d,30d,
// total} counters so couples can browse the 商戶指南 without
// loading every /vendorImageViews row.
export * from './vendorAnalytics';
export * from './cron/archiveJob';

export const grantAdmin = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const selfPromoteAdmin = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const admin_listUsers = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const admin_setDisabled = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const admin_listVendors = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
        // 2026-07-20 — vendor activation flow: surfaced to admin UI so
        // each row can render a status pill + activation buttons.
        signupStatus: typeof data.signupStatus === 'string' ? data.signupStatus : 'uninvited',
        invitationExpiresAt: data.invitationExpiresAt || null,
        claimedByUid: typeof data.claimedByUid === 'string' ? data.claimedByUid : null,
        claimedAt: data.claimedAt || null,
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
 * adminUpdateVendor — admin-only. Patches whitelisted fields on a vendor doc.
 * Rejects unknown keys so the frontend can't widen the surface.
 *
 * 2026-07-17 — Renamed from `admin_updateVendor` because the original
 * Cloud Functions gen2 function entry got stuck in a stale Cloud Run
 * service that wouldn't pick up the cors: true option we added. The
 * fresh name avoids every cached binding. The front-end now calls
 * `adminUpdateVendor` (camelCase). The old function name continues
 * to exist in the cloud (until we delete it cleanly) but is no
 * longer referenced from code.
 */
export const adminUpdateVendor = onCall({ cors: true, region: "us-central1" }, async (req) => {
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
export const admin_deleteVendor = onCall({ cors: true, region: "us-central1" }, async (req) => {
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

// 2026-07-20 — vendor activation flow: admin-only invitation tokens,
// public claim-on-signup path, and invite-email sender. See
// functions/src/vendorActivation.ts for the module header.

export {
  activateSeededVendor,
  claimSeededVendor,
  claimAndApplyAsVendor,
  sendVendorInviteEmail,
  bulkActivateSeededVendors,
} from './vendorActivation';

// 2026-07-21 — Couple-initiated vendor invite flow. When a couple
// submits an email for a not-onboarded vendor via
// NotOnboardedEmailModal, we write /vendors/{slug}/pendingInvites
// and these triggers fire automatically — no couple-side Cloud
// Function call needed. Couples get the email experience they
// expect (just submit and forget) while admin gets full audit
// trail + manual retry via adminRetryVendorInvite.
export {
  onPendingInviteCreated,
  onPendingInviteUpdated,
  adminRetryVendorInvite,
} from './vendorInviteTrigger';
export {
  submitSocialProof,
  adminVerifySocialProof,
  claimReferral,
  adminVerifyReferral,
  submitPaymentReceipt,
  adminVerifyPayment,
  grantUnlock,
  UNLOCK_PRICING,
  UNLOCK_TYPES,
} from './unlocks';

// 2026-07-23 — public job board callable. Couples post 徵求報價
// requests through here because the direct Firestore path is
// blocked by the catch-all deny (see functions/src/jobBoard.ts
// for the full rationale).
//
// 2026-08-08 — added submitProposal (vendors reply to a job) and
// _listProposalsForJob (couple-side read; future-proofing). See
// functions/src/jobBoard.ts for the full rationale on why these
// go through a CF instead of direct Firestore.
export { postJobRequest, submitProposal, listProposalsForJob } from './jobBoard';

// 2026-07-26 — Co-owners (couples / partners). The sendPartnerInviteV2
// callable sends a magic-link email to a partner; redeemPartnerInviteV2
// is what they call after signing in to finalize the join. removePartnerV2
// revokes a co-owner's access (owner-only). V2 suffix bypasses a
// stuck Cloud Run 409 on the original names; see partnerInvite.ts.
//
// 2026-07-27 — listPartnerInvites returns the invite history
// (which emails were sent, per-event, with derived accept status:
// pending / accepted / expired). Owner-only. Used by the
// InvitePartnerModal and the dashboard card.
export {
  sendPartnerInviteV2,
  redeemPartnerInviteV2,
  previewPartnerInvite,
  removePartnerV2,
  listPartnerInvites,
} from './partnerInvite';

// 2026-07-27 — Server-side QR upload + delete for 電子人情. See
// ./redPackets.ts for why client-side Storage rules + firestore.exists()
// turned out to be unreliable for coOwner writes. These functions verify
// the caller via the Admin SDK and use Admin SDK writes that bypass
// storage.rules + firestore.rules entirely.
export {
  uploadRedPacketV2,
  deleteRedPacketV2,
} from './redPackets';

// 2026-07-29 — Referral code plumbing. onUserCreate auto-mints a
// referralCode on every new Firebase Auth user. applyReferralAttribution
// is called from the front-end during signup when the user landed on
// `?ref=STD-XXXXX`. getMyReferralInfo powers the share UI in
// ReferralModal.tsx (Phase 2). requestReferralClaim is the
// auto-grant path — the referrer provides a friend's email and we
// grant the storage-500mb unlock without admin involvement.
export {
  // 2026-08-15 — onUserCreate removed. It used a blocking auth
  // trigger which can't deploy on standard Firebase projects.
  // The same code-minting logic lives as a fallback in
  // getMyReferralInfo.
  applyReferralAttribution,
  getMyReferralInfo,
  requestReferralClaim,
  // Firestore trigger that auto-qualifies the referrer the
  // moment a referred user creates their first event.
  onEventCreated,
} from './referralCodes';

// 2026-07-29 — listSocialProofs for SocialProofModal history tab.
// Pure read of /users/{uid}/socialProofs for the owner; no unlock
// side effects so it stays co-located with the social-proof callables.
export { listSocialProofs } from './unlocks';

// 2026-07-31 — Branded Auth verification email. Firebase Auth's
// default English template is functional but off-brand for our
// bilingual (HK Cantonese primary) audience. This callable builds
// the verification link via the Admin SDK, then ships a branded HTML
// email through SendGrid. Front-end calls this instead of
// user.sendEmailVerification(). The Firebase-side default template
// stays as a fallback for anyone using the SDK directly.
export { sendBrandedVerificationV2 } from './brandedEmail';

// 2026-08-02 — Owner upload-preferences token. The owner calls
// this from their session to mint a short-lived HMAC-signed token
// that says "my wedding should NOT be watermarked" (when they
// have the `watermark-removed` unlock). The token is sent with
// every photo upload (owner's + guests') and verified by the
// Vercel /api/photo-upload proxy, which forwards the
// watermark-disabled signal to the NAS photo_upload_server.py.
// This is what makes the RewardsBanner's "+500MB + 移除浮水印"
// promise actually true end-to-end — the watermark is applied
// on the NAS during the upload itself, not in Firebase.
export {
  getUploadPreferencesToken,
  recordUploadBytesUsed,
} from './uploadPreferencesToken';

// 2026-08-05 — Photo-delete authorization token. Mirrors the
// getUploadPreferencesToken shape: the client calls this CF,
// the CF verifies the caller is allowed to delete the photo
// (owner / co-owner / uploader), and returns an HMAC-signed
// token bound to that specific photo. The Vercel
// /api/photo-delete proxy verifies the token (using the
// mirrored HMAC_KEY env) and forwards a signed DELETE to the
// NAS, which deletes the file. See functions/src/photoDeleteToken.ts
// for the auth rules; see deploy/photo_upload_server.py
// _handle_delete_path for the NAS receiver.
export { mintPhotoDeleteToken } from './photoDeleteToken';

// 2026-08-12 — Vendor-side comment write via Cloud Function.
// Vendor/helper chat writes have been silently failing on the
// vendor's Incognito tab despite the live rules verifying OK on
// REST probes. Rather than chase the rules-engine quirk
// further, this gives the browser a server-side path that
// verifies caller authorization via Admin SDK and writes the
// comment via Admin SDK (rules always allow admin writes). The
// vendor's existing onSnapshot subscribe picks up the new doc
// on the next tick, no UI changes required. See
// functions/src/vendorComment.ts for the auth + write shape.
export { vendorPostComment, vendorPostCommentHelper } from './vendorComment';
export { onBigDayCommentCreated } from './commentAlertTrigger';
// 2026-08-31 — Manus P11: helper-assignment and task-status
// alert triggers. See functions/src/helperAssignmentTrigger.ts
// and functions/src/taskStatusTrigger.ts for the full design
// notes. Both triggers fan out private inbox notifications to
// the assigned helper on writes to the relevant event-scoped
// collections.
export {
  onRundownAssignedItemWritten,
  onResourcesAssignedItemWritten,
} from './helperAssignmentTrigger';
export { onTaskStatusWritten } from './taskStatusTrigger';

// 2026-08-13 — H-03 audit follow-up. Backfills the `vendor: true`
// custom claim for every existing /vendors/{authUid} doc whose
// user lacks it. The H-03 root-cause fix (commit before) routes
// new vendors through `setVendorClaim`, but vendors created
// before that fix have docs but no claim — this CF repairs them.
//
// Caller must have the `admin` custom claim. Accepts:
//   { dryRun?: boolean, limit?: number, startAfter?: string }
// Returns:
//   { scanned, flipped, skipped, errors, dryRun, nextStartAfter }
//
// Idempotent by design — re-running is safe. The chokepoint
// (vendors.ts#setVendorClaim) preserves existing claims
// (admin, helper, etc.), so a user who already has the claim
// is reported as `skipped` with no writes.
export const admin_backfillVendorClaims = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const callerClaims = (req.auth.token as { admin?: boolean }) || {};
    if (!callerClaims.admin) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const data = (req.data || {}) as {
      dryRun?: boolean;
      limit?: number;
      startAfter?: string;
    };
    const dryRun = data.dryRun !== false; // default true
    const limit = Math.min(Math.max(data.limit ?? 200, 1), 1000);

    const db = getFirestore();
    const auth = getAdminAuth();
    const { setVendorClaim } = await import('./vendors');

    let query = db.collection('vendors').orderBy('__name__').limit(limit);
    if (data.startAfter) {
      query = query.startAfter(data.startAfter);
    }
    const snap = await query.get();

    let scanned = 0;
    let flipped = 0;
    let skipped = 0;
    const errors: Array<{ slug: string; error: string }> = [];

    for (const doc of snap.docs) {
      scanned += 1;
      const slug = doc.id;
      const data = doc.data() as {
        vendorUid?: string;
        ownerUid?: string;
        signupStatus?: string;
      };

      // Only backfill claimants — seeded but unclaimed entries
      // have no auth uid to grant the claim to.
      const authUid = data.vendorUid || data.ownerUid;
      if (!authUid || data.signupStatus !== 'claimed') {
        skipped += 1;
        continue;
      }

      try {
        const user = await auth.getUser(authUid);
        const claims = (user.customClaims || {}) as { vendor?: boolean };
        if (claims.vendor === true) {
          skipped += 1;
          continue;
        }

        if (dryRun) {
          // Pretend we flipped it for the counter, but make no writes.
          flipped += 1;
        } else {
          await setVendorClaim(authUid, true);
          flipped += 1;
        }
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        errors.push({ slug, error: msg });
      }
    }

    const nextStartAfter =
      snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;

    return {
      scanned,
      flipped,
      skipped,
      errors,
      dryRun,
      nextStartAfter,
    };
  },
);

// 2026-08-19 — Manus P1.2: single canonical event-scoped
// entitlement resolver. Replaces the tier-flag / unlocks.* mix
// with one server-authored object that the client, invitation
// editor, upload token issuer, and (future) archive job all
// consume. See functions/src/entitlementResolver.ts for the
// data contract.
//
// Also bundles listPaymentReceipts so the customer payment-
// status view (P1.1) has a single fetch.
export {
  getEventEntitlement,
  listPaymentReceipts,
  computeEntitlement,
} from './entitlementResolver';
