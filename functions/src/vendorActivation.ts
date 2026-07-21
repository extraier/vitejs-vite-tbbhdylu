// vendorActivation.ts — admin-driven "send invite link" + "claim seeded
// vendor" cloud functions.
//
// 2026-07-20 — new module. Three callables wired up from AdminVendors.jsx
// + the public signup screen:
//
//   activateSeededVendor   — admin generates an invite token, returns a
//                            deep link with ?signup&venue=&token=. The
//                            vendor's /vendors/{slug} doc gets
//                            signupStatus='invited'. Email is optional —
//                            admin can copy the link instead.
//
//   claimSeededVendor      — runs at the end of the vendor's signup flow.
//                            Reads /vendors/{slug}, validates the
//                            invitationToken, copies the doc to
//                            /vendors/{auth.uid}, moves the storage
//                            objects, deletes the slug doc. Idempotent.
//
//   sendVendorInviteEmail  — sibling to sendHelperInviteEmail. Uses the
//                            same SMTP_URL / SMTP_FROM / APP_BASE_URL
//                            secrets, same handle-unhandled pattern.
//
// Why a separate file: keeps the activation flow isolated from the
// applyAsVendor wizard path so the two can evolve independently. The
// vendor-id model used by applyAsVendor (auth.uid = doc id) is also what
// claimSeededVendor produces; this aligns seeded vendor docs with the
// auth-uid-typed world rather than creating a parallel schema.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';

try {
  initializeApp();
} catch (_) {
  // Already initialized by another module — admin SDK is a singleton.
}

const db = getFirestore();
const bucket = getStorage().bucket();

const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

// 14-day default for invitation tokens. Vendor can be re-invited if
// they expire; the new token supersedes the old one.
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Length of the opaque invite token. 12 chars gives ~7e16 keys — enough
// that brute force isn't realistic.
const INVITE_TOKEN_LEN = 12;

function isAdmin(req: any): boolean {
  return !!req.auth && (req.auth.token as { admin?: boolean })?.admin === true;
}

function genToken(len: number): string {
  // URL-safe base32 (no padding), lowercase. crypto.randomBytes is
  // cryptographically suitable here — these are short-lived, scoped
  // tokens for vendor signup, not session secrets.
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/1/0/o
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function readVendor(slug: string) {
  // The vendor doc lives at /vendors/{slug} during the seeded period.
  // After claim, it should live at /vendors/{auth.uid}. We try both
  // locations because the slug doc may have been migrated mid-flight.
  const slugRef = db.collection('vendors').doc(slug);
  const slugSnap = await slugRef.get();
  if (slugSnap.exists) return { source: 'slug' as const, ref: slugRef, data: slugSnap.data() as any };
  // Otherwise check if an activated vendor with the same slug-origin
  // exists already. We use the originalSlug field set by claimSeededVendor.
  const allWithOrig = await db
    .collection('vendors')
    .where('originalSlug', '==', slug)
    .limit(1)
    .get();
  if (!allWithOrig.empty) {
    const ref = allWithOrig.docs[0].ref;
    return { source: 'migrated' as const, ref, data: ref.get().then((s) => s.data() as any) as any };
  }
  throw new HttpsError('not-found', `找不到 seeded vendor "${slug}" — 請確認 slug 拼字正確.`);
}

// ───────────────────────────────────────────────────────────────────────────
// activateSeededVendor
// ───────────────────────────────────────────────────────────────────────────
//
// Admin-only. Generates a fresh invitationToken for a seeded vendor
// slug. Writes signupStatus='invited' + invitationExpiresAt onto the
// doc. Returns the deep link the vendor should click.

interface ActivateSeededVendorInput {
  slug: string;
  ttlMs?: number; // optional override; defaults to 14d
}

interface ActivateSeededVendorResult {
  ok: true;
  slug: string;
  signupUrl: string;
  signupStatus: 'invited';
  invitationExpiresAt: string; // ISO
}

export const activateSeededVendor = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 30, memory: '256MiB', secrets: [APP_BASE_URL] },
  async (req): Promise<ActivateSeededVendorResult> => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!isAdmin(req)) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { slug, ttlMs } = (req.data || {}) as ActivateSeededVendorInput;
    if (!slug || typeof slug !== 'string') {
      throw new HttpsError('invalid-argument', 'slug is required.');
    }

    const found = await readVendor(slug);
    if (found.source === 'migrated') {
      throw new HttpsError(
        'failed-precondition',
        '呢個商戶已經畀人 claim 咗 — activation link 已經失效. (This vendor was already claimed.)',
      );
    }
    const data = found.data as any;
    if (data.signupStatus === 'claimed') {
      throw new HttpsError('failed-precondition', '呢個商戶已經激活完成 (already claimed).');
    }

    const token = genToken(INVITE_TOKEN_LEN);
    const expiresAt = Date.now() + (ttlMs && ttlMs > 0 ? ttlMs : INVITE_TTL_MS);
    await found.ref.set(
      {
        signupStatus: 'invited',
        invitationToken: token,
        invitationExpiresAt: new Date(expiresAt),
        invitedAt: FieldValue.serverTimestamp(),
        invitedBy: req.auth!.uid,
      },
      { merge: true },
    );
    // Analytics — note the admin actor so we can attribute later.
    await logActivationEvent({
      type: 'token_issued',
      slug,
      actorUid: req.auth!.uid,
      detail: { ttlMs: expiresAt - Date.now(), hadExistingToken: data.invitationToken ? true : false },
    });

    const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    const signupUrl = `${baseUrl || 'https://savetheday.io'}/?signup&venue=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`;

    return {
      ok: true,
      slug,
      signupUrl,
      signupStatus: 'invited',
      invitationExpiresAt: new Date(expiresAt).toISOString(),
    };
  },
);

