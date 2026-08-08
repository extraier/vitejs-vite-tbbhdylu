// 2026-08-08 — useRecentProposals
//
// Subscribes to the most recent proposals on jobs owned by the
// couple. Powers the notifications dropdown panel that the header
// 🔔 bell opens (instead of deep-linking to the 徵求報價 board).
//
// Approach: query /proposals filtered by coupleUid, sorted by
// createdAt desc, capped at 20. The couple's rules in firestore.rules
// already permit reading proposals where coupleUid == request.auth.uid,
// so the query is rule-compliant.
//
// Tradeoffs:
//   - We don't filter by "unread" here — the dropdown shows the most
//     recent 20 always. "Unread" is computed via localStorage on the
//     consumer side (see useProposalBell.js).
//   - 20 items is a soft cap; past that the panel scrolls.
//   - Per-job click navigation is the consumer's responsibility —
//     the hook just returns the docs.

import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

const MAX_ITEMS = 20;

export function useRecentProposals({ coupleUid, enabled = true }) {
  const [proposals, setProposals] = useState(null); // null = loading, [] = empty
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !coupleUid) {
      setProposals([]);
      return undefined;
    }

    let cancelled = false;
    setProposals(null);
    setError(null);

    let unsub = () => {};
    try {
      const q = query(
        collection(db, 'proposals'),
        where('coupleUid', '==', coupleUid),
        orderBy('createdAt', 'desc'),
        limit(MAX_ITEMS),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              jobId: data.jobId || '',
              vendorUid: data.vendorUid || '',
              vendorName: data.vendorName || '商戶',
              price: data.price || '',
              message: data.message || '',
              // raw Firestore Timestamp (consumer formats)
              createdAt: data.createdAt,
            };
          });
          setProposals(list);
        },
        (err) => {
          if (cancelled) return;
          console.error('[useRecentProposals] onSnapshot error:', err);
          setError(err.message || '讀取失敗');
          setProposals([]);
        },
      );
    } catch (err) {
      console.error('[useRecentProposals] subscription failed:', err);
      setError(err.message || '讀取失敗');
      setProposals([]);
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [coupleUid, enabled]);

  return { proposals, error };
}
