/**
 * Cloud Functions — Vendor Onboarding & Self-Service
 * ===================================================
 *
 * applyAsVendor        — auth'd user submits the 5-step onboarding form.
 *                        Writes /vendors/{uid}, sets the `vendor` custom
 *                        claim, and (later) seeds the vendor profile edit
 *                        permission.
 *
 * updateMyVendorProfile — auth'd user with `vendor` claim can patch their
 *                        own vendor doc. Whitelisted fields only.
 *
 * uploadVendorPortfolio — auth'd user with `vendor` claim can append image
 *                         URLs to their `portfolio` array. The actual file
 *                         bytes are uploaded directly to cdn.savetheday.io
 *                         (see src/lib/portfolioUpload.js) — this function
 *                         just writes the returned URL into the vendor doc.
 *
 * Why these are Cloud Functions (not direct Firestore writes)
 * ------------------------------------------------------------
 * 1. Setting custom claims is admin-only — must run server-side.
 * 2. We want a single chokepoint to enforce field whitelisting and shape
 *    validation, instead of trusting the client to send correct shapes.
 * 3. We can later add rate-limiting, moderation hooks, email notifications
 *    without touching the client.
 *
 * Status field semantics (2026-07-11)
 * ------------------------------------
 * We auto-approve all submissions for now (writes `status: 'pending'` to
 * the doc but does NOT block the user from using the vendor dashboard).
 * DiscoverDirectory should filter on `status != 'pending'` to gate public
 * listings until we wire up admin review. See AdminVendors for the
 * approval UI later.
 *
 *   - 'pending'  : just submitted, awaiting admin review (default)
 *   - 'approved' : admin approved, fully visible
 *   - 'rejected' : admin rejected, hidden
 *   - 'suspended': previously approved, now hidden
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const db = getFirestore();

// App id under artifacts/{appId}/... matches the frontend's resolveAppId().
// For /vendors/* we use the flat path (no appId prefix) — see firestore.rules.
const APP_ID = 'savetheday-production';

// --- Whitelisted fields for both apply + update ------------------------------
// Anything outside this list is silently dropped. Prevents accidental shape
// drift between client and server, and gives us a single place to evolve the
// vendor schema.
const ALLOWED_VENDOR_FIELDS = [
  // Identity
  'name',
  'category',
  'subcategory',
  'description',
  // Pricing
  'priceMin',
  'priceMax',
  'currency',
  'openEnded',
  // Discovery
  'tags',
  'rating',
  'serviceArea',
  'yearsInBusiness',
  // Portfolio
  'portfolio',
  // Status (only writable via admin_updateVendor — rejected here)
  // (intentionally excluded from this list)
] as const;

function pickAllowed(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_VENDOR_FIELDS) {
    if (k in input) out[k] = input[k];
  }
  return out;
}

// --- applyAsVendor ----------------------------------------------------------

interface ApplyAsVendorInput {
  // Step 2: business
  name?: string;
  category?: string;
  description?: string;
  yearsInBusiness?: number;
  serviceArea?: string;
  rating?: number;
  // Step 3: pricing
  priceMin?: number;
  priceMax?: number | null;
  currency?: string;
  openEnded?: boolean;
  // Step 4: portfolio (already-uploaded URLs)
  portfolio?: string[];
  tags?: string[];
}

interface ApplyAsVendorResult {
  ok: boolean;
  vendorUid: string;
  vendorId: string;
  status: 'pending';
}

export const applyAsVendor = onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (req): Promise<ApplyAsVendorResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const data = (req.data || {}) as ApplyAsVendorInput;

    // Field validation — fail loudly for clearly broken shapes so the client
    // gets actionable errors instead of a silent partial write.
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
      throw new HttpsError('invalid-argument', '請填寫商戶名稱 (Business name is required, ≥2 chars).');
    }
    if (!data.category || typeof data.category !== 'string') {
      throw new HttpsError('invalid-argument', '請選擇分類 (Category is required).');
    }
    if (typeof data.priceMin !== 'number' || data.priceMin < 0) {
      throw new HttpsError('invalid-argument', '起步價必須是非負數字 (priceMin must be a non-negative number).');
    }
    if (
      data.priceMax !== null &&
      data.priceMax !== undefined &&
      (typeof data.priceMax !== 'number' || data.priceMax < data.priceMin)
    ) {
      throw new HttpsError('invalid-argument', '最高價必須 ≥ 起步價 (priceMax must be ≥ priceMin).');
    }
    if (!Array.isArray(data.portfolio)) {
      throw new HttpsError('invalid-argument', 'portfolio 必須是 array of URLs.');
    }
    if (data.portfolio.length > 24) {
      throw new HttpsError('invalid-argument', '作品集最多 24 張圖片 (max 24 portfolio items).');
    }
    if (!Array.isArray(data.tags)) {
      throw new HttpsError('invalid-argument', 'tags 必須是 array of strings.');
    }
    if (data.tags.length > 10) {
      throw new HttpsError('invalid-argument', '最多 10 個標籤 (max 10 tags).');
    }

    const vendorUid = req.auth.uid;
    const vendorRef = db.collection('vendors').doc(vendorUid);

    // Refuse if the vendor doc already exists — vendor edits go through
    // updateMyVendorProfile, not a second apply. This avoids accidental
    // overwrites if a vendor double-submits the wizard.
    const existing = await vendorRef.get();
    if (existing.exists) {
      throw new HttpsError(
        'already-exists',
        '你已申請成為商戶。如需修改資料請到「管理專頁」。 (You have already applied. Edit your profile instead.)',
      );
    }

    const sanitized = pickAllowed(data as Record<string, unknown>);

    const vendorDoc = {
      ...sanitized,
      // Force these — they should never come from the client.
      vendorUid,
      ownerUid: vendorUid,                  // alias for code that expects `ownerUid`
      status: 'pending' as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Default rating if not provided — admin can override later.
      rating: typeof data.rating === 'number' ? data.rating : 0,
    };

    await vendorRef.set(vendorDoc);

    // Set the `vendor` custom claim so the routing logic in App.jsx sees
    // this user as a vendor on next sign-in / token refresh.
    const auth = getAdminAuth();
    const existingClaims = (await auth.getUser(vendorUid)).customClaims || {};
    await auth.setCustomUserClaims(vendorUid, {
      ...existingClaims,
      vendor: true,
      // Note: do NOT auto-set admin:true. Admin is a separate role.
    });
    // Force a token refresh so the claim is available on the next request.
    await auth.revokeRefreshTokens(vendorUid);

    // Best-effort: also write a minimal profile entry under
    // artifacts/{appId}/users/{uid} so future queries that expect a
    // "user profile" doc alongside the vendor doc find something there.
    // Keeps the existing app data shape consistent.
    try {
      await db
        .collection('artifacts')
        .doc(APP_ID)
        .collection('users')
        .doc(vendorUid)
        .set(
          {
            uid: vendorUid,
            role: 'vendor',
            displayName: data.name,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    } catch (e) {
      // Non-fatal — the main vendor doc write already succeeded.
      console.warn('[applyAsVendor] profile upsert failed (non-fatal):', e);
    }

    return { ok: true, vendorUid, vendorId: vendorUid, status: 'pending' };
  },
);

// --- updateMyVendorProfile --------------------------------------------------

interface UpdateMyVendorProfileInput {
  updates?: Record<string, unknown>;
}

export const updateMyVendorProfile = onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (req): Promise<{ ok: boolean; updatedAt: string }> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const claims = (req.auth.token as { vendor?: boolean; admin?: boolean }) || {};
    if (!claims.vendor && !claims.admin) {
      throw new HttpsError('permission-denied', '只有商戶可以更新自己的專頁 (vendor claim required).');
    }

    const data = (req.data || {}) as UpdateMyVendorProfileInput;
    if (!data.updates || typeof data.updates !== 'object') {
      throw new HttpsError('invalid-argument', 'updates 物件為必要 (updates object required).');
    }

    const allowed = pickAllowed(data.updates);
    if (Object.keys(allowed).length === 0) {
      throw new HttpsError('invalid-argument', '沒有可更新的欄位 (no allowed fields in updates).');
    }

    // Re-validate pricing if present (allow partial updates but keep invariants).
    if ('priceMin' in allowed && (typeof allowed.priceMin !== 'number' || (allowed.priceMin as number) < 0)) {
      throw new HttpsError('invalid-argument', 'priceMin must be a non-negative number.');
    }

    const vendorRef = db.collection('vendors').doc(req.auth.uid);
    const existing = await vendorRef.get();
    if (!existing.exists) {
      throw new HttpsError('not-found', '商戶資料不存在 — 請先完成申請表 (vendor doc missing — apply first).');
    }

    await vendorRef.update({
      ...allowed,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, updatedAt: new Date().toISOString() };
  },
);

// --- uploadVendorPortfolio --------------------------------------------------
//
// Note: This does NOT actually upload bytes — that's done client-side via
// https://cdn.savetheday.io/upload. This function just appends the returned
// public URL to the vendor's portfolio[] field, optionally with a caption.

interface UploadVendorPortfolioInput {
  url?: string;
  caption?: string;
}

interface UploadVendorPortfolioResult {
  ok: boolean;
  portfolio: string[];
}

export const uploadVendorPortfolio = onCall(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (req): Promise<UploadVendorPortfolioResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const claims = (req.auth.token as { vendor?: boolean; admin?: boolean }) || {};
    if (!claims.vendor && !claims.admin) {
      throw new HttpsError('permission-denied', '只有商戶可以上傳作品 (vendor claim required).');
    }

    const data = (req.data || {}) as UploadVendorPortfolioInput;
    if (!data.url || typeof data.url !== 'string') {
      throw new HttpsError('invalid-argument', 'url 為必要 (url required).');
    }
    // Only accept our own CDN URLs (defense in depth — also enforced by
    // the receiver's X-Upload-Token check, but belt-and-braces).
    if (!/^https:\/\/cdn\.savetheday\.io\//.test(data.url)) {
      throw new HttpsError('invalid-argument', 'URL 必須來自 cdn.savetheday.io (must be a savetheday CDN URL).');
    }

    const vendorRef = db.collection('vendors').doc(req.auth.uid);
    const snap = await vendorRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', '商戶資料不存在 (vendor doc missing).');
    }
    const current = Array.isArray(snap.data()?.portfolio) ? (snap.data()!.portfolio as string[]) : [];
    if (current.length >= 24) {
      throw new HttpsError('resource-exhausted', '作品集已滿 (max 24 items).');
    }

    const next = [...current, data.url];
    await vendorRef.update({
      portfolio: next,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, portfolio: next };
  },
);
// =============================================================================
// autoLinkVendorContacts — Cloud Function callable that runs with admin
// credentials and scans every owner for vendorContacts entries whose
// vendorEmail matches the signed-in vendor's email, then sets
// linkedVendorUid on the contact and back-fills assignedVendorUid on any
// tasks pointing at that contact.
//
// Why this is a Cloud Function
// ----------------------------
// The same logic attempted client-side in src/lib/contactLink.js hits a
// permission wall: the vendor's auth.uid does NOT have owner-scoped write
// perms to other couples' /tasks/ subcollections. Doing this with the admin
// service account bypasses that wall — runs server-side with full read+write
// across all owners.
//
// Idempotent
// ----------
// - Skips contacts that already have linkedVendorUid set.
// - Skips tasks that already have assignedVendorUid set (preserves manual
//   overrides).
// - Safe to call multiple times.
//
// Trigger
// -------
// Called from src/lib/contactLink.js (or directly from the App.jsx useEffect
// on sign-in). Client can pass either:
//   { vendorEmail: '<override@email>' }   (rare; defaults to req.auth.token.email)
// Returns { linked: number, backfilled: number, ownersTouched: number }.
// =============================================================================

export const autoLinkVendorContacts = onCall(
  { region: 'asia-east1' },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', '請先登入 (must be signed in).');
    }
    const authUid = req.auth.uid;
    const overrideEmail = typeof req.data?.vendorEmail === 'string'
      ? req.data.vendorEmail.trim().toLowerCase()
      : '';
    // firebase decoded id token exposes .email; fall back to Admin SDK
    // lookup if the token didn't carry it (rare — happens for phone auth
    // or some federated providers).
    let authEmail = (req.auth.token.email as string | undefined)?.toLowerCase() || '';
    if (!authEmail) {
      try {
        const userRecord = await getAdminAuth().getUser(authUid);
        authEmail = (userRecord.email || '').toLowerCase();
      } catch {
        // ignore — proceeds with empty email, which matches no contacts
      }
    }
    const targetEmail = overrideEmail || authEmail;
    if (!targetEmail) {
      throw new HttpsError(
        'invalid-argument',
        '找不到電郵 (no email available on the signed-in user).',
      );
    }

    // 1. collection-group scan over ALL vendorContacts with this email.
    //    Requires the (vendorEmail ASC) collection-group index; declared
    //    in firestore.indexes.json.
    const contactsSnap = await db
      .collectionGroup('vendorContacts')
      .where('vendorEmail', '==', targetEmail)
      .get();

    if (contactsSnap.empty) {
      return { linked: 0, backfilled: 0, ownersTouched: 0 };
    }

    // 2. Group contact refs by ownerUid so we can batch together
    //    (a) the contact-update + (b) any task updates within the
    //    same owner. One batch per owner keeps it simple + atomic.
    const grouped = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    contactsSnap.forEach((c) => {
      if (c.data().linkedVendorUid) return; // skip already-linked
      const ownerUid = c.ref.parent.parent?.id;
      if (!ownerUid) return;
      if (!grouped.has(ownerUid)) grouped.set(ownerUid, []);
      grouped.get(ownerUid)!.push(c);
    });

    let totalLinked = 0;
    let totalBackfilled = 0;
    const ownersTouched = grouped.size;

    // 3. For each owner, build one batch: contact-link + task back-fill.
    for (const [ownerUid, contacts] of grouped) {
      const batch = db.batch();

      for (const c of contacts) {
        batch.update(c.ref, {
          linkedVendorUid: authUid,
          invitationAccepted: true,
          linkedAt: FieldValue.serverTimestamp(),
        });
        totalLinked++;
      }

      // Back-fill tasks in this owner's /tasks/ for each contact.
      for (const c of contacts) {
        const tasksSnap = await db
          .collection(`artifacts/savetheday-production/users/${ownerUid}/tasks`)
          .where('assignedContactId', '==', c.id)
          .get();
        for (const t of tasksSnap.docs) {
          if (t.data().assignedVendorUid) continue; // preserve manual
          batch.update(t.ref, {
            assignedVendorUid: authUid,
            assignedVendorName:
              t.data().assignedVendorName || c.data().vendorName || '',
          });
          totalBackfilled++;
        }
      }

      try {
        await batch.commit();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[autoLinkVendorContacts] owner ${ownerUid} batch failed:`,
          (err as Error)?.message,
        );
        // Roll back the running counters for this owner so the
        // returned numbers reflect what actually committed.
        totalLinked -= contacts.length;
        // Best-effort rollback of partial state isn't safe (we don't
        // know which contacts in the batch were already updated), so
        // we just report the partial state below.
      }
    }

    // eslint-disable-next-line no-console
    console.info(
      `[autoLinkVendorContacts] uid=${authUid} email=${targetEmail} → ` +
        `linked=${totalLinked} backfilled=${totalBackfilled} owners=${ownersTouched}`,
    );

    return {
      linked: totalLinked,
      backfilled: totalBackfilled,
      ownersTouched,
    };
  },
);