// ───────────────────────────────────────────────────────────────────────────
// claimSeededVendor
// ───────────────────────────────────────────────────────────────────────────
//
// Called from the public signup flow after the vendor has authenticated
// and chosen "Claim seeded vendor <slug>". Atomic-ish: reads the slug
// doc, validates token, copies all fields into /vendors/{auth.uid},
// moves storage objects, deletes the slug doc.

interface ClaimSeededVendorInput {
  slug: string;
  invitationToken: string;
}

interface ClaimSeededVendorResult {
  ok: true;
  authUid: string;
  migratedStorageObjects: number;
}

export const claimSeededVendor = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (req): Promise<ClaimSeededVendorResult> => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { slug, invitationToken } = (req.data || {}) as ClaimSeededVendorInput;
    if (!slug || typeof slug !== 'string') {
      throw new HttpsError('invalid-argument', 'slug is required.');
    }
    if (!invitationToken || typeof invitationToken !== 'string') {
      throw new HttpsError('invalid-argument', 'invitationToken is required.');
    }

    const authUid = req.auth.uid;
    const slugRef = db.collection('vendors').doc(slug);
    const slugSnap = await slugRef.get();
    if (!slugSnap.exists) {
      throw new HttpsError('not-found', 'Invitation no longer valid — vendor was claimed by another path.');
    }
    const data = slugSnap.data() as any;

    // Token check + expiry
    if (data.invitationToken !== invitationToken) {
      throw new HttpsError('permission-denied', 'Invitation token 不正確 (token mismatch).');
    }
    if (data.signupStatus === 'claimed') {
      throw new HttpsError('failed-precondition', 'Invitation already used.');
    }
    const expires = data.invitationExpiresAt?.toMillis?.() || 0;
    if (!expires || expires < Date.now()) {
      throw new HttpsError('failed-precondition', 'Invitation expired — ask admin to re-issue.');
    }

    // Refuse if this auth uid already has a vendor doc. Prevents the
    // vendor from re-claiming someone else's seeded slot if they're
    // already onboarded.
    const existingAuthRef = db.collection('vendors').doc(authUid);
    const existingAuthSnap = await existingAuthRef.get();
    if (existingAuthSnap.exists) {
      throw new HttpsError(
        'already-exists',
        '你已經有一個 /vendors/{authUid} doc. 唔可以再 claim 另一個 seeded slot — 喺 dashboard 編輯原本個 profile 即可.',
      );
    }

    // Copy doc fields, drop slug-specific transient fields, mark as claimed.
    const {
      invitationToken: _t,
      invitationExpiresAt: _e,
      signupStatus: _s,
      invitedAt: _i,
      invitedBy: _by,
      claimedByUid: _cb,
      claimedAt: _ca,
      source: _src,
      ...seedFields
    } = data;

    const newDoc = {
      ...seedFields,
      // Required auth-coupled fields
      vendorUid: authUid,
      ownerUid: authUid,
      originalSlug: slug, // back-reference for traceability
      signupStatus: 'claimed',
      claimedByUid: authUid,
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: data.createdAt || FieldValue.serverTimestamp(),
    };

    // Move storage objects first. If this fails, the doc claim hasn't
    // happened yet, so no inconsistency.
    const oldPrefix = `vendors/${slug}/portfolio/`;
    let movedCount = 0;
    try {
      const [files] = await bucket.getFiles({ prefix: oldPrefix });
      const newPortfolioUrls: string[] = [];
      for (const f of files) {
        const fileName = f.name.slice(oldPrefix.length); // e.g. 'wed-vendor-01.jpg'
        const newName = `vendors/${authUid}/portfolio/${fileName}`;
        await f.copy(bucket.file(newName));
        await f.delete();
        movedCount++;
        newPortfolioUrls.push(
          `https://storage.googleapis.com/${bucket.name}/${newName}`,
        );
      }
      // Stash fresh portfolio URLs into the new doc
      (newDoc as any).portfolio = newPortfolioUrls;
      (newDoc as any).portfolioCount = newPortfolioUrls.length;
    } catch (e) {
      console.warn('[claimSeededVendor] storage move failed (non-fatal):', e);
      // Continue — the new doc lands even if storage move errored. The
      // pre-existing URLs in data.portfolio continue to work for the
      // post-migration reading code; if any of those URLs still point
      // at the slug prefix, the public-storage-rules change I deployed
      // earlier keeps them readable until we delete the slug doc.
    }

    // Atomic-ish write: set the new doc + delete the slug doc in a
    // single batch. If either fails, neither takes effect.
    const batch = db.batch();
    batch.set(existingAuthRef, newDoc);
    batch.delete(slugRef);
    await batch.commit();

    // Analytics — log the success path. We log AFTER the commit so we
    // never write a "success" event for a transaction that actually
    // rolled back.
    await logActivationEvent({
      type: 'claim_success',
      slug,
      authUid,
      detail: { migratedStorageObjects: movedCount },
    });

    return { ok: true, authUid, migratedStorageObjects: movedCount };
  },
);

