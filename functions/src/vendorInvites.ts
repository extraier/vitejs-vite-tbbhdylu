// vendorInvites.ts — single source of truth for vendor invitation
// state.
//
// 2026-08-13 — C-01 (CRITICAL) fix. Invitation fields used to live on
// the public /vendors/{slug} doc, which meant anyone (signed in or
// not) could GET the doc and harvest the invitationToken, then call
// claimSeededVendor to take over the seeded vendor profile.
//
// Invitation state now lives under /vendorInvites/{slug}, which is
// fully deny-all on the client (see firestore.rules). Only Cloud
// Functions running with Admin SDK credentials ever read or write
// these docs.
//
// Every existing writer (vendorInviteTrigger.onPendingInviteCreated,
// vendorActivation.activateSeededVendor, sendVendorInviteEmail,
// bulkActivateVendors) now goes through issueInvite() below instead
// of touching /vendors/{slug} directly. Readers
// (claimSeededVendor, claimAndApplyAsVendor) go through
// readInvite() + deleteInvite(). This keeps the four writers and
// two readers in lock-step — if a new code path needs to mint or
// validate an invite, it MUST go through this module.
//
// IMPORTANT: callers MUST NOT include the invite object in any
// response that goes back to a non-admin client. The token in
// particular is only safe inside an outbound email or a deep-link
// URL the admin is explicitly constructing.

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

export interface VendorInviteState {
  slug: string;
  invitationToken: string;
  // Firestore Timestamp when read back, Date when freshly minted by
  // issueInvite. Callers should use the toMillis() helper below rather
  // than relying on a single shape.
  invitationExpiresAt: Timestamp | Date;
  signupStatus: 'invited' | 'claimed';
  invitedAt?: FieldValue | Timestamp;
  invitedEmail?: string | null;
  invitedBy?: string | null;
  // Mirror fields so claim flows can read everything in one doc.
  // Keep small — this doc lives forever (until claimed/deleted).
  source?: 'admin_console' | 'pending_invite' | 'bulk_activate' | 'send_vendor_invite';
}

/** Convert a Timestamp | Date to ms-since-epoch safely. */
export function expiresAtMillis(t: Timestamp | Date | undefined | null): number {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  // Firestore Timestamp — duck-type to avoid an extra import.
  const fn = (t as unknown as { toMillis?: () => number }).toMillis;
  return typeof fn === 'function' ? fn.call(t) : 0;
}

function inviteRef(slug: string) {
  return getFirestore().collection('vendorInvites').doc(slug);
}

/**
 * Issue a fresh invitation. Overwrites any prior invite for the same
 * slug — same semantics as the previous `vendorRef.set(..., {merge})`
 * behavior.
 *
 * Returns the new token so the caller can build the deep link.
 */
export async function issueInvite(args: {
  slug: string;
  token: string;
  expiresAt: Date;
  invitedEmail?: string | null;
  invitedBy?: string | null;
  source: VendorInviteState['source'];
}): Promise<{ token: string }> {
  const ref = inviteRef(args.slug);
  await ref.set(
    {
      slug: args.slug,
      invitationToken: args.token,
      invitationExpiresAt: args.expiresAt,
      signupStatus: 'invited',
      invitedAt: FieldValue.serverTimestamp(),
      invitedEmail: args.invitedEmail ?? null,
      invitedBy: args.invitedBy ?? null,
      source: args.source,
    },
    { merge: true },
  );
  return { token: args.token };
}

/**
 * Read the current invite. Returns null if no invite exists or if the
 * invite doc was deleted after a successful claim.
 *
 * Callers (claimSeededVendor, claimAndApplyAsVendor) must validate
 * token + expiry + signupStatus themselves — this helper just
 * surfaces the state.
 */
export async function readInvite(slug: string): Promise<VendorInviteState | null> {
  const snap = await inviteRef(slug).get();
  if (!snap.exists) return null;
  return snap.data() as VendorInviteState;
}

/**
 * Delete the invite after a successful claim. The claim flow already
 * writes a copy of the vendor's directory fields to
 * /vendors/{authUid} and deletes the slug doc — the invite doc is
 * independent state that must be cleaned up here.
 */
export async function deleteInvite(slug: string): Promise<void> {
  await inviteRef(slug).delete();
}

/**
 * Strip any leftover invitation fields from the public
 * /vendors/{slug} doc. Idempotent. Used by the one-shot migration
 * (scripts/migrate-vendor-invites-2026-08-13.cjs) and on every
 * successful claim as belt-and-braces.
 *
 * The fields stripped match what issueInvite() now owns:
 *   invitationToken, invitationExpiresAt, signupStatus, invitedAt,
 *   invitedEmail, invitedBy, claimedByUid, claimedAt, source.
 */
export async function stripInviteFieldsFromVendorDoc(slug: string): Promise<void> {
  const vendorRef = getFirestore().collection('vendors').doc(slug);
  const fieldsToStrip = [
    'invitationToken',
    'invitationExpiresAt',
    'signupStatus',
    'invitedAt',
    'invitedEmail',
    'invitedBy',
    'claimedByUid',
    'claimedAt',
    'source',
  ];
  const update: Record<string, FieldValue> = {};
  for (const f of fieldsToStrip) update[f] = FieldValue.delete();
  await vendorRef.update(update).catch((e: any) => {
    // Vendor doc may not exist for some invite-only paths; treat
    // "not found" as success.
    if (e?.code === 5 /* NOT_FOUND */) return;
    throw e;
  });
}
