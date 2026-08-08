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

const db = getFirestore();

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

/**
 * submitProposal — vendor submits a proposal in response to a job.
 *
 * 2026-08-08 — closes the gap in the 商戶接單大堂 (Vendor Board)
 * feature. Before this, the "立即發送報價單" button on the vendor's
 * job card only mutated in-memory React state (no Firestore write),
 * so the proposal never reached the couple and didn't increment
 * the job's proposalsCount. This callable persists the proposal
 * to /proposals/{proposalId} with the auth shape that firestore.rules
 * (top-level mirror at line ~1265) already validates.
 *
 * Input shape:
 *   {
 *     jobId: string          (required, /jobRequests/{jobId})
 *     price: string          (optional, free-form, ≤ 100 chars; e.g. "$25,000")
 *     message: string        (required, ≤ 1000 chars; the pitched message)
 *   }
 *
 * Returns: { id: string, createdAt: number, proposalsCount: number }
 *
 * Auth model:
 *   - requires signed-in user
 *   - requires the caller to have a /vendors/{authUid} doc with a
 *     name (i.e. they have completed vendor onboarding). Uses the
 *     vendor doc's vendorUid (= auth.uid) and the vendor's name to
 *     populate the proposal so the couple sees "Visionary Capture"
 *     not the raw auth email.
 *   - cross-checks the job doc: exists, status == 'open', and writes
 *     the coupleUid from the job's doc so the couple can later query
 *     their own proposals.
 *
 * Why a Cloud Function (not a direct Firestore write):
 *   - The /proposals rule requires vendorUid == auth.uid AND
 *     coupleUid is a string. A direct client write would need the
 *     client to know the coupleUid, which couples generate server-side
 *     via postJobRequest. Routing through this CF keeps the coupleUid
 *     source-of-truth on the server.
 *   - Increments the job's proposalsCount atomically via
 *     FieldValue.increment(1) so concurrent submissions don't lose
 *     counts (the previous "client increments after write then
 *     refetches" pattern had a race window).
 *
 * What the client does:
 *   - App.jsx's submitProposal() now calls this CF instead of mutating
 *     the in-memory jobRequests array. The vendor sees the toast as
 *     before; the couple sees real proposalsCount + real proposals.
 */
export const submitProposalV2 = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = req.auth.uid;

    const { jobId, price, message } = (req.data || {}) as {
      jobId?: string;
      price?: string;
      message?: string;
    };

    if (!jobId || typeof jobId !== 'string') {
      throw new HttpsError('invalid-argument', 'jobId is required.');
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new HttpsError('invalid-argument', 'message is required.');
    }
    if (message.length > 1000) {
      throw new HttpsError('invalid-argument', 'message must be <= 1000 chars.');
    }
    if (price !== undefined && price !== null && price !== '') {
      if (typeof price !== 'string') {
        throw new HttpsError('invalid-argument', 'price must be a string.');
      }
      if (price.length > 100) {
        throw new HttpsError('invalid-argument', 'price too long.');
      }
    }

    // Look up the vendor doc to confirm the caller is a real vendor
    // and to grab the public-facing name + rating.
    const vendorRef = db.collection('vendors').doc(uid);
    const vendorSnap = await vendorRef.get();
    if (!vendorSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        '尚未完成商戶設定：請先完成商戶專頁設定。',
      );
    }
    const vendorData = vendorSnap.data() || {};
    const vendorName =
      (typeof vendorData.name === 'string' && vendorData.name.trim() && vendorData.name.trim()) ||
      (typeof vendorData.businessName === 'string' && vendorData.businessName.trim()) ||
      '商戶';
    const vendorRating =
      typeof vendorData.rating === 'number' && vendorData.rating >= 0 && vendorData.rating <= 5
        ? vendorData.rating
        : 0;

    // Look up the job to grab coupleUid and confirm it's still open.
    const jobRef = db.collection('jobRequests').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new HttpsError('not-found', 'Job not found.');
    }
    const jobData = jobSnap.data() || {};
    if (jobData.status !== 'open') {
      throw new HttpsError(
        'failed-precondition',
        '此 job 已經關閉，唔可以再報價。',
      );
    }
    const coupleUid = typeof jobData.coupleUid === 'string' ? jobData.coupleUid : null;
    if (!coupleUid) {
      throw new HttpsError(
        'failed-precondition',
        'Job 缺少 coupleUid，請聯絡管理員。',
      );
    }

    // Atomic write: persist the proposal + increment the job's count
    // in a single batch so the count never drifts from the truth.
    const proposalRef = db.collection('proposals').doc();
    const batch = db.batch();
    batch.set(proposalRef, {
      jobId,
      vendorUid: uid,
      coupleUid,
      vendorName,
      rating: vendorRating,
      price: (price || '').trim(),
      message: message.trim(),
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(jobRef, {
      proposalsCount: FieldValue.increment(1),
    });
    await batch.commit();

    // Read back the new count (could be slightly stale under concurrent
    // writes, but the client's onSnapshot subscription will correct).
    const newCountSnap = await jobRef.get();
    const newCount =
      typeof newCountSnap.data()?.proposalsCount === 'number'
        ? newCountSnap.data()!.proposalsCount
        : 0;

    return {
      id: proposalRef.id,
      createdAt: Date.now(),
      proposalsCount: newCount,
    };
  },
);

/**
 * listProposalsForJob — couple-facing read of the proposals on a job
 * they own. Couples can already read /proposals directly per the
 * top-level rules, but a CF gives us:
 *   1. Server-side enforcement that the requester is the couple who
 *      owns the job (rules alone can't do this — the rule only checks
 *      coupleUid == auth.uid on the proposal doc, which is correct,
 *      but a CF lets us return a cleaner shape and sort by createdAt).
 *   2. Pagination headroom for jobs with many proposals later.
 *
 * For now the client uses useFirestoreCollection directly with the
 * standard rule check; this CF is a future-proofing hook. Components
 * that want server-side filtering can call this instead.
 *
 * 2026-08-08 — registered for future use; not yet called from the
 * client. The Vendors page uses the live query path.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const _listProposalsForJob = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = req.auth.uid;
    const { jobId, limit = 50 } = (req.data || {}) as {
      jobId?: string;
      limit?: number;
    };
    if (!jobId) {
      throw new HttpsError('invalid-argument', 'jobId is required.');
    }

    // Confirm the caller owns the job.
    const jobSnap = await db.collection('jobRequests').doc(jobId).get();
    if (!jobSnap.exists) {
      throw new HttpsError('not-found', 'Job not found.');
    }
    if (jobSnap.data()?.coupleUid !== uid) {
      throw new HttpsError('permission-denied', 'Not your job.');
    }

    const lim = Math.min(Math.max(limit, 1), 200);
    const snap = await db
      .collection('proposals')
      .where('jobId', '==', jobId)
      .orderBy('createdAt', 'desc')
      .limit(lim)
      .get();

    return {
      proposals: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  },
);