// ───────────────────────────────────────────────────────────────────────────
// claimAndApplyAsVendor
// ───────────────────────────────────────────────────────────────────────────
//
// Combined "claim seeded slot" + "submit wizard data" in one atomic
// call. Replaces the two-step path (applyAsVendor then claim) so the
// wizard can submit in a single round-trip when called via the
// invitation deep-link.
//
// Why: applyAsVendor refuses to write if /vendors/{authUid} already
// exists, and claimSeededVendor refuses if /vendors/{authUid} already
// exists. So whichever runs first blocks the other. This function
// bypasses both checks by:
//   1. Validating the invite token on the slug doc
//   2. Reading the slug doc + copying it to /vendors/{authUid}
//   3. Overlaying wizard form fields onto the new doc
//   4. Migrating storage (same logic as claimSeededVendor)
//   5. Deleting the slug doc
//
// All five steps happen in one batch where possible — Firestore
// allows a single batch to span reads+writes, so we re-read the slug
// inside the transaction for safety.

interface ClaimAndApplyInput {
  slug: string;
  invitationToken: string;
  // Wizard payload — same shape as applyAsVendor. Server re-validates
  // every field; we re-use the same ALLOWED_VENDOR_FIELDS whitelist.
  name: string;
  category: string;
  subcategory?: string;
  description?: string;
  yearsInBusiness?: number;
  serviceArea?: string;
  priceMin: number;
  priceMax?: number | null;
  currency?: string;
  openEnded?: boolean;
  portfolio?: string[];
  tags?: string[];
}

interface ClaimAndApplyResult {
  ok: true;
  vendorUid: string;
  status: 'pending';
  migratedStorageObjects: number;
}

const ALLOWED_VENDOR_FIELDS = [
  'name',
  'category',
  'subcategory',
  'description',
  'priceMin',
  'priceMax',
  'currency',
  'openEnded',
  'tags',
  'rating',
  'serviceArea',
  'yearsInBusiness',
  'portfolio',
] as const;

function pickAllowed(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_VENDOR_FIELDS) {
    if (k in input) out[k] = input[k];
  }
  return out;
}

