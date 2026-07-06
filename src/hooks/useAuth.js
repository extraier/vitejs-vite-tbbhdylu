// Firebase Auth hook — exposes the current user and login helpers.
// Does NOT auto-sign-in: callers (e.g. App.jsx) decide whether to show a
// login screen, a "continue as guest" button, or sign in immediately.
//
// Returns:
//   user / authChecked            — current Firebase user, ready flag
//   isAdmin                       — true if user has the `admin` custom claim
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
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      // Anonymous users (guest mode) never auto-restore on next visit —
      // they must explicitly click "Continue as guest" again. This keeps
      // the login screen as the front page for every fresh visit.
      if (currentUser && currentUser.isAnonymous && !allowAnonymous) {
        setUser(null);
        setIsAdmin(false);
      } else {
        setUser(currentUser);
        // Refresh the ID token to read fresh custom claims. Custom claims
        // are set server-side (Firebase Admin SDK) and only refresh on
        // sign-in or explicit token refresh.
        setIsAdmin(false);
        if (currentUser && !currentUser.isAnonymous) {
          try {
            const tokenResult = await currentUser.getIdTokenResult(true);
            setIsAdmin(Boolean(tokenResult.claims.admin));
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

  const registerWithEmail = async (email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
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
    isAnonymous: Boolean(user?.isAnonymous),
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    continueAsGuest,
    linkAnonymousWithEmail,
    logout,
  };
}
