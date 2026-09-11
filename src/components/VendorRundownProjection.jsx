// 2026-09-11 — P12.3 per-event rundown projection listener.
//
// Background
// ----------
// Each vendor's dashboard subscribes to per-event rundown
// PROJECTIONS — sanitized, read-only copies of the couple's
// rundown that include every entry (not just the ones assigned
// to the viewer). The projection lives at:
//
//   artifacts/{appId}/users/{ownerUid}/events/{eventId}/
//     vendorViews/{vendorUid}/rundown/{entryId}
//
// Firestore rules gate this collection by a `vendorAccess`
// marker on the parent event — see firestore.rules (out of
// scope for this PR). The vendor-side component MUST scope
// reads per-event, never via a global collectionGroup.
//
// Why a per-event subscription instead of one collectionGroup?
//   1. The collectionGroup query would have to filter by
//      `vendorUid == auth.uid`, but firestore.rules can't
//      evaluate cross-document filters inside collectionGroup
//      queries the way it can for client-side filters. Scoping
//      by path lets the rule do the gate.
//   2. The vendor's assigned-rows query is already scoped per
//      event (via the parent /events/{eventId}/ path); pairing
//      the projection the same way keeps the lifecycle simple
//      (subscribe when we know the eventId, unsubscribe when
//      the assigned rows vanish).
//   3. Failure isolation: a broken event listener must not
//      kill sibling listeners. Each instance wraps its onError
//      callback, and the parent wraps each instance in a
//      per-event ErrorBoundary (see App.jsx).
//
// What this component renders
// ---------------------------
// Nothing. It is a "headless" subscription that calls
// `onSnapshot(docs)` whenever the per-vendor projection
// changes, and `onError(err)` if the subscription fails.
// Cleanup is automatic on unmount.
//
// Sanitization
// ------------
// The component calls `doc.data()` and merges with the
// expected sanitized fields, explicitly NOT trusting raw
// doc shape. The server-side writer is responsible for
// emitting only vendor-safe fields (no internal owner notes,
// no comment counts, etc.).

import { useEffect } from 'react';
import {
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

/**
 * Sanitize a projection doc into a plain plain object.
 * Whitelist of fields is enforced server-side; this is a
 * defensive copy so the UI never reads raw DocumentSnapshot.
 */
function sanitize(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ownerUid: data.ownerUid ?? null,
    eventId: data.eventId ?? null,
    vendorUid: data.vendorUid ?? null,
    entryId: data.entryId ?? docSnap.id,
    title: data.title ?? '（未命名項目）',
    group: data.group ?? null,
    startTime: data.startTime ?? null,
    endTime: data.endTime ?? null,
    durationMinutes: data.durationMinutes ?? null,
    location: data.location ?? null,
    sequence: data.sequence ?? null,
    isAssignedToViewer: data.isAssignedToViewer === true,
    operationalStatus: data.operationalStatus ?? 'scheduled',
    reportedDelayMinutes:
      typeof data.reportedDelayMinutes === 'number'
        ? data.reportedDelayMinutes
        : 0,
    approvedDelayMinutes:
      typeof data.approvedDelayMinutes === 'number'
        ? data.approvedDelayMinutes
        : 0,
    updatedAt: data.updatedAt ?? null,
    sourceVersion: data.sourceVersion ?? null,
  };
}

/**
 * Per-event projection subscription.
 *
 * Mounts an `onSnapshot` listener on the vendor-scoped rundown
 * projection. Calls `onSnapshot(rows, { ownerUid, eventId })`
 * on every successful emission, `onError(err, { ownerUid, eventId })`
 * on listener failure. Returns null — the parent handles layout.
 *
 * @param {object} props
 * @param {string} props.ownerUid
 * @param {string} props.eventId
 * @param {string} props.vendorUid
 * @param {Function} [props.onSnapshot] (rows, meta) => void
 * @param {Function} [props.onError] (err, meta) => void
 */
export function VendorRundownProjection({
  ownerUid,
  eventId,
  vendorUid,
  onSnapshot: onSnapshotProp,
  onError: onErrorProp,
}) {
  useEffect(() => {
    // Defensive: don't subscribe unless we have a complete
    // addressable path. The vendorAccess rule would reject a
    // partial path anyway, but failing fast here keeps the
    // listener counts honest.
    if (!ownerUid || !eventId || !vendorUid) {
      return undefined;
    }
    const meta = { ownerUid, eventId };
    let cancelled = false;
    let unsubscribe = null;

    try {
      const colRef = collection(
        db,
        'artifacts',
        appId,
        'users',
        ownerUid,
        'events',
        eventId,
        'vendorViews',
        vendorUid,
        'rundown',
      );
      unsubscribe = onSnapshot(
        colRef,
        (snap) => {
          if (cancelled) return;
          const rows = snap.docs.map(sanitize);
          if (onSnapshotProp) onSnapshotProp(rows, meta);
        },
        (err) => {
          if (cancelled) return;
          // eslint-disable-next-line no-console
          console.warn(
            '[VendorRundownProjection] snapshot failed:',
            err?.message,
            meta,
          );
          if (onErrorProp) onErrorProp(err, meta);
        },
      );
    } catch (err) {
      // Synchronous setup failure (e.g. invalid path). Same
      // surface as an async listener error so the parent can
      // react identically.
      // eslint-disable-next-line no-console
      console.warn(
        '[VendorRundownProjection] setup failed:',
        err?.message,
        meta,
      );
      if (onErrorProp) onErrorProp(err, meta);
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [ownerUid, eventId, vendorUid, onSnapshotProp, onErrorProp]);

  return null;
}

export default VendorRundownProjection;