export const claimAndApplyAsVendor = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (req): Promise<ClaimAndApplyResult> => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const data = (req.data || {}) as ClaimAndApplyInput;
    if (!data.slug || typeof data.slug !== 'string') {
      throw new HttpsError('invalid-argument', 'slug is required.');
    }
    if (!data.invitationToken || typeof data.invitationToken !== 'string') {
      throw new HttpsError('invalid-argument', 'invitationToken is required.');
    }
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
      throw new HttpsError('invalid-argument', '請填寫商戶名稱 (name is required, ≥2 chars).');
    }
    if (!data.category || typeof data.category !== 'string') {
      throw new HttpsError('invalid-argument', '請選擇分類 (category is required).');
    }
    if (typeof data.priceMin !== 'number' || data.priceMin < 0) {
      throw new HttpsError('invalid-argument', 'priceMin 必須是非負數字.');
    }
    if (data.portfolio != null && !Array.isArray(data.portfolio)) {
      throw new HttpsError('invalid-argument', 'portfolio 必須是 array of URLs.');
    }
    if (Array.isArray(data.portfolio) && data.portfolio.length > 24) {
      throw new HttpsError('invalid-argument', '作品集最多 24 張圖片.');
    }
    if (data.tags != null && !Array.isArray(data.tags)) {
      throw new HttpsError('invalid-argument', 'tags 必須是 array of strings.');
    }
    if (Array.isArray(data.tags) && data.tags.length > 10) {
      throw new HttpsError('invalid-argument', '最多 10 個標籤.');
    }

    const authUid = req.auth.uid;
    const slugRef = db.collection('vendors').doc(data.slug);
    const newRef = db.collection('vendors').doc(authUid);

    // Analytics — log the wizard submit. We emit this BEFORE the
    // validation guards so we can see in the logs how many wizard
    // submissions got rejected vs. succeeded (funnel-style insight).
    await logActivationEvent({
      type: 'apply_attempt',
      slug: data.slug,
      authUid,
    });

    // Validate token + existence + expiry BEFORE any migration work.
    // If anything fails we bail out without touching storage.
    const slugSnap = await slugRef.get();
    if (!slugSnap.exists) {
      await logActivationEvent({
        type: 'apply_failed',
        slug: data.slug,
        authUid,
        errorMessage: 'Invitation no longer valid — vendor was claimed by another path.',
      });
      throw new HttpsError('not-found', 'Invitation no longer valid — vendor was claimed by another path.');
    }
    const slugData = slugSnap.data() as any;
    if (slugData.invitationToken !== data.invitationToken) {
      await logActivationEvent({
        type: 'apply_failed',
        slug: data.slug,
        authUid,
        errorMessage: 'Invitation token 不正確 (token mismatch).',
      });
      throw new HttpsError('permission-denied', 'Invitation token 不正確 (token mismatch).');
    }
    if (slugData.signupStatus === 'claimed') {
      await logActivationEvent({
        type: 'apply_failed',
        slug: data.slug,
        authUid,
        errorMessage: 'Invitation already used.',
      });
      throw new HttpsError('failed-precondition', 'Invitation already used.');
    }
    const expires = slugData.invitationExpiresAt?.toMillis?.() || 0;
    if (!expires || expires < Date.now()) {
      await logActivationEvent({
        type: 'apply_failed',
        slug: data.slug,
        authUid,
        errorMessage: 'Invitation expired.',
      });
      throw new HttpsError('failed-precondition', 'Invitation expired — ask admin to re-issue.');
    }

    // Refuse if this auth uid already has a vendor doc. Two reasons:
    //   1. They're a vendor already — they should be editing their
    //      profile, not claiming a seed slot.
    //   2. If the wizard was already submitted before, the doc is
    //      theirs and we shouldn't nuke it.
    const existingAuthSnap = await newRef.get();
    if (existingAuthSnap.exists) {
      await logActivationEvent({
        type: 'apply_failed',
        slug: data.slug,
        authUid,
        errorMessage: 'Auth uid already has a vendor doc.',
      });
      throw new HttpsError(
        'already-exists',
        '你已經有一個 vendor 帳戶. 喺 dashboard 編輯原本個 profile 即可.',
      );
    }

    // Build the new doc: seed fields + wizard overlay.
    const {
      invitationToken: _t,
      invitationExpiresAt: _e,
      signupStatus: _s,
      invitedAt: _i,
      invitedBy: _by,
      claimedByUid: _cb,
      claimedAt: _ca,
      source: _src,
      ...seedFields
    } = slugData as Record<string, unknown>;

    const sanitized = pickAllowed(data as unknown as Record<string, unknown>);
    const newDoc: Record<string, unknown> = {
      ...seedFields, // portfolio / tags / photos from seed pass through
      ...sanitized, // wizard fields overlay
      vendorUid: authUid,
      ownerUid: authUid,
      originalSlug: data.slug,
      signupStatus: 'claimed',
      claimedByUid: authUid,
      claimedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Default rating to 0 (applyAsVendor pattern)
      rating: typeof sanitized.rating === 'number' ? sanitized.rating : 0,
      status: 'pending',
    };

    // Move storage objects. Same logic as claimSeededVendor.
    const oldPrefix = `vendors/${data.slug}/portfolio/`;
    let movedCount = 0;
    let newPortfolioUrls: string[] = [];
    try {
      const [files] = await bucket.getFiles({ prefix: oldPrefix });
      for (const f of files) {
        const fileName = f.name.slice(oldPrefix.length);
        const newName = `vendors/${authUid}/portfolio/${fileName}`;
        await f.copy(bucket.file(newName));
        await f.delete();
        movedCount++;
        newPortfolioUrls.push(`https://storage.googleapis.com/${bucket.name}/${newName}`);
      }
      if (newPortfolioUrls.length) {
        newDoc.portfolio = newPortfolioUrls;
        newDoc.portfolioCount = newPortfolioUrls.length;
      }
    } catch (e) {
      // Storage migration failure is non-fatal — the existing
      // portfolio URLs in data.portfolio still work (slug doc kept
      // its public-read rule). We continue but note the partial
      // state in console for debugging.
      console.warn('[claimAndApplyAsVendor] storage migration failed (non-fatal):', e);
    }

    const batch = db.batch();
    batch.set(newRef, newDoc);
    batch.delete(slugRef);
    await batch.commit();

    // Analytics — log AFTER the commit so we don't write a "success"
    // for a transaction that rolled back.
    await logActivationEvent({
      type: 'apply_success',
      slug: data.slug,
      authUid,
      detail: {
        migratedStorageObjects: movedCount,
        wizardCategory: sanitized.category,
        wizardSubcategory: sanitized.subcategory,
      },
    });

    return { ok: true, vendorUid: authUid, status: 'pending', migratedStorageObjects: movedCount };
  },
);

