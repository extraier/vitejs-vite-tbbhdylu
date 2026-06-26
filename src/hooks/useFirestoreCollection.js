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
    // Standalone-function form (works in modular SDK v10.x). NOT the method
    // form (`collectionRef.onSnapshot(...)`) which throws in production.
    const unsub = onSnapshot(
      collectionRef,
      (snapshot) => {
        setData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('useFirestoreCollection error:', err);
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}