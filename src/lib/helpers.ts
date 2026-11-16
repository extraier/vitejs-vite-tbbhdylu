// Helpers (兄弟姊妹) — client-side helpers for the permission system.
//
// A helper is a registered Firebase Auth user (Google or email/password)
// who has been invited by an owner. Their perms live in a Firestore doc at
//   users/{ownerUid}/helpers/{auth.uid}
// The client uses these helpers to:
//   - detect whether the current user is a helper
//   - look up their perms
//   - call the Cloud Functions to invite / revoke / accept invites

import { doc, getDoc } from 'firebase/firestore';
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
  eventId?: string | null;
  eventName?: string | null;
};

export type ListedHelperAssignment = {
  id?: string;
  ownerUid?: string;
  email?: string;
  displayName?: string;
  phone?: string | null;
  status?: string;
  perms?: Partial<HelperPerms>;
  eventId?: string | null;
  eventName?: string | null;
  helperUid?: string | null;
};

const HELPER_STATUSES = new Set(['invited', 'active', 'revoked']);

function normalizeListedAssignment(row: ListedHelperAssignment): HelperDoc | null {
  if (!row || typeof row.id !== 'string' || typeof row.ownerUid !== 'string') return null;
  if (typeof row.status !== 'string' || !HELPER_STATUSES.has(row.status)) return null;
  return {
    id: row.id,
    ownerUid: row.ownerUid,
    email: typeof row.email === 'string' ? row.email : '',
    displayName: typeof row.displayName === 'string' ? row.displayName : '',
    phone: typeof row.phone === 'string' ? row.phone : null,
    status: row.status as HelperDoc['status'],
    perms: { ...defaultHelperPerms(), ...row.perms },
    invitedAt: 0,
    acceptedAt: null,
    revokedAt: null,
    helperUid: typeof row.helperUid === 'string' ? row.helperUid : null,
    eventId: typeof row.eventId === 'string' ? row.eventId : null,
    eventName: typeof row.eventName === 'string' ? row.eventName : null,
  };
}

/**
 * Find every wedding that has invited the current user, including
 * invites they have not accepted yet.
 *
 * This goes through the listMyHelperAssignments callable. A client
 * collectionGroup('pendingInvites') query is denied: those rules
 * allow only the owner, and the same collection id is used for
 * vendor outreach. The denial used to abort before active helper
 * rows were read, so the dashboard stayed empty.
 */
export async function listMyHelperAssignments(): Promise<HelperDoc[]> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user || !user.email) return [];
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'listMyHelperAssignments');
  const res = await fn({});
  const data = res.data as { assignments?: ListedHelperAssignment[] };
  const rows = Array.isArray(data?.assignments) ? data.assignments : [];
  return rows.flatMap((row) => {
    const normalized = normalizeListedAssignment(row);
    return normalized ? [normalized] : [];
  });
}

/**
 * Send the invite email for every successful invite, including
 * people who already have an account. pendingEmailRegistration is
 * only "they still need to sign up", not "they should be told".
 */
export function shouldEmailHelperInvite(
  inviteRes: { ok?: boolean } | null | undefined,
): boolean {
  return inviteRes?.ok === true;
}

// ---- Cloud Function wrappers ---------------------------------------------

async function inviteHelperFn(args: {
  email: string;
  displayName: string;
  phone?: string;
  perms: Partial<HelperPerms>;
  // 2026-08-15 — Helper onboarding audit (P0-B). eventId is
  // required so the Helper Dashboard can scope its queries.
  // Cloud function rejects invites without eventId.
  eventId: string;
}) {
  const fns = getFunctions();
  const fn = httpsCallable(fns, 'inviteHelper');
  const res = await fn(args);
  return res.data as {
    ok: boolean;
    helperUid: string | null;
    pendingEmailRegistration: boolean;
    alreadyActive?: boolean;
  };
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