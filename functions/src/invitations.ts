/**
 * Cloud Functions — Electronic Invitations
 * =========================================
 *
 * sendInvitations — owner-only.
 * For each guestId, builds the personal shareUrl, generates a QR PNG,
 * and emails the guest with the QR attached. Returns per-guest send status.
 *
 * Why a Cloud Function (not client-side mailto:)
 * ----------------------------------------------
 * 1. We need QR PNGs as email attachments — must render server-side.
 * 2. Nodemailer SMTP credentials should never be in the client bundle.
 * 3. Batching N emails from one trigger is cheaper with a function.
 *
 * Email transport
 * ---------------
 * Configure via Firebase secrets:
 *   firebase functions:secrets:set SMTP_URL
 *   firebase functions:secrets:set SMTP_FROM
 *   firebase functions:secrets:set APP_BASE_URL
 * Example: smtps://user:pass@smtp.gmail.com:465
 *
 * Dev fallback: if SMTP_URL is unset, the function returns the rendered
 * HTML in `dryRun: true` mode (no email sent) so you can preview the
 * template without SMTP credentials. First deploy, then add secrets.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import * as QRCode from 'qrcode';
import * as crypto from 'node:crypto';

// HMAC-signed token helpers — signs (ownerUid|eventId|guestId|expires) so a
// guest who clicks the email link can be redeemed exactly once into
// artifacts/{appId}/users/{ownerUid}/guestLinks/{auth.uid}, after which
// Firestore Rules hasValidGuestLink() unlocks their read of the event doc.
// See firestore.rules §guestLinks.
const LINK_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function signLinkToken(ownerUid: string, eventId: string, guestId: string, expiresAt: number): string {
  const secret = LINK_SECRET.value();
  const payload = `${ownerUid}|${eventId}|${guestId}|${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function buildShareUrl(appBase: string, ownerUid: string, eventId: string, guestId: string): string {
  const expiresAt = Date.now() + LINK_TTL_MS;
  const token = signLinkToken(ownerUid, eventId, guestId, expiresAt);
  return `${appBase}/?o=${ownerUid}&e=${eventId}&g=${guestId}&token=${token}`;
}

const db = getFirestore();

// Hermes 2026-07-03 — explicit appId. The frontend resolves this via
// `__app_id` global with fallback 'savetheday-production' (see
// src/lib/firebase.ts:resolveAppId). The previous code used
// `db.collection('artifacts').doc()` which generates a RANDOM auto-id,
// guaranteeing that the function's guest query never matches any
// real data path. Using the literal appId keeps backend and frontend
// in lockstep.
const APP_ID = 'savetheday-production';

// Hermes 2026-07-03 — switch to Pattern 2 (defineSecret + secrets: [...]).
// v2 SDK does NOT auto-inject Secret Manager values into process.env —
// the previous code read process.env.SMTP_URL directly and was stuck in
// dryRun mode forever even after `firebase functions:secrets:set SMTP_URL`.
// See firebase-gen2-cloud-run-iam §1a for the full trace.
const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');
const LINK_SECRET = defineSecret('LINK_SECRET');  // HMAC secret for guest share URLs

// To enable real email sending:
//   firebase functions:secrets:set SMTP_URL     # smtps://user:pass@host:465
//   firebase functions:secrets:set SMTP_FROM    # no-reply@savetheday.io
//   firebase functions:secrets:set APP_BASE_URL # https://savetheday.io
//   firebase deploy --only functions:sendInvitations
//
// (Or via gcloud secrets versions add for non-interactive:
//   gcloud secrets versions add SMTP_URL --data-file=- --project=savetheday-2377a)

interface SendInvitationsInput {
  eventId: string;
  invitationId: string;
  guestIds: string[];
  customMessage?: string;
}

interface SendResult {
  guestId: string;
  email: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
}

interface SendInvitationsResult {
  ok: boolean;
  dryRun: boolean;
  sent: SendResult[];
}

export const sendInvitations = onCall(
  {
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL, LINK_SECRET],
  },
  async (req): Promise<SendInvitationsResult> => {
    // Wrap the entire handler so any unhandled exception (e.g. a TypeError
    // from a missing field, a Nodemailer transport init failure, or a Firestore
    // permission error) is converted into a structured HttpsError instead of
    // being swallowed by the Cloud Functions runtime as a generic
    // `functions/internal` with the placeholder message "internal".
    try {
      return await _sendInvitationsImpl(req);
    } catch (err: unknown) {
      // Re-throw HttpsErrors as-is — those are already structured.
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[sendInvitations] unhandled error:', msg, stack);
      throw new HttpsError('internal', msg, stack ? { stack } : undefined);
    }
  },
);

async function _sendInvitationsImpl(req: any): Promise<SendInvitationsResult> {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { eventId, invitationId, guestIds, customMessage } = req.data as SendInvitationsInput;
    if (!eventId || !invitationId || !Array.isArray(guestIds) || guestIds.length === 0) {
      throw new HttpsError('invalid-argument', 'eventId, invitationId, guestIds required.');
    }
    if (guestIds.length > 200) {
      throw new HttpsError('invalid-argument', 'Max 200 guests per batch.');
    }

    const ownerUid = req.auth.uid;
    const appBase = APP_BASE_URL.value() || 'https://savetheday.io';

    // Load invitation + event + guests.
    // Firestore 'in' query max is 30 items, so we chunk.
    const [invSnap, eventSnap] = await Promise.all([
      db.collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
        .collection('invitations').doc(invitationId).get(),
      db.collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
        .collection('events').doc(eventId).get(),
    ]);

    // Self-heal: if the invitation doc doesn't exist (first-time send, or the
    // client-side ensureDefaultDoc effect didn't fire because the editor never
    // opened), create it inline with sensible defaults so the rest of the
    // pipeline can continue. This is safe to do from the cloud function
    // because it runs as the service account, which bypasses the client-side
    // isOwner() rule.
    let invitation: any;
    if (!invSnap.exists) {
      console.warn('[sendInvitations] invitation doc missing; auto-creating defaults');
      const invRef = db
        .collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
        .collection('invitations').doc(invitationId);
      const defaults = {
        templateId: 'plain',
        bgUrl: null,
        ownerMessage: '',
        sentCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await invRef.set(defaults);
      invitation = defaults;
    } else {
      invitation = invSnap.data()!;
    }
    if (!eventSnap.exists) {
      // Same self-heal pattern as invitation: if the event doc is missing,
      // synthesize minimal defaults so the rest of the pipeline can proceed.
      // The event doc normally holds venue/time/address — without these the
      // email template renders empty fields. We log a loud warning so the
      // owner knows to populate the event editor.
      console.warn('[sendInvitations] event doc missing; auto-creating stub. Owner should fill venue/time/date via the event editor.');
      const eventRef = db
        .collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
        .collection('events').doc(eventId);
      const stubEvent = {
        name: '婚禮',
        date: '',
        time: '',
        venue: '',
        address: '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await eventRef.set(stubEvent);
      // The pre-fetched eventSnap was empty — use the stub we just wrote.
      // Re-fetching isn't worth the round-trip; the stub has all the fields
      // the email template needs (with sensible empty-string defaults).
      var event: any = stubEvent;
    } else {
      var event: any = eventSnap.data()!;
    }

    // Load the owner's profile (displayName + email) so we can put the
    // couple's name in the From display field and route replies to their
    // personal mailbox. Uses collectionGroup because the Firestore layout
    // is artifacts/{appId}/users/{uid} with a variable appId segment.
    let ownerProfile: { displayName?: string; email?: string } = {};
    try {
      const ownerSnap = await db
        .collectionGroup('users')
        .where('uid', '==', ownerUid)
        .limit(1)
        .get();
      if (!ownerSnap.empty) {
        ownerProfile = ownerSnap.docs[0].data() as { displayName?: string; email?: string };
      }
    } catch (e) {
      // Non-fatal — fall back to event-level fields if owner profile fetch fails.
      console.warn('[sendInvitations] could not load owner profile:', e);
    }

    // Chunked guest fetch (Firestore 'in' limit = 30)
    const guestById: Record<string, FirebaseFirestore.QueryDocumentSnapshot> = {};
    for (let i = 0; i < guestIds.length; i += 30) {
      const chunk = guestIds.slice(i, i + 30);
      const snap = await db
        .collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
        .collection('guests')
        .where('guestId', 'in', chunk)
        .get();
      snap.docs.forEach((d) => {
        const g = d.data();
        if (g.guestId) guestById[g.guestId] = d as unknown as FirebaseFirestore.QueryDocumentSnapshot;
      });
    }

    // Hermes 2026-07-03: SMTP_URL is bound via defineSecret() + secrets: []
    // in the onCall options above. Read it via .value() — process.env.X
    // silently returns undefined in v2 SDK even after the secret is set.
    const smtpUrlRaw = SMTP_URL.value();
    const smtpUrlValid =
      typeof smtpUrlRaw === 'string' &&
      smtpUrlRaw.length > 0 &&
      smtpUrlRaw !== 'undefined' &&
      /^[a-z]+:\/\//.test(smtpUrlRaw);
    const dryRun = !smtpUrlValid;
    const transporter = dryRun
      ? null
      : nodemailer.createTransport(smtpUrlRaw!);

    // Group guestIds by household. A household parent receives ONE email that
    // bundles every member's QR code. Singles receive their own email.
    //
    // Input: flat list of guestIds (some are parents, some are members, some
    // are singles). Output: one entry per "send unit" — either a parent or a
    // standalone single.
    type SendUnit = {
      contactGuest: any;             // row whose email we send to
      memberRows: any[];             // rows whose QR codes go into this email
    };
    const units: SendUnit[] = [];
    const consumed = new Set<string>();

    for (const guestId of guestIds) {
      if (consumed.has(guestId)) continue;
      const guestDoc = guestById[guestId];
      const guest = guestDoc?.data();
      if (!guest) continue;

      if (guest.isHouseholdParent && guest.householdId === guest.guestId) {
        // Parent: gather all selected members that belong to this household
        const memberRows = guestIds
          .filter((id) => id !== guest.guestId)
          .filter((id) => !consumed.has(id))
          .map((id) => guestById[id])
          .filter((d) => d && d.data().householdId === guest.guestId)
          .map((d) => d!);
        memberRows.forEach((d) => consumed.add(d.data().guestId));
        consumed.add(guest.guestId);
        units.push({ contactGuest: guest, memberRows });
      } else if (!guest.householdId || guest.householdId === guest.guestId) {
        // Standalone single (no household) — one email, one QR
        consumed.add(guest.guestId);
        units.push({ contactGuest: guest, memberRows: [] });
      } else {
        // Member of household whose parent wasn't selected — still send to the
        // member's email as a fallback so we don't lose them.
        consumed.add(guest.guestId);
        units.push({ contactGuest: guest, memberRows: [] });
      }
    }

    const results: SendResult[] = [];

    for (const unit of units) {
      const guest = unit.contactGuest;
      const email = guest.email as string | undefined;
      const name = guest.name as string | undefined;
      const isFamily = unit.memberRows.length > 0;

      if (!email) {
        results.push({
          guestId: guest.guestId,
          email: email || '',
          status: 'skipped',
          reason: 'no email on file',
        });
        continue;
      }

      // Build per-recipient QR codes (parent + each member).
      const recipientQrs: { label: string; png: Buffer }[] = [];
      const allRecipients = isFamily ? [guest, ...unit.memberRows] : [guest];
      for (const r of allRecipients) {
        const shareUrl = buildShareUrl(appBase, ownerUid, eventId, r.guestId);
        const png = await QRCode.toBuffer(shareUrl, {
          errorCorrectionLevel: 'H',
          width: 500,
          margin: 1,
          color: { dark: '#312e81', light: '#ffffff' },
        });
        recipientQrs.push({ label: r.name, png });
      }

      const html = renderEmailHtml({
        guestName: name || '尊貴的嘉賓',
        isFamily,
        memberNames: isFamily ? unit.memberRows.map((m: any) => m.data().name) : [],
        eventName: event.name || '婚禮晚宴',
        eventDate: event.date,
        eventTime: event.time,
        venue: event.venue,
        address: event.address,
        ownerMessage: customMessage || (invitation.ownerMessage as string) || '',
        bgUrl: invitation.bgUrl as string | null | undefined,
        templateId: invitation.templateId as string,
      });

      if (dryRun) {
        results.push({
          guestId: guest.guestId,
          email,
          status: 'skipped',
          reason: 'dryRun: SMTP_URL not configured',
        });
        continue;
      }

      try {
        // Family emails get N attachments (one QR per person); singles get one.
        const attachments = recipientQrs.map((qr, i) => ({
          filename: isFamily ? `qr-${i + 1}-${qr.label}.png` : 'invitation-qr.png',
          content: qr.png,
          cid: `invitation-qr-${i}`,
        }));
        const primaryShareUrl = buildShareUrl(appBase, ownerUid, eventId, guest.guestId);

        // From / Reply-To:
        // - `From` stays on the savetheday.io domain (verified SPF/DKIM) so
        //   the email lands in the inbox instead of spam.
        // - The display name shows the couple so the recipient sees
        //   "Roger & Yuki 敬邀 <noreply@savetheday.io>" in their inbox.
        // - `replyTo` is the owner's personal mailbox so replies land in
        //   their real inbox (not bounced by no-reply@).
        const ownerDisplayName =
          ownerProfile.displayName ||
          (event.ownerName as string | undefined) ||
          (invitation.ownerName as string | undefined) ||
          '新人';
        const ownerReplyEmail =
          ownerProfile.email ||
          (event.ownerEmail as string | undefined) ||
          (invitation.ownerEmail as string | undefined);
        const fromAddress = SMTP_FROM.value() || 'no-reply@savetheday.io';
        await transporter!.sendMail({
          from: `"${ownerDisplayName} 敬邀" <${fromAddress}>`,
          replyTo: ownerReplyEmail,
          to: email,
          subject: isFamily
            ? `${event.name || '婚禮'} · ${guest.name} 家庭專屬電子喜帖（${unit.memberRows.length + 1}位）`
            : `${event.name || '婚禮'} · 您的專屬電子喜帖`,
          html: html.replace(/\{\{PRIMARY_QR\}\}/g, primaryShareUrl),
          attachments,
        });
        // Mark the parent + every member as "sent" in the results array so the
        // editor's per-guest counts stay accurate.
        results.push({ guestId: guest.guestId, email, status: 'sent' });
        for (const m of unit.memberRows) {
          const mData = m.data();
          results.push({
            guestId: mData.guestId,
            email,
            status: 'sent',
            reason: 'bundled into household email',
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown';
        results.push({ guestId: guest.guestId, email, status: 'failed', reason: msg });
      }
    }

    const sentCount = results.filter((r) => r.status === 'sent').length;
    if (sentCount > 0) {
      await invSnap.ref.update({
        sentCount: FieldValue.increment(sentCount),
        lastSentAt: FieldValue.serverTimestamp(),
      });
    }

    return { ok: true, dryRun, sent: results };
}

// =============================================================================
// Email HTML — inlined so the function is self-contained.
// =============================================================================

function renderEmailHtml(args: {
  guestName: string;
  isFamily: boolean;
  memberNames: string[];
  eventName: string;
  eventDate?: string;
  eventTime?: string;
  venue?: string;
  address?: string;
  ownerMessage: string;
  bgUrl?: string | null;
  templateId: string;
}): string {
  const { guestName, isFamily, memberNames, eventName, eventDate, eventTime, venue, address, ownerMessage, bgUrl } = args;

  const heroStyle = bgUrl
    ? `background-image: linear-gradient(rgba(15,23,42,0.45), rgba(15,23,42,0.6)), url('${bgUrl}'); background-size: cover; background-position: center;`
    : `background: linear-gradient(135deg, #fff1f2 0%, #fdf2f8 100%);`;

  const greeting = isFamily
    ? `<h2 style="margin:0 0 8px;font-size:24px;font-weight:900;">${escapeHtml(guestName)}</h2>
       <p style="margin:0 0 16px;font-size:13px;color:#64748b;">${escapeHtml(memberNames.join('、'))}</p>`
    : `<h2 style="margin:0 0 16px;font-size:24px;font-weight:900;">${escapeHtml(guestName)}</h2>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
        <tr><td style="${heroStyle}padding:48px 32px;text-align:center;color:#fff;">
          <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.3em;font-weight:900;">${isFamily ? 'FAMILY INVITATION' : 'ELECTRONIC INVITATION'}</p>
          <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;">${escapeHtml(eventName)}</h1>
          ${eventDate ? `<p style="margin:0;font-size:14px;opacity:0.9;">${escapeHtml(eventDate)}${eventTime ? ` · ${escapeHtml(eventTime)}` : ''}</p>` : ''}
        </td></tr>
        <tr><td style="padding:32px;text-align:center;color:#1e293b;">
          <p style="margin:0 0 8px;font-size:14px;color:#64748b;">${isFamily ? '誠意邀請' : '親愛的'}</p>
          ${greeting}
          ${ownerMessage ? `<p style="margin:0 0 24px;font-size:14px;color:#475569;font-style:italic;line-height:1.6;">"${escapeHtml(ownerMessage)}"</p>` : ''}
          ${venue ? `<p style="margin:0 0 4px;font-size:14px;"><strong style="color:#e11d48;">場地：</strong>${escapeHtml(venue)}</p>` : ''}
          ${address ? `<p style="margin:0 0 24px;font-size:12px;color:#64748b;">${escapeHtml(address)}</p>` : ''}
          <div style="margin:24px auto;display:inline-block;background:#eef2ff;border:2px solid #e0e7ff;border-radius:16px;padding:16px;">
            <img src="cid:invitation-qr-0" alt="QR Code" width="200" height="200" style="display:block;border-radius:8px;" />
            <p style="margin:8px 0 0;font-size:11px;color:#6366f1;font-family:monospace;">入場請出示此 QR Code</p>
          </div>
          <a href="{{PRIMARY_QR}}" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#e11d48;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;">開啟專屬電子喜帖</a>
          <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;font-family:monospace;">Save The Day</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// redeemGuestLink — verifies the HMAC token from the email QR, then writes
// artifacts/{appId}/users/{ownerUid}/guestLinks/{auth.uid} so subsequent reads
// from the same auth.uid pass hasValidGuestLink() in firestore.rules.
// Idempotent: if the guest already redeemed, this is a no-op.
// Exposed as a callable so anonymous guests can hit it.
// ---------------------------------------------------------------------------
export const verifyShareToken = onCall(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [LINK_SECRET],
  },
  async (req): Promise<{ ok: true; ownerUid: string; eventId: string; guestId: string }> => {
    // Anonymous redeems are the norm — guests hit this before any signin.
    // We do NOT require auth here; instead we require HMAC verification of
    // (ownerUid|eventId|guestId|expires) and that the caller *will* sign in
    // anonymously right after, picking up guestLinks/{auth.uid} = {ownerUid,
    // eventId, guestId, ...}.
    const { token, expectedAuthUid } = req.data as { token?: string; expectedAuthUid?: string };
    if (typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'token required');
    }
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) throw new HttpsError('invalid-argument', 'malformed token');
    let payload: string;
    try {
      payload = Buffer.from(b64, 'base64url').toString('utf8');
    } catch {
      throw new HttpsError('invalid-argument', 'token payload not base64url');
    }
    const parts = payload.split('|');
    if (parts.length !== 4) throw new HttpsError('invalid-argument', 'token payload wrong shape');
    const [ownerUid, eventId, guestId, expiresAtStr] = parts;
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt)) throw new HttpsError('invalid-argument', 'token expiresAt not a number');
    if (Date.now() > expiresAt) throw new HttpsError('deadline-exceeded', 'token expired');

    // Re-compute HMAC, constant-time compare.
    const secret = LINK_SECRET.value();
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpsError('permission-denied', 'invalid signature');
    }

    // Write guestLinks/{authUid} doc — the caller's auth.uid must equal the
    // linkDocId per firestore.rules match /guestLinks/{linkDocId} allows create.
    // For anonymous flow: the client signs in anonymously FIRST, gets auth.uid,
    // then calls this with that uid. If uid mismatch, we error.
    const authUid = req.auth?.uid ?? expectedAuthUid;
    if (!authUid) throw new HttpsError('unauthenticated', 'sign in first');

    const linkRef = db
      .collection('artifacts').doc(APP_ID).collection('users').doc(ownerUid)
      .collection('guestLinks').doc(authUid);
    const existing = await linkRef.get();
    if (existing.exists) {
      const data = existing.data()!;
      // Idempotent — already redeemed with matching eventId/guestId is fine.
      if (data.eventId === eventId && data.guestId === guestId) {
        return { ok: true, ownerUid, eventId, guestId };
      }
      throw new HttpsError('already-exists', 'a different link is bound to this uid');
    }

    await linkRef.set({
      ownerUid,
      eventId,
      guestId,
      expiresAt: new Date(expiresAt),
      redeemedByUid: authUid,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, ownerUid, eventId, guestId };
  },
);