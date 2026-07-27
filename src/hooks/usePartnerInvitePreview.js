// usePartnerInvitePreview — detects ?t=<token> in the URL, calls the
// `previewPartnerInvite` Cloud Function, and returns the invite
// metadata so the LoginScreen can pre-fill the email and show a
// welcome message.
//
// Returns:
//   invite        — { partnerEmail, eventName, expiresAt } | null
//     (eventId intentionally omitted — the previewPartnerInvite
//     Cloud Function dropped it from its response to fix a
//     minor info-disclosure leak. The hook is defensive: if a
//     payload that includes eventId ever arrives, the field is
//     simply absent from the parsed object.)
//   loading       — true while the preview CF is in flight
//   error         — error string if the CF failed (bad token, expired, etc.)
//   clearInvite   — () => void; call after the user signs up / in to
//                   remove the token from the URL so refreshes don't
//                   re-fire the preview
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

  useEffect(() => {
    // Resolve the token from URL (priority) or localStorage (resume).
    const urlToken = readTokenFromUrl();
    const token = urlToken || readStashedToken();
    if (!token) return;

    // Stash the resolved token in BOTH localStorage AND sessionStorage so
    // App.jsx's redeem effect can find it after auth. This intentionally
    // mirrors localStorage-only resumes too (not just fresh URL arrivals).
    // Keep the sessionStorage value as the RAW token: App.jsx passes that
    // value directly to redeem({ token }), so a JSON envelope here would
    // be sent as the token and fail signature verification.
    //
    // We do NOT strip the URL token until preview SUCCEEDS — App.jsx's
    // redeem effect also reads from the URL via extractPartnerTokenFromUrl()
    // and the two effects run in parallel.
    //
    // Previously this hook stripped the URL token immediately at effect
    // start, which raced with App.jsx's redeem effect: if the user wasn't
    // signed in yet, the URL token was gone by the time they signed in
    // and App.jsx's extractPartnerTokenFromUrl() returned null. Combined
    // with the sessionStorage/localStorage split (this hook wrote
    // localStorage; App.jsx read sessionStorage), the redeem silently
    // never fired. Bug seen 2026-07-26 on savetheday-2377a.
    stashToken(token);
    try {
      sessionStorage.setItem('pendingPartnerToken', token);
    } catch { /* sessionStorage blocked — fallback to URL/localStorage */ }

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
          // Preview succeeded — safe to strip URL now.
          stripTokenFromUrl();
          setInvite({
            partnerEmail: data.partnerEmail,
            eventName: data.eventName,
            expiresAt: data.expiresAt,
          });
        } else {
          setError('invalid-response');
        }
      } catch (err) {
        if (cancelled) return;
        const code = err?.code || 'unknown';
        // eslint-disable-next-line no-console
        console.warn('[usePartnerInvitePreview] preview failed:', code, err?.message);
        setError(code);
        // DO NOT clearStash() here — the redeem effect (App.jsx) might
        // still succeed via sessionStorage['pendingPartnerToken'].
        // The redeem path is independent and shouldn't be blocked by
        // a preview-only failure (e.g. CORS, network blip).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const clearInvite = useCallback(() => {
    setInvite(null);
    setError(null);
    clearStash();
  }, []);

  return { invite, loading, error, clearInvite };
}
