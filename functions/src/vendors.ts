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

/**
 * 2026-08-13 — H-03 audit fix.
 *
 * Pure-logic version of the vendor claim flip. Returns the new
 * claims object given the existing claims and the requested value.
 * Extracted from `setVendorClaim` (below) so it can be unit-tested
 * without the firebase-admin SDK.
 *
 * Why export this as its own function: the audit requires one
 * named canonical pathway for vendor activation. The only thing
 * that's *actually canonical* about that pathway is "this is the
 * place that decides what the new claims object looks like". Pulling
 * the decision out of the I/O wrapper means a future migration (e.g.
 * a new "vip" role) can update this single 6-line function instead
 * of touching every callsite that mints a vendor claim.
 *
 * Invariants enforced here:
 *  - Existing claims are always preserved (helper, admin, etc.)
 *  - When value is true: set `vendor: true` explicitly
 *  - When value is false: REMOVE the `vendor` key (NOT set false —
 *    firebase-admin treats absent as undefined and reads it as
 *    falsy, but a literal `false` survives token round-trips and
 *    can surprise later `claims.vendor === true` checks).
 */
export function mergeVendorClaim(
  existingClaims: Record<string, unknown>,
  value: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existingClaims };
  if (value) {
    next.vendor = true;
  } else {
    delete next.vendor;
  }
  return next;
}

/**
 * 2026-08-13 — H-03 audit fix.
 *
 * Canonical chokepoint for setting the `vendor: true` custom claim on
 * a Firebase Auth user. Every code path that creates/claims a vendor
 * profile MUST funnel through this helper so the claim-set is
 * consistent across `applyAsVendor` (free-form wizard) and the two
 * seeded-slot paths (`claimSeededVendor`, `claimAndApplyAsVendor`).
 *
 * Why a helper instead of inline `setCustomUserClaims` at each callsite:
 *  - One place to enforce "claim preserved alongside other roles"
 *    (we always MERGE with existing claims; we NEVER touch admin).
 *  - One place to call `revokeRefreshTokens` after the claim flip —
 *    missing this is why seeded-slot vendors never get the
 *    refreshed token that App.jsx's auto-route watches for.
 *  - One place to update later when we add `vip`, `enterprise`,
 *    or any other role-as-claim.
 *
 * @param uid   Firebase Auth uid of the user.
 * @param value true to set `vendor: true`, false to clear the claim.
 */
export async function setVendorClaim(uid: string, value: boolean): Promise<void> {
  const auth = getAdminAuth();
  const existingClaims = (await auth.getUser(uid)).customClaims || {};
  // Defer the decision to the pure helper so the merge logic is
  // unit-testable without a firebase-admin mock.
  const nextClaims = mergeVendorClaim(existingClaims, value);
  await auth.setCustomUserClaims(uid, nextClaims as Record<string, boolean>);
  // Force a token refresh — without this the user must wait for
  // the 1-hour token cache to expire before App.jsx sees the
  // updated claim.
  await auth.revokeRefreshTokens(uid);
}

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

// --- linkMatchingVendorContacts --------------------------------------------
//
// 2026-08-09 — Cross-owner contact linker for vendor onboarding.
//
// When a vendor signs up via applyAsVendor (no claim) or
// claimAndApplyAsVendor (claim-from-invite), couples who have already
// added the same business name from the catalog need to be linked to
// the new auth uid so the vendor sees their assigned work + can post
// comments. The pre-existing client-side contactLink.tryAutoLinkContacts
// only matches by email, but catalog-seeded vendorContacts have empty
// vendorEmail (the catalog data was imported from heychoices which
// doesn't expose vendor emails publicly). So that path can never link
// a catalog contact to a real vendor.
//
// This helper uses the Admin SDK (cross-owner read + write) to find
// any unlinked contact whose (vendorName + category) matches the new
// vendor's (name + category) and stamp linkedVendorUid on each. The
// match is intentionally loose on name (case-insensitive trim) but
// strict on category — false-positive links would silently reassign
// the wrong vendor's tasks.
//
// Idempotent: contacts that already have linkedVendorUid are skipped.
// The first claim wins; if two vendors share a name, the second
// signup won't disturb the first's links.
//
// Bounded: collectionGroup('vendorContacts') is read once per vendor
// signup. At our scale (a few thousand contacts across all couples)
// this is a single admin read of <100KB — acceptable as part of the
// onboarding flow. If the table grows past 10K contacts we'd want to
// add a composite index (vendorName + linkedVendorUid) and filter
// server-side.

