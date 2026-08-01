/**
 * Cloud Functions — Event-Level Owner Names
 * =========================================
 *
 * 2026-08-01 — Owner / bride display names live PER-EVENT on
 * /artifacts/{appId}/users/{uid}/events/{eventId} as flat
 * `boyName` / `girlName` fields. Per-event (NOT per-user) so:
 *   - a wedding planner running 30 weddings enters the names once
 *     per couple/event, not once globally.
 *   - co-owners (partners) share the same names automatically —
 *     one person enters, both see the same value.
 *
 * Access model
 * ------------
 * The CF accepts callers who are EITHER:
 *   - the event owner (`auth.uid == data.userId` on the event doc)
 *   - a co-owner on the event (`auth.uid in data.coOwners`)
 * Guests / helpers / vendors are rejected.
 *
 * Why a Callable instead of a direct-rules update:
 *   - The event doc carries a lot of state (date, venue, rundown
 *     entries, etc). Letting the client write `boyName` via
 *     Firestore rules would either need a strict
 *     `affectedKeys().hasOnly(['boyName','girlName','updatedAt'])`
 *     rule OR a separate subcollection for owner-names. Both add
 *     complexity. The CF keeps the write path server-side.
 *   - Co-owner access lives in CF code, not rules — easier to
 *     audit than chasing the rule engine.
 *   - Server-side validation (cleanEventOwnerNames) is the only
 *     place where the 30-char cap + empty-pair rejection lives;
 *     client + server stay in sync.
 *
 * Pure logic (cleanName / cleanEventOwnerNames) lives in
 * userProfileLogic.ts so it can be unit-tested without an
 * emulator. This file only owns the side-effects:
 *   - auth check
 *   - event access check (owner OR co-owner)
 *   - firestore write (Admin SDK + merge:true on event doc)
 *   - server timestamp
 *
 * Return value: { ok: true, eventId, boyName, girlName } so the
 * client can refresh its optimistic state without re-subscribing.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { cleanEventOwnerNames } from './userProfileLogic';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();
// 2026-07-18 — Cloud functions were reading/writing under
// `.collection('artifacts').doc(appId)` (random doc ID). Every Firestore
// read+write from the client SDK goes to `.doc('savetheday-production')`.
// So the functions were creating docs in a parallel, isolated namespace
// that no client could ever see. Fix: every CF that touches /artifacts
// must hard-code `appId = 'savetheday-production'` (matching the
// constant in the front-end lib/firebase.ts).
const appId = 'savetheday-production';

function eventRef(uid: string, eventId: string) {
  return db
    .collection('artifacts').doc(appId)
    .collection('users').doc(uid)
    .collection('events').doc(eventId);
}

/**
 * Throws HttpsError if `uid` is not the owner or a co-owner of
 * `eventId`. Reads the event doc once; cheap relative to the
 * Firestore write that follows.
 *
 * Co-owner semantics: `data.coOwners` is `string[]`. We accept the
 * primary owner (`data.userId`) OR any entry in `coOwners`. An
 * event with `coOwners` undefined or non-array is treated as
 * owner-only — defensive against older event docs.
 */
async function assertEventAccess(uid: string, eventId: string): Promise<void> {
  const snap = await eventRef(uid, eventId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Event ${eventId} not found.`);
  }
  const data = snap.data() || {};
  const ownerUid: string | undefined = data.userId;
  const coOwners: string[] = Array.isArray(data.coOwners) ? data.coOwners : [];
  if (uid !== ownerUid && !coOwners.includes(uid)) {
    throw new HttpsError('permission-denied', 'You do not have access to this event.');
  }
}

/**
 * updateOwnerNames — callable that writes `boyName` and
 * `girlName` to a specific event doc the caller owns or co-owns.
 * Admin SDK bypass of Firestore rules means we can write narrowly
 * without exposing the event doc to client-side privilege
 * escalation (e.g. setting `coOwners` or `userId`).
 */
export const updateOwnerNames = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const { eventId, boyName, girlName } = req.data || {};
    if (typeof eventId !== 'string' || !eventId) {
      throw new HttpsError('invalid-argument', 'eventId is required.');
    }

    const result = cleanEventOwnerNames({ boyName, girlName });
    if (!result.ok) {
      throw new HttpsError('invalid-argument', result.message);
    }
    const cleaned = result.cleaned;

    await assertEventAccess(uid, eventId);

    // narrow setDoc: only the two whitelisted fields + updatedAt.
    // merge:true so any race with co-owner edits doesn't clobber
    // other event fields (date, venue, rundown, etc).
    await eventRef(uid, eventId).set(
      {
        boyName: cleaned.boyName,
        girlName: cleaned.girlName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      eventId,
      boyName: cleaned.boyName,
      girlName: cleaned.girlName,
    };
  },
);
