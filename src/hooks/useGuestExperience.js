// useGuestExperience.js
// =====================
//
// 2026-08-23 — Manus P2b hook: subscribe to the
// `guestExperience/public` projection document on a given event.
//
// This is the canonical READ path for the guest portal in P2. The
// projection is owned by the `publishGuestExperience` callable (owner
// side) and consumed by guests via this hook. The hook follows the
// existing `useFirestoreDoc` pattern (see ./useFirestoreDoc.js) — it
// returns `{ data, loading, error }` where `data` is null until the
// snapshot resolves.
//
// IMPORTANT — privacy boundary:
//   The hook reads `guestExperience/public`, NOT the canonical
//   `/events/{eventId}` doc. The public projection is what the owner
//   chose to publish — it intentionally excludes guest identifiers,
//   guest lists, email, phone, gift amount, check-in fields, and
//   internal notes (see functions/src/guestExperience.pure.ts +
//   PDF §3.1 data model). The hook does NOT fall back to
//   `currentEvent` or any other doc — that fallback was the source
//   of the privacy regression we're fixing.
//
// Usage:
//   const { data: guestExperience, loading, error } = useGuestExperience({
//     enabled: isGuestMode,
//     ownerUid: guest.qOwner,
//     eventId: guest.qEvent,
//   });
//   if (guestExperience?.hero?.coupleNames) { ... }

import { useMemo } from 'react';
import { doc } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';
import { useFirestoreDoc } from './useFirestoreDoc';

/**
 * Subscribe to the public guestExperience projection for one event.
 *
 * @param {object} args
 * @param {boolean} args.enabled - Set false to opt out (returns null
 *   data without subscribing). Used by App.jsx to gate the hook on
 *   guest mode + token redemption + owner-mode fallback paths.
 * @param {string|null|undefined} args.ownerUid - Owner's auth uid.
 * @param {string|null|undefined} args.eventId - Event document id.
 * @returns {{ data: object|null, loading: boolean, error: Error|null }}
 */
export function useGuestExperience({ enabled, ownerUid, eventId }) {
  const ref = useMemo(
    () =>
      enabled && ownerUid && eventId
        ? doc(
            db,
            'artifacts',
            appId,
            'users',
            ownerUid,
            'events',
            eventId,
            'guestExperience',
            'public',
          )
        : null,
    [enabled, ownerUid, eventId],
  );
  return useFirestoreDoc(ref, [enabled, ownerUid, eventId]);
}