export async function linkMatchingVendorContacts(
  vendorUid: string,
  vendorName: string,
  category: string,
): Promise<number> {
  const trimmed = (vendorName || '').trim();
  if (!trimmed) return 0;
  let matched = 0;
  try {
    const cg = db.collectionGroup('vendorContacts');
    const snap = await cg.get();
    if (snap.empty) return 0;
    const batch = db.batch();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.linkedVendorUid) continue; // already linked — skip
      const contactName = typeof data.vendorName === 'string' ? data.vendorName.trim() : '';
      const contactCategory = typeof data.category === 'string' ? data.category : '';
      if (!contactName || !contactCategory) continue;
      if (contactName.toLowerCase() !== trimmed.toLowerCase()) continue;
      if (contactCategory !== category) continue;
      batch.update(docSnap.ref, {
        linkedVendorUid: vendorUid,
        invitationAccepted: true,
      });
      matched++;
    }
    if (matched > 0) {
      await batch.commit();
    }
  } catch (e) {
    // Non-fatal — the main vendor write already succeeded. Log so we
    // can see in the cloud-functions log when this fails (e.g.
    // permission rules, collection-group index missing, etc.).
    console.warn('[linkMatchingVendorContacts] failed (non-fatal):', e);
  }
  return matched;
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

    // 2026-08-13 — H-03 audit fix: route the claim-set through
    // the canonical chokepoint `setVendorClaim` (defined below).
    // Previously only applyAsVendor set the claim; claimSeededVendor
    // and claimAndApplyAsVendor skipped this step, leaving seeded
    // vendors un-routed in App.jsx (App.jsx's vendor auto-route
    // only fires when useAuth's `isVendor` claim is true). All
    // three entry points now converge here.
    await setVendorClaim(vendorUid, true);

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

    // 2026-08-09 — Link any pre-existing unlinked vendorContacts whose
    // (name + category) matches this new vendor. See
    // linkMatchingVendorContacts for the rationale. Best-effort — the
    // main vendor doc + custom claim above must complete first so the
    // vendor can sign in immediately. A failure here just means the
    // contact stays "未加入" and a follow-up onboarding pass can fix
    // it later.
    await linkMatchingVendorContacts(vendorUid, sanitized.name as string, sanitized.category as string);

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

// 2026-07-22 — Renamed to autoLinkVendorContactsV2 AND pinned
// to us-central1. The original was in asia-east1 but the front-
// end's default `functions` singleton points at us-central1, so
// the SDK was hitting the wrong URL → CORS error / 404. A stuck
// 409 on the original resource in us-central1 (queued operation
// from an earlier deploy) prevented an in-place update, so we
// renamed to bypass it. The front-end callsite in App.jsx has
// been updated to call autoLinkVendorContactsV2.
export const autoLinkVendorContactsV2 = onCall(
  { region: 'us-central1', cors: true },
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
    let ownersTouched = 0;

    // 3. For each owner, build one batch: contact-link + task back-fill.
    // Tasks are event-scoped in the current data model, so do not query the
    // retired /users/{ownerUid}/tasks path. Enumerate this owner's events
    // first, then query each event's tasks collection. These are ordinary
    // collection queries and do not require another collection-group index.
    for (const [ownerUid, contacts] of grouped) {
      const eventsSnap = await db
        .collection(`artifacts/${APP_ID}/users/${ownerUid}/events`)
        .get();
      const batch = db.batch();
      let ownerLinked = 0;
      let ownerBackfilled = 0;

      for (const c of contacts) {
        batch.update(c.ref, {
          linkedVendorUid: authUid,
          invitationAccepted: true,
          linkedAt: FieldValue.serverTimestamp(),
        });
        ownerLinked++;

        for (const eventDoc of eventsSnap.docs) {
          const tasksSnap = await db
            .collection(
              `artifacts/${APP_ID}/users/${ownerUid}/events/${eventDoc.id}/tasks`,
            )
            .where('assignedContactId', '==', c.id)
            .get();
          for (const t of tasksSnap.docs) {
            if (t.data().assignedVendorUid) continue; // preserve manual
            batch.update(t.ref, {
              assignedVendorUid: authUid,
              assignedVendorName:
                t.data().assignedVendorName || c.data().vendorName || '',
            });
            ownerBackfilled++;
          }
        }
      }

      try {
        await batch.commit();
        totalLinked += ownerLinked;
        totalBackfilled += ownerBackfilled;
        ownersTouched++;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[autoLinkVendorContacts] owner ${ownerUid} batch failed:`,
          (err as Error)?.message,
        );
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
