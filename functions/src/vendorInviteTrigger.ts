// vendorInviteTrigger.ts — Firestore-triggered email sender for
// /vendors/{slug}/pendingInvites.
//
// 2026-07-21 — when a couple taps "索取報價" on a not-onboarded
// vendor, the NotOnboardedEmailModal creates a doc under
// /vendors/{slug}/pendingInvites. This trigger fires immediately,
// generates a fresh invitation token, and emails the vendor a
// signup link.
//
// Why a Firestore trigger instead of an onCall?
//   1. Couples don't need to know about Cloud Functions at all —
//      the email just goes out, which matches their expectation.
//   2. Idempotency is easy: the trigger only fires on onCreate,
//      and we check status before sending (re-deliveries skip).
//   3. Admin can re-fire by manually updating status back to
//      'pending' (we treat any update that sets status back to
//      'pending' as a re-send — handy for retries after SMTP hiccups).
//
// Reuses the existing SMTP setup + HTML template from
// vendorActivation.ts. The trigger runs as the service account, so
// it has full read/write on /vendors and friends — no permission
// surprises.

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';

try {
  initializeApp();
} catch (_) {
  // Already initialized by another module — admin SDK is a singleton.
}

const db = getFirestore();

const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const INVITE_TOKEN_LEN = 12;

function genToken(len: number): string {
  // URL-safe base32 (no padding), lowercase. Same alphabet as
  // vendorActivation so tokens minted by either path look the same.
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/1/0/o
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

// ───────────────────────────────────────────────────────────────────────────
// HTML email template (slightly different from the admin-flow template
// because it includes the couple's personal note: "我哋喺準備緊
// 婚禮，想邀請你加入" instead of a generic "your listing is ready").
// ───────────────────────────────────────────────────────────────────────────
function renderCoupleInviteHtml(args: {
  vendorName: string;
  signupUrl: string;
  expiresAt: Date;
}): string {
  const { vendorName, signupUrl, expiresAt } = args;
  const fmt = new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong',
  });
  const expiresLabel = fmt.format(expiresAt);

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
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;line-height:1.3;color:#ffffff;">${escapeHtml(vendorName)}，新人想搵你！</h1>
          <p style="margin:8px 0 0;font-size:13px;color:#ffffff;opacity:0.92;">一對籌備緊婚禮嘅新人，邀請你加入 Save The Day</p>
        </td></tr>
        <tr><td style="padding:32px 28px 36px;text-align:center;color:#1e293b;">
          <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7;text-align:left;">
            你喺 Save The Day 嘅商戶目錄有 listing，但你仲未啟用商戶帳戶，<br/>所以新人暫時無法透過平台訊息直接聯絡你。
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;text-align:left;">
            用以下連結註冊或登入 Save The Day 商戶帳戶，你就可以即時收到呢位同其他新人嘅查詢：
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
            <tr><td style="border-radius:14px;background:linear-gradient(135deg,#10b981,#0d9488);">
              <a href="${escapeAttr(signupUrl)}" style="display:inline-block;padding:16px 36px;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;letter-spacing:0.05em;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK',sans-serif;">啟動商戶帳戶 · 立即登入</a>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            連結有效到 <strong style="color:#475569;">${escapeHtml(expiresLabel)}</strong>（14 日內）。點擊後會跳到註冊/登入頁。
          </p>
          <hr style="margin:28px 0 16px;border:none;border-top:1px solid #e2e8f0;" />
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="left" style="font-size:12px;color:#64748b;line-height:1.6;vertical-align:top;">
              <strong style="color:#1e293b;">啟動後你可以：</strong>
              <ul style="margin:8px 0 0;padding-left:20px;font-size:12px;color:#64748b;">
                <li>接收 + 回覆全港新人嘅查詢</li>
                <li>展示作品集相片同服務</li>
                <li>編輯價錢範圍、地區等資料</li>
                <li>被新人指派到佢哋嘅婚禮任務</li>
              </ul>
            </td></tr>
          </table>
          <hr style="margin:20px 0 16px;border:none;border-top:1px solid #e2e8f0;" />
          <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">Save The Day</p>
          <p style="margin:0;font-size:11px;color:#cbd5e1;">香港婚禮策劃助手 · savetheday.io</p>
        </td></tr>
      </table>
      <p style="margin:16px auto 0;max-width:500px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
        如果你唔識 Save The Day 或者唔係婚禮商戶，請直接刪除此電郵。<br />
        有疑問？回覆此電郵，我哋嘅團隊會跟進。
      </p>
    </td></tr>
  </table>
