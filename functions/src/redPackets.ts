/**
 * Cloud Functions — 電子人情 (e-Red-Packet) QR upload + delete
 * ==============================================================
 *
 * Why server-side (2026-07-27)
 * ----------------------------
 * The previous client-side pattern relied on `firestore.exists()` inside
 * a Firebase Storage rule to gate coOwner uploads. That turned out to be
 * unreliable: storage rules' `firestore.exists()` returns false even
 * when the doc exists (verified live — see memory entry "電子人情
 * event-scoping"). Uploads from coOwners consistently 403'd.
 *
 * This module replaces the client-side path with two server-side
 * Cloud Functions that use the Admin SDK:
 *   - `uploadRedPacketV2` accepts the QR image as base64, verifies the
 *     caller is the event owner OR an active coOwner, writes both the
 *     Storage object AND the Firestore doc server-side. Returns the
 *     download URL so the client can render the new row.
 *   - `deleteRedPacketV2` removes both records with the same auth check.
 *
 * Storage rules were simplified in parallel to disallow ALL client-side
 * writes under `red-packets/{ownerUid}/{eventId}/...` — every change
 * must go through these functions. The Storage path remains
 * `red-packets/{ownerUid}/{eventId}/{qrId}/{filename}` for legacy
 * consistency, but only the Cloud Function writes there now.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const appId = 'savetheday-production';

// 2 MB cap (matches the client-side validation in RedPacketManager.jsx).
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPTED_PROVIDERS = new Set([
  'payme', 'fps', 'alipayhk', 'wechat', 'octopus', 'other',
]);

/**
 * Returns true iff the given user is the event owner OR an active
 * coOwner of that owner. Reads two firestore paths:
 *   /users/{ownerUid}/events/{eventId}         — to confirm the event exists
 *                                               and the user is in coOwners[]
 *   /users/{ownerUid}/coOwners/{userUid}       — backup signal for the
 *                                               /coOwners/ collection
 * Both checks are best-effort: either passing is sufficient.
 */
async function isEventOwnerOrCoOwner(
  userUid: string,
  ownerUid: string,
  eventId: string,
): Promise<boolean> {
  const db = getFirestore();

  // Original owner check (request.auth.uid == ownerUid)
  if (userUid === ownerUid) return true;

  // Check the event's coOwners[] array — this is the canonical source.
  const eventSnap = await db
    .collection('artifacts').doc(appId)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId)
    .get();
  if (eventSnap.exists) {
    const coOwners = (eventSnap.data()?.coOwners as string[] | undefined) || [];
    if (coOwners.includes(userUid)) return true;
  }

  // Fallback: /coOwners collection (mirrors the same data, written by
  // partnerInvite.ts when the partner accepts an invite).
  const coOwnerDoc = await db
    .collection('artifacts').doc(appId)
    .collection('users').doc(ownerUid)
    .collection('coOwners').doc(userUid)
    .get();
  if (coOwnerDoc.exists && coOwnerDoc.data()?.status === 'active') {
    return true;
  }

  return false;
}

/**
 * uploadRedPacketV2 — owner OR any active coOwner of the event can call.
 *
 * Input:
 *   data = {
 *     ownerUid: string,
 *     eventId: string,
 *     qrId: string,                  // caller-generated (matches client-side id)
 *     filename: string,              // safe name from client (e.g. "myqr.png")
 *     contentType: 'image/png'|'image/jpeg'|'image/webp',
 *     base64: string,                // the file bytes, base64-encoded (no data: prefix)
 *     provider: 'payme'|'fps'|'alipayhk'|'wechat'|'octopus'|'other',
 *     label: string,
 *     suggested?: number | null,
 *     note?: string,
 *     sortOrder?: number,
 *   }
 *
 * Output: { qrUrl: string, qrPath: string, qrId: string }
 */
export const uploadRedPacketV2 = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const authUid = req.auth.uid;
    const {
      ownerUid, eventId, qrId, filename, contentType, base64,
      provider, label, suggested, note, sortOrder,
    } = req.data as {
      ownerUid: string;
      eventId: string;
      qrId: string;
      filename: string;
      contentType: string;
      base64: string;
      provider: string;
      label: string;
      suggested?: number | null;
      note?: string;
      sortOrder?: number;
    };

    // === Input validation ===
    if (!ownerUid || !eventId || !qrId || !filename || !contentType || !base64) {
      throw new HttpsError(
        'invalid-argument',
        'ownerUid, eventId, qrId, filename, contentType, and base64 are required.',
      );
    }
    if (!ACCEPTED_TYPES.has(contentType)) {
      throw new HttpsError('invalid-argument', `Unsupported content type: ${contentType}`);
    }
    if (!ACCEPTED_PROVIDERS.has(provider)) {
      throw new HttpsError('invalid-argument', `Unsupported provider: ${provider}`);
    }
    if (typeof label !== 'string' || label.length === 0 || label.length > 80) {
      throw new HttpsError('invalid-argument', 'label must be 1-80 characters.');
    }

    // === Auth: caller must be event owner or active coOwner ===
    const allowed = await isEventOwnerOrCoOwner(authUid, ownerUid, eventId);
    if (!allowed) {
      throw new HttpsError(
        'permission-denied',
        `User ${authUid} is not the event owner or an active coOwner of ${ownerUid}.`,
      );
    }

    // === Decode + size check ===
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch (e) {
      throw new HttpsError('invalid-argument', 'base64 payload could not be decoded.');
    }
    if (buffer.length === 0) {
      throw new HttpsError('invalid-argument', 'Empty file payload.');
    }
    if (buffer.length > MAX_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `File too large (${buffer.length} bytes; max ${MAX_BYTES}).`,
      );
    }

    // === Sanitize filename ===
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);

    // === Upload to Storage (Admin SDK bypasses Storage rules) ===
    const storagePath = `red-packets/${ownerUid}/${eventId}/${qrId}/${safeName}`;
    const file = getStorage().bucket().file(storagePath);
    await file.save(buffer, {
      contentType,
      metadata: {
        metadata: {
          uploadedByUid: authUid,
          uploadedAt: new Date().toISOString(),
          eventId,
        },
      },
      resumable: false,
      validation: 'crc32c',
    });
    // The download URL is a public URL because storage.rules marks
    // the path as `allow read: if true`. We construct the canonical
    // firebase storage URL with `alt=media` so the browser downloads
    // the file content rather than showing the metadata JSON.
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;

    // === Write Firestore doc (Admin SDK bypasses Firestore rules) ===
    const docRef = getFirestore()
      .collection('artifacts').doc(appId)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId)
      .collection('redPackets').doc(qrId);

    await docRef.set({
      provider,
      label: label.trim(),
      qrUrl: downloadUrl,
      qrPath: storagePath,
      suggested: suggested ?? null,
      note: (note || '').trim(),
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 1,
      createdAt: FieldValue.serverTimestamp() as Timestamp,
      eventId,
      uploadedByUid: authUid, // helpful audit field
    });

    return { qrUrl: downloadUrl, qrPath: storagePath, qrId };
  },
);

/**
 * deleteRedPacketV2 — owner OR active coOwner.
 *
 * Input: { ownerUid: string, eventId: string, qrId: string }
 *
 * Removes both the Storage object and the Firestore doc. Errors deleting
 * the Storage object are logged but don't fail the call (orphaned files
 * are cheap; the user has already seen the row disappear).
 */
export const deleteRedPacketV2 = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const authUid = req.auth.uid;
    const { ownerUid, eventId, qrId } = req.data as {
      ownerUid: string;
      eventId: string;
      qrId: string;
    };

    if (!ownerUid || !eventId || !qrId) {
      throw new HttpsError(
        'invalid-argument',
        'ownerUid, eventId, and qrId are all required.',
      );
    }

    const allowed = await isEventOwnerOrCoOwner(authUid, ownerUid, eventId);
    if (!allowed) {
      throw new HttpsError(
        'permission-denied',
        `User ${authUid} is not the event owner or an active coOwner of ${ownerUid}.`,
      );
    }

    const db = getFirestore();
    const docRef = db
      .collection('artifacts').doc(appId)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId)
      .collection('redPackets').doc(qrId);

    // Read first so we can find the qrPath for storage deletion
    const docSnap = await docRef.get();
    const qrPath = docSnap.exists ? docSnap.data()?.qrPath : null;

    // Delete the firestore doc
    await docRef.delete();

    // Best-effort delete the storage object
    if (qrPath && typeof qrPath === 'string') {
      try {
        await getStorage().bucket().file(qrPath).delete();
      } catch (e: unknown) {
        // eslint-disable-next-line no-console
        console.warn('[deleteRedPacketV2] storage delete failed (continuing):', e);
      }
    }

    return { ok: true };
  },
);
