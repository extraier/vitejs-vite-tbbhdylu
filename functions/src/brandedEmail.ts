// 2026-07-31 — Branded Firebase Auth emails via SendGrid.
//
// Firebase Auth's built-in email templates (verification, password-reset,
// email-change) only customize if you switch the project to
// method=CUSTOM_SMTP, at which point Firebase stops sending on your
// behalf and you have to set up SMTP creds, DNS records (SPF/DKIM),
// and an operational SendGrid/Mailgun tier.
//
// We don't want that operational commitment for a small uplift (the
// built-in English templates already work). Instead, this module
// provides one callable per Auth flow that builds the Firebase
// verification/reset link via the Auth admin SDK, then ships a
// branded HTML email through SendGrid. The default Firebase-side
// templates stay as a fallback for anyone hitting the SDK path
// directly (e.g. during testing), but the front-end wires its users
// through these callables.
//
// Why one file instead of three:
//   - All three callables share the same pattern (build link + render
//     branded HTML + send via SendGrid).
//   - The branded template style is shared, so co-locating renders
//     keeps the design consistent.
//   - Easier to keep current with SendGrid API changes (one place to
//     update when helpers/signatures shift).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getAuth } from 'firebase-admin/auth';
import * as admin from 'firebase-admin';
import { sendViaSendgrid } from './sendgridMailer';

if (admin.apps.length === 0) admin.initializeApp();

// Secrets — already provisioned for the existing SendGrid path
// (partnerInvite.ts, vendorInviteTrigger.ts, helpersMail.ts). Wiring
// these in this file gives the new callables the same SMTP credentials
// without re-declaring them.
const SMTP_URL = defineSecret('SMTP_URL');
const SMTP_FROM = defineSecret('SMTP_FROM');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

// Shared chrome for the branded email layout. Keep markup minimal so
// the templates work in clients that strip <style> blocks (Gmail
// web). Inline styles + a single-column table layout are the most
// reliable path.
const BRAND_COLOR = '#d12c4e'; // matches Save The Day's rose palette
const BRAND_BG = '#fff5f7';

function shellHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background:${BRAND_BG};font-family:'Helvetica Neue',Arial,sans-serif;color:#334155">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_BG};padding:24px">
  <tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;width:100%;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #f1f5f9">
      <tr><td>${body}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Save The Day &middot; <a href="https://savetheday.io" style="color:${BRAND_COLOR};text-decoration:none">savetheday.io</a></p>
  </td></tr>
</table>
</body></html>`;
}

function ctaBlock(heading: string, ctaText: string, ctaUrl: string, ctaColor: string): string {
  return `
<h1 style="font-size:22px;color:#0f172a;margin:0 0 16px;font-weight:700">${heading}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#334155">請點擊以下按鈕繼續：</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px">
  <tr><td align="center" bgcolor="${ctaColor}" style="border-radius:8px">
    <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${ctaText}</a>
  </td></tr>
</table>
<p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 8px">如果按鈕無效，請複製以下連結到瀏覽器：</p>
<p style="word-break:break-all;background:#f1f5f9;padding:10px;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#334155;margin:0 0 24px">${ctaUrl}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">如果你並無要求此電郵，可以安全地忽略。為咗你嘅帳戶安全，請勿將此連結轉發俾其他人。</p>`;
}

/** Build the "verify your email" branded email for a given user. */
function buildVerificationHtml(displayName: string | null, link: string): string {
  const greeting = displayName ? `${displayName}，` : '';
  return shellHtml(
    '歡迎使用 Save The Day！請驗證電郵',
    ctaBlock(
      `歡迎使用 Save The Day 🎉`,
      '✓ 驗證電郵地址',
      link,
      BRAND_COLOR,
    ).replace('請點擊以下按鈕繼續：', `${greeting}多謝你註冊 Save The Day！請點擊以下按鈕驗證電郵地址：`),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Callable: sendBrandedVerificationV2
//   Auth-required, single call replaces user.sendEmailVerification().
//   Returns: { sent: boolean, error?: string }
//     - sent: true → SendGrid accepted (202).
//     - sent: false, error: missing-config | sendgrid-error
//
//   Idempotency: Auth's generateEmailVerificationLink always returns a
//   fresh link (we don't store tokens), so calling twice yields two
//   emails. The CLIENT side rate-limits via button-disabled state, so
//   we don't enforce a server-side cooldown here.
// ─────────────────────────────────────────────────────────────────────
export const sendBrandedVerificationV2 = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [SMTP_URL, SMTP_FROM, APP_BASE_URL],
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (e) {
      throw new HttpsError('not-found', 'User account not found.');
    }
    if (!userRecord.email) {
      throw new HttpsError(
        'failed-precondition',
        'No email address on this account; cannot send verification.',
      );
    }
    if (userRecord.emailVerified) {
      throw new HttpsError(
        'failed-precondition',
        'Email already verified.',
      );
    }
    let link: string;
    try {
      link = await auth.generateEmailVerificationLink(userRecord.email, {
        url: `${APP_BASE_URL.value()}/`,
      });
    } catch (e) {
      throw new HttpsError(
        'internal',
        `Failed to mint verification link: ${(e as Error).message}`,
      );
    }
    const html = buildVerificationHtml(userRecord.displayName ?? null, link);
    const result = await sendViaSendgrid({
      smtpUrl: SMTP_URL.value(),
      from: SMTP_FROM.value(),
      fromName: 'Save The Day',
      to: userRecord.email,
      subject: '歡迎使用 Save The Day！請驗證電郵',
      html,
      replyTo: SMTP_FROM.value(),
    });
    if (!result.ok) {
      // Don't surface internal SendGrid errors as a hard 5xx — the
      // client just wants to know the send failed so it can show a
      // toast.
      throw new HttpsError('internal', result.error || 'sendgrid-failed');
    }
    return { sent: true };
  },
);
