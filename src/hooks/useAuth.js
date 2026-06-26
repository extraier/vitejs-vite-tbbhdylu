// Firebase Auth hook — exposes the current user and login helpers.
// Does NOT auto-sign-in: callers (e.g. App.jsx) decide whether to show a
// login screen, a "continue as guest" button, or sign in immediately.
//
// Returns:
//   user / authChecked            — current Firebase user, ready flag
//   isAdmin                       — true if user has the `admin` custom claim
//   loginWithGoogle               — popup-based Google sign-in
//   loginWithEmail / registerWithEmail — email/password sign-in / sign-up
//   continueAsGuest               — anonymous sign-in (used by the "Continue
//                                   as guest" button on LoginScreen)
//   logout                        — sign out

import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
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

  const logout = async () => {
    setAllowAnonymous(false);
    await signOut(auth);
  };

  return {
    user,
    authChecked,
    isAdmin,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    continueAsGuest,
    logout,
  };
}
