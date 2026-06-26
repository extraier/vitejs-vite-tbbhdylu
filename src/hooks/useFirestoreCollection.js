// Generic Firestore collection → React state hook.
//
// Replaces 5 nearly-identical useEffect(onSnapshot, deps) blocks that the
// original App.jsx inlined for events, guests, photos, tasks, notifications.
// Returns `{ data, loading, error }`. `loading` is true until the first
// snapshot fires (so callers can show spinners during initial fetch).
//
// IMPORTANT: We import `onSnapshot` from `firebase/firestore` here even
// though we call it as a method on `collectionRef`. Importing the standalone
// function has the side effect of patching
// `CollectionReference.prototype.onSnapshot`, which is what we need.
//
// Usage:
//   const { data: events } = useFirestoreCollection(
//     user ? collection(db, 'artifacts', appId, 'users', user.uid, 'events') : null,
//     [user?.uid, appId]
//   );

import { useEffect, useState } from 'react';

// Note: `CollectionReference.prototype.onSnapshot` is the prototype method
// used inside this hook. The patch that installs that prototype method runs
// as a side effect of importing `onSnapshot` from `firebase/firestore`.
// That import happens in App.jsx (kept reachable via globalThis assignment).
// Do NOT import `onSnapshot` here — Rollup will tree-shake any local-only
// use (e.g. `void X`), and re-importing here would only fragment the bundle.

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
    const unsub = collectionRef.onSnapshot(
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