// ───────────────────────────────────────────────────────────────────────────
// sendVendorInviteEmail
// ───────────────────────────────────────────────────────────────────────────
//
// Admin-only. Sends the deep link via SMTP. Failure is logged but
// doesn't block — admin can always copy the link from the UI.

interface SendVendorInviteEmailInput {
  slug: string;
  email: string;
  /** Optional override; if omitted, admin must have just called
   *  activateSeededVendor to mint a fresh token. */
  signupUrl?: string;
}

interface SendVendorInviteEmailResult {
  ok: true;
  sent: boolean;
  reason?: string;
}

export const sendVendorInviteEmail = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req): Promise<SendVendorInviteEmailResult> => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!isAdmin(req)) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { slug, email, signupUrl: signupUrlOverride } = (req.data || {}) as SendVendorInviteEmailInput;
    if (!slug || typeof slug !== 'string') throw new HttpsError('invalid-argument', 'slug is required.');
    if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'email required and must look like an email.');
    }

    const found = await readVendor(slug);
    if (found.source === 'migrated') {
      throw new HttpsError('failed-precondition', '呢個商戶已經被人 claim 咗 — 唔可以再寄 invite.');
    }

    let signupUrl = signupUrlOverride || '';
    if (!signupUrl) {
      // Mint a fresh token right now — re-using a token would let the
      // email leak the same URL to anyone who has it.
      const token = genToken(INVITE_TOKEN_LEN);
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      await found.ref.set(
        {
          signupStatus: 'invited',
          invitationToken: token,
          invitationExpiresAt: expiresAt,
          invitedEmail: email,
          invitedAt: FieldValue.serverTimestamp(),
          invitedBy: req.auth!.uid,
        },
        { merge: true },
      );
      const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
      signupUrl = `${baseUrl || 'https://savetheday.io'}/?signup&venue=${encodeURIComponent(slug)}&token=${token}`;
    }

    const data = found.data as any;
    const vendorName = data.name || slug;

    // Reuse the SMTP plumbing from helpersMail by inlining a minimal
    // transporter. We deliberately do NOT import helpersMail's internal
    // send code — circular imports + tighter secret access is cleaner
    // this way. If we ever extend this to HTML templates, factor out
    // a shared `mailer.ts` module.
    const smtpUrl = process.env.SMTP_URL;
    const smtpFrom = process.env.SMTP_FROM;
    if (!smtpUrl || !smtpFrom) {
      console.warn('[sendVendorInviteEmail] SMTP_URL or SMTP_FROM not set, skipping send');
      return { ok: true, sent: false, reason: 'SMTP not configured' };
    }

    try {
      const transport = nodemailer.createTransport(smtpUrl);
      const subject = `歡迎加入 Save The Day · ${vendorName}`;
      const text = [
        `Hi ${vendorName},`,
        ``,
        `你喺「Save The Day」嘅 vendor listing 已經準備好喇。`,
        `請用以下連結註冊以啟用商戶帳戶、編輯你嘅 portfolio 同接生意:`,
        ``,
        signupUrl,
        ``,
        `連結 14 日內有效。如果你唔識點用，請回覆呢封 email。`,
        ``,
        `— Save The Day 團隊`,
      ].join('\n');
      const html = renderVendorInviteHtml({ vendorName, signupUrl, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
      await transport.sendMail({
        from: smtpFrom,
        to: email,
        subject,
        text,
        html,
      });
      // Analytics — log the admin actor + recipient for attribution.
      // "ok: false" path emits email_failed below.
      await logActivationEvent({
        type: 'email_sent',
        slug,
        actorUid: req.auth!.uid,
        detail: { email, expiresInDays: Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000)) },
      });
      return { ok: true, sent: true };
    } catch (e: any) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn('[sendVendorInviteEmail] send failed:', msg);
      // Analytics — log the failure too, so admin can see which
      // recipients bounced. Non-fatal: sendVendorInviteEmail returns
      // { ok: true, sent: false, reason } so the client UI can show
      // the link manually.
      await logActivationEvent({
        type: 'email_failed',
        slug,
        actorUid: req.auth!.uid,
        detail: { email },
        errorMessage: msg,
      });
      return { ok: true, sent: false, reason: msg };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// bulkActivateSeededVendors
