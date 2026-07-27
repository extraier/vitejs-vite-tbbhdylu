/**
 * Cloud Functions — Partner (Co-Owner) Invite Flow (V2)
 * =======================================================
 *
 * 2026-07-26 — Co-owners feature. The "single owner" model worked
 * fine for a solo user, but couples planning a wedding together
 * need equal access. The data model adds a `coOwners: string[]`
 * field on the event doc; anyone in that array gets full CRUD on
 * the owner's data, same as the original owner.
 *
 * 2026-07-26b — Renamed to V2 (sendPartnerInviteV2,
 * redeemPartnerInviteV2, removePartnerV2) to bypass a stuck
 * Cloud Run 409 conflict on the original names. The CORS
 * preflight was returning 403 instead of 204 on the original
 * deploy, blocking the browser. Same workaround we used for
 * autoLinkVendorContacts → autoLinkVendorContactsV2 (see
 * functions/src/vendors.ts). Front-end callsites in
 * src/lib/partnerInvite.ts have been updated to call the V2
 * names.
 *
 * Flow
 * ----
 * 1. Owner clicks "邀請另一半" (Invite partner) → opens modal
 * 2. Owner enters partner's email → calls sendPartnerInviteV2
 * 3. sendPartnerInviteV2 creates a doc at:
 *      /users/{ownerUid}/pendingPartnerInvites/{inviteId}
 *    with { email, token, expiresAt, ownerName, eventId, eventName }
 * 4. sendPartnerInviteV2 sends an email with a magic link:
 *      ${APP_BASE_URL}/?t=${token}
 * 5. Partner clicks link → sign-in or sign-up
 * 6. Front-end detects ?t= in URL → calls redeemPartnerInviteV2
 * 7. redeemPartnerInviteV2 verifies the token, adds the partner's
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
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as crypto from 'crypto';
import { sendViaSendgrid } from './sendgridMailer';

const db = getFirestore();
const auth = getAuth();

const APP_ID = 'savetheday-production';

// Secrets (re-declared per module, see helpersMail.ts for why).
// 2026-07-26 — referenced via the secrets:[] array in each onCall
// config below. The runtime values come from process.env (Firebase's
// secrets runtime populates them when the secret is referenced in
// the deployed function code).
const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');
const HMAC_KEY = defineSecret('HMAC_KEY');

// Read SMTP_URL/SMTP_FROM/APP_BASE_URL via process.env at runtime
// (these are populated by Firebase's secrets runtime thanks to the
// `secrets: [...]` array below). We also assign the defineSecret
// handles into local no-op constants so tsc sees them as "used".
const _smtpUrl = SMTP_URL;
const _smtpFrom = SMTP_FROM;
const _appBaseUrl = APP_BASE_URL;
const _hmacKey = HMAC_KEY;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
[_smtpUrl, _smtpFrom, _appBaseUrl, _hmacKey].forEach(() => undefined);

// Magic-link token TTL: 7 days. Plenty for a partner to find
// the email and click; short enough that abandoned invites
// don't linger forever.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// Token signing (server-side, so the client can't forge invites)
// ────────────────────────────────────────────────────────────────────────────
//
// 2026-07-27 — failed-closed secret loading. Previously this module
// had a hardcoded `DEFAULT_HMAC_KEY = 'dev-only-do-not-ship-savetheday-2377a'`
// that silently signed production tokens if the secret wasn't set.
// Now we throw at module load if HMAC_KEY is missing or empty, so a
// missing Cloud Function Secret Manager binding manifests as a
// function deploy failure rather than a security hole.
//
// Cloud Functions v2 does NOT populate `process.env` from
// Secret Manager unless the secret is registered via defineSecret()
// AND listed in the onCall's `secrets: [...]` array. The runtime
// resolves secrets on each invocation via `.value()`, so the value
// is always fresh — no per-module caching (the prior `cachedKey`
// memo would have prevented legitimate secret rotation).
function getHmacKey(): string {
  const secret = HMAC_KEY.value();
  if (!secret) {
    // We cannot throw at module load because in v2 the secret
    // is resolved per-invocation. Throwing here surfaces as an
    // HttpsError to the caller, with enough detail to debug.
    throw new HttpsError(
      'failed-precondition',
      'HMAC_KEY secret is missing or empty; configure via ' +
        '`firebase functions:secrets:set HMAC_KEY` ' +
        'and add to onCall secrets[] array.',
    );
  }
  return secret;
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
// sendPartnerInviteV2 — owner-only
// ────────────────────────────────────────────────────────────────────────────

export interface SendPartnerInviteInput {
  ownerUid: string;
  partnerEmail: string;
  eventId: string;
}

interface SendPartnerInviteResult {
  ok: boolean;
  sent: boolean;
  dryRun?: boolean;
  magicLinkUrl?: string;
  html?: string;
  error?: string;
}

export const sendPartnerInviteV2 = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL, HMAC_KEY],
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

    const ownerRecord = await auth.getUser(ownerUid);
    if (ownerRecord.email?.toLowerCase() === partnerEmail.toLowerCase()) {
      throw new HttpsError(
        'invalid-argument',
        'You cannot invite yourself — this is your own email.',
      );
    }

    const tokenPayload = {
      ownerUid,
      eventId,
      partnerEmail: partnerEmail.toLowerCase(),
      iat: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex'),
    };
    const token = signToken(tokenPayload);

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

    const ownerName = ownerRecord.displayName || ownerRecord.email || '新郎／新娘';

    const baseUrl = process.env.APP_BASE_URL || 'https://savetheday.io';
    const magicLinkUrl = `${baseUrl}/?t=${encodeURIComponent(token)}`;

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
      const sendResult = await sendViaSendgrid({
        smtpUrl: process.env.SMTP_URL,
        from: fromAddr,
        fromName: ownerName,
        to: partnerEmail,
        subject,
        html,
      });
      if (sendResult.ok && sendResult.sent) {
        return { ok: true, sent: true };
      }
      // Capture the human-readable error from the API path; mirror the
      // shape of the previous nodemailer error so callers / clients
      // don't need to know which transport is in use.
      console.error('[sendPartnerInviteV2] mail error:', sendResult.error);
      return { ok: false, sent: false, error: sendResult.error };
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.error('[sendPartnerInviteV2] mail error:', msg);
      return { ok: false, sent: false, error: msg };
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────
// redeemPartnerInviteV2 — called by the partner after they sign in
// ────────────────────────────────────────────────────────────────────────────

export interface RedeemPartnerInviteInput {
  token: string;
}

interface RedeemPartnerInviteResult {
  ok: boolean;
  ownerUid: string;
  eventId: string;
  event: { id: string; name: string };
}

export const redeemPartnerInviteV2 = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [HMAC_KEY],
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

    const payload = verifyToken<{
      ownerUid: string;
      eventId: string;
      partnerEmail: string;
      iat: number;
      nonce: string;
    }>(token);

    if (Date.now() - payload.iat > INVITE_TTL_MS) {
      throw new HttpsError('deadline-exceeded', 'Invite link has expired.');
    }

    if (payload.partnerEmail !== authEmail) {
      throw new HttpsError(
        'permission-denied',
        'This invite was sent to a different email.',
      );
    }

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
    if (eventData.userId && !newCoOwners.includes(eventData.userId)) {
      newCoOwners.unshift(eventData.userId);
    }
    batch.update(eventRef, { coOwners: newCoOwners });
    batch.set(coOwnerRef, {
      coOwnerUid: authUid,
      email: authEmail,
      status: 'active',
      addedAt: FieldValue.serverTimestamp(),
    });
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
// previewPartnerInvite — UNAUTHENTICATED. Lets the client pre-fill the
// login form on the partner's landing page (e.g. "You've been invited
// to co-plan 'Test' wedding — sign up to continue").
//
// Returns minimal invite metadata: just the email + event name + expiry.
// Does NOT mark the invite as accepted — that's redeemPartnerInviteV2's
// job. Verifies the HMAC signature so anonymous callers can't enumerate
// other users' invites by guessing tokens.
//
// Security notes:
//   • No auth required (this runs on the landing page, before sign-in).
//   • Token signature must match — verifyToken throws on bad signature.
//   • TTL check same as redeem: 7 days.
//   • We do NOT return ownerUid, ownerEmail, or eventId to the
//     unauthenticated caller (those are revealed post-auth via
//     the user doc on the dashboard, or upon successful redeem
//     where they're a natural byproduct of the lookup).
//     2026-07-27 — dropped eventId from the preview response body.
//     It was leaked even though the function's own comment claimed
//     otherwise. The client only used `eventName` for the welcome
//     message; eventId-from-preview was effectively dead code on
//     the frontend (`usePartnerInvitePreview.js` passed it through
//     but `App.jsx` only read `.eventName` and `.partnerEmail`).
// ────────────────────────────────────────────────────────────────────────────

interface PreviewInput {
  token: string;
}

interface PreviewResult {
  ok: boolean;
  partnerEmail: string;
  // eventId intentionally omitted — see security note above.
  eventName: string;
  expiresAt: number; // ms since epoch
}

export const previewPartnerInvite = onCall<PreviewInput, Promise<PreviewResult>>(
  {
    cors: true,
    region: 'us-central1',
    secrets: [HMAC_KEY],
  },
  async (req): Promise<PreviewResult> => {
    const input = req.data || ({} as PreviewInput);
    const { token } = input;
    if (!token) {
      throw new HttpsError('invalid-argument', 'token is required.');
    }

    const payload = verifyToken(token);
    if (Date.now() - payload.iat > INVITE_TTL_MS) {
      throw new HttpsError('deadline-exceeded', 'Invite link has expired.');
    }

    // Look up the event so we can show its name. If the event is gone
    // (owner deleted it before partner accepted), return the token's
    // own metadata as a fallback.
    const eventRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(payload.ownerUid)
      .collection('events').doc(payload.eventId);
    let eventName = '婚禮';
    try {
      const eventSnap = await eventRef.get();
      if (eventSnap.exists) {
        const eventData = eventSnap.data() || {};
        eventName = eventData.name || '婚禮';
      }
    } catch {
      // If the lookup fails, still return the email — better than
      // blocking the partner from signing up.
    }

    return {
      ok: true,
      partnerEmail: payload.partnerEmail,
      // eventId intentionally omitted — see comment above the
      // PreviewResult type. Was being leaked to unauthenticated
      // callers contrary to the function's own documented contract.
      eventName,
      expiresAt: payload.iat + INVITE_TTL_MS,
    };
  },
);

// ────────────────────────────────────────────────────────────────────────────
// removePartnerV2 — owner revokes a co-owner's access
// ────────────────────────────────────────────────────────────────────────────

export interface RemovePartnerInput {
  ownerUid: string;
  coOwnerUid: string;
  eventId: string;
}

export const removePartnerV2 = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [HMAC_KEY],
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
    batch.set(coOwnerRef, {
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    return { ok: true };
  },
);

// ────────────────────────────────────────────────────────────────────────────
// listPartnerInvites — owner-only. Returns the full invite history for
// the calling owner so the dashboard / modal can render
// "which emails were sent, and the accept status" rows.
//
// 2026-07-27 — first version. The existing /pendingPartnerInvites
// docs are already being written by sendPartnerInviteV2 and updated
// by redeemPartnerInviteV2; this just exposes them in one batch
// read with status derivation. No writes.
//
// Status semantics (no backend write needed for 'expired' — derived):
//   - 'pending'   — status field still 'pending' AND expiresAt > now
//   - 'accepted'  — status field is 'accepted'
//   - 'expired'   — status field still 'pending' but expiresAt <= now
//                   (we don't need a scheduled job to mark this — the
//                   read computes it)
//
// Revoked invites: there's no dedicated revoke path that touches the
// pending doc (removePartnerV2 flips the coOwners doc to status=
// 'revoked' but leaves the pending doc alone, since acceptance is a
// one-way transition). So revoked invites will appear here as
// 'accepted' if redeemed first, then 'pending' if not — which is
// fine for the history view. We could enhance later by adding a
// separate revoked field on the pending doc; for now we ship the
// minimal history surface.
//
// Returns the rows newest-first so the UI can show the most recent
// attempt at the top.
// ────────────────────────────────────────────────────────────────────────────

export interface ListPartnerInvitesInput {
  ownerUid: string;
}

export interface PartnerInviteHistoryRow {
  id: string;
  email: string;
  eventId: string;
  // Resolved from the event doc on the server so the UI doesn't have
  // to make N+1 reads. Falls back to '婚禮' if the event is gone.
  eventName: string;
  // 'pending' | 'accepted' | 'expired' — derived as described above.
  status: 'pending' | 'accepted' | 'expired';
  createdAt: number;        // ms since epoch
  expiresAt: number;        // ms since epoch
  acceptedAt?: number;      // ms since epoch (only when status==='accepted')
  acceptedByUid?: string;
}

interface ListPartnerInvitesResult {
  ok: boolean;
  rows: PartnerInviteHistoryRow[];
}

export const listPartnerInvites = onCall(
  {
    cors: true,
    region: 'us-central1',
  },
  async (req): Promise<ListPartnerInvitesResult> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const input: Partial<ListPartnerInvitesInput> = req.data || {};
    const { ownerUid } = input;
    if (!ownerUid) {
      throw new HttpsError('invalid-argument', 'ownerUid is required.');
    }
    if (req.auth.uid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'You can only list invites for your own account.',
      );
    }

    // One query for all pending invites owned by this user.
    const pendingSnap = await db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('pendingPartnerInvites')
      .orderBy('createdAt', 'desc')
      .get();

    if (pendingSnap.empty) {
      return { ok: true, rows: [] };
    }

    // Resolve event names in parallel so the UI doesn't need an extra
    // round-trip. Each row's eventId → event.name lookup.
    const eventIds = Array.from(
      new Set(pendingSnap.docs.map((d) => (d.data().eventId as string) || '').filter(Boolean)),
    );
    const eventSnaps = await Promise.all(
      eventIds.map((eid) =>
        db
          .collection('artifacts').doc(APP_ID)
          .collection('users').doc(ownerUid)
          .collection('events').doc(eid)
          .get(),
      ),
    );
    const eventNameById = new Map<string, string>();
    eventSnaps.forEach((snap, i) => {
      const eid = eventIds[i];
      if (snap.exists) {
        eventNameById.set(eid, (snap.data()?.name as string) || '婚禮');
      } else {
        // Event was deleted after the invite was sent — show the
        // raw id so the owner can still distinguish rows.
        eventNameById.set(eid, '(已刪除的婚禮)');
      }
    });

    const now = Date.now();
    const rows: PartnerInviteHistoryRow[] = pendingSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const email = ((data.email as string) || '').toLowerCase();
      const eventId = (data.eventId as string) || '';
      const statusRaw = (data.status as string) || 'pending';
      const expiresAtMs =
        data.expiresAt instanceof Timestamp
          ? (data.expiresAt as Timestamp).toMillis()
          : Number(data.expiresAt) || 0;
      const createdAtMs =
        data.createdAt instanceof Timestamp
          ? (data.createdAt as Timestamp).toMillis()
          : Number(data.createdAt) || 0;
      const acceptedAtMs =
        data.acceptedAt instanceof Timestamp
          ? (data.acceptedAt as Timestamp).toMillis()
          : data.acceptedAt ? Number(data.acceptedAt) : undefined;

      // Derived status:
      //   - 'accepted' wins over everything else if it's set
      //   - 'expired' if still pending but past expiresAt
      //   - 'pending' otherwise
      let status: 'pending' | 'accepted' | 'expired';
      if (statusRaw === 'accepted') {
        status = 'accepted';
      } else if (expiresAtMs > 0 && expiresAtMs <= now) {
        status = 'expired';
      } else {
        status = 'pending';
      }

      const row: PartnerInviteHistoryRow = {
        id: d.id,
        email,
        eventId,
        eventName: eventNameById.get(eventId) || '婚禮',
        status,
        createdAt: createdAtMs,
        expiresAt: expiresAtMs,
      };
      if (acceptedAtMs !== undefined) row.acceptedAt = acceptedAtMs;
      const acceptedByUid = data.acceptedByUid as string | undefined;
      if (acceptedByUid) row.acceptedByUid = acceptedByUid;
      return row;
    });

    return { ok: true, rows };
  },
);
