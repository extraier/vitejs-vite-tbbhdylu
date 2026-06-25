// Generic Firestore collection → React state hook.
//
// Replaces 5 nearly-identical useEffect(onSnapshot, deps) blocks that the
// original App.jsx inlined for events, guests, photos, tasks, notifications.
// Returns `{ data, loading, error }`. `loading` is true until the first
// snapshot fires (so callers can show spinners during initial fetch).
//
// Usage:
//   const { data: events } = useFirestoreCollection(
//     user ? collection(db, 'artifacts', appId, 'users', user.uid, 'events') : null,
//     [user?.uid, appId]
//   );

import { useEffect, useState } from 'react';

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
