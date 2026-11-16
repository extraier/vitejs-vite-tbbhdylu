// useHelperAuth — for signed-in users who are helpers (兄弟姊妹).
//
// Returns:
//   - assignments: list of weddings where the current user is an active helper
//   - isHelper: boolean shortcut
//   - getPerms(ownerUid): returns the perms for a specific owner's wedding
//   - acceptInvite(): flips status from 'invited' to 'active'
//
// Usage:
//   const { isHelper, getPerms, acceptInvite } = useHelperAuth();
//   if (isHelper) {
//     const perms = getPerms(currentOwnerUid);
//     if (perms?.canScan) { ... }
//   }

import { useCallback, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  listMyHelperAssignments,
  helpersApi,
  type HelperDoc,
  type HelperPerms,
} from '../lib/helpers';

export function useHelperAuth() {
  const [assignments, setAssignments] = useState<HelperDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      setAssignments([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await listMyHelperAssignments();
      setAssignments(list);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auth restore is async. A one-shot read on mount often runs
  // before currentUser exists, stores [], and never looks again —
  // the waiting screen then shows "no invite" for a real helper.
  useEffect(() => {
    const auth = getAuth();
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, () => {
      if (!cancelled) refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refresh]);

  const acceptInvite = useCallback(async () => {
    setLoading(true);
    try {
      await helpersApi.accept();
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const getPerms = useCallback(
    (ownerUid: string): HelperPerms | null => {
      const match = assignments.find((a) => a.ownerUid === ownerUid && a.status === 'active');
      return match?.perms ?? null;
    },
    [assignments],
  );

  return {
    assignments,
    loading,
    error,
    isHelper: assignments.some((a) => a.status === 'active'),
    getPerms,
    acceptInvite,
    refresh,
    helpersApi,
  };
}