// useMergedVendors — combines the live /vendors Firestore
// subscription with the hardcoded DEFAULT_VENDORS fallback
// into a single `vendors` array for the discover / catalog UI.
//
// Replaces the inline useEffect(onSnapshot) + filter +
// useMemo merge that lived in App.jsx (lines 770-853). Pure
// logic lives in src/lib/vendorPure so it can be unit-tested
// without React or Firebase.
//
// Returns `{ vendors, loading, error }` so callers can show
// a spinner during the initial fetch and surface any
// subscription failure.
//
// The hook does NOT poll / refetch on a timer — Firestore's
// onSnapshot pushes updates as the collection changes, which
// is what the previous inline useEffect did too. Same surface,
// same behavior, fewer lines.

import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useFirestoreCollection } from './useFirestoreCollection';
import { normalizeLiveVendor, mergeVendors } from '../lib/vendorPure';
import { DEFAULT_VENDORS } from '../lib/config';

export function useMergedVendors() {
  const { data: liveDocs, loading, error } = useFirestoreCollection(
    collection(db, 'vendors'),
  );
  const vendors = useMemo(() => {
    const live = liveDocs
      .map((d) => normalizeLiveVendor(d.id, d))
      .filter(Boolean);
    // Cast through unknown: MergedVendor (string ids) and
    // Vendor (number ids) are structurally compatible for
    // every property consumers actually read. The string /
    // number id divergence is intentional — see vendorPure.ts
    // "deliberately NOT importing the strict Vendor type".
    return mergeVendors(live, DEFAULT_VENDORS);
  }, [liveDocs]);
  return { vendors, loading, error };
}
