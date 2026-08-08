// Firebase Auth hook — exposes the current user and login helpers.
// Does NOT auto-sign-in: callers (e.g. App.jsx) decide whether to show a
// login screen, a "continue as guest" button, or sign in immediately.
//
// Returns:
//   user / authChecked            — current Firebase user, ready flag
//   isAdmin                       — true if user has the `admin` custom claim
//   isVendor                      — true if user has the `vendor` custom claim
//   isAnonymous                   — true for guest users (can browse, can't save)
//   loginWithGoogle               — popup-based Google sign-in
//   loginWithEmail / registerWithEmail — email/password sign-in / sign-up
//   continueAsGuest               — anonymous sign-in (used by the "Continue
//                                   as guest" button on LoginScreen)
//   linkAnonymousWithEmail        — upgrade the current anonymous user to a
//                                   permanent email/password account, KEEPING
//                                   their existing UID + Firestore data
//                                   (the hybrid "guest try + then save" flow)
//   changePassword                — for users with an email/password provider:
//                                   re-auth by current password, then update
//                                   to the new password. Throws FirebaseAuthError
//                                   codes on failure (wrong-password, weak-password,
//                                   requires-recent-login).
//   linkPassword                  — for users signed in via Google only (no email/
//                                   password provider): link a new password to the
//                                   existing account so they can sign in directly
//                                   next time. Idempotent — throws if already linked.
//   hasPasswordProvider           — helper: true if currentUser.providerData includes
//                                   a 'password' provider. Used by MyProfile to
//                                   decide whether to show "Change password" or
//                                   "Set password / Set login password".
//   logout                        — sign out

import { useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';

// 2026-07-29 — referral attribution. When a new user lands on
// savetheday.io via `?ref=STD-XXXXX`, we stash the code in
// sessionStorage so it survives the sign-up round-trip, then call
// applyReferralAttribution once they're authenticated. Stripped from
// the URL on first sight so refreshes don't loop.
const REFERRAL_URL_PARAM = 'ref';
const REFERRAL_SESSION_KEY = '__pendingReferralCode';
// STD-XXXXX (5 chars, alphabet excludes I/O/0/1)
const REFERRAL_CODE_RE = /^STD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

function readReferralFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(REFERRAL_URL_PARAM);
    if (!raw || !REFERRAL_CODE_RE.test(raw)) return null;
    params.delete(REFERRAL_URL_PARAM);
    const next =
      window.location.pathname +
      (params.toString() ? '?' + params.toString() : '') +
      window.location.hash;
    window.history.replaceState({}, '', next);
    return raw;
  } catch (_) {
    return null;
  }
}

function stashReferral(code) {
  try {
    window.sessionStorage.setItem(REFERRAL_SESSION_KEY, code);
  } catch (_) {
    /* sessionStorage blocked — will fail silently server-side */
  }
}

function readStashedReferral() {
  try {
    return window.sessionStorage.getItem(REFERRAL_SESSION_KEY) || null;
  } catch (_) {
    return null;
  }
}

function clearStashedReferral() {
  try {
    window.sessionStorage.removeItem(REFERRAL_SESSION_KEY);
  } catch (_) {
    /* noop */
  }
}

/**
 * Apply any stashed referral code to the just-signed-in user. No-op if
 * none is stashed. Errors are logged but never thrown — failing to
 * attribute a referral must not break sign-in. On success we clear the
 * stash so re-logins don't double-attribute (the CF is idempotent on
 * its side too).
 */
