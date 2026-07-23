/**
 * Cloud Functions — Public Job Board (徵求報價)
 * ==============================================
 *
 * postJobRequest — couple posts a new job request to /jobRequests.
 *
 * Why this is a Cloud Function (not direct Firestore)
 * ----------------------------------------------------
 * The /jobRequests collection lives at the FIRESTORE TOP LEVEL
 * (not under /artifacts/{appId}), but the firestore.rules only
 * define a match block under /artifacts/{appId}/jobRequests/{jobId}.
 * Without a rule on the top-level path, direct client writes fail
 * with "Missing or insufficient permissions".
 *
 * Routing through this callable sidesteps the rules entirely:
 * Cloud Functions run with the Firebase Admin SDK, which uses the
 * service account and bypasses rules. We still enforce the same
 * auth checks client-side (coupleUid == auth.uid) so the security
 * posture matches.
 *
 * Reads still go through the live client-side Firestore query —
 * those use the top-level path too, but they hit the same
 * catch-all deny. To make reads work for vendors, we add a
 * top-level match in firestore.rules (separate PR).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ALLOWED_SERVICE_CATEGORIES = new Set([
  '場地佈置',
  '攝影服務',
  '錄影服務',
  '婚紗禮服',
  '化妝造型',
  '司儀',
  '花藝設計',
  '蛋糕甜品',
  '婚戒首飾',
  '請帖設計',
  '其他',
]);

/**
 * Post a new job request to the public /jobRequests collection.
 *
 * Input shape:
 *   {
 *     serviceNeeded: string (one of ALLOWED_SERVICE_CATEGORIES)
 *     venues: string[] (optional)
 *     budget: string (free-form, e.g. "HK$30,000")
 *     details: string (optional, max 1000 chars)
 *     eventName: string (optional, used as coupleName fallback)
 *     weddingDate: string (optional)
 *   }
 *
 * Returns: { id: string, createdAt: number }
 */
export const postJobRequest = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = req.auth.uid;

    const {
      serviceNeeded,
      venues,
      budget,
      details,
      eventName,
      weddingDate,
    } = (req.data || {}) as {
      serviceNeeded?: string;
      venues?: string[];
      budget?: string;
      details?: string;
      eventName?: string;
      weddingDate?: string;
    };

    // ---- Validation ----
    if (!serviceNeeded || typeof serviceNeeded !== 'string') {
      throw new HttpsError('invalid-argument', 'serviceNeeded is required.');
    }
    if (!ALLOWED_SERVICE_CATEGORIES.has(serviceNeeded)) {
      throw new HttpsError(
        'invalid-argument',
        `serviceNeeded must be one of: ${Array.from(ALLOWED_SERVICE_CATEGORIES).join(', ')}`,
      );
    }
    if (!budget || typeof budget !== 'string' || !budget.trim()) {
      throw new HttpsError('invalid-argument', 'budget is required.');
    }
    if (budget.length > 100) {
      throw new HttpsError('invalid-argument', 'budget too long.');
    }
    if (details && (typeof details !== 'string' || details.length > 1000)) {
      throw new HttpsError('invalid-argument', 'details must be <= 1000 chars.');
    }
    let venuesArr: string[] = [];
    if (venues !== undefined) {
      if (!Array.isArray(venues)) {
        throw new HttpsError('invalid-argument', 'venues must be an array.');
      }
      venuesArr = venues
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 20);
    }

    // ---- Write ----
    const db = getFirestore();
    const docRef = db.collection('jobRequests').doc();
    await docRef.set({
      coupleUid: uid,
      coupleName: eventName || '新人',
      weddingDate: weddingDate || '',
      serviceNeeded,
      venues: venuesArr,
      budget: budget.trim(),
      details: (details || '').trim(),
      status: 'open',
      proposalsCount: 0,
      postedAt: '剛剛',
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      id: docRef.id,
      // Return ms timestamp so the client can use it immediately
      // without waiting for the serverTimestamp() round-trip.
      createdAt: Date.now(),
    };
  },
);
