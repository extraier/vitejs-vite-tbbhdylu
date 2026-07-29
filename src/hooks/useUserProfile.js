// 2026-07-30 — useUserProfile hook.
//
// Real-time subscription to the user doc + unlocks subcollection, so
// any screen that needs "what's the user's premium tier? what unlocks
// do they have?" can call this hook and get live updates.
//
// Field sources (all under artifacts/{appId}/users/{uid}):
//
//   tier         — set by grantUnlock() in functions/src/unlocks.ts
//                  when the user gets any unlock. Phase 4 wiring.
//   promotedAt   — same write. Timestamp of first unlock.
//   createdAt    — set by referralCodes.onUserCreate() in the Auth
//                  trigger. Timestamp of account creation.
//   unlocks[]    — array of UnlockType strings, one per doc in
//                  users/{uid}/unlocks. Each doc has a `type` field.
//
// Loading semantics:
//   - loading=true on mount, until at least one unlock snapshot fires
//   - The user doc snapshot fires immediately (the doc always exists;
//     even for a fresh signup it has referralCode from onUserCreate).
//   - The unlocks subcollection may be empty (returning a 0-doc
//     snapshot), which still flips loading=false.
//
// Subscriptions are cleaned up on unmount or uid change.
//
// Used by:
//   - EventsDashboard (replaces the inline useEffect added in Phase 4)
//   - MyProfile (new — the profile screen)

import { useEffect, useState } from 'react';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

export function useUserProfile(user) {
  const uid = user?.uid;

  const [tier, setTier] = useState(null);
  const [promotedAt, setPromotedAt] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [unlocks, setUnlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      // Anonymous / not signed in — reset everything and stay
      // loading=false so callers don't render a persistent spinner.
      setTier(null);
      setPromotedAt(null);
      setCreatedAt(null);
      setUnlocks([]);
      setLoading(false);
      return undefined;
    }

    // User doc snapshot — tier, promotedAt, createdAt.
    // The user doc always exists (Auth-trigger onUserCreate writes it
    // on signup), so we don't gate on .exists().
    const userRef = doc(db, 'artifacts', appId, 'users', uid);
    const unsubUser = onSnapshot(userRef, (snap) => {
      const data = snap.data() || {};
      setTier(data.tier || null);
      setPromotedAt(data.promotedAt || null);
      setCreatedAt(data.createdAt || null);
    });

    // Unlocks subcollection — list of unlockType strings.
    const unlocksRef = collection(db, 'artifacts', appId, 'users', uid, 'unlocks');
    const unsubUnlocks = onSnapshot(unlocksRef, (snap) => {
      const types = snap.docs
        .map((d) => d.data()?.type)
        .filter(Boolean);
      setUnlocks(types);
      setLoading(false);
    });

    return () => {
      unsubUser();
      unsubUnlocks();
    };
  }, [uid]);

  return { tier, unlocks, createdAt, promotedAt, loading };
}
