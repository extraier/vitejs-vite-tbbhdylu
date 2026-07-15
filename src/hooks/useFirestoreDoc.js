// Generic Firestore document → React state hook.
//
// Same pattern as useFirestoreCollection, but for a single document.
// Returns `{ data, loading, error }`. data is null until the snapshot
// resolves, or null forever if the doc doesn't exist.
//
// 2026-07-15 — used by the VendorDashboard to live-read the signed-in
// vendor's own profile from /vendors/{uid}. Replaces the previously
// hardcoded "Visionary Capture" display name.
//
// Usage:
//   const { data: vendor } = useFirestoreDoc(
//     user ? doc(db, 'vendors', user.uid) : null,
//     [user?.uid]
//   );

import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

export function useFirestoreDoc(docRef, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(docRef));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!docRef) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = onSnapshot(
      docRef,
      (snapshot) => {
        setData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('useFirestoreDoc error:', err);
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}