/**
 * Move gift amounts off the guest doc.
 *
 * guestGifts/{guestId} is the enforced store (rules require
 * canViewGiftAmount, ownership, or the guest's own link).
 * guestDirectory/{guestId} is a sanitized projection helpers
 * without that permission can list. Client writes to both are
 * denied; this module uses the Admin SDK.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  hasLegacyGiftFields,
  legacyGiftRecord,
  shouldReplaceGiftDoc,
  stripGiftFields,
} from './guestGifts.pure';

const db = getFirestore();
const APP_ID = 'savetheday-production';
const REGION = 'us-central1';

const eventDoc = (appId: string, ownerUid: string, eventId: string) =>
  db.doc(`artifacts/${appId}/users/${ownerUid}/events/${eventId}`);

const guestsCol = (appId: string, ownerUid: string, eventId: string) =>
  eventDoc(appId, ownerUid, eventId).collection('guests');

const giftDoc = (appId: string, ownerUid: string, eventId: string, guestId: string) =>
  eventDoc(appId, ownerUid, eventId).collection('guestGifts').doc(guestId);

const directoryDoc = (appId: string, ownerUid: string, eventId: string, guestId: string) =>
  eventDoc(appId, ownerUid, eventId).collection('guestDirectory').doc(guestId);

async function callerMaySplit(
  uid: string,
  admin: boolean,
  ownerUid: string,
  eventId: string,
): Promise<boolean> {
  if (admin || uid === ownerUid) return true;
  const eventSnap = await eventDoc(APP_ID, ownerUid, eventId).get();
  if (!eventSnap.exists) return false;
  const coOwners = eventSnap.data()?.coOwners;
  if (Array.isArray(coOwners) && coOwners.includes(uid)) return true;
  const coSnap = await db.doc(`artifacts/${APP_ID}/users/${ownerUid}/coOwners/${uid}`).get();
  if (coSnap.exists && coSnap.data()?.status === 'active') return true;
  const helperSnap = await db.doc(`artifacts/${APP_ID}/users/${ownerUid}/helpers/${uid}`).get();
  if (helperSnap.exists && helperSnap.data()?.status === 'active') {
    const perms = helperSnap.data()?.perms || {};
    if (perms.canViewGuestList === true || perms.canEditGuests === true || perms.canViewGiftAmount === true) {
      return true;
    }
  }
  return false;
}

/**
 * Copy legacy gift fields into guestGifts and refresh guestDirectory.
 * Does not return amounts. Safe for a helper who cannot view them.
 */
export const splitEventGuestGifts = onCall(
  { cors: true, region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const ownerUid = String(req.data?.ownerUid ?? '').trim();
    const eventId = String(req.data?.eventId ?? '').trim();
    if (!ownerUid || !eventId) {
      throw new HttpsError('invalid-argument', 'ownerUid and eventId required.');
    }
    const admin = req.auth.token.admin === true;
    const allowed = await callerMaySplit(req.auth.uid, admin, ownerUid, eventId);
    if (!allowed) throw new HttpsError('permission-denied', 'Not allowed to split gift fields.');

    const [guestSnap, giftSnap] = await Promise.all([
      guestsCol(APP_ID, ownerUid, eventId).get(),
      eventDoc(APP_ID, ownerUid, eventId).collection('guestGifts').get(),
    ]);
    const existingGifts = new Map(giftSnap.docs.map((d) => [d.id, d.data()]));

    let moved = 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const guest of guestSnap.docs) {
      const data = guest.data() || {};
      batch.set(directoryDoc(APP_ID, ownerUid, eventId, guest.id), stripGiftFields(data));
      ops += 1;
      const legacy = legacyGiftRecord(data);
      if (legacy && shouldReplaceGiftDoc(existingGifts.get(guest.id), legacy)) {
        batch.set(giftDoc(APP_ID, ownerUid, eventId, guest.id), {
          ...legacy,
          guestId: typeof data.guestId === 'string' ? data.guestId : null,
          migratedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        ops += 1;
        moved += 1;
      }
      if (hasLegacyGiftFields(data)) {
        batch.update(guest.ref, {
          giftAmount: FieldValue.delete(),
          hasGifted: FieldValue.delete(),
          lastGiftedAt: FieldValue.delete(),
        });
        ops += 1;
      }
      if (ops >= 400) await flush();
    }
    await flush();
    return { ok: true, guests: guestSnap.size, moved };
  },
);

export const onGuestGiftFieldsWritten = onDocumentWritten(
  {
    document: 'artifacts/{appId}/users/{ownerUid}/events/{eventId}/guests/{guestId}',
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const { appId, ownerUid, eventId, guestId } = event.params;
    const after = event.data?.after;
    const dirRef = directoryDoc(appId, ownerUid, eventId, guestId);
    if (!after?.exists) {
      await dirRef.delete().catch(() => undefined);
      return;
    }
    const data = after.data() || {};
    const legacy = legacyGiftRecord(data);
    const writes: Promise<unknown>[] = [
      dirRef.set(stripGiftFields(data)),
    ];
    if (legacy) {
      const giftRef = giftDoc(appId, ownerUid, eventId, guestId);
      const existing = await giftRef.get();
      if (shouldReplaceGiftDoc(existing.data(), legacy)) {
        writes.push(giftRef.set({
          ...legacy,
          guestId: typeof data.guestId === 'string' ? data.guestId : null,
          migratedAt: FieldValue.serverTimestamp(),
        }, { merge: true }));
      }
      writes.push(after.ref.update({
        giftAmount: FieldValue.delete(),
        hasGifted: FieldValue.delete(),
        lastGiftedAt: FieldValue.delete(),
      }));
    }
    await Promise.all(writes);
  },
);
