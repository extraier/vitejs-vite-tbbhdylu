// Firebase initialization (preserves the Canvas-environment compat layer:
// when running inside StackBlitz/CodeSandbox preview, __firebase_config and
// __app_id are injected globally. Otherwise we fall back to the production
// wedding-app project.)
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Production config for "savetheday-2377a" — also acts as the
// Canvas-environment fallback if __firebase_config isn't injected.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBrH5bUXbBFAsMZ6Ya5IDWV9p7OpvLbAWo',
  authDomain: 'savetheday-2377a.firebaseapp.com',
  projectId: 'savetheday-2377a',
  storageBucket: 'savetheday-2377a.firebasestorage.app',
  messagingSenderId: '1076306848030',
  appId: '1:1076306848030:web:067794edd31cb2cdb3410f',
  measurementId: 'G-LH4S4CEBK1',
};

function resolveFirebaseConfig() {
  try {
    // StackBlitz / CodeSandbox / Firebase Canvas inject __firebase_config.
    // The values are accessed via `globalThis` to keep strict mode happy and
    // avoid "variable is not defined" errors in plain Vite builds.
    const injected = (globalThis as { __firebase_config?: string }).__firebase_config;
    if (injected) {
      const parsed = JSON.parse(injected);
      if (parsed && Object.keys(parsed).length > 0) return parsed;
    }
  } catch (err) {
    console.warn('Using default firebase config due to Canvas environment override.', err);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

function resolveAppId(): string {
  const injected = (globalThis as { __app_id?: string }).__app_id;
  return injected || 'savetheday-production';
}

// Vite HMR can re-execute this module — guard with getApps() so we don't
// double-initialize.
const app: FirebaseApp = getApps().length === 0 ? initializeApp(resolveFirebaseConfig()) : getApp();

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export const appId: string = resolveAppId();
