// guestExperience.ts
// ==================
//
// 2026-08-23 — Manus P2a: 4 server-authoritative callables for the
// guestExperience projection. PDF §3.2.
//
// Why this file is thin:
// All decision logic lives in `./guestExperience.pure.ts` so tests
// can import it without pulling in firebase-admin (see
// firebase-functions-testability skill Trap #1).
//
// The 4 callables:
//   - publishGuestExperience  — owner-side: draft → public projection
//   - getGuestPortalBootstrap — guest-side: minimal profile (no PII)
//   - respondToRsvp           — guest-side: RSVP write (only this path
//                                can write /guests/{id} fields now)
//   - saveGuestMessage        — guest-side: 心意 / message write
//
// PDF §3.2 also requires moving the red-packet UI to a payment-intent
// / confirmation callable. That's P2c (commit `confirmRedPacket`).
// This file does NOT touch hasGifted / giftAmount — those writes still
// go through the rules-blocked client path until P2c lands.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  OwnershipError,
  LinkInvalidError,
  assertOwnerOrCoOwner,
  projectDraft,
  validateLinkShape,
  sanitizeRsvpRequest,
  mealChoiceIsAllowed,
  sanitizeGuestMessage,
  buildBootstrapGuest,
} from './guestExperience.pure';

const db = getFirestore();
const APP_ID = 'savetheday-production';
const REGION = 'us-central1';

// ---------------------------------------------------------------------------
// Doc refs (centralised so a future path-rename touches one line)
// ---------------------------------------------------------------------------

const eventRef = (ownerUid: string, eventId: string) =>
  db.doc(`artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}`);

const experienceRef = (
  ownerUid: string,
  eventId: string,
  id: 'draft' | 'public',
) =>
  db.doc(
    `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/guestExperience/${id}`,
  );

const linkRef = (ownerUid: string, authUid: string) =>
  db.doc(`artifacts/${APP_ID}/users/${ownerUid}/guestLinks/${authUid}`);

const guestRef = (ownerUid: string, eventId: string, guestDocId: string) =>
  db.doc(
    `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/guests/${guestDocId}`,
  );

// ---------------------------------------------------------------------------
// 1. publishGuestExperience — owner-side, draft → public
// ---------------------------------------------------------------------------

export const publishGuestExperience = onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const ownerUid = String(req.data?.ownerUid ?? '').trim().slice(0, 128);
    const eventId = String(req.data?.eventId ?? '').trim().slice(0, 128);
    if (!ownerUid || !eventId) {
      throw new HttpsError('invalid-argument', 'ownerUid and eventId required');
    }

    const [eventSnap, draftSnap] = await Promise.all([
      eventRef(ownerUid, eventId).get(),
      experienceRef(ownerUid, eventId, 'draft').get(),
    ]);

    try {
      assertOwnerOrCoOwner(eventSnap.data(), ownerUid, req.auth.uid);
    } catch (err) {
      if (err instanceof OwnershipError) {
        throw new HttpsError(err.code, err.message);
      }
      throw err;
    }

    if (!draftSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        'guest experience draft required',
      );
    }

    const projection = projectDraft(draftSnap.data() ?? {});
    if (!projection) {
      throw new HttpsError(
        'failed-precondition',
        'couple names and date label are required',
      );
    }

    await experienceRef(ownerUid, eventId, 'public').set({
      ...projection,
      publishedAt: FieldValue.serverTimestamp(),
      publishedByUid: req.auth.uid,
    });
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// 2. getGuestPortalBootstrap — guest-side, minimal profile
// ---------------------------------------------------------------------------

export const getGuestPortalBootstrap = onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'guest session required');
    }
    const ownerUid = String(req.data?.ownerUid ?? '').trim().slice(0, 128);
    const eventId = String(req.data?.eventId ?? '').trim().slice(0, 128);
    if (!ownerUid || !eventId) {
      throw new HttpsError('invalid-argument', 'ownerUid and eventId required');
    }

    let linkGuestId: string;
    let guestDocId: string;
    try {
      const link = await linkRef(ownerUid, req.auth.uid).get();
      const verified = validateLinkShape(
        link.data() ?? null,
        ownerUid,
        eventId,
        req.auth.uid,
      );
      linkGuestId = verified.guestId;
      guestDocId = verified.guestDocId;
    } catch (err) {
      if (err instanceof LinkInvalidError) {
        throw new HttpsError('permission-denied', err.message);
      }
      throw err;
    }

    const guestSnap = await guestRef(ownerUid, eventId, guestDocId).get();
    if (!guestSnap.exists) {
      throw new HttpsError('not-found', 'guest record not found');
    }

    const guest = buildBootstrapGuest(
      guestSnap.id,
      (guestSnap.data() ?? {}) as Parameters<typeof buildBootstrapGuest>[1],
      linkGuestId,
    );
    if (!guest) {
      throw new HttpsError('not-found', 'guest record not found');
    }

    return { guest };
  },
);

