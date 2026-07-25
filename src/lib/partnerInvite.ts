// 2026-07-26 — Co-owners (couples / partners) front-end library.
//
// Wraps the three Cloud Functions defined in functions/src/partnerInvite.ts:
//   - sendPartnerInvite   — owner invokes; sends email to partner
//   - redeemPartnerInvite — partner invokes after sign-in; finalizes join
//   - removePartner       — owner revokes a co-owner
//
// Plus a small client-side helper to extract the ?t= token from
// the URL (the front-end checks for it on every load to handle
// the partner's first visit after clicking the magic link).
//
// The shape mirrors sendHelperInviteEmail / acceptHelperInvite
// in src/lib/helpers.ts so the call-site code reads uniformly.

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
  // Present only in dryRun. The front-end shows this in a
  // "copy this link" modal so the owner can send it manually
  // when SMTP isn't configured.
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

// Singleton Functions instance. We import firebase/app lazily
// because this module is also imported by tests that mock
// getFunctions().
let cachedFn: Functions | null = null;
function fns(): Functions {
  if (cachedFn) return cachedFn;
  // Use the default app — App.jsx initializes it before
  // any of these calls are made.
  cachedFn = getFunctions(undefined, 'us-central1');
  return cachedFn;
}

export const partnerInviteApi = {
  async send(input: SendPartnerInviteInput): Promise<SendPartnerInviteResult> {
    const call = httpsCallable<SendPartnerInviteInput, SendPartnerInviteResult>(
      fns(),
      'sendPartnerInvite',
    );
    const res = await call(input);
    return res.data;
  },

  async redeem(input: RedeemPartnerInviteInput): Promise<RedeemPartnerInviteResult> {
    const call = httpsCallable<RedeemPartnerInviteInput, RedeemPartnerInviteResult>(
      fns(),
      'redeemPartnerInvite',
    );
    const res = await call(input);
    return res.data;
  },

  async remove(input: RemovePartnerInput): Promise<RemovePartnerResult> {
    const call = httpsCallable<RemovePartnerInput, RemovePartnerResult>(
      fns(),
      'removePartner',
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
 *
 * After consuming the token, the caller should remove it from
 * the URL (so a page refresh doesn't trigger another redeem).
 * See usePartnerInviteRedeem hook for the standard pattern.
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
    // Use history.replaceState so we don't pollute the back stack.
    window.history.replaceState({}, '', url.toString());
  }
}
