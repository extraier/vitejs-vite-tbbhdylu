import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Reject signed payloads older (or further ahead) than this. Mailgun's own guidance is about 15 minutes. */
export const MAILGUN_SIGNATURE_MAX_SKEW_SECONDS = 15 * 60;

export const INBOUND_MAX_FILES = 10;
export const INBOUND_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const INBOUND_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const INBOUND_MAX_BODY_BYTES = 25 * 1024 * 1024;

/** One courtesy reply per address per day, and a global cap so a catch-all cannot relay a flood. */
export const AUTO_REPLY_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_REPLY_GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const AUTO_REPLY_GLOBAL_MAX_PER_WINDOW = 20;

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

function mailgunTimestampFresh(
  timestamp: string,
  nowMs: number,
  maxSkewSeconds: number,
): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  return Math.abs(nowMs / 1000 - seconds) <= maxSkewSeconds;
}

/**
 * Mailgun signs inbound webhooks with HMAC-SHA256(signingKey, timestamp + token).
 * Returns false (never throws) for missing fields, non-hex signatures,
 * length mismatches, and stale timestamps. Callers map false to HTTP 401.
 */
export function verifyMailgunSignature(input: {
  timestamp?: string;
  token?: string;
  signature?: string;
  signingKey?: string | null;
  nowMs?: number;
  maxSkewSeconds?: number;
}): boolean {
  const { timestamp, token, signature, signingKey } = input;
  if (!timestamp || !token || !signature || !signingKey) return false;
  const fresh = mailgunTimestampFresh(
    timestamp,
    input.nowMs ?? Date.now(),
    input.maxSkewSeconds ?? MAILGUN_SIGNATURE_MAX_SKEW_SECONDS,
  );
  if (!fresh) return false;
  if (!SHA256_HEX.test(signature)) return false;
  const expectedHex = createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');
  const actual = Buffer.from(signature, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length === 0 || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function attachmentsWithinLimits(
  files: Array<{ size: number }>,
  limits: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number } = {},
): boolean {
  const maxFiles = limits.maxFiles ?? INBOUND_MAX_FILES;
  const maxFileBytes = limits.maxFileBytes ?? INBOUND_MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? INBOUND_MAX_TOTAL_BYTES;
  if (files.length > maxFiles) return false;
  let total = 0;
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > maxFileBytes) return false;
    total += file.size;
    if (total > maxTotalBytes) return false;
  }
  return true;
}

const NON_REPLY_LOCAL = /^(mailer-daemon|postmaster|noreply|no-reply|bounce|bounces|notifications)$/i;

/** Pull a single mailbox out of a From header or a bare address. */
export function extractReplyAddress(header: string | null | undefined): string | null {
  const raw = (header || '').trim();
  if (!raw) return null;
  const wrapped = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  const bare = raw.match(/^([^<>\s]+@[^<>\s]+)$/);
  const email = (wrapped?.[1] || bare?.[1] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export type AutoReplyGate =
  | { ok: true; toEmail: string }
  | { ok: false; reason: string };

/**
 * First-contact auto-reply is attacker-controlled via From. Only reply
 * when From is a real mailbox, the envelope sender is that same mailbox,
 * and the message is not a bounce or bulk/auto-submitted mail.
 * The message is still stored either way.
 */
export function autoReplyGate(input: {
  fromHeader?: string;
  envelopeSender?: string;
  messageHeaders?: string;
}): AutoReplyGate {
  const toEmail = extractReplyAddress(input.fromHeader);
  if (!toEmail) return { ok: false, reason: 'missing-from' };
  const local = toEmail.slice(0, toEmail.indexOf('@'));
  if (NON_REPLY_LOCAL.test(local)) return { ok: false, reason: 'noreply-or-bounce' };
  const headers = input.messageHeaders || '';
  if (/auto-submitted\s*[:=]\s*(?!no\b)/i.test(headers)) {
    return { ok: false, reason: 'auto-submitted' };
  }
  if (/precedence\s*[:=]\s*(bulk|list|junk)/i.test(headers)) {
    return { ok: false, reason: 'bulk' };
  }
  const envelope = extractReplyAddress(input.envelopeSender);
  if (!envelope || envelope !== toEmail) return { ok: false, reason: 'envelope-mismatch' };
  return { ok: true, toEmail };
}

export function autoReplyRateDecision(input: {
  lastSentAtMs: number | null;
  recentGlobalSends: number;
  nowMs: number;
}): { allow: boolean; reason: string } {
  if (input.recentGlobalSends >= AUTO_REPLY_GLOBAL_MAX_PER_WINDOW) {
    return { allow: false, reason: 'global-cap' };
  }
  if (
    input.lastSentAtMs != null &&
    input.nowMs - input.lastSentAtMs < AUTO_REPLY_MIN_INTERVAL_MS
  ) {
    return { allow: false, reason: 'per-address-cooldown' };
  }
  return { allow: true, reason: 'ok' };
}

/** Reply-To uses support+<threadId>@domain. An empty tag falls back to a new thread. */
export function parsePlusAddress(localPart: string): { base: string; tag: string | null } {
  const i = localPart.indexOf('+');
  if (i === -1) return { base: localPart.toLowerCase(), tag: null };
  const tag = localPart.slice(i + 1);
  return {
    base: localPart.slice(0, i).toLowerCase(),
    tag: tag ? tag.toLowerCase() : null,
  };
}

export function recipientToAddress(
  recipientHeader: string,
): { local: string; domain: string } | null {
  const m = recipientHeader.match(/<([^>]+)>/);
  const raw = m ? m[1] : recipientHeader;
  const at = raw.lastIndexOf('@');
  if (at === -1) return null;
  return { local: raw.slice(0, at), domain: raw.slice(at + 1).toLowerCase() };
}

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function threadIdForInbound(input: {
  threadTag: string | null;
  messageId: string;
  sender: string;
  subject: string;
  rawRecipient: string;
}): { threadId: string; isFirstInbound: boolean } {
  const fallbackId = createHash('sha1')
    .update(input.messageId || input.sender + input.subject + input.rawRecipient)
    .digest('hex')
    .slice(0, 16);
  return {
    threadId: input.threadTag || fallbackId,
    isFirstInbound: !input.threadTag,
  };
}

export function autoReplyPayload(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  threadId: string;
  domain: string;
  subject: string;
}): Record<string, unknown> {
  const replyAddr = `support+${input.threadId}@${input.domain}`;
  const subject = input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`;
  return {
    from: `${input.fromName} <${input.fromEmail}>`,
    to: [input.toEmail],
    'h:Reply-To': replyAddr,
    subject,
    text:
      `Hi,\n\nThanks for reaching out — we received your message and will get back to you within 24 hours.\n\n` +
      `If you'd like to add anything to this thread, simply reply to this email; your reply will be routed back to us automatically.\n\n` +
      `— Savetheday Support`,
    html:
      `<p>Hi,</p>` +
      `<p>Thanks for reaching out — we received your message and will get back to you within 24 hours.</p>` +
      `<p>If you'd like to add anything to this thread, simply reply to this email; your reply will be routed back to us automatically.</p>` +
      `<p>— Savetheday Support</p>`,
  };
}