// ---------------------------------------------------------------------------
// 3. respondToRsvp — guest-side, RSVP write
// ---------------------------------------------------------------------------

export const respondToRsvp = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError('unauthenticated', 'guest session required');
  }
  const ownerUid = String(req.data?.ownerUid ?? '').trim().slice(0, 128);
  const eventId = String(req.data?.eventId ?? '').trim().slice(0, 128);
  if (!ownerUid || !eventId) {
    throw new HttpsError('invalid-argument', 'invalid RSVP request');
  }

  let guestDocId: string;
  try {
    const link = await linkRef(ownerUid, req.auth.uid).get();
    const verified = validateLinkShape(
      link.data() ?? null,
      ownerUid,
      eventId,
      req.auth.uid,
    );
    guestDocId = verified.guestDocId;
  } catch (err) {
    if (err instanceof LinkInvalidError) {
      throw new HttpsError('permission-denied', err.message);
    }
    throw err;
  }

  // Load the public projection to gate RSVP on its policy fields
  // (enabled, deadline, mealOptions, allowPartySize, allowNote).
  const publicSnap = await experienceRef(ownerUid, eventId, 'public').get();
  if (!publicSnap.exists) {
    throw new HttpsError('failed-precondition', 'RSVP is unavailable');
  }
  const config = publicSnap.data()?.rsvp;
  if (!config || config.enabled !== true) {
    throw new HttpsError('failed-precondition', 'RSVP is unavailable');
  }
  if (
    config.deadlineAt &&
    typeof config.deadlineAt.toMillis === 'function' &&
    config.deadlineAt.toMillis() < Date.now()
  ) {
    throw new HttpsError('deadline-exceeded', 'RSVP deadline passed');
  }

  const sanitized = sanitizeRsvpRequest(
    {
      status: req.data?.status,
      partySize: req.data?.partySize,
      mealChoice: req.data?.mealChoice,
      note: req.data?.note,
    },
    {
      allowPartySize: config.allowPartySize === true,
      maxPartySize:
        typeof config.maxPartySize === 'number' ? config.maxPartySize : 1,
      allowNote: config.allowNote === true,
    },
  );
  if (!sanitized) {
    throw new HttpsError('invalid-argument', 'invalid RSVP request');
  }

  // Re-validate meal against the live projection's allowlist
  // (sanitizeRsvpRequest doesn't see it because meal options live
  // server-side, not on the request).
  if (
    !mealChoiceIsAllowed(sanitized.mealChoice, config.mealOptions ?? [])
  ) {
    throw new HttpsError('invalid-argument', 'invalid meal choice');
  }

  await guestRef(ownerUid, eventId, guestDocId).set(
    {
      rsvpStatus: sanitized.status,
      rsvpPartySize: sanitized.partySize,
      rsvpMealChoice: sanitized.mealChoice,
      rsvpNote: sanitized.note,
      rsvpUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});

// ---------------------------------------------------------------------------
// 4. saveGuestMessage — guest-side, message write
// ---------------------------------------------------------------------------

export const saveGuestMessage = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError('unauthenticated', 'guest session required');
  }
  const ownerUid = String(req.data?.ownerUid ?? '').trim().slice(0, 128);
  const eventId = String(req.data?.eventId ?? '').trim().slice(0, 128);
  if (!ownerUid || !eventId) {
    throw new HttpsError('invalid-argument', 'ownerUid and eventId required');
  }

  let guestDocId: string;
  try {
    const link = await linkRef(ownerUid, req.auth.uid).get();
    const verified = validateLinkShape(
      link.data() ?? null,
      ownerUid,
      eventId,
      req.auth.uid,
    );
    guestDocId = verified.guestDocId;
  } catch (err) {
    if (err instanceof LinkInvalidError) {
      throw new HttpsError('permission-denied', err.message);
    }
    throw err;
  }

  const { message } = sanitizeGuestMessage({ message: req.data?.message });

  await guestRef(ownerUid, eventId, guestDocId).set(
    {
      guestMessage: message,
      guestMessageUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});
