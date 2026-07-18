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
//   logout                        — sign out

import { useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isVendor, setIsVendor] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // Session-only flag: when true, anonymous Firebase users are accepted
  // as the active user. Defaults false so restored anonymous sessions
  // from prior visits don't bypass the login screen.
  const [allowAnonymous, setAllowAnonymous] = useState(false);

  // Hermes 2026-07-03 — dev-only auth bypass for headless debugging.
  // Visit ?__herotoken=<firebase_custom_token> to sign in as that UID
  // without a password. The token is consumed exactly once and stripped
  // from the URL. Safe to leave in the build: tokens are short-lived
  // (60 min) and the param has zero effect if no token is passed.
  useEffect(() => {
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

  const logout = async () => {
    setAllowAnonymous(false);
    await signOut(auth);
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
    logout,
  };
}
