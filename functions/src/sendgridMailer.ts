/**
 * SendGrid v3 mail-send helper (2026-07-27).
 * ==========================================
 *
 * Replaces the previous `nodemailer.SMTP` path that was hitting the
 * "550 from address does not match a verified Sender Identity"
 * error. SendGrid's SMTP gateway enforces a per-address Sender
 * Identity check (`/v3/senders`) that the API path skips; the same
 * `SMTP_URL` secret holds both values:
 *
 *   smtps://apikey:SG.xxx...@host:465
 *      ├── user   = "apikey"
 *      └── passwd = "SG.xxx..."   ← this is the API Bearer token
 *
 * The HTTP v3 mail-send endpoint accepts the key as `Authorization:
 * Bearer SG.xxx...` and only requires domain authentication (DKIM +
 * SPF + whitelabel/default) — not the single-sender verification.
 *
 * Usage:
 *
 *   import { sendViaSendgrid } from './sendgridMailer';
 *
 *   const result = await sendViaSendgrid({
 *     smtpUrl: process.env.SMTP_URL,
 *     from: 'no-reply@savetheday.io',
 *     fromName: 'Save The Day',
 *     to: partnerEmail,
 *     subject,
 *     html,
 *     text,    // optional
 *   });
 *   // result: { ok: true, sent: true }  or { ok: false, error: string }
 *
 * The function is intentionally tiny — it does ONE thing (post a
 * v3/mail/send request and translate the result into the same
 * `{ok, sent, error}` shape nodemailer would have returned) so it's
 * safe to call from any callable that previously called nodemailer.
 *
 * Side-effects:
 *   - Imports `@sendgrid/mail` at module load (so the module is loaded
 *     once per Cloud Function instance, not per request).
 *   - The API client is `setApiKey(...)`-d on each call; SendGrid's
 *     client memoizes, so this is cheap.
 *
 * Failure modes:
 *   - Missing/invalid SMTP_URL secret → returns `ok: false, error: 'SMTP_URL secret missing or malformed'`.
 *   - 401/403 from SendGrid → return the HTTP status + body.
 *   - 4xx otherwise → return the parsed `errors[0].message` (with
 *     status code prefix when present).
 *   - Network error / timeout → rethrow or wrap as a string.
 */

import * as sgMail from '@sendgrid/mail';

export interface SendgridAttachment {
  filename: string;
  /** PNG/JPG/etc. bytes — base64 will also be accepted via passing the
   * base64 string and we will detect by trying to decode. For clarity
   * the helper expects Buffer (or a base64 string with `isBase64: true`). */
  content: Buffer;
  type?: string;       // e.g. 'image/png'
  disposition?: 'attachment' | 'inline';
  /** Content-ID used to <img src="cid:..."> reference. Matches nodemailer `cid`. */
  cid?: string;
}

export interface SendViaSendgridInput {
  smtpUrl: string | undefined;
  from: string;
  fromName?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: SendgridAttachment[];
  replyTo?: string;
}

export interface SendViaSendgridResult {
  ok: boolean;
  sent: boolean;
  error?: string;
}

/**
 * Parse the SendGrid SMTP URL of the form
 *   smtps://apikey:<SGkey>@host:port
 * and return `<SGkey>`. Returns null if the URL is missing or
 * malformed (wrong scheme, no password, etc.).
 *
 * Defensive: tolerates trailing slashes, query strings, and the
 * `smtp://` (non-TLS) variant.
 */
export function extractSendgridApiKey(smtpUrl: string | undefined): string | null {
  if (!smtpUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(smtpUrl);
  } catch {
    return null;
  }
  // Accept smtps:// and smtp:// — both are valid SendGrid SMTP URLs.
  if (parsed.protocol !== 'smtps:' && parsed.protocol !== 'smtp:') return null;
  // The password component is the SendGrid API key.
  // `URL.password` decodes percent-encoding automatically.
  const key = parsed.password;
  if (!key || !key.startsWith('SG.')) return null;
  return key;
}

/**
 * Translate `@sendgrid/mail` thrown errors into a stable human-readable
 * string. The library sometimes provides `e.response.statusCode` /
 * `e.response.body.errors[0].message`, sometimes only one of them,
 * depending on whether the SDK was able to classify the response as
 * a 4xx/5xx vs network error.
 */
function formatSendgridError(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { statusCode?: number; body?: unknown };
  };
  if (e.response?.body) {
    try {
      const bodyObj = typeof e.response.body === 'string'
        ? JSON.parse(e.response.body) as { errors?: { message?: string }[] }
        : (e.response.body as { errors?: { message?: string }[] });
      const firstMsg = bodyObj?.errors?.[0]?.message;
      if (firstMsg) {
        const code = typeof e.response.statusCode === 'number'
          ? `${e.response.statusCode} `
          : '';
        return `${code}${firstMsg}`.trim();
      }
    } catch {
      /* fall through to plain message */
    }
  }
  return e.message ?? String(err);
}

export async function sendViaSendgrid(input: SendViaSendgridInput): Promise<SendViaSendgridResult> {
  const apiKey = extractSendgridApiKey(input.smtpUrl);
  if (!apiKey) {
    return {
      ok: false,
      sent: false,
      error: 'SMTP_URL secret missing or malformed; expected smtps://apikey:SG.<key>@<host>:465',
    };
  }

  // Configure the client for this request. SendGrid's client uses
  // `setApiKey` (process-global), so we set it each call. The function
  // is multiplexed per request in CF v2.
  sgMail.setApiKey(apiKey);

  // Trim the `from` email — Secret Manager often appends a trailing
  // newline to secret values, which SendGrid's API rejects as an
  // "Invalid from email address" because `\n` isn't valid in RFC 5322.
  // (Real-world bug, observed 2026-07-27 with SMTP_FROM = "no-reply@\n".)
  const fromEmail = input.from.trim();
  const fromName = (input.fromName ?? 'Save The Day').trim();
  const sgAttachments = (input.attachments ?? []).map(a => ({
    content: a.content.toString('base64'),
    filename: a.filename,
    type: a.type,
    disposition: a.disposition ?? 'attachment',
    content_id: a.cid,
  }));

  const msg: Record<string, unknown> = {
    to: input.to,
    from: { email: fromEmail, name: fromName },
    subject: input.subject,
    ...(input.html ? { html: input.html } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(sgAttachments.length ? { attachments: sgAttachments } : {}),
    ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
  };

  try {
    const [response] = await sgMail.send(msg as unknown as Parameters<typeof sgMail.send>[0]);
    // SendGrid returns 202 for queued mail; 2xx → success.
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { ok: true, sent: true };
    }
    return {
      ok: false,
      sent: false,
      error: `SendGrid HTTP ${response.statusCode}: ${response.body ?? ''}`,
    };
  } catch (err) {
    return { ok: false, sent: false, error: formatSendgridError(err) };
  }
}