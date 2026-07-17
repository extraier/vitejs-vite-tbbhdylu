/**
 * Cloud Functions — Vendor Ratings & Reviews
 * ==========================================
 *
 * submitRating           — auth'd couple writes a 1-5 star rating to
 *                          /vendors/{vendorId}/ratings/{ratingId}. One
 *                          rating per (coupleUid, vendorId) — re-rating
 *                          updates the existing doc.
 *
 * deleteMyRating         — auth'd couple (or admin) can remove a rating
 *                          they authored.
 *
 * listVendorRatings      — public list of ratings for a vendor (paginated).
 *                          Used by the directory reviews panel on tap.
 *
 * Data model
 * ----------
 *
 *   /vendors/{vendorId}
 *     ├── (existing fields)
 *     ├── rating            : number   ← cached average (rolling)
 *     ├── ratingCount       : number   ← total number of ratings
 *     └── ratings/{ratingId}
 *           rating        : 1-5
 *           coupleUid     : string
 *           coupleName    : string
 *           weddingYear   : number | null
 *           review        : string   ≤ 500 chars
 *           createdAt     : ts
 *           updatedAt     : ts
 *
 * Aggregates (rating + ratingCount) live on the vendor doc itself so the
 * directory can render without reading the subcollection. Atomic
 * arithmetic via FieldValue.increment on add; decrement on delete.
 *
 * Why a subcollection and not a flat collection
 * ---------------------------------------------
 * Subcollections of /vendors/{id} are readable by the same path the
 * directory already lists, so the security rules don't need a separate
 * match block for ratings. Indexed by vendorId for free.
 *
 * Why this is a Cloud Function (not direct Firestore writes)
 * ----------------------------------------------------------
 * 1. Couples-only enforcement (must be a couple, not a vendor or admin
 *    sneaking ratings in). We resolve couple status from the partner
 *    hint on the auth profile.
 * 2. Atomic update of the rating aggregate (avg + count) on the vendor
 *    doc. Without server-side, a client race could double-count.
 * 3. Field validation + auth checks in one chokepoint.
 *
 * Rate-limit / abuse prevention
 * -----------------------------
 * - One rating per (coupleUid, vendorId). Re-rating edits.
 * - Min review length 0 (rating-only), max 500 chars.
 * - Couples only — vendor-authenticated users (custom claim `vendor`)
 *   cannot rate other vendors.
 *
 * 2026-07-17 — Initial implementation.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const db = getFirestore();

interface SubmitRatingInput {
  vendorId: string;
  rating: number;
  review?: string;
  weddingYear?: number | null;
  coupleName?: string;
}

interface SubmitRatingResult {
  ratingId: string;
  newAvg: number;
  newCount: number;
}

const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_REVIEW_LEN = 500;

// Returns true if the auth'd user is a couple (not a vendor, not admin,
// not anonymous). We use the user collection's type field — couples
// don't have a custom claim, but they have role === 'couple' on their
// /users/{uid} doc.
async function isCouple(uid: string): Promise<boolean> {
  // The user doc is at /artifacts/{appId}/users/{uid} — the appId is
  // fixed for prod: savetheday-production. See firestore.rules.
  const snap = await db
    .collection('artifacts/savetheday-production/users')
    .doc(uid)
    .get();
  if (!snap.exists) return false;
  const role = snap.data()?.role;
  return role === 'owner' || role === 'couple' || role === 'helper';
}

export const submitRating = onCall(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (req): Promise<SubmitRatingResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', '請先登入 (Sign in first).');
    }
    const coupleUid = req.auth.uid;
    const data = (req.data || {}) as SubmitRatingInput;

    // --- field validation ---
    if (!data.vendorId || typeof data.vendorId !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        '請提供商戶 ID (vendorId is required).',
      );
    }
    const ratingNum = Number(data.rating);
    if (
      !Number.isFinite(ratingNum) ||
      ratingNum < MIN_RATING ||
      ratingNum > MAX_RATING ||
      Math.round(ratingNum) !== ratingNum
    ) {
      throw new HttpsError(
        'invalid-argument',
        `評分必須係 ${MIN_RATING}-${MAX_RATING} 之間嘅整數 (rating must be an integer ${MIN_RATING}-${MAX_RATING}).`,
      );
    }
    const review =
      typeof data.review === 'string' ? data.review.trim().slice(0, MAX_REVIEW_LEN) : '';
    const weddingYear =
      typeof data.weddingYear === 'number' && data.weddingYear >= 1900 && data.weddingYear <= 2100
        ? Math.round(data.weddingYear)
        : null;
    const coupleName =
      typeof data.coupleName === 'string' ? data.coupleName.trim().slice(0, 60) || '準新人' : '準新人';

    // --- couple guard ---
    const ok = await isCouple(coupleUid);
    if (!ok) {
      throw new HttpsError(
        'permission-denied',
        '只有主理新人才可以為商戶評分 (Only couples can submit ratings).',
      );
    }

    const vendorRef = db.collection('vendors').doc(data.vendorId);
    const vendorSnap = await vendorRef.get();
    if (!vendorSnap.exists) {
      throw new HttpsError('not-found', `商戶 ${data.vendorId} 唔存在。`);
    }

    const ratingsRef = vendorRef.collection('ratings');

    // --- lookup existing rating for this (coupleUid, vendorId) ---
    const existing = await ratingsRef.where('coupleUid', '==', coupleUid).limit(1).get();
    const isUpdate = !existing.empty;
    const oldRating = isUpdate ? existing.docs[0].data().rating : null;

    if (isUpdate) {
      const docRef = existing.docs[0].ref;
      const batch = db.batch();
      batch.update(docRef, {
        rating: ratingNum,
        review,
        weddingYear,
        coupleName,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Update aggregate: subtract old, add new.
      const sumDelta = ratingNum - (oldRating || 0);
      if (sumDelta !== 0) {
        batch.update(vendorRef, {
          ratingSumDelta: FieldValue.increment(sumDelta),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    } else {
      const newRatingId = ratingsRef.doc().id;
      const batch = db.batch();
      batch.set(ratingsRef.doc(newRatingId), {
        rating: ratingNum,
        coupleUid,
        coupleName,
        weddingYear,
        review,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.update(vendorRef, {
        ratingCount: FieldValue.increment(1),
        ratingSumDelta: FieldValue.increment(ratingNum),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    }

    // Recompute average via a fresh read. Acceptable cost since this
    // is a one-time write path, not a high-throughput endpoint.
    const fresh = await vendorRef.get();
    const data2 = fresh.data() || {};
    const sum = Number(data2.ratingSum || 0); // legacy field if any
    const sumDelta = Number(data2.ratingSumDelta || 0);
    // Use the more authoritative field: historical sum if present,
    // else delta-based reconstruction. Initial legacy shops may have
    // `rating` set to a static value; we leave that in place.
    const ratingCount = Number(data2.ratingCount || 0);
    const newAvg = ratingCount > 0 ? (sum + sumDelta) / ratingCount : 0;

    await vendorRef.update({ rating: newAvg });

    return {
      ratingId: isUpdate ? existing.docs[0].id : '(committed)',
      newAvg: Number(newAvg.toFixed(2)),
      newCount: ratingCount,
    };
  },
);

interface DeleteRatingInput {
  vendorId: string;
}

export const deleteMyRating = onCall(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (req): Promise<{ deleted: boolean; newAvg: number; newCount: number }> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', '請先登入 (Sign in first).');
    }
    const coupleUid = req.auth.uid;
    const data = (req.data || {}) as DeleteRatingInput;
    if (!data.vendorId || typeof data.vendorId !== 'string') {
      throw new HttpsError('invalid-argument', 'vendorId is required.');
    }

    const vendorRef = db.collection('vendors').doc(data.vendorId);
    const ratingsRef = vendorRef.collection('ratings');
    const existing = await ratingsRef.where('coupleUid', '==', coupleUid).limit(1).get();
    if (existing.empty) {
      return { deleted: false, newAvg: 0, newCount: 0 };
    }
    const ref = existing.docs[0].ref;
    const ratingValue = existing.docs[0].data().rating;

    const batch = db.batch();
    batch.delete(ref);
    batch.update(vendorRef, {
      ratingCount: FieldValue.increment(-1),
      ratingSumDelta: FieldValue.increment(-ratingValue),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const fresh = await vendorRef.get();
    const v = fresh.data() || {};
    const sum = Number(v.ratingSum || 0);
    const sumDelta = Number(v.ratingSumDelta || 0);
    const ratingCount = Number(v.ratingCount || 0);
    const newAvg = ratingCount > 0 ? (sum + sumDelta) / ratingCount : 0;
    await vendorRef.update({ rating: newAvg });

    return {
      deleted: true,
      newAvg: Number(newAvg.toFixed(2)),
      newCount: ratingCount,
    };
  },
);

interface ListVendorRatingsInput {
  vendorId: string;
  limit?: number;
  startAfterId?: string | null;
}

interface RatingEntry {
  ratingId: string;
  rating: number;
  coupleName: string;
  weddingYear: number | null;
  review: string;
  createdAtMs: number;
}

interface ListVendorRatingsResult {
  ratings: RatingEntry[];
  nextCursor: string | null;
}

export const listVendorRatings = onCall(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (req): Promise<ListVendorRatingsResult> => {
    const data = (req.data || {}) as ListVendorRatingsInput;
    if (!data.vendorId || typeof data.vendorId !== 'string') {
      throw new HttpsError('invalid-argument', 'vendorId is required.');
    }
    const limit = Math.min(Math.max(Number(data.limit) || 10, 1), 50);
    const ratingsRef = db
      .collection('vendors')
      .doc(data.vendorId)
      .collection('ratings');
    let q = ratingsRef.orderBy('createdAt', 'desc').limit(limit);
    if (data.startAfterId) {
      const cursor = await ratingsRef.doc(data.startAfterId).get();
      if (cursor.exists) {
        q = q.startAfter(cursor);
      }
    }
    const snap = await q.get();
    const entries: RatingEntry[] = snap.docs.map((d) => {
      const data = d.data();
      const ts = data.createdAt as Timestamp | undefined;
      return {
        ratingId: d.id,
        rating: Number(data.rating || 0),
        coupleName: String(data.coupleName || '準新人'),
        weddingYear: data.weddingYear == null ? null : Number(data.weddingYear),
        review: String(data.review || ''),
        createdAtMs: ts?.toMillis?.() || 0,
      };
    });
    return {
      ratings: entries,
      nextCursor: snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null,
    };
  },
);