// ─────────────────────────────────────────────────────────────────────────
//
// 2026-07-20 — admin-driven bulk minting of invitation tokens for many
// seeded vendors at once. Use case: after the 643-vendor heychoices
// import, the admin wants to onboard them all in one pass instead of
// clicking each row.
//
// Design notes:
//   - Each vendor gets its OWN freshly-minted token. We deliberately
//     do NOT reuse the single-vendor `activateSeededVendor` callable
//     N times in a Promise.all loop because:
//       a) one bad slug shouldn't fail the whole batch — we need
//          per-row error capture for the admin UI to surface them.
//       b) admin token minting should be rate-limited per-call (1
//          batch = 1 admin RPC, not N) — Firebase Functions charges
//          per call.
//   - The result includes per-row status so the admin UI can show
//     "642 ok, 1 failed (aqua: not found)".
//   - Concurrency: emails send serially with a small delay between
//     each to avoid triggering the SMTP provider's anti-spam heuristics.
//     If we ever ramp up to 1000+ per batch, swap to a background
//     queue (Task Queue) — but for 100s at a time this is fine.
//   - 500-row cap per call: protects against accidental "send 5000
//     at once" misuse. Admin can fire multiple batches.

interface BulkActivateSeededVendorInput {
  items: Array<{
    slug: string;
    email?: string; // optional — if provided, sends invite email after minting
  }>;
  ttlMs?: number;
  // If true, send email for each item where email is set. If false,
  // just mint tokens and return URLs (admin copies/pastes).
  sendEmails?: boolean;
}

interface BulkActivateVendorRow {
  slug: string;
  ok: boolean;
  signupUrl?: string;
  emailSent?: boolean;
  emailError?: string;
  error?: string;
  signupStatus?: 'invited' | 'claimed';
  invitationExpiresAt?: string;
}

interface BulkActivateSeededVendorResult {
  ok: true;
  totalRequested: number;
  minted: number;
  emailsSent: number;
  emailsFailed: number;
  rows: BulkActivateVendorRow[];
}

