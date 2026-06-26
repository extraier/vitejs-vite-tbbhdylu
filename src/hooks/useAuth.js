// Firebase Auth hook — exposes the current user and login helpers.
// Does NOT auto-sign-in: callers (e.g. App.jsx) decide whether to show a
// login screen, a "continue as guest" button, or sign in immediately.
//
// Props: none.
//
// Returns:
//   user / authChecked            — current Firebase user, ready flag
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
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthChecked(true);
    });
    return unsub;
  }, []);

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
    await signInAnonymously(auth);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return {
    user,
    authChecked,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    continueAsGuest,
    logout,
  };
}