async function applyStashedReferral(user) {
  const code = readStashedReferral();
  if (!code) return;
  if (!user || user.isAnonymous) return;
  try {
    const fn = httpsCallable(functions, 'applyReferralAttribution');
    const result = await fn({ code });
    // eslint-disable-next-line no-console
    console.info(
      '[useAuth] referral attribution applied:',
      result.data,
    );
    clearStashedReferral();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[useAuth] applyReferralAttribution failed:',
      err?.code,
      err?.message,
    );
    // Clear stale codes (malformed / not-found). For other errors leave
    // the stash so the next login retry can try again.
    if (
      err?.code === 'functions/invalid-argument' ||
      err?.code === 'functions/not-found' ||
      err?.code === 'functions/failed-precondition'
    ) {
      clearStashedReferral();
    }
  }
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isVendor, setIsVendor] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // Session-only flag: when true, anonymous Firebase users are accepted
  // as the active user. Defaults false so restored anonymous sessions
  // from prior visits don't bypass the login screen.
  const [allowAnonymous, setAllowAnonymous] = useState(false);

  // 2026-07-29 — Referral attribution URL pickup. If the user landed
  // via ?ref=STD-XXXXX, stash the code in sessionStorage. The actual
  // attribution call happens inside onAuthStateChanged below, AFTER
  // the user has a real (non-anonymous) auth.uid.
  useEffect(() => {
    const code = readReferralFromUrl();
    if (code) stashReferral(code);
  }, []);

  // Hermes 2026-07-03 — dev-only auth bypass for headless debugging.
  // Visit ?__herotoken=<firebase_custom_token> to sign in as that UID
  // without a password. The token is consumed exactly once and stripped
  // from the URL.
  //
  // 2026-07-27 — hard-gated behind import.meta.env.DEV. Previously the
  // comment claimed "safe to leave in the build" because tokens are
  // short-lived, but any signed-in user could share their own
  // still-valid token via a URL and the recipient would be signed in
  // as them. In dev we need it for `curl` + headless browsers; in prod
  // we MUST NOT sign anyone in via URL params.
  useEffect(() => {
    // import.meta.env.DEV is statically replaced by Vite at build time.
    // In production builds this entire block is dead-code eliminated.
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('__herotoken');
    if (!token) return;
    params.delete('__herotoken');
    const next =
      window.location.pathname +
      (params.toString() ? '?' + params.toString() : '') +
      window.location.hash;
    window.history.replaceState({}, '', next);
    signInWithCustomToken(auth, token).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[useAuth] __herotoken sign-in failed:', err?.code, err?.message);
    });
  }, []);

  // 2026-07-18 — Passwordless helper-invite link handler.
  // When the owner invites an email via HelperManager, Firebase Auth
  // sends a one-time signed link to that email containing
  // `?apiKey=…&oobCode=…&__heroinvite=1`. We detect both the URL
  // param and `isSignInWithEmailLink` to be belt-and-suspenders, then
  // call `signInWithEmailLink` using the email we stashed in
  // localStorage when the invite was first sent.
  //
  // After sign-in, acceptHelperInvite (called from App.jsx in
  // response to onAuthStateChanged) reads pendingInvites for this
  // email and migrates them to helpers/{uid} with status='active'.
  //
  // If the email isn't in localStorage (e.g. a private-window copy
  // of the link), fall through to the LoginScreen where the helper
  // can enter their email and we'll match it on next sign-in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isInviteLanding =
      params.get('__heroinvite') === '1' || isSignInWithEmailLink(auth, window.location.href);
    if (!isInviteLanding) return;

    // Pull the email we stashed when the invite was sent. If absent,
    // prompt the user (LoginScreen reads localStorage too).
    let storedEmail = '';
    try {
      storedEmail = window.localStorage.getItem('__heroinvite_email') || '';
    } catch (_) {
      /* localStorage blocked — fall through */
    }

    // Strip our marker param so refreshes don't loop.
    params.delete('__heroinvite');
    const next =
      window.location.pathname +
      (params.toString() ? '?' + params.toString() : '') +
      window.location.hash;
    window.history.replaceState({}, '', next);

    if (!storedEmail) {
      // eslint-disable-next-line no-console
      console.warn(
        '[useAuth] __heroinvite landing, but no stashed email — ' +
          'LoginScreen will prompt for it.',
      );
      return;
    }

    signInWithEmailLink(auth, storedEmail, window.location.href)
      .then(() => {
        // Don't keep the email around forever — it's only needed for
        // this one sign-in.
        try {
          window.localStorage.removeItem('__heroinvite_email');
        } catch (_) {
          /* noop */
        }
        // eslint-disable-next-line no-console
        console.info('[useAuth] helper invite sign-in succeeded');
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          '[useAuth] __heroinvite sign-in failed:',
          err?.code,
          err?.message,
        );
        // Clear stale stored email so the user can re-enter.
        try {
          window.localStorage.removeItem('__heroinvite_email');
        } catch (_) {
          /* noop */
        }
      });
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      // Anonymous users (guest mode) never auto-restore on next visit —
      // they must explicitly click "Continue as guest" again. This keeps
      // the login screen as the front page for every fresh visit.
      if (currentUser && currentUser.isAnonymous && !allowAnonymous) {
        setUser(null);
        setIsAdmin(false);
        setIsVendor(false);
      } else {
        setUser(currentUser);
        // Refresh the ID token to read fresh custom claims. Custom claims
        // are set server-side (Firebase Admin SDK) and only refresh on
        // sign-in or explicit token refresh.
        setIsAdmin(false);
        setIsVendor(false);
        if (currentUser && !currentUser.isAnonymous) {
          try {
            // 2026-07-15 — force-refresh the token so we get the latest
            // claims. applyAsVendor sets `vendor: true` server-side; if
            // we don't force-refresh, an existing signed-in user sees a
            // stale token (no vendor claim) and gets routed to the
            // couple events-dashboard instead of the vendor dashboard.
            const tokenResult = await currentUser.getIdTokenResult(true);
            setIsAdmin(Boolean(tokenResult.claims.admin));
            setIsVendor(Boolean(tokenResult.claims.vendor));
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[useAuth] token refresh failed:', err?.message || err);
          }
          // 2026-07-29 — apply any pending referral attribution for
          // freshly-signed-in users. Fire-and-forget — must not block
          // the auth state from settling (UI wants the user logged in
          // even if the CF fails).
          applyStashedReferral(currentUser);
        }
      }
      setAuthChecked(true);
    });
    return unsub;
  }, [allowAnonymous]);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const registerWithEmail = async (email, password, displayName = '') => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // 2026-07-14 — vendor signup passes a displayName so it shows up on
    // the Firebase user profile. Used by Step 1 of the wizard to pre-fill
    // the vendor business name (saves the user retyping).
    if (displayName) {
      try {
        await cred.user.updateProfile({ displayName });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useAuth] updateProfile failed:', err?.message || err);
      }
    }
    return cred.user;
  };

  const loginWithEmail = async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  };

  const continueAsGuest = async () => {
    setAllowAnonymous(true);
    await signInAnonymously(auth);
  };

  // 2026-07-03 — hybrid guest-flow upgrade. Anonymous users can explore
  // the app freely (their Firestore writes go under their anonymous UID),
  // and when they're ready to commit, we LINK the existing anonymous
  // account to a permanent email/password credential. Firebase preserves
  // the UID on link, so all their data (events, tasks, guests, photos)
  // carries over with zero migration. After link, isAnonymous flips to
  // false and the user can sign in normally on future visits.
  //
  // Throws if the current user isn't anonymous (defensive — caller should
  // only invoke this from the guest signup prompt) or if the email is
  // already taken by a different account.
  const linkAnonymousWithEmail = async (email, password) => {
    if (!auth.currentUser) throw new Error('No current user to link.');
    if (!auth.currentUser.isAnonymous) {
      throw new Error('Already a permanent account — sign in directly.');
    }
    const credential = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(auth.currentUser, credential);
    return result.user;
  };

  // 2026-07-30 — changePassword for users with an existing password provider.
  // Re-authenticates with the current password (Firebase requires recent
  // login for sensitive ops like updatePassword), then updates to the new
  // password. The re-auth step is what makes this safe — without it, a
  // stolen session token from a public terminal could change the password.
  //
  // Throws Firebase AuthError codes the caller can map to user-friendly
  // Chinese:
  //   auth/wrong-password              — current password is wrong
  //   auth/weak-password               — new password too weak (we pre-validate)
  //   auth/requires-recent-login       — session too old, ask user to re-login
  //   auth/network-request-failed      — offline
  const changePassword = async (currentPassword, newPassword) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Not signed in.');
    if (!u.email) throw new Error('No email on this account.');
    if (!hasPasswordProvider(u)) {
      throw new Error('This account has no password — use linkPassword instead.');
    }
    // Re-auth (requires recent login)
    const credential = EmailAuthProvider.credential(u.email, currentPassword);
    await reauthenticateWithCredential(u, credential);
    // Update password
    await updatePassword(u, newPassword);
    return u; // password may be stale; caller should refetch if needed
  };

  // 2026-07-30 — linkPassword for Google-only users. Adds a password
  // provider to the existing account so they can sign in directly next
  // time (without going through Google). Uses the same linkWithCredential
  // path as linkAnonymousWithEmail but works for any non-anonymous user
  // who doesn't already have a password provider.
  //
  // Throws if the user already has a password provider, or if the email
  // is already taken by a different account.
  const linkPassword = async (newPassword) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Not signed in.');
    if (!u.email) throw new Error('No email on this account.');
    if (hasPasswordProvider(u)) {
      throw new Error('This account already has a password — use changePassword instead.');
    }
    const credential = EmailAuthProvider.credential(u.email, newPassword);
    const result = await linkWithCredential(u, credential);
    return result.user;
  };

  // 2026-07-30 — hasPasswordProvider is a pure helper, not a state
  // reader. Works on any user object (currentUser or a snapshot from
  // somewhere else). Exported so MyProfile can decide whether to show
  // "Change password" (has provider) or "Set login password" (Google-only).
  const hasPasswordProvider = (u) => {
    if (!u || !u.providerData) return false;
    return u.providerData.some((p) => p.providerId === 'password');
  };

  const logout = async () => {
    setAllowAnonymous(false);
    await signOut(auth);
  };

  // 2026-08-05 — acceptAnonymousSession. Called by the partner-share
  // / guest redeem flow in App.jsx right after signInAnonymously
  // completes. Without this, onAuthStateChanged sees
  // currentUser.isAnonymous && !allowAnonymous and STORES null as
  // the user (useAuth.js:273) — so callers that read `user` see
  // "no user" and the upload handler refuses to fire with
  // "登入狀態已過期".
  //
  // Idempotent. Pair with `logout` (or a page refresh) to revoke.
  const acceptAnonymousSession = () => {
    setAllowAnonymous(true);
  };

  // 2026-07-31 — send a Firebase Auth verification email to the current
  // user. Routes through the `sendBrandedVerificationV2` Cloud Function
  // (functions/src/brandedEmail.ts) which builds the link via the
  // Admin SDK and ships a branded HTML email via SendGrid — so we
  // get the bilingual Cantonese-primary copy instead of Firebase's
  // default English template.
  //
  // (Earlier versions of this hook called `user.sendEmailVerification`
  // directly. That path is still available as a fallback for any
  // future code path that wants to bypass our branded flow, but the
  // front-end at MyProfile → MyProfile uses this CF path so users
  // see branded copy.)
  //
  // Throws:
  //   - 'No user signed in'           — `auth.currentUser` is null
  //   - 'Email already verified'      — server-side check, surface
  //                                     "already verified; refresh"
  //   - auth/too-many-requests       — Firebase rate-limits the
  //                                     underlying SDK link
  //                                     generation
  //   - 'sendgrid-failed' / other     — SendGrid returned non-2xx
  const sendEmailVerification = async () => {
    const u = auth.currentUser;
    if (!u) {
      throw new Error('Not signed in');
    }
    if (u.emailVerified) {
      throw new Error('Email is already verified');
    }
    const fn = httpsCallable(functions, 'sendBrandedVerificationV2');
    await fn();
  };

  return {
    user,
    authChecked,
    isAdmin,
    isVendor,
    isAnonymous: Boolean(user?.isAnonymous),
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    continueAsGuest,
    linkAnonymousWithEmail,
    changePassword,
    linkPassword,
    hasPasswordProvider,
    sendEmailVerification,
    logout,
    // 2026-08-05 — guest share-redemption needs to opt the anonymous
    // session in so useAuth.onAuthStateChanged doesn't strip it.
    // See App.jsx share-redeem effect.
    acceptAnonymousSession,
  };
}
