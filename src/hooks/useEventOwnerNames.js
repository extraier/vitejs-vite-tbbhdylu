// 2026-08-01 (pivot) — useEventOwnerNames hook.
//
// Subscribes to /artifacts/{appId}/users/{uid}/events/{eventId}
// for the couple's display names (boyName / girlName) and exposes
// { ownerNames, saveOwnerNames, loading }.
//
// Replaces the user-scoped ownerNames from useUserProfile. Co-owners
// (partners) share the same names automatically because the data
// lives on the event doc, which they both have read access to.
//
// Server-side: updateOwnerNames Cloud Function (see
// functions/src/userProfile.ts) validates the caller is owner OR
// co-owner of `eventId` before writing. We pass `eventId` + `ownerUid`
// in the payload and trust the server's cleaned response.
//
// Uid semantics:
//   - The caller (EventSettingsModal / OwnerNamesEditor) passes the
//     OWNER's uid as the `uid` parameter here. App.jsx overrides
//     `currentUser.uid = event._ownerUid` when opening the modal so
//     the read path (subscription) and write path (CF ownerUid) both
//     resolve to the owner's user doc.
//   - For single-owner events this is the same as the caller's uid.
//   - For co-owner editors `uid` is the partner's uid (the event's
//     _ownerUid), not the caller's uid. The CF's auth.uid is still
//     the actual logged-in user; we pass `ownerUid` separately so
//     the CF can locate the doc.
//
// Commit-1 fallback: if the event doc has neither boyName nor
// girlName AND the caller passes an optional `fallbackNames` prop
// (from the legacy user-level field), use those + emit a one-time
// console.warn so we can audit how many users still need migration
// in Commit 2. Removed in Commit 2.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, appId } from '../lib/firebase';

export function useEventOwnerNames(eventId, uid, fallbackNames) {
  const [ownerNames, setOwnerNames] = useState({ boyName: '', girlName: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !eventId) {
      setOwnerNames({ boyName: '', girlName: '' });
      setLoading(false);
      return undefined;
    }
    const eventRef = doc(db, 'artifacts', appId, 'users', uid, 'events', eventId);
    const unsub = onSnapshot(eventRef, (snap) => {
      const data = snap.data() || {};
      const fromEvent = {
        boyName: data.boyName || '',
        girlName: data.girlName || '',
      };
      if (
        !fromEvent.boyName &&
        !fromEvent.girlName &&
        fallbackNames &&
        (fallbackNames.boyName || fallbackNames.girlName)
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          '[useEventOwnerNames] falling back to user-level names (will be removed in Commit 2 migration):',
          fallbackNames,
        );
        setOwnerNames({
          boyName: fallbackNames.boyName || '',
          girlName: fallbackNames.girlName || '',
        });
      } else {
        setOwnerNames(fromEvent);
      }
      setLoading(false);
    });
    return unsub;
    // We intentionally only re-subscribe when the eventId or uid changes,
    // OR when the fallback names actually change. Falling-back mid-save
    // shouldn't re-trigger the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, eventId, fallbackNames?.boyName, fallbackNames?.girlName]);

  const saveOwnerNames = async (next) => {
    if (!uid || !eventId) {
      throw new Error('Not signed in or no event selected');
    }
    const updateOwnerNamesFn = httpsCallable(functions, 'updateOwnerNames');
    // 2026-08-01 (co-owner fix) — events live under the OWNER's user
    // doc, not the caller's. The hook's `uid` parameter is the
    // owner's uid (set by App.jsx modal override). We pass it as
    // `ownerUid` in the CF payload so the CF can locate the event
    // at `users/{ownerUid}/events/{eventId}` regardless of whether
    // the caller is the owner or a co-owner. For single-owner events
    // this is the same value as the caller's uid. Without this, the
    // CF would look up at the caller's path and throw not-found.
    const res = await updateOwnerNamesFn({
      eventId,
      ownerUid: uid,
      boyName: next.boyName || '',
      girlName: next.girlName || '',
    });
    const cleaned = res.data || {};
    setOwnerNames({
      boyName: cleaned.boyName ?? next.boyName ?? '',
      girlName: cleaned.girlName ?? next.girlName ?? '',
    });
    return cleaned;
  };

  return { ownerNames, saveOwnerNames, loading };
}
