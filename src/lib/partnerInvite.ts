// 2026-07-26 — Co-owners (couples / partners) front-end library.
//
// Wraps the three Cloud Functions defined in
// functions/src/partnerInvite.ts:
//   - sendPartnerInviteV2   — owner invokes; sends email to partner
//   - redeemPartnerInviteV2 — partner invokes after sign-in; finalizes join
//   - removePartnerV2       — owner revokes a co-owner
//
// Plus a small client-side helper to extract the ?t= token from
// the URL (the front-end checks for it on every load to handle
// the partner's first visit after clicking the magic link).
//
// The shape mirrors sendHelperInviteEmail / acceptHelperInvite
// in src/lib/helpers.ts so the call-site code reads uniformly.
//
// 2026-07-26b — Renamed to call the V2 Cloud Functions. The
// original sendPartnerInvite / redeemPartnerInvite / removePartner
// hit a stuck Cloud Run 409 on the original names; their CORS
// preflight started returning 403 instead of 204. Renaming
// bypasses the stuck resource.

import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

export interface SendPartnerInviteInput {
  ownerUid: string;
  partnerEmail: string;
  eventId: string;
}

export interface SendPartnerInviteResult {
  ok: boolean;
  sent: boolean;
  dryRun?: boolean;
  magicLinkUrl?: string;
  html?: string;
  error?: string;
}

export interface RedeemPartnerInviteInput {
  token: string;
}

export interface RedeemPartnerInviteResult {
  ok: boolean;
  ownerUid: string;
  eventId: string;
  event: { id: string; name: string };
}

export interface RemovePartnerInput {
  ownerUid: string;
  coOwnerUid: string;
  eventId: string;
}

export interface RemovePartnerResult {
  ok: boolean;
}

// 2026-07-27 — list-partner-invites history (powers the 邀請另一半
// history list in the dashboard + modal). Server derives the
// status field from the pending-doc + expiresAt so we don't
// need a separate write to mark expired invites.
export interface ListPartnerInvitesInput {
  ownerUid: string;
  // 2026-07-27 — optional eventId filter. When set, only invites
  // for that event are returned (used by InvitePartnerModal so
  // the modal doesn't show partner invites from a previous event).
  eventId?: string;
}

export type PartnerInviteStatus = 'pending' | 'accepted' | 'expired';

export interface PartnerInviteHistoryRow {
  id: string;
  email: string;
  eventId: string;
  eventName: string;
  status: PartnerInviteStatus;
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  acceptedByUid?: string;
}

export interface ListPartnerInvitesResult {
  ok: boolean;
  rows: PartnerInviteHistoryRow[];
}

// Singleton Functions instance.
let cachedFn: Functions | null = null;
function fns(): Functions {
  if (cachedFn) return cachedFn;
  cachedFn = getFunctions(undefined, 'us-central1');
  return cachedFn;
}

export const partnerInviteApi = {
  async send(input: SendPartnerInviteInput): Promise<SendPartnerInviteResult> {
    const call = httpsCallable<SendPartnerInviteInput, SendPartnerInviteResult>(
      fns(),
      'sendPartnerInviteV2',
    );
    const res = await call(input);
    return res.data;
  },

  async redeem(input: RedeemPartnerInviteInput): Promise<RedeemPartnerInviteResult> {
    const call = httpsCallable<RedeemPartnerInviteInput, RedeemPartnerInviteResult>(
      fns(),
      'redeemPartnerInviteV2',
    );
    const res = await call(input);
    return res.data;
  },

  async remove(input: RemovePartnerInput): Promise<RemovePartnerResult> {
    const call = httpsCallable<RemovePartnerInput, RemovePartnerResult>(
      fns(),
      'removePartnerV2',
    );
    const res = await call(input);
    return res.data;
  },

  // 2026-07-27 — list partner-invite history. Used by
  // InvitePartnerModal and the dashboard card to show "which
  // emails were sent, and the accept status".
  async list(input: ListPartnerInvitesInput): Promise<ListPartnerInvitesResult> {
    const call = httpsCallable<ListPartnerInvitesInput, ListPartnerInvitesResult>(
      fns(),
      'listPartnerInvites',
    );
    const res = await call(input);
    return res.data;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// URL token extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Look for ?t=<token> in the current URL. Returns the token
 * string, or null if not present. The token is the magic-link
 * value from the partner-invite email.
 */
export function extractPartnerTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('t');
}

/**
 * Strip the ?t= param from the URL bar (no page reload).
 * Use after a successful redeem so the back/refresh doesn't
 * re-trigger the flow.
 */
export function clearPartnerTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('t')) {
    url.searchParams.delete('t');
    window.history.replaceState({}, '', url.toString());
  }
}