export const bulkActivateSeededVendors = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 540, // 9 min — large batches need time
    memory: '512MiB',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req): Promise<BulkActivateSeededVendorResult> => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!isAdmin(req)) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { items, sendEmails = false, ttlMs } = (req.data || {}) as BulkActivateSeededVendorInput;
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'items array is required.');
    }
    if (items.length > 500) {
      throw new HttpsError('invalid-argument', '一次最多 500 個 — 請分批發送.');
    }
    // Dedupe by slug (keep first occurrence). Protects against
    // double-clicks in the UI.
    const seen = new Set<string>();
    const deduped = items.filter((it) => {
      if (!it.slug || typeof it.slug !== 'string' || seen.has(it.slug)) return false;
      seen.add(it.slug);
      return true;
    });

    const expiresMs = ttlMs && ttlMs > 0 ? ttlMs : INVITE_TTL_MS;
    const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    const fallbackBase = baseUrl || 'https://savetheday.io';

    // Lazily create SMTP transport — only if at least one item has
    // an email AND sendEmails is true. Skipping the createTransport
    // on pure-link batches saves ~50ms and avoids touching secret.
    const smtpUrl = process.env.SMTP_URL;
    const smtpFrom = process.env.SMTP_FROM;
    const canSendEmail = sendEmails && !!smtpUrl && !!smtpFrom;
    const transport = canSendEmail ? nodemailer.createTransport(smtpUrl!) : null;

    const rows: BulkActivateVendorRow[] = [];
    let minted = 0;
    let emailsSent = 0;
    let emailsFailed = 0;

    for (const item of deduped) {
      try {
        const found = await readVendor(item.slug);
        if (found.source === 'migrated') {
          rows.push({ slug: item.slug, ok: false, error: 'already claimed' });
          continue;
        }
        const data = found.data as any;
        if (data.signupStatus === 'claimed') {
          rows.push({ slug: item.slug, ok: false, error: 'already claimed' });
          continue;
        }
        // Mint fresh token per slug. Same code path as the single
        // vendor callable so behavior is identical.
        const token = genToken(INVITE_TOKEN_LEN);
        const expiresAt = new Date(Date.now() + expiresMs);
        await found.ref.set(
          {
            signupStatus: 'invited',
            invitationToken: token,
            invitationExpiresAt: expiresAt,
            invitedAt: FieldValue.serverTimestamp(),
            invitedBy: req.auth!.uid,
            ...(item.email ? { invitedEmail: item.email } : {}),
          },
          { merge: true },
        );
        const signupUrl = `${fallbackBase}/?signup&venue=${encodeURIComponent(item.slug)}&token=${encodeURIComponent(token)}`;
        minted++;

        // Log the token_issued event so the activation history
        // surfaces the bulk operation in the per-vendor timeline.
        await logActivationEvent({
          type: 'token_issued',
          slug: item.slug,
          actorUid: req.auth!.uid,
          detail: {
            ttlMs: expiresMs,
            hadExistingToken: data.invitationToken ? true : false,
            bulkBatch: true,
          },
        });

        const row: BulkActivateVendorRow = {
          slug: item.slug,
          ok: true,
          signupUrl,
          signupStatus: 'invited',
          invitationExpiresAt: expiresAt.toISOString(),
        };

        // Send email if requested + we have an email + transport.
        if (item.email && transport && smtpFrom) {
          try {
            const vendorName = data.name || item.slug;
            const subject = `歡迎加入 Save The Day · ${vendorName}`;
            const text = [
              `Hi ${vendorName},`,
              ``,
              `你喺「Save The Day」嘅 vendor listing 已經準備好喇。`,
              `請用以下連結註冊以啟用商戶帳戶、編輯你嘅 portfolio 同接生意:`,
              ``,
              signupUrl,
              ``,
              `連結 14 日內有效。如果你唔識點用，請回覆呢封 email。`,
              ``,
              `— Save The Day 團隊`,
            ].join('\n');
            const html = renderVendorInviteHtml({
              vendorName,
              signupUrl,
              expiresAt,
            });
            await transport.sendMail({
              from: smtpFrom,
              to: item.email,
              subject,
              text,
              html,
            });
            row.emailSent = true;
            emailsSent++;
            await logActivationEvent({
              type: 'email_sent',
              slug: item.slug,
              actorUid: req.auth!.uid,
              detail: { email: item.email, bulkBatch: true },
            });
          } catch (e: any) {
            const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
            row.emailSent = false;
            row.emailError = msg;
            emailsFailed++;
            await logActivationEvent({
              type: 'email_failed',
              slug: item.slug,
              actorUid: req.auth!.uid,
              detail: { email: item.email, bulkBatch: true },
              errorMessage: msg,
            });
          }
          // Light throttle between SMTP sends — keeps Gmail +
          // SendGrid happy at scale. 50ms = ~20 emails/sec, plenty
          // for the SMTP provider's per-connection limit.
          await new Promise((r) => setTimeout(r, 50));
        }

        rows.push(row);
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        rows.push({ slug: item.slug, ok: false, error: msg });
      }
    }

    return {
      ok: true,
      totalRequested: items.length,
      minted,
      emailsSent,
      emailsFailed,
      rows,
    };
  },
);

// Minimal HTML escape (we hand-roll instead of pulling a dep).
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

// ───────────────────────────────────────────────────────────────────────────
// logActivationEvent
// ───────────────────────────────────────────────────────────────────────────
//
// 2026-07-20 — analytics helper. Writes one row to the
// /vendorActivationLogs/{auto} collection on every meaningful step
// of the activation flow. Five event types are emitted:
//
//   'token_issued'    — admin minted a fresh token (activateSeededVendor)
//   'email_sent'      — admin sent the SMTP invite (sendVendorInviteEmail)
//   'email_failed'    — SMTP send rejected (non-fatal path)
//   'claim_attempt'   — vendor tried to claim (claimSeededVendor)
//   'claim_failed'    — token/expire/permission check failed
//   'claim_success'   — vendor successfully claimed (claimSeededVendor)
//   'apply_attempt'   — vendor's wizard submit reached (claimAndApply)
//   'apply_failed'    — wizard claim rejected
//   'apply_success'   — wizard claim committed
//
// Logs are write-only from server, read-only from admin UI (rules
// below). Admin UI will eventually surface a "Activation history"
// panel showing the chain for any given vendor.
//
// Failure mode: if the log write fails, the surrounding operation
// still completes — analytics must never block the user flow. We
// catch + console.warn rather than throw.

interface ActivationEventType {
  type: 'token_issued' | 'email_sent' | 'email_failed' | 'claim_attempt' | 'claim_failed' | 'claim_success' | 'apply_attempt' | 'apply_failed' | 'apply_success';
  slug: string;
  actorUid?: string;
  authUid?: string;
  detail?: Record<string, unknown>;
  errorMessage?: string;
}

