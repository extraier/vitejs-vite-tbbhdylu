/**
 * Cloud Functions — Helper (兄弟姊妹) Invite Email
 * =================================================
 *
 * sendHelperInviteEmail — owner-only.
 * Sends a beautifully-formatted Traditional-Chinese HTML email to a
 * prospective helper (兄弟姊妹) with a one-click magic link that registers
 * them and immediately grants the owner's chosen permissions.
 *
 * Mirrors the Nodemailer / SMTP pattern from ./invitations.ts so we have
 * ONE consistent "From / Reply-To" envelope across the whole app:
 *   - From   : `${ownerDisplayName} 敬邀 <${SMTP_FROM || 'no-reply@savetheday.io'}>`
 *   - Reply-To: the owner's personal mailbox (so replies land in their real inbox)
 *   - Subject : Traditional-Chinese, names the wedding + the role
 *
 * Email transport
 * ---------------
 * Configure via Firebase secrets (same three secrets used by sendInvitations):
 *   firebase functions:secrets:set SMTP_URL      # smtps://user:pass@host:465
 *   firebase functions:secrets:set SMTP_FROM     # no-reply@savetheday.io
 *   firebase functions:secrets:set APP_BASE_URL  # https://savetheday.io
 *
 * Dev fallback: if SMTP_URL is unset/invalid, the function returns
 *   { ok: true, sent: false, dryRun: true, html, magicLinkUrl }
 * so the front-end can surface the link manually (mirrors the dryRun
 * behavior in invitations.ts §"Dev fallback").
 *
 * Why this exists alongside the client-side sendSignInLinkToEmail
 * ----------------------------------------------------------------
 * The pre-existing HelperManager.jsx flow calls
 * `sendSignInLinkToEmail()` from the browser — this works but uses
 * Firebase's bare-bones default template (no branding, no owner name,
 * no Traditional-Chinese flourish). This function generates a richer
 * email AND lets the SMTP envelope show the couple's name. The
 * HelperManager calls sendHelperInviteEmail FIRST and falls back to
 * the client-side path only if this function throws — see the
 * `catch (err)` block in HelperManager.jsx#handleInvite.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as nodemailer from 'nodemailer';

const db = getFirestore();

// Note on APP_ID: this function does NOT write to /artifacts (no Firestore
// mutation needed for the email itself), so we don't need the literal
// 'savetheday-production' string here. The collectionGroup('users')
// query below automatically scopes to whatever appId segment the caller's
// profile lives under.

// Same secrets as invitations.ts. Re-declared (not imported) because
// defineSecret() returns a param handle that needs to be passed into
// the onCall options' `secrets: [...]` array — sharing the handle
// across modules works but is fragile (the build emits source maps
// that point to a single declaration site).
const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

// ────────────────────────────────────────────────────────────────────────────
// Input / output shapes
// ────────────────────────────────────────────────────────────────────────────

interface SendHelperInviteEmailInput {
  ownerUid: string;
  helperEmail: string;
  helperDisplayName: string;
  ownerName?: string;      // optional override; otherwise fetched from /users/{ownerUid}
  eventName?: string;      // optional — the wedding title
  role?: string;           // defaults to 'wedding helper'
}

interface SendHelperInviteEmailResult {
  ok: boolean;
  sent: boolean;
  dryRun?: boolean;
  html?: string;           // only in dryRun
  magicLinkUrl?: string;   // only in dryRun — surfaced so the front-end can show it
  error?: string;          // only when ok=false
}

// ────────────────────────────────────────────────────────────────────────────
// Callable
// ────────────────────────────────────────────────────────────────────────────

export const sendHelperInviteEmail = onCall(
  {
    // 2026-07-18 — MISSING `cors: true` + `region: 'us-central1'` was the
    // root cause of the CORS preflight block! Every other helper CF in
    // index.ts uses { cors: true, region: 'us-central1' }. Without
    // `cors: true`, the v2 onCall handler does NOT install the
    // Access-Control-Allow-Origin preflight response handler, so the
    // browser blocks the POST with a generic CORS error and the
    // frontend sees `{message: 'internal'}` (which is why the catch
    // block fired and the console warn read "FirebaseError: internal").
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req): Promise<SendHelperInviteEmailResult> => {
    // Same wrapper pattern as invitations.ts — convert any unhandled
    // exception into a structured HttpsError so the client sees the
    // real reason instead of the opaque "internal" placeholder.
    try {
      return await _sendHelperInviteEmailImpl(req);
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[sendHelperInviteEmail] unhandled error:', msg, stack);
      throw new HttpsError('internal', msg, stack ? { stack } : undefined);
    }
  },
);

async function _sendHelperInviteEmailImpl(req: any): Promise<SendHelperInviteEmailResult> {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { ownerUid, helperEmail, helperDisplayName, ownerName, eventName, role } =
    req.data as SendHelperInviteEmailInput;

  // Auth sanity: only the owner themselves can send an invite "as
  // themselves". Prevents a helper from spoofing an invite that
  // appears to come from the owner.
  if (!ownerUid || ownerUid !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'ownerUid must match auth.uid.');
  }
  if (!helperEmail || typeof helperEmail !== 'string') {
    throw new HttpsError('invalid-argument', 'helperEmail required.');
  }
  if (!helperDisplayName || typeof helperDisplayName !== 'string') {
    throw new HttpsError('invalid-argument', 'helperDisplayName required.');
  }

  const appBase = APP_BASE_URL.value() || 'https://savetheday.io';

  // Resolve the owner's display name. Mirrors invitations.ts: walk a
  // collectionGroup('users') query restricted by `uid` so we work
  // across the variable appId segment in /artifacts/{appId}/users/{uid}.
  let resolvedOwnerName = (ownerName || '').trim();
  let ownerReplyEmail: string | undefined;
  if (!resolvedOwnerName) {
    try {
      const ownerSnap = await db
        .collectionGroup('users')
        .where('uid', '==', ownerUid)
        .limit(1)
        .get();
      if (!ownerSnap.empty) {
        const data = ownerSnap.docs[0].data() as { displayName?: string; email?: string };
        if (data.displayName) resolvedOwnerName = data.displayName;
        if (data.email) ownerReplyEmail = data.email;
      }
    } catch (e) {
      // Non-fatal — we fall back to a generic greeting below.
      console.warn('[sendHelperInviteEmail] could not load owner profile:', e);
    }
  }
  if (!resolvedOwnerName) {
    resolvedOwnerName = '朋友';  // generic Traditional-Chinese fallback ("friend")
  }

  const resolvedRole = (role || 'wedding helper').trim();

  // Generate the one-time magic link. Admin SDK's generateSignInWithEmailLink
  // produces the SAME shape that the client's sendSignInLinkToEmail would
  // produce, so the front-end's existing useAuth flow
  // (AuthScreen: `signInWithEmailLink(localStorage.__heroinvite_email, link)`)
  // works without any client-side changes.
  let magicLinkUrl: string;
  try {
    magicLinkUrl = await getAuth().generateSignInWithEmailLink(helperEmail, {
      url: `${appBase}/?__heroinvite=1`,
      handleCodeInApp: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[sendHelperInviteEmail] generateSignInWithEmailLink failed:', msg);
    throw new HttpsError('internal', `Magic link generation failed: ${msg}`);
  }

  // Render the email. Pure function so we can return it in dryRun mode
  // without re-running the renderer.
  const html = renderInviteEmailHtml({
    ownerName: resolvedOwnerName,
    helperName: helperDisplayName,
    eventName: eventName || '',
    role: resolvedRole,
    magicLinkUrl,
  });

  // ─── SMTP envelope ──────────────────────────────────────────────────────
  //
  // Hermes 2026-07-18 — same envelope as invitations.ts:
  //   From:    `${ownerDisplayName} 敬邀 <${SMTP_FROM || 'no-reply@savetheday.io'}>`
  //   Reply-To: owner's personal mailbox so replies land in their inbox
  //             (no-reply@ would bounce, so SMTP_FROM isn't suitable for replies)
  const fromAddress = SMTP_FROM.value() || 'no-reply@savetheday.io';
  const subject = eventName
    ? `${resolvedOwnerName} 嘅婚禮 · 邀請你做兄弟姊妹`
    : `${resolvedOwnerName} 邀請你做兄弟姊妹`;

  // ─── dryRun fallback ────────────────────────────────────────────────────
  //
  // If SMTP_URL is unset / invalid (matches the validator used in
  // invitations.ts), skip the send and return the rendered HTML + the
  // magic-link URL so the front-end can surface them in the UI. Same
  // pattern as invitations.ts — first deploy, then add secrets.
  const smtpUrlRaw = SMTP_URL.value();
  const smtpUrlValid =
    typeof smtpUrlRaw === 'string' &&
    smtpUrlRaw.length > 0 &&
    smtpUrlRaw !== 'undefined' &&
    /^[a-z]+:\/\//.test(smtpUrlRaw);

  if (!smtpUrlValid) {
    console.warn('[sendHelperInviteEmail] SMTP_URL missing/invalid; returning dryRun for', helperEmail);
    return {
      ok: true,
      sent: false,
      dryRun: true,
      html,
      magicLinkUrl,
    };
  }

  // ─── Real send ──────────────────────────────────────────────────────────
  const transporter = nodemailer.createTransport(smtpUrlRaw!);
  try {
    await transporter.sendMail({
      from: `"${resolvedOwnerName} 敬邀" <${fromAddress}>`,
      replyTo: ownerReplyEmail,
      to: helperEmail,
      subject,
      html,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[sendHelperInviteEmail] sendMail failed:', msg);
    // Re-throw as HttpsError so the client can decide whether to fall
    // back to sendSignInLinkToEmail. Returning { ok: false, sent: false }
    // here would be ambiguous (caller can't tell SMTP error from
    // dryRun), so we surface the failure loudly.
    throw new HttpsError('internal', `SMTP send failed: ${msg}`);
  }

  return { ok: true, sent: true };
}

// 2026-07-18 — V2 alias. The CF control plane keeps recreating the
// v1 deployment within seconds of any delete operation ("Resource
// already exists" 409s on every redeploy). Rather than fight GCP,
// we deploy under a fresh name and the front-end calls this new
// entry point. Once GCP behaviour is healthy, V1 + V2 can be merged.
export const sendHelperInviteEmailV2 = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req: any): Promise<SendHelperInviteEmailResult> => {
    // Same impl as V1 — wraps any unhandled exception into HttpsError.
    try {
      return await _sendHelperInviteEmailImpl(req);
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      // eslint-disable-next-line no-console
      console.error('[sendHelperInviteEmailV2] unhandled error:', msg);
      throw new HttpsError('internal', msg);
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────
// HTML template — Traditional-Chinese, rose-pink gradient hero, max-width
// 480 white card with shadow, PingFang HK font stack.
// Mirrors invitations.ts renderEmailHtml() visually so the two emails
// feel like the same product.
// ────────────────────────────────────────────────────────────────────────────

function renderInviteEmailHtml(args: {
  ownerName: string;
  helperName: string;
  eventName: string;
  role: string;
  magicLinkUrl: string;
}): string {
  const { ownerName, helperName, eventName, role, magicLinkUrl } = args;

  // Rose-to-pink gradient hero (per the user's brief — invitations.ts
  // uses #fff1f2 → #fdf2f8 by default; here we intensify it slightly so
  // the helper email reads as its own moment, not a duplicate of the
  // e-card). White text on a soft pink works well on Gmail/iOS Mail.
  const heroStyle = `background: linear-gradient(135deg, #f43f5e 0%, #ec4899 50%, #f9a8d4 100%);`;

  const eventLine = eventName
    ? escapeHtml(eventName)
    : escapeHtml(ownerName) + ' 嘅婚禮';

  return `<!DOCTYPE html>
<html lang="zh-HK"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
        <tr><td style="${heroStyle}padding:48px 32px;text-align:center;color:#ffffff;">
          <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.3em;font-weight:900;color:#ffffff;text-transform:uppercase;">Save The Day · Wedding Helper</p>
          <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;line-height:1.25;color:#ffffff;">${eventLine}</h1>
          <p style="margin:8px 0 0;font-size:13px;color:#ffffff;opacity:0.92;">${escapeHtml(ownerName)} 敬邀</p>
        </td></tr>
        <tr><td style="padding:32px 28px 36px;text-align:center;color:#1e293b;">
          <p style="margin:0 0 6px;font-size:13px;color:#64748b;">你好，</p>
          <h2 style="margin:0 0 18px;font-size:24px;font-weight:900;color:#1e293b;">${escapeHtml(helperName)}！</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;text-align:left;">
            ${escapeHtml(ownerName)} 邀請你成為佢婚禮嘅${escapeHtml(role)}，可以幫手處理大日流程、座位表、回禮等。
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
            <tr><td style="border-radius:14px;background:linear-gradient(135deg,#e11d48,#db2777);">
              <a href="${escapeHtml(magicLinkUrl)}" style="display:inline-block;padding:16px 36px;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;letter-spacing:0.05em;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'PingFang HK',sans-serif;">接受邀請 · 一鍵加入</a>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            連結 24 小時內有效。點擊後會建立你嘅 Save The Day 帳號，立即可以看到${escapeHtml(ownerName)}嘅婚禮資料。
          </p>
          <hr style="margin:28px 0 16px;border:none;border-top:1px solid #e2e8f0;" />
          <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">Save The Day</p>
          <p style="margin:0;font-size:11px;color:#cbd5e1;">香港婚禮策劃助手 · savetheday.io</p>
        </td></tr>
      </table>
      <p style="margin:16px auto 0;max-width:480px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
        如果你唔識對方，請直接刪除此電郵。<br />
        如有疑問，回覆此電郵即可聯絡 ${escapeHtml(ownerName)}。
      </p>
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
