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
import { getFunctions, httpsCallable } from 'firebase/functions';

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

    // Stash the token in BOTH localStorage AND sessionStorage so the
    // App.jsx redeem effect (which reads sessionStorage['pendingPartnerToken'])
    // can find it after auth. We do NOT strip the URL token until the
    // preview SUCCEEDS — App.jsx's redeem effect also reads from the URL
    // via extractPartnerTokenFromUrl() and the two effects run in parallel.
    //
    // Previously this hook stripped the URL token immediately at effect
    // start, which raced with App.jsx's redeem effect: if the user wasn't
    // signed in yet, the URL token was gone by the time they signed in
    // and App.jsx's extractPartnerTokenFromUrl() returned null. Combined
    // with the sessionStorage/localStorage split (this hook wrote
    // localStorage; App.jsx read sessionStorage), the redeem silently
    // never fired. Bug seen 2026-07-26 on savetheday-2377a.
    if (urlToken) {
      stashToken(urlToken);
      try {
        sessionStorage.setItem(
          'pendingPartnerToken',
          JSON.stringify({ token: urlToken, stashedAt: Date.now() }),
        );
      } catch { /* sessionStorage blocked — fallback to URL/localStorage */ }
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const fn = httpsCallable(getFunctions(undefined, 'us-central1'), 'previewPartnerInvite');
        const res = await fn({ token });
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
