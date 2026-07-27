// Generic Firestore collection → React state hook.
//
// Replaces 5 nearly-identical useEffect(onSnapshot, deps) blocks that the
// original App.jsx inlined for events, guests, photos, tasks, notifications.
// Returns `{ data, loading, error }`. `loading` is true until the first
// snapshot fires (so callers can show spinners during initial fetch).
//
// CRITICAL (verified 2026-06-26 on vitejs-vite-tbbhdylu):
// We call `onSnapshot(collectionRef, cb, errCb)` — the STANDALONE function
// imported from `firebase/firestore` — NOT `collectionRef.onSnapshot(cb)`
// (the method form).
//
// Why not the method form: the modular SDK v10.x does NOT install
// `CollectionReference.prototype.onSnapshot` (only the compat SDK does).
// Calling it as a method throws `TypeError: t.onSnapshot is not a function`
// in production. The standalone function works because it accepts a Query
// / CollectionReference as its first argument directly.
//
// 2026-07-26 — IMPORTANT: we now expose `ref` on each returned doc so the
// App.jsx events-merge dedup can compute `_ownerUid` from `e.ref.path`.
// Without this, collectionGroup('events') results have no path binding,
// the dedup produces duplicate keys (undefined/ownerUid), and the partner
// sees the same event rendered twice on the dashboard.
//
// Usage:
//   const { data: events } = useFirestoreCollection(
//     user ? collection(db, 'artifacts', appId, 'users', user.uid, 'events') : null,
//     [user?.uid, appId]
//   );

import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

export function useFirestoreCollection(collectionRef, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(collectionRef));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!collectionRef) {
      setData([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    // 2026-07-27 — cancelled-flag pattern. Firestore can resolve
    // onSnapshot AFTER the component unmounts (race between the
    // subscription's first tick and our cleanup). The previous
    // code called setData on a torn-down component, which logs
    // "Can't perform a React state update on an unmounted
    // component" in dev. See https://github.com/savetheday-io
    // session 20260726_110814 for context.
    let cancelled = false;
    // Standalone-function form (works in modular SDK v10.x). NOT the method
    // form (`collectionRef.onSnapshot(...)`) which throws in production.
    const unsub = onSnapshot(
      collectionRef,
      (snapshot) => {
        if (cancelled) return;
        setData(snapshot.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('useFirestoreCollection error:', err);
        setError(err);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}