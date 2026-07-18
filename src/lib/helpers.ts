// Helpers (兄弟姊妹) — client-side helpers for the permission system.
//
// A helper is a registered Firebase Auth user (Google or email/password)
// who has been invited by an owner. Their perms live in a Firestore doc at
//   users/{ownerUid}/helpers/{auth.uid}
// The client uses these helpers to:
//   - detect whether the current user is a helper
//   - look up their perms
//   - call the Cloud Functions to invite / revoke / accept invites

import { doc, getDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { db, appId } from './firebase';

// All possible helper permissions. Kept in sync with functions/src/index.ts
// and firestore.rules. The order here is the display order in HelperManager.
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

// Chinese labels for the permission matrix UI
export const HELPER_PERM_LABELS: Record<HelperPerm, string> = {
  canScan: '掃描 QR Code',
  canViewGuestList: '查閱名單',
  canViewBudget: '查閱預算',
  canViewChecklist: '查閱籌備清單',
  canViewPhotos: '查閱相片牆',
  canUploadPhotos: '上載相片',
  canEditGuests: '編輯賓客資料',
  canViewGiftAmount: '查閱人情金額',
};

export function defaultHelperPerms(): HelperPerms {
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

// ---- Permission lookup ----------------------------------------------------

/**
 * Read the current user's helper doc for a given owner. Returns null if
 * they're not a helper. The rules enforce that helpers can only read their
 * own doc, so this just calls getDoc on the expected path.
 */
export async function loadHelperDoc(ownerUid: string, helperUid: string): Promise<HelperDoc | null> {
  const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'helpers', helperUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as HelperDoc;
}

export type HelperDoc = {
  id: string;
  ownerUid: string;
  email: string;
  displayName: string;
  phone: string | null;
  status: 'invited' | 'active' | 'revoked';
  perms: HelperPerms;
  invitedAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  helperUid: string | null;
};

/**
 * Find all owners who have invited the current user as a helper.
 * Used after the helper signs in so they know which weddings they can access.
 */
export async function listMyHelperAssignments(): Promise<HelperDoc[]> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user || !user.email) return [];
  const myEmail = user.email.toLowerCase();

  // Look in pendingInvites (if helper signed up after being invited by email)
  const pendingQ = query(
    collectionGroup(db, 'pendingInvites'),
    where('email', '==', myEmail),
  );
  const pendingSnap = await getDocs(pendingQ);
  const fromPending: HelperDoc[] = pendingSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<HelperDoc, 'id'>),
  }));

  // Look in helpers/{myUid} for active assignments (by walking the user's
  // known owner scopes — we don't know them in advance, so we use a
  // collectionGroup query restricted to this user).
  // Note: rules allow helper to read their own helpers/{uid} doc only.
  const helpersQ = query(
    collectionGroup(db, 'helpers'),
    where('helperUid', '==', user.uid),
  );
  const helpersSnap = await getDocs(helpersQ);
  const fromHelpers: HelperDoc[] = helpersSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<HelperDoc, 'id'>) }))
    .filter((h) => h.status === 'active');

  return [...fromPending, ...fromHelpers];
}

// ---- Cloud Function wrappers ---------------------------------------------

async function inviteHelperFn(args: {
  email: string;
  displayName: string;
  phone?: string;
  perms: Partial<HelperPerms>;
}) {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'inviteHelper');
  const res = await fn(args);
  return res.data as { ok: boolean; helperUid: string | null; pendingEmailRegistration: boolean };
}

async function revokeHelperFn(args: { helperUid: string }) {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'revokeHelper');
  const res = await fn(args);
  return res.data as { ok: boolean };
}

async function updateHelperPermsFn(args: { helperUid: string; perms: Partial<HelperPerms> }) {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'updateHelperPerms');
  const res = await fn(args);
  return res.data as { ok: boolean };
}

async function acceptHelperInviteFn() {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'acceptHelperInvite');
  const res = await fn();
  return res.data as { ok: boolean; accepted: { ownerUid: string; perms: HelperPerms }[] };
}

// 2026-07-18 — Rich Traditional-Chinese helper-invite SMTP email.
// sendHelperInviteEmailV2 renders a branded HTML template and sends
// via Nodemailer (uses the same From / Reply-To envelope as the
// e-card flow). The V2 suffix is only because the v1 stuck-CF-control-
// plane is wedged — GCP keeps recreating it within seconds of any
// delete. Once GCP returns the v1 to healthy, we can re-merge.
// Returns `{ ok, sent, dryRun?, html?, magicLinkUrl? }`.
// The front-end's HelperManager handleInvite uses this FIRST, falling
// back to sendSignInLinkToEmail if the callable throws — preserves
// the existing safety net while upgrading the visual quality.
//
// ownerName / eventName are optional — the cloud function falls back
// to collectionGroup('users') to resolve the owner's display name.
async function sendHelperInviteEmailFn(args: {
  ownerUid: string;
  helperEmail: string;
  helperDisplayName: string;
  ownerName?: string;
  eventName?: string;
  role?: string;
}) {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'sendHelperInviteEmailV2');
  const res = await fn(args);
  return res.data as {
    ok: boolean;
    sent: boolean;
    dryRun?: boolean;
    html?: string;
    magicLinkUrl?: string;
    error?: string;
  };
}

export const helpersApi = {
  invite: inviteHelperFn,
  revoke: revokeHelperFn,
  updatePerms: updateHelperPermsFn,
  accept: acceptHelperInviteFn,
  sendInviteEmail: sendHelperInviteEmailFn,
};

// ---- Client-side filter for gift amounts --------------------------------
//
// Firestore rules can't redact fields, so the client must strip giftAmount
// and hasGifted if the helper doesn't have canViewGiftAmount. We do this in
// a selector so all screens see consistent data.

export function sanitizeGuestForHelper<
  T extends { giftAmount?: number; hasGifted?: boolean },
>(
  guest: T,
  perms: HelperPerms,
): T {
  if (perms.canViewGiftAmount) return guest;
  const { giftAmount: _gift, hasGifted: _gifted, ...rest } = guest;
  return { ...(rest as T), hasGifted: false, giftAmount: 0 };
}