// Firebase initialization (preserves the Canvas-environment compat layer:
// when running inside StackBlitz/CodeSandbox preview, __firebase_config and
// __app_id are injected globally. Otherwise we fall back to the production
// wedding-app project.)
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, type Functions } from 'firebase/functions';

// Production config for "savetheday-2377a" — also acts as the
// Canvas-environment fallback if __firebase_config isn't injected.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA-HGRqFqNRp3t4xKjXgnjSZoqUoWZmEXs',
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
// 2026-07-22 — Export the app instance too. Was previously
// module-private; needed by callers that want to create
// region-specific Functions instances (sendInvitationsV2 in
// asia-east2) without depending on the default `functions`
// singleton. Without this, callers had to either re-import
// the `initializeApp` machinery or call getApp() which fails
// when initializeApp was already called from this module.
const app: FirebaseApp = getApps().length === 0 ? initializeApp(resolveFirebaseConfig()) : getApp();
export { app };

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export const functions: Functions = getFunctions(app);
export const appId: string = resolveAppId();

// DevTools convenience: expose the Firebase SDKs on `window.__fb` so callables
// (admin SDK operations, etc.) can be invoked from the browser console. This is
// needed because Vite-bundled bare specifiers like `firebase/functions` don't
// resolve from DevTools dynamic imports — Vite's module graph is invisible to
// the console, so the user gets:
//   "Failed to resolve module specifier 'firebase/functions'"
// when they try the obvious `await import('firebase/functions')` pattern.
//
// Example from DevTools after signing in:
//   const fn = window.__fb.httpsCallable(window.__fb.functions, 'selfPromoteAdmin');
//   const r = await fn();
//   console.log(r.data);
//
// SECURITY: This exposes no secrets — only public Firebase client SDK handles
// + the user's own auth state. The Admin SDK / service account keys are not
// bundled into the client, so this is the same surface area as the rest of
// the app. The auth/claims layer still gates what the user can DO.
//
// 2026-08-13 — M-05 audit fix. Gated behind import.meta.env.DEV so the
// global is removed from production builds. The audit recommendation was
// to gate behind "an admin-only authenticated support page with explicit
// audit logging"; that requires building a separate ops surface which is
// out of scope. DEV-only gate is the minimum-cost mitigation per the
// audit's "Remove the global in production" guidance. For prod ops needs,
// add the support-page solution in a follow-up.
if (import.meta.env.DEV) {
void Promise.all([
  import('firebase/functions'),
  import('firebase/app'),
  import('firebase/firestore'),
]).then(([{ httpsCallable, getFunctions }, { getApp }, { disableNetwork, enableNetwork, clearIndexedDbPersistence }]) => {
  (globalThis as unknown as { __fb: unknown }).__fb = {
    app,
    getApp,
    auth,
    db,
    storage,
    appId,
    functions: getFunctions(app),
    httpsCallable,
    // 2026-08-10 — Expose Firestore network toggle so DevTools can force a
    // rules-cache refresh after a Firestore rules deploy. The dynamic
    // `import('firebase/firestore')` from DevTools creates a SECOND SDK
    // instance whose `disableNetwork` rejects with "Expected type 'Firestore'"
    // because the user's `db` is from the bundle's SDK instance. These
    // references come from the same Promise.all that builds `db`, so the
    // instance matches. Use:
    //   await window.__fb.disableNetwork(); await window.__fb.enableNetwork();
    //   location.reload();
    disableNetwork: () => disableNetwork(db),
    enableNetwork: () => enableNetwork(db),
    clearPersistence: () => clearIndexedDbPersistence(db).then(() => location.reload()),
  };
  // eslint-disable-next-line no-console
  console.info('[firebase] DevTools helpers attached: window.__fb');
});
}
