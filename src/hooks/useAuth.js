// Firebase Auth hook — handles Google sign-in (with anonymous fallback)
// and exposes the current user. The original App.jsx repeated this logic
// twice (once in init, once for the login button).

import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

const CANVAS_INITIAL_TOKEN = '__initial_auth_token';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Canvas / StackBlitz preview environments inject __initial_auth_token.
      const initialToken = (globalThis)[CANVAS_INITIAL_TOKEN];
      try {
        if (initialToken) {
          await signInWithCustomToken(auth, initialToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Auth init error:', err);
      }
    };
    init();

    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (cancelled) return;
      setUser(currentUser);
      setAuthChecked(true);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Popup login failed, falling back to anonymous:', err);
      await signInAnonymously(auth);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return { user, authChecked, loginWithGoogle, logout };
}