</body></html>`;
}

// ───────────────────────────────────────────────────────────────────────────
// Core send logic. Idempotent: only sends if status === 'pending'.
// On success: updates invite doc status → 'invited', stamps
// sentAt + token + expiry. On SMTP failure: status → 'invite_failed'
// so admin can retry manually (admin can flip back to 'pending' to
// re-fire).
// ───────────────────────────────────────────────────────────────────────────
async function processPendingInvite(
  inviteRef: FirebaseFirestore.DocumentReference,
  inviteData: any,
  slug: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (!inviteData) return { sent: false, reason: 'no data' };
  const email = String(inviteData.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, reason: 'invalid email' };
  }
  if (inviteData.status && inviteData.status !== 'pending') {
    return { sent: false, reason: `already ${inviteData.status}` };
  }

  // Look up vendor doc
  const vendorRef = db.collection('vendors').doc(slug);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) {
    return { sent: false, reason: 'vendor doc not found' };
  }
  const vendorData = vendorSnap.data() || {};

  // If vendor has already onboarded (claimed status, no longer
  // 'uninvited'), don't send — they already have an account, the
  // couple should use a direct contact method.
  if (vendorData.signupStatus === 'claimed') {
    await inviteRef.update({
      status: 'skipped',
      skipReason: 'vendor already onboarded',
      skippedAt: FieldValue.serverTimestamp(),
    });
    return { sent: false, reason: 'vendor already onboarded' };
  }

  // Mint a fresh token and stamp the vendor doc.
  const token = genToken(INVITE_TOKEN_LEN);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const signupUrl = `${baseUrl || 'https://savetheday.io'}/?signup&venue=${encodeURIComponent(slug)}&token=${token}`;

  await vendorRef.set(
    {
      signupStatus: 'invited',
      invitationToken: token,
      invitationExpiresAt: expiresAt,
      invitedEmail: email,
      invitedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // SMTP
  const smtpUrl = process.env.SMTP_URL;
  const smtpFrom = process.env.SMTP_FROM;
  if (!smtpUrl || !smtpFrom) {
    console.warn('[onPendingInviteCreated] SMTP_URL or SMTP_FROM not set; mark as invite_failed');
    await inviteRef.update({
      status: 'invite_failed',
      failReason: 'SMTP not configured',
      failedAt: FieldValue.serverTimestamp(),
    });
    return { sent: false, reason: 'SMTP not configured' };
  }

  const vendorName = vendorData.name || slug;
  try {
    const transport = nodemailer.createTransport(smtpUrl);
    const subject = `新人想搵你 · ${vendorName} · 加入 Save The Day`;
    const text = [
      `Hi ${vendorName},`,
      ``,
      `一對籌備緊婚禮嘅新人想透過 Save The Day 邀請你加入平台，`,
      `佢哋暫時無法用平台訊息直接聯絡你，因為你仲未啟用商戶帳戶。`,
      ``,
      `請用以下連結註冊或登入 Save The Day 商戶帳戶:`,
      ``,
      signupUrl,
      ``,
      `連結 14 日內有效。`,
      ``,
      `— Save The Day 團隊`,
    ].join('\n');
    const html = renderCoupleInviteHtml({ vendorName, signupUrl, expiresAt });
    await transport.sendMail({
      from: smtpFrom,
      to: email,
      subject,
      text,
      html,
    });
    await inviteRef.update({
      status: 'invited',
      sentAt: FieldValue.serverTimestamp(),
      signupUrl,
      token,
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onPendingInviteCreated] SMTP send failed:', msg);
    await inviteRef.update({
      status: 'invite_failed',
      failReason: msg.slice(0, 500),
      failedAt: FieldValue.serverTimestamp(),
    });
    return { sent: false, reason: msg };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Trigger 1: onCreate — fires when couple first submits the email
// ───────────────────────────────────────────────────────────────────────────
export const onPendingInviteCreated = onDocumentCreated(
  {
    document: 'vendors/{slug}/pendingInvites/{inviteId}',
    region: 'us-central1',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const slug = String(event.params.slug);
    const inviteId = String(event.params.inviteId);
    const data = event.data?.data() || {};
    console.log(`[onPendingInviteCreated] slug=${slug} inviteId=${inviteId} email=${data.email}`);
    try {
      const result = await processPendingInvite(event.data!.ref, data, slug);
      console.log(`[onPendingInviteCreated] result:`, JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[onPendingInviteCreated] crash:`, msg);
      try {
        await event.data!.ref.update({
          status: 'invite_failed',
          failReason: msg.slice(0, 500),
          failedAt: FieldValue.serverTimestamp(),
        });
      } catch (_) {
        // best-effort status update
      }
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Trigger 2: onUpdate — fires when admin flips status back to 'pending'
// (e.g. to retry after an SMTP hiccup). We only act if status changed
// TO 'pending' AND sentAt hasn't been stamped yet.
// ───────────────────────────────────────────────────────────────────────────
export const onPendingInviteUpdated = onDocumentUpdated(
  {
    document: 'vendors/{slug}/pendingInvites/{inviteId}',
    region: 'us-central1',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const before = event.data?.before.data() || {};
    const after = event.data?.after.data() || {};
    const slug = String(event.params.slug);

    // Only re-send if status flipped back to 'pending'.
    if (before.status === 'pending' || after.status !== 'pending') return;
    // Don't re-send if we already have a sentAt stamp (admin only
    // updated something else, e.g. adminNote).
    if (after.sentAt) return;

    console.log(`[onPendingInviteUpdated] retry slug=${slug}`);
    try {
      await processPendingInvite(event.data!.after.ref, after, slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[onPendingInviteUpdated] crash:`, msg);
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Optional onCall: admin-only manual retry that flips a doc back to
// 'pending'. Useful if SMTP was down and the couple's email never
// arrived. Cleaner than asking admin to edit Firestore directly.
// ───────────────────────────────────────────────────────────────────────────
import { onCall, HttpsError } from 'firebase-functions/v2/https';

export const adminRetryVendorInvite = onCall(
  { cors: true, region: 'us-central1', secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (req.auth.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin only.');
    }
    const { slug, inviteId } = (req.data || {}) as { slug?: string; inviteId?: string };
    if (!slug || !inviteId) {
      throw new HttpsError('invalid-argument', 'slug and inviteId required.');
    }
    const ref = db.collection('vendors').doc(slug).collection('pendingInvites').doc(inviteId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Invite not found.');
    }
    // Flip back to pending + clear sentAt so onUpdate trigger fires.
    await ref.update({
      status: 'pending',
      sentAt: FieldValue.delete(),
      failReason: FieldValue.delete(),
      failedAt: FieldValue.delete(),
      retryRequestedBy: req.auth.uid,
      retryRequestedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },
);