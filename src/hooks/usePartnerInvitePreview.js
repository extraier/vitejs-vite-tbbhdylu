// usePartnerInvitePreview — detects ?t=<token> in the URL, calls the
// `previewPartnerInvite` Cloud Function, and returns the invite
// metadata so the LoginScreen can pre-fill the email and show a
// welcome message.
//
// Returns:
//   invite           — { partnerEmail, eventName, expiresAt } | null
//   loading          — true while the preview CF is in flight
//   error            — error string if the CF failed
//   clearInvite      — () => void; resets state and clears localStorage
//   validatedToken   — string | null; set ONLY on preview success.
//                      Source of truth for App.jsx's auto-redeem
//                      effect (added 2026-08-02 round 3 — see the
//                      validatedToken state declaration above for
//                      why this replaced the old sessionStorage
//                      hand-off).
//
// Why validatedToken is exposed (instead of just invite):
//   App.jsx needs the RAW token to call redeemPartnerInviteV2.
//   invite only carries partnerEmail/eventName/expiresAt (the
//   eventId was intentionally dropped server-side for info-disclosure
//   hygiene — see eventId comment at the top). The token itself
//   never crosses the wire from the preview CF; only this hook
//   knows it (because we resolved it from URL/localStorage). So we
//   pass it back up through the hook's return value once we've
//   server-validated it.
//
// Why this is a hook (not inline in App.jsx):
//   • Same useEffect-dependency semantics as useAuth
//   • Lets us lazy-import the functions SDK only on the landing page
//     (keeps the initial bundle lean)
//   • Makes the unit-test surface clean — see tests/usePartnerInvitePreview.test.js

import { useEffect, useState, useCallback } from 'react';
import { callFirebaseFn } from '../lib/firebaseFn';

const STORAGE_KEY = '__heropartnerinvite_token';
// Keep the token around in case the user closes the tab and resumes.
// 7 days matches the server-side INVITE_TTL_MS so the two never disagree
// for any meaningful period.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function readStashedToken() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string') return null;
    if (Date.now() - parsed.stashedAt > STALE_AFTER_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch (_) {
    // localStorage blocked / disabled — fall through to null
    return null;
  }
}

function stashToken(token) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token, stashedAt: Date.now() }),
    );
  } catch (_) {
    /* noop — preview still works in this session via component state */
  }
}

function clearStash() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* noop */
  }
}

function readTokenFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('t');
}

function stripTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('t')) return;
  params.delete('t');
  const next =
    window.location.pathname +
    (params.toString() ? '?' + params.toString() : '') +
    window.location.hash;
  window.history.replaceState({}, '', next);
}

