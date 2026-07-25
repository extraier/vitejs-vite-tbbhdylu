/**
 * Cloud Functions — Partner (Co-Owner) Invite Flow
 * ==================================================
 *
 * 2026-07-26 — Co-owners feature. The "single owner" model worked
 * fine for a solo user, but couples planning a wedding together
 * need equal access. The data model adds a `coOwners: string[]`
 * field on the event doc; anyone in that array gets full CRUD on
 * the owner's data, same as the original owner.
 *
 * Flow (mirrors the helper invite flow)
 * --------------------------------------
 * 1. Owner clicks "邀請另一半" (Invite partner) → opens modal
 * 2. Owner enters partner's email → calls sendPartnerInvite
 * 3. sendPartnerInvite creates a doc at:
 *      /users/{ownerUid}/pendingPartnerInvites/{inviteId}
 *    with { email, token, expiresAt, ownerName, eventId, eventName }
 * 4. sendPartnerInvite sends an email with a magic link:
 *      ${APP_BASE_URL}/?t=${token}
 * 5. Partner clicks link → sign-in or sign-up
 * 6. Front-end detects ?t= in URL → calls redeemPartnerInvite
 * 7. redeemPartnerInvite verifies the token, adds the partner's
 *    uid to the event's coOwners array, AND creates
 *    /users/{ownerUid}/coOwners/{partnerUid} so the partner
 *    can access the non-eventId subcollections (helpers,
 *    guestLinks, redPackets).
 *
 * The partner is NOT removed from their own events. After
 * acceptance they have N+1 events (their own + the partner's)
 * and the event picker shows all of them.
 *
 * Why a separate collection from /helpers
 * ---------------------------------------
 * Semantically, a co-owner is not a "helper" — they're an
 * equal partner. Keeping them in their own /coOwners collection
 * makes the data model self-documenting, the UI badges
 * (👰 + 🤵 vs 兄弟姊妹) make sense, and the Firestore rules
 * are easier to reason about (one helper system, one co-owner
 * system, never the twain shall meet).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
// 2026-07-26 — initializeApp is already called in index.ts (the
// shared bootstrap). Re-calling it here throws "default Firebase
// app already exists" at deploy time. We rely on the global
// already-initialized app and just grab the Firestore + Auth
// handles.
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';

const db = getFirestore();
const auth = getAuth();

const APP_ID = 'savetheday-production';

// Secrets (re-declared per module, see helpersMail.ts for why)
const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

// Magic-link token TTL: 7 days. Plenty for a partner to find
// the email and click; short enough that abandoned invites
// don't linger forever.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// Token signing (server-side, so the client can't forge invites)
// ────────────────────────────────────────────────────────────────────────────

// Fallback to a built-in dev secret if HMAC_KEY isn't set. DO NOT
// ship the default — anyone who knows it can mint valid invite tokens.
// (Same shape as invitations.ts to keep one mental model.)
const DEFAULT_HMAC_KEY = 'dev-only-do-not-ship-savetheday-2377a';
let cachedKey: string | null = null;
function getHmacKey(): string {
  if (cachedKey) return cachedKey;
  // process.env.HMAC_KEY is populated by the Cloud Functions
  // runtime when the user runs `firebase functions:secrets:set HMAC_KEY`.
  // Falls back to the dev default if unset (acceptable for local
  // emulator + dev testing; production should always set the secret).
  cachedKey = process.env.HMAC_KEY || DEFAULT_HMAC_KEY;
  return cachedKey;
}

function signToken(payload: object): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getHmacKey())
    .update(b64)
    .digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken<T = any>(token: string): T {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) throw new HttpsError('invalid-argument', 'Malformed token.');
  const expected = crypto
    .createHmac('sha256', getHmacKey())
    .update(b64)
    .digest('base64url');
  // timingSafeEqual requires equal-length buffers
  if (sig.length !== expected.length) {
    throw new HttpsError('permission-denied', 'Bad signature.');
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new HttpsError('permission-denied', 'Bad signature.');
  }
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    throw new HttpsError('invalid-argument', 'Bad payload.');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// sendPartnerInvite — owner-only
// ────────────────────────────────────────────────────────────────────────────

export interface SendPartnerInviteInput {
  ownerUid: string;          // the inviting owner
  partnerEmail: string;      // the partner's email
  eventId: string;           // which event to share
}

interface SendPartnerInviteResult {
  ok: boolean;
  sent: boolean;
  dryRun?: boolean;
  magicLinkUrl?: string;     // surfaced in dryRun for the front-end to show
  html?: string;             // the email body (dryRun only — for preview)
  error?: string;
}

export const sendPartnerInvite = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req): Promise<SendPartnerInviteResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const input: Partial<SendPartnerInviteInput> = req.data || {};
    const { ownerUid, partnerEmail, eventId } = input;
    if (!ownerUid || !partnerEmail || !eventId) {
      throw new HttpsError(
        'invalid-argument',
        'ownerUid, partnerEmail, eventId are all required.',
      );
    }
    if (req.auth.uid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'You can only send invites from your own account.',
      );
    }

    // Verify the owner actually owns this event.
    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError('not-found', 'Event not found.');
    }
    const eventData = eventSnap.data() || {};
    const eventName = eventData.name || '我們的婚禮';

    // 2026-07-26 — Reject if the invited email is the owner's own
    // email. Catches the "wife invites herself by typo" case.
    const ownerRecord = await auth.getUser(ownerUid);
    if (ownerRecord.email?.toLowerCase() === partnerEmail.toLowerCase()) {
      throw new HttpsError(
        'invalid-argument',
        'You cannot invite yourself — this is your own email.',
      );
    }

    // Reject if the partner is already a co-owner.
    // (we don't know the partner's uid yet — but we can check by
    // trying to look up the email. Skip for now; the redeem step
    // does a stricter check.)

    // Build the magic-link token.
    const tokenPayload = {
      ownerUid,
      eventId,
      partnerEmail: partnerEmail.toLowerCase(),
      // Issued-at (seconds). redeemPartnerInvite checks `iat`
      // against INVITE_TTL_MS for expiry.
      iat: Date.now(),
      // Random nonce so two invites for the same partner in the
      // same minute get distinct tokens (mostly cosmetic — the
      // redeem function doesn't compare nonces).
      nonce: crypto.randomBytes(8).toString('hex'),
    };
    const token = signToken(tokenPayload);

    // Persist the pending invite. We store it server-side so we
    // can (a) have a server-side record of who-was-invited-when,
    // and (b) revoke it on demand. The token is also derivable
    // from the data we store, but we re-verify on redeem by
    // looking up the doc + checking the token matches.
    const inviteRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('pendingPartnerInvites').doc();
    await inviteRef.set({
      ownerUid,
      eventId,
      email: partnerEmail.toLowerCase(),
      token,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    });

    // Look up the owner's display name for the email "from" line.
    const ownerName = ownerRecord.displayName || ownerRecord.email || '新郎／新娘';

    // Build the magic link. APP_BASE_URL is the production domain
    // (https://savetheday.io); the front-end will detect ?t= on
    // load and trigger the redemption flow.
    const baseUrl = process.env.APP_BASE_URL || 'https://savetheday.io';
    const magicLinkUrl = `${baseUrl}/?t=${encodeURIComponent(token)}`;

    // Email body. Bilingual (TC + EN) because the partner might
    // not read Chinese, and a wedding app should be inclusive.
    const subject = `${ownerName} 邀請你一起籌備「${eventName}」婚禮 💍`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #be185d; font-size: 22px;">💍 婚禮共同籌備邀請</h1>
        <p>${ownerName} 邀請你加入 <strong>${eventName}</strong> 的籌備工作，一同規劃這個大日子。</p>
        <p style="color: #64748b;">(Your partner ${ownerName} invited you to plan <strong>${eventName}</strong> together.)</p>
        <p>點擊以下連結接受邀請：</p>
        <p style="margin: 24px 0;">
          <a href="${magicLinkUrl}" style="display: inline-block; background: #be185d; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">接受邀請</a>
        </p>
        <p style="color: #64748b; font-size: 13px;">連結有效期 7 天。如果你未有 Save The Day 帳戶，接受邀請時會自動引導你註冊。</p>
        <p style="color: #64748b; font-size: 13px;">(Link valid for 7 days. If you don't have a Save The Day account yet, you'll be guided to sign up.)</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">如非你本人，請忽略此電郵。<br/>(If this isn't you, please ignore this email.)</p>
      </div>
    `;

    // Send via SMTP. Same pattern as invitations.ts: if SMTP_URL
    // isn't set, return dryRun with the link so the UI can
    // surface it for the owner to share manually.
    const smtpUrl = process.env.SMTP_URL;
    const fromAddr = process.env.SMTP_FROM || 'no-reply@savetheday.io';
    if (!smtpUrl) {
      return {
        ok: true,
        sent: false,
        dryRun: true,
        magicLinkUrl,
        html,
      };
    }
    try {
      const transporter = nodemailer.createTransport(smtpUrl);
      await transporter.sendMail({
        from: `${ownerName} 敬邀 <${fromAddr}>`,
        to: partnerEmail,
        subject,
        html,
      });
      return { ok: true, sent: true };
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.error('[sendPartnerInvite] SMTP error:', msg);
      // Don't fail the whole call — return ok:false so the UI can
      // fall back to the dryRun path (same as HelperManager does
      // for sendHelperInviteEmail).
      return { ok: false, sent: false, error: msg };
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────
// redeemPartnerInvite — called by the partner after they sign in
// ────────────────────────────────────────────────────────────────────────────

interface RedeemPartnerInviteInput {
  token: string;
}

interface RedeemPartnerInviteResult {
  ok: boolean;
  ownerUid: string;
  eventId: string;
  // The event data the partner should immediately switch to
  // after redemption. Saves them a round-trip.
  event: { id: string; name: string };
}

export const redeemPartnerInvite = onCall(
  {
    cors: true,
    region: 'us-central1',
  },
  async (req): Promise<RedeemPartnerInviteResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const input: Partial<RedeemPartnerInviteInput> = req.data || {};
    const { token } = input;
    if (!token) {
      throw new HttpsError('invalid-argument', 'token is required.');
    }
    const authUid = req.auth.uid;
    const authEmail = req.auth.token.email?.toLowerCase();
    if (!authEmail) {
      throw new HttpsError('invalid-argument', 'Auth user has no email.');
    }

    // Verify the token signature + payload.
    const payload = verifyToken<{
      ownerUid: string;
      eventId: string;
      partnerEmail: string;
      iat: number;
      nonce: string;
    }>(token);

    // Check expiry.
    if (Date.now() - payload.iat > INVITE_TTL_MS) {
      throw new HttpsError('deadline-exceeded', 'Invite link has expired.');
    }

    // Check the redeemer's email matches the invited email.
    if (payload.partnerEmail !== authEmail) {
      throw new HttpsError(
        'permission-denied',
        'This invite was sent to a different email.',
      );
    }

    // Look up the pending invite by token (defence in depth — the
    // signed token is the primary source of truth, but checking
    // the stored doc lets us reject a revoked invite).
    const pendingSnap = await db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(payload.ownerUid)
      .collection('pendingPartnerInvites')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .get();
    if (pendingSnap.empty) {
      throw new HttpsError('not-found', 'Invite not found or already used.');
    }

    // Now we know everything checks out. Do the migration:
    //   1. Add authUid to event.coOwners
    //   2. Create /users/{ownerUid}/coOwners/{authUid}
    //   3. Mark the pending invite as 'accepted' (or delete it)
    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(payload.ownerUid)
      .collection('events').doc(payload.eventId);
    const coOwnerRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(payload.ownerUid)
      .collection('coOwners').doc(authUid);

    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError('not-found', 'Event no longer exists.');
    }
    const eventData = eventSnap.data() || {};
    const existingCoOwners: string[] = (eventData.coOwners as string[]) || [];
    const newCoOwners = existingCoOwners.includes(authUid)
      ? existingCoOwners
      : [...existingCoOwners, authUid];

    const batch = db.batch();
    // 1. Update the event's coOwners array. The original owner
    //    (eventData.userId or whoever is first in coOwners) might
    //    not be in the array on legacy events — add them defensively
    //    so the rule continues to work for them.
    if (eventData.userId && !newCoOwners.includes(eventData.userId)) {
      newCoOwners.unshift(eventData.userId);
    }
    batch.update(eventRef, { coOwners: newCoOwners });
    // 2. Create the coOwners record so the partner can access
    //    non-eventId subcollections (helpers, guestLinks, etc).
    batch.set(coOwnerRef, {
      coOwnerUid: authUid,
      email: authEmail,
      status: 'active',
      addedAt: FieldValue.serverTimestamp(),
    });
    // 3. Mark the pending invite as accepted. We don't delete
    //    it because the owner UI might want to show "已接受"
    //    history. A future feature could expire and purge.
    for (const d of pendingSnap.docs) {
      batch.update(d.ref, {
        status: 'accepted',
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedByUid: authUid,
      });
    }
    await batch.commit();

    return {
      ok: true,
      ownerUid: payload.ownerUid,
      eventId: payload.eventId,
      event: {
        id: payload.eventId,
        name: eventData.name || '我們的婚禮',
      },
    };
  },
);

// ────────────────────────────────────────────────────────────────────────────
// removePartner — owner revokes a co-owner's access
// ────────────────────────────────────────────────────────────────────────────

interface RemovePartnerInput {
  ownerUid: string;
  coOwnerUid: string;
  eventId: string;
}

export const removePartner = onCall(
  {
    cors: true,
    region: 'us-central1',
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const input: Partial<RemovePartnerInput> = req.data || {};
    const { ownerUid, coOwnerUid, eventId } = input;
    if (!ownerUid || !coOwnerUid || !eventId) {
      throw new HttpsError(
        'invalid-argument',
        'ownerUid, coOwnerUid, eventId are all required.',
      );
    }
    if (req.auth.uid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Only the original owner can remove a co-owner.',
      );
    }

    // Defensive: don't let the owner remove themselves from
    // their own event. (They can transfer ownership in a future
    // feature; for now the original owner is permanent.)
    if (coOwnerUid === ownerUid) {
      throw new HttpsError(
        'failed-precondition',
        'You cannot remove yourself as the original owner.',
      );
    }

    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId);
    const coOwnerRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('coOwners').doc(coOwnerUid);

    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError('not-found', 'Event not found.');
    }
    const existing: string[] = (eventSnap.data()?.coOwners as string[]) || [];
    const newCoOwners = existing.filter((u) => u !== coOwnerUid);

    const batch = db.batch();
    batch.update(eventRef, { coOwners: newCoOwners });
    // We set status='revoked' rather than deleting so the partner's
    // UI can show a "Access removed" message instead of an error.
    batch.set(coOwnerRef, {
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    return { ok: true };
  },
);