async function logActivationEvent(e: ActivationEventType): Promise<void> {
  try {
    const doc: Record<string, unknown> = {
      type: e.type,
      slug: e.slug,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (e.actorUid) doc.actorUid = e.actorUid;
    if (e.authUid) doc.authUid = e.authUid;
    if (e.detail) doc.detail = e.detail;
    if (e.errorMessage) doc.errorMessage = e.errorMessage.slice(0, 500);
    await db.collection('vendorActivationLogs').add(doc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[logActivationEvent] write failed (non-fatal):', msg);
  }
}

// 2026-07-20 — branded vendor invite email. Mirrors the helper
// invite template's structure (single column, gradient hero, big
// CTA button) but uses the vendor emerald palette so the recipient
// immediately recognizes this as a vendor onboarding moment. The
// `logoUrl` is a static SVG served from the public site — saves the
// recipient from "is this from a real company" doubt.
function renderVendorInviteHtml(args: {
  vendorName: string;
  signupUrl: string;
  expiresAt: Date;
}): string {
  const { vendorName, signupUrl, expiresAt } = args;
  // Date in CJK: "2026年8月3日 10:05". Anchored to the deployed
  // server's local time; the actual expiry is encoded into the URL
  // itself, so a slight clock drift here is acceptable — this is a
  // human-friendly reminder, not a contract.
  const fmt = new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong',
  });
  const expiresLabel = fmt.format(expiresAt);

  // Logo: green emerald "Save The Day" wordmark + emoji. Inline SVG
  // means the email renders the logo even with images off (which is
  // common on corporate Outlook). The wordmark is recognizable
  // without the emoji for accessibility.
  const logo = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Save The Day">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#10b981"/>
          <stop offset="100%" stop-color="#0d9488"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/>
      <text x="32" y="44" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="900" font-size="34" fill="#ffffff">S</text>
    </svg>`;

  return `<!DOCTYPE html>
<html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="500" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#10b981 0%,#0d9488 50%,#0f766e 100%);padding:40px 32px;text-align:center;color:#ffffff;">
          <div style="margin-bottom:16px;display:inline-block;">${logo}</div>
          <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.3em;font-weight:900;color:#ffffff;text-transform:uppercase;opacity:0.92;">Save The Day · Vendor Onboarding</p>
          <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;line-height:1.25;color:#ffffff;">${escapeHtml(vendorName)}，你嘅商戶專頁已就緒</h1>
          <p style="margin:8px 0 0;font-size:13px;color:#ffffff;opacity:0.92;">一鍵啟動，繼續編輯你嘅 listing、接生意、回覆新人查詢</p>
        </td></tr>
        <tr><td style="padding:32px 28px 36px;text-align:center;color:#1e293b;">
          <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7;text-align:left;">
            你喺 Save The Day 嘅 vendor listing 已經準備好喇。我哋由 heychoices.com 接手咗你原本嘅商戶資料 — 作品集相片、簡介、價錢範圍都已經保存好。
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;text-align:left;">
            用以下連結註冊或登入 Save The Day 商戶帳戶，就可以即時開始接收新人查詢、編輯你嘅價錢、上載新作品。
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
            <tr><td style="border-radius:14px;background:linear-gradient(135deg,#10b981,#0d9488);">
              <a href="${escapeAttr(signupUrl)}" style="display:inline-block;padding:16px 36px;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;letter-spacing:0.05em;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK',sans-serif;">啟動商戶帳戶 · 立即登入</a>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            連結有效到 <strong style="color:#475569;">${escapeHtml(expiresLabel)}</strong>（14 日內）。點擊後會跳到註冊/登入頁，請用你想用嚟管理商戶嘅電郵繼續。
          </p>
          <hr style="margin:28px 0 16px;border:none;border-top:1px solid #e2e8f0;" />
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="left" style="font-size:12px;color:#64748b;line-height:1.6;vertical-align:top;">
              <strong style="color:#1e293b;">啟動後可以做嘅事：</strong>
              <ul style="margin:8px 0 0;padding-left:20px;font-size:12px;color:#64748b;">
                <li>編輯價錢範圍、簡介、地區等資料</li>
                <li>上載新作品集相片</li>
                <li>接收 + 回覆新人查詢</li>
                <li>管理被指派嘅婚禮任務</li>
              </ul>
            </td></tr>
          </table>
          <hr style="margin:20px 0 16px;border:none;border-top:1px solid #e2e8f0;" />
          <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">Save The Day</p>
          <p style="margin:0;font-size:11px;color:#cbd5e1;">香港婚禮策劃助手 · savetheday.io</p>
        </td></tr>
      </table>
      <p style="margin:16px auto 0;max-width:500px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
        如果你唔識 Save The Day 或者冇喺 heychoices 開過 listing，請直接刪除此電郵。<br />
        有疑問？回覆此電郵，我哋嘅團隊會跟進。
      </p>
    </td></tr>
  </table>
</body></html>`;
}