export function usePartnerInvitePreview() {
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // 2026-08-02 (round 3) — validatedToken. App.jsx's auto-redeem
  // effect needs the token AFTER auth, but it can't safely read
  // sessionStorage because:
  //   - The hook used to write sessionStorage at effect-start so
  //     App.jsx could find it after auth (race-free handover).
  //   - That meant App.jsx's parallel redeem effect fired BEFORE
  //     the preview completed — and if the preview returned 403
  //     (dead token), App.jsx had already fired its own 403.
  //     Round 2 cleared sessionStorage AFTER the preview failed,
  //     but the redeem was already in flight. Race condition.
  //
  // Fix: the hook now owns the token state. App.jsx reads
  // validatedToken from the hook's return value and redeems ONLY
  // when the hook has validated the token via preview success.
  // No more parallel redeem-on-mount. No more storage hand-off.
  // No more 403 noise on dead tokens.
  //
  // validatedToken is set ONLY on preview success (token has been
  // server-validated). On preview failure it stays null, and App.jsx
  // never tries to redeem — which is exactly what we want for dead
  // tokens.
  const [validatedToken, setValidatedToken] = useState(null);

  useEffect(() => {
    // Resolve the token from URL (priority) or localStorage (resume).
    const urlToken = readTokenFromUrl();
    const token = urlToken || readStashedToken();
    if (!token) return;

    // We only stash to localStorage at effect-start (the hook's
    // own resume-on-tab-reopen mechanism). sessionStorage is no
    // longer touched at effect-start — see validatedToken above
    // for why.

    // Stash the resolved token in localStorage so we can resume
    // after a tab close/reopen. We do NOT strip the URL token
    // until preview SUCCEEDS — App.jsx's redeem effect used to
    // read URL directly too, but now it reads validatedToken
    // (which only exists on success), so stripping URL here
    // doesn't break anything; we keep the existing behaviour of
    // stripping only on success for back-compat.
    //
    // Why we DON'T stash the RAW token to sessionStorage at
    // effect-start (removed 2026-08-02 round 3):
    // App.jsx's auto-redeem effect used to read sessionStorage
    // directly and fire redeemPartnerInviteV2 BEFORE the preview
    // completed. With dead tokens that meant two parallel 403s
    // (preview + redeem). The race is intrinsic if both effects
    // can independently decide to call the redeem API. The new
    // design serialises: hook validates first, then exposes the
    // token via validatedToken, then App.jsx redeems. Dead tokens
    // never make it past the validation gate.
    stashToken(token);

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 2026-07-27 — route through the Vercel proxy (same as
        // uploadRedPacketV2, sendInvitationsV2, etc.) instead of a
        // direct httpsCallable() call. Direct calls hit Cloud Run's
        // preflight rejection (403 Bad signature) because the SDK
        // sends an OPTIONS probe before the POST. The proxy bypasses
        // preflight entirely (same-origin request → no probe).
        const res = await callFirebaseFn('previewPartnerInvite', { token });
        if (cancelled) return;
        const data = res?.data;
        if (data && data.ok && data.partnerEmail) {
          // Preview succeeded — safe to strip URL now AND expose
          // the token so App.jsx's auto-redeem effect can fire.
          stripTokenFromUrl();
          setInvite({
            partnerEmail: data.partnerEmail,
            eventName: data.eventName,
            expiresAt: data.expiresAt,
          });
          // validatedToken is the source of truth for App.jsx's
          // redeem effect. Setting it here (after server-side
          // validation) is what eliminates the dead-token 403
          // noise — App.jsx no longer fires its own redeem until
          // we've confirmed the token is real.
          setValidatedToken(token);
        } else {
          setError('invalid-response');
        }
      } catch (err) {
        if (cancelled) return;
        const code = err?.code || 'unknown';
        // eslint-disable-next-line no-console
        console.warn('[usePartnerInvitePreview] preview failed:', code, err?.message);
        setError(code);
        // 2026-08-02 (bad-signature follow-up) — distinguish "token is
        // permanently dead" (Bad signature, NOT_FOUND, INVALID_ARGUMENT,
        // UNREGISTERED) from transient failures (network blip, CORS).
        // For dead-token errors, clear the localStorage stash so future
        // mounts don't replay it and spam the console with 403s. For
        // transient errors, keep the stash so the user can refresh and
        // try again.
        //
        // validatedToken stays null in this branch (the token was
        // never set), so App.jsx will not fire redeemPartnerInviteV2
        // — which is the round-3 fix for the dead-token 403 noise.
        const isDeadToken =
          code === 'Bad signature' ||
          code === 'NOT_FOUND' ||
          code === 'INVALID_ARGUMENT' ||
          code === 'UNREGISTERED' ||
          code === 'invalid-response' ||
          /bad signature/i.test(err?.message || '');
        if (isDeadToken) {
          clearStash();
        }
        // For transient preview errors (NOT dead-token) DO NOT clearStash()
        // — a future mount might succeed where this one didn't.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // 2026-08-05 — listen for App.jsx's "redeem failed, drop
    // the banner" signal. App.jsx can't call clearInvite() directly
    // (it's in scope here, not there), so we use a window-level
    // CustomEvent. Fires only on redeem failure, when the user is
    // signed in but the redeemPartnerInviteV2 CF threw — clearing
    // the React state here means the 💍 banner on the LoginScreen
    // goes away immediately instead of surviving until a hard
    // reload.
  }, []);

  useEffect(() => {
    function onClear() {
      setInvite(null);
      setValidatedToken(null);
      setError(null);
      clearStash();
    }
    window.addEventListener('partner-invite-clear', onClear);
    return () => window.removeEventListener('partner-invite-clear', onClear);
  }, []);

  const clearInvite = useCallback(() => {
    setInvite(null);
    setError(null);
    clearStash();
  }, []);

  return { invite, loading, error, clearInvite, validatedToken };
}
