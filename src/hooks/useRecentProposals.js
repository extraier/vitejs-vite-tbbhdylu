// 2026-08-08 — useRecentProposals
//
// Subscribes to the most recent proposals on jobs owned by the
// couple. Powers the notifications dropdown panel that the header
// 🔔 bell opens (instead of deep-linking to the 徵求報價 board).
//
// Approach: query /proposals filtered by coupleUid, then sort
// client-side by createdAt desc and cap at 20. The couple's
// firestore.rules already permit reading proposals where
// coupleUid == request.auth.uid, so the query is rule-compliant.
//
// Why client-side sort (not orderBy + composite index):
//   - Firestore needs a composite index for (coupleUid ASC, createdAt DESC)
//     on /proposals. Indexes cost extra reads and take 5-10 min to
//     build. Sorting ≤20 items client-side is trivial and avoids the
//     index entirely. The page also avoids burning index build slots
//     that are better spent on real query patterns.
//
// Tradeoffs:
//   - We don't filter by "unread" here — the dropdown shows the most
//     recent 20 always. "Unread" is computed via localStorage on the
//     consumer side (see useProposalBell.js).
//   - 20 items is a soft cap; past that the panel scrolls.
//   - We fetch ALL proposals for the couple to sort them. A heavy
//     vendor with thousands of proposals would push too many reads.
//     At our current scale (couples have ~10-50 proposals each) this
//     is fine. If a couple ever hits 1000+, switch to a paginated
//     query or create the composite index.
//   - Per-job click navigation is the consumer's responsibility —
//     the hook just returns the docs.

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
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
      // No orderBy here — sorting happens client-side to avoid the
      // (coupleUid, createdAt) composite index requirement.
      const q = query(
        collection(db, 'proposals'),
        where('coupleUid', '==', coupleUid),
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
          // Firestore Timestamps have a toMillis() we can sort by;
          // fall back to 0 for missing/malformed values so the row
          // still surfaces (but ranks at the bottom).
          list.sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
          setProposals(list.slice(0, MAX_ITEMS));
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
