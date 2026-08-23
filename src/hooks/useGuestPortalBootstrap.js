// useGuestPortalBootstrap.js
// ===========================
//
// 2026-08-23 — Manus P2b hook: thin callable wrapper for the
// `getGuestPortalBootstrap` Cloud Function.
//
// WHY THIS HOOK EXISTS
// --------------------
// Pre-P2b, the guest portal read the active guest's record via a
// Firestore collection subscription on `/events/{eventId}/guests`
// and matched `guest.qGuest` against the returned list. That works,
// but it ALSO enumerates every other guest on the event — which is
// exactly the data exposure the P1 audit flagged. P1 rules still
// allowed it for backwards compat (we didn't want to break the
// portal between the P1 deploy and the P2b migration), but the
// PDF's P2b migration is the cleanup: the portal should pull
// ONLY its own bound guest via the bootstrap callable.
//
// The bootstrap callable's response shape (server-authoritative)
// is exactly what the guest portal needs and nothing more:
//   { guest: { id, guestId, name, tableNumber, rsvpStatus,
//              rsvpPartySize, rsvpMealChoice, rsvpNote,
//              guestMessage } }
// It deliberately omits email, phone, gift amount, check-in status,
// and internal notes. See functions/src/guestExperience.pure.ts +
// PDF §3.2 getGuestPortalBootstrap.
//
// USAGE
// -----
//   const { data: bootstrap, loading, error, refetch } =
//     useGuestPortalBootstrap({
//       enabled: isGuestMode && redeemStatus === 'ok' && !!user?.uid,
//       ownerUid: guest.qOwner,
//       eventId: guest.qEvent,
//     });
//   if (bootstrap?.guest) { ... bootstrap.guest.name ... }

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

/**
 * Fetch the canonical guest bootstrap via the
 * getGuestPortalBootstrap callable.
 *
 * @param {object} args
 * @param {boolean} args.enabled - Set false to opt out (no call fires).
 * @param {string|null|undefined} args.ownerUid
 * @param {string|null|undefined} args.eventId
 * @returns {{
 *   data: { guest: object } | null,
 *   loading: boolean,
 *   error: Error | null,
 *   refetch: () => void
 * }}
 */
export function useGuestPortalBootstrap({ enabled, ownerUid, eventId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refetch = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !ownerUid || !eventId) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const bootstrap = httpsCallable(functions, 'getGuestPortalBootstrap');
        const result = await bootstrap({ ownerUid, eventId });
        if (cancelled) return;
        // callable result is wrapped in `{ data: <payload> }`. The
        // payload itself is `{ guest: { ... } }` per
        // guestExperience.ts: getGuestPortalBootstrap.
        const payload = result?.data;
        if (!payload || !payload.guest) {
          setData(null);
          setError(new Error('guest portal bootstrap returned no guest'));
        } else {
          setData(payload);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, ownerUid, eventId, refreshTick]);

  return { data, loading, error, refetch };
}
