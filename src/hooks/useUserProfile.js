// 2026-07-30 — useUserProfile hook.
//
// Real-time subscription to the user doc + unlocks subcollection, so
// any screen that needs "what's the user's premium tier? what unlocks
// do they have?" can call this hook and get live updates.
//
// 2026-08-01 — added referral pipeline counts. Fetched from
// getMyReferralInfo Cloud Function (functions/src/referralCodes.ts).
// `referred` = people who signed up with this user's code.
// `claimed`  = referred friends who have ≥1 event (eligible to
//   count toward the storage-500mb unlock once admin verifies the
//   claim). `storageMbBonus` = derived locally: each
//   `storage-500mb` unlock = +500MB of bonus storage.
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
//   referralCode — set by referralCodes.onUserCreate(). The user's
//                  own STD-XXXXX code. Never changes after signup.
//
// Loading semantics:
//   - loading=true on mount, until at least one unlock snapshot fires
//   - The user doc snapshot fires immediately (the doc always exists;
//     even for a fresh signup it has referralCode from onUserCreate).
//   - The unlocks subcollection may be empty (returning a 0-doc
//     snapshot), which still flips loading=false.
//   - The referral fetch is independent: while in flight the
//     `referral.loading` flag stays true and the UI shows '…'.
//
// Subscriptions are cleaned up on unmount or uid change.

import { useEffect, useState } from 'react';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, appId, functions } from '../lib/firebase';

const STORAGE_BONUS_MB_PER_UNLOCK = 500;

export function useUserProfile(user) {
  const uid = user?.uid;

  const [tier, setTier] = useState(null);
  const [promotedAt, setPromotedAt] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [referralCode, setReferralCode] = useState(null);
  // 2026-08-01 — owner display names (新郎 / 新娘). User-scoped
  // (one pair per user, persists across all their events) so
  // a wedding planner who runs many weddings only enters the
  // names once. Propagated to the 大日流程 HelperPicker so the
  // couple can be assigned to rundown entries.
  const [ownerNames, setOwnerNames] = useState({ boyName: '', girlName: '' });
  const [unlocks, setUnlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Referral pipeline — { referred, claimed, loading, error }.
  // storageMbBonus is derived from `unlocks` (below) so the hook
  // never has two sources of truth for the same number.
  const [referral, setReferral] = useState({
    referred: 0,
    claimed: 0,
    loading: true,
    error: null,
  });

  // 1. User doc + unlocks subcollection (real-time).
  useEffect(() => {
    if (!uid) {
      setTier(null);
      setPromotedAt(null);
      setCreatedAt(null);
      setReferralCode(null);
      setOwnerNames({ boyName: '', girlName: '' });
      setUnlocks([]);
      setLoading(false);
      return undefined;
    }

    const userRef = doc(db, 'artifacts', appId, 'users', uid);
    const unsubUser = onSnapshot(userRef, (snap) => {
      const data = snap.data() || {};
      setTier(data.tier || null);
      setPromotedAt(data.promotedAt || null);
      setCreatedAt(data.createdAt || null);
      setReferralCode(data.referralCode || null);
      // 2026-08-01 — owner names live on the user doc as
      // `boyName` and `girlName` (flat string fields). Empty
      // string is the canonical "not set" shape; missing
      // fields are normalised to ''.
      setOwnerNames({
        boyName: data.boyName || '',
        girlName: data.girlName || '',
      });
    });

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

  // 2. Referral pipeline — single round-trip to getMyReferralInfo.
  // We use the function (not a query on /users) because:
  //   - referredCount is "people who signed up with my code" — this
  //     is NOT stored on the user doc, only the function knows it
  //     by counting `referredByCode === myCode` user docs.
  //   - claimedCount is "referred friends who have ≥1 event" — same
  //     story, and a Firestore `get()` per referred user would
  //     exceed the SDK's quota for big pipelines.
  //   - The function already exists for ReferralModal's track tab.
  useEffect(() => {
    if (!uid) {
      setReferral({ referred: 0, claimed: 0, loading: false, error: null });
      return undefined;
    }
    setReferral((prev) => ({ ...prev, loading: true, error: null }));
    let cancelled = false;
    const fn = httpsCallable(functions, 'getMyReferralInfo');
    fn()
      .then((res) => {
        if (cancelled) return;
        const data = res.data || {};
        setReferral({
          referred: data.referredCount || 0,
          claimed: data.claimedCount || 0,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[useUserProfile] getMyReferralInfo failed:', err?.code, err?.message);
        setReferral({
          referred: 0,
          claimed: 0,
          loading: false,
          error: err?.code === 'functions/unauthenticated' ? 'unauth' : 'other',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // 2026-08-01 — Persist owner names. Uses setDoc(merge:true) so
  // we only touch the two fields, never clobbering tier / unlocks
  // / referralCode / etc. The hook returns the new state so the
  // caller can show a toast (and so a re-render reflects the save
  // even if the realtime subscription is slow on this network).
  const saveOwnerNames = async (next) => {
    if (!uid) throw new Error('Not signed in');
    const userRef = doc(db, 'artifacts', appId, 'users', uid);
    const { setDoc } = await import('firebase/firestore');
    await setDoc(
      userRef,
      {
        boyName: next.boyName || '',
        girlName: next.girlName || '',
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    setOwnerNames({
      boyName: next.boyName || '',
      girlName: next.girlName || '',
    });
  };

  // Derived: each storage-500mb unlock = +500MB. Lives in the hook
  // so consumers don't have to know the pricing constant.
  const storageMbBonus = unlocks.filter((u) => u === 'storage-500mb').length * STORAGE_BONUS_MB_PER_UNLOCK;

  return {
    tier,
    unlocks,
    createdAt,
    promotedAt,
    referralCode,
    ownerNames,
    saveOwnerNames,
    referral: {
      referred: referral.referred,
      claimed: referral.claimed,
      storageMbBonus,
      loading: referral.loading,
      error: referral.error,
    },
    loading,
  };
}
