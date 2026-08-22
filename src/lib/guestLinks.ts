// Guest link utilities — client side
// ==================================
//
// 2026-08-23 — Manus P1 hardening (manus recommedation 2.pdf §2.3):
//
// THIS FILE IS PARTIALLY DEPRECATED.
//
// The 4 functions below (`buildGuestQrUrl`, `redeemGuestLink`,
// `saveRedeemedLink`, `loadRedeemedLink`) are dead code and would be
// actively dangerous if called after P1 ships. Specifically:
//
//   - `saveRedeemedLink` calls `setDoc` directly on
//     `guestLinks/{auth.uid}`. P1 forbids `allow create` on
//     `guestLinks/{linkDocId}` for ALL clients — only the
//     `verifyShareToken` callable (which runs with Admin SDK via
//     App Engine integration) can create them. After P1, calling
//     `saveRedeemedLink` will return `permission-denied` from
//     Firestore.
//
//   - The other 3 functions depend on `saveRedeemedLink` (or were
//     never wired in) and would break the redeem flow if used.
//
// The CORRECT post-P1 path for guest redemption is:
//
//   1. Client calls `signInAnonymously(auth)` to get an auth.uid.
//   2. Client calls `httpsCallable(functions, 'verifyShareToken')({ token })`
//      — the callable validates the HMAC, resolves guestId → guestDocId,
//      and writes the link doc server-side.
//   3. Subsequent reads from the same auth.uid pass `hasValidGuestLink`
//      and the guest can read `/events/{eventId}/guestExperience/public`.
//
// The `hmacHex` helper below is NOT deprecated — it's used by unit
// tests in src/lib/guestLinks.test.ts to verify round-trip signing
// against a known secret. We keep it exported because removing it
// would break the test file for no security benefit (the helper is
// pure crypto; it doesn't touch Firestore).
//
// If you're tempted to call any of the @deprecated functions below
// after P1 ships, don't. Open src/App.jsx line ~1047 and follow the
// `verifyShareToken` flow instead.

import { getFunctions, httpsCallable } from 'firebase/functions';

// ---- HMAC signing (still used by unit tests) ------------------------
//
// Pure crypto helper — no Firestore access, no auth dependency. Safe to
// keep even though the rest of this file is quarantined.
export async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---- Deprecated functions (do not call after P1) -------------------

/**
 * @deprecated Since 2026-08-23 (Manus P1). The `issueGuestLink` callable
 * this wraps may still exist server-side, but the QR URL flow it
 * produced was superseded by the HMAC-token flow that `verifyShareToken`
 * uses. No production code imports this. Keep the export so the test
 * surface doesn't churn, but new code should NOT call it.
 */
export async function buildGuestQrUrl(
  _ownerUid: string,
  eventId: string,
  guestId: string,
  ttlHours = 72,
): Promise<{ url: string; token: string; linkId: string; expiresAt: number }> {
  const fns = getFunctions();
  const issue = httpsCallable<
    { eventId: string; guestId: string; ttlHours?: number },
    { linkId: string; token: string; expiresAt: number }
  >(fns, 'issueGuestLink');
  const res = await issue({ eventId, guestId, ttlHours });
  const base = `${window.location.origin}/`;
  const params = new URLSearchParams({
    t: res.data.token,
    lid: res.data.linkId,
  });
  return {
    url: `${base}?${params.toString()}`,
    token: res.data.token,
    linkId: res.data.linkId,
    expiresAt: res.data.expiresAt,
  };
}

/**
 * @deprecated Since 2026-08-23 (Manus P1). The `redeemGuestLink` callable
 * was a placeholder that this wrapped; the production redemption flow
 * uses `verifyShareToken` directly (see App.jsx line 1047). Kept for
 * type compat only — no production code imports this.
 */
export async function redeemGuestLink(
  linkId: string,
  token: string,
): Promise<{ ownerUid: string; eventId: string; guestId: string }> {
  const fns = getFunctions();
  const redeem = httpsCallable<
    { linkId: string; token: string },
    { ownerUid: string; eventId: string; guestId: string }
  >(fns, 'redeemGuestLink');
  const res = await redeem({ linkId, token });
  return res.data;
}

/**
 * @deprecated Since 2026-08-23 (Manus P1). DIRECTLY HAZARDOUS — calls
 * `setDoc` on `guestLinks/{auth.uid}` which P1 forbids for ALL clients
 * (only the `verifyShareToken` callable can create these). If anything
 * still imports this, it will fail with `permission-denied` after P1
 * deploys. No production code imports this today, but the export is
 * preserved so any future import attempt fails loud at the call site,
 * not at runtime via a confusing 403.
 *
 * @throws {Error} Always throws — quarantined after P1.
 */
export async function saveRedeemedLink(
  _ownerUid: string,
  _eventId: string,
  _guestId: string,
  _redeemedByUid: string,
): Promise<void> {
  throw new Error(
    'saveRedeemedLink was quarantined in 2026-08-23 (Manus P1). ' +
    'Use the verifyShareToken callable flow instead — see App.jsx line 1047.',
  );
}

/**
 * @deprecated Since 2026-08-23 (Manus P1). Kept for type compat but the
 * `redeemedByUid` query it issues is now redundant: post-P1, the client
 * only needs to know its own `auth.uid` to satisfy `hasValidGuestLink`
 * (the rule does the lookup). The ownerUid here is the *inviter's* uid
 * which the client should already know from the QR URL.
 *
 * Kept as a no-op stub so any latent import doesn't crash.
 */
export async function loadRedeemedLink(
  _ownerUid: string,
  _redeemedByUid: string,
): Promise<{ eventId: string; guestId: string } | null> {
  return null;
}