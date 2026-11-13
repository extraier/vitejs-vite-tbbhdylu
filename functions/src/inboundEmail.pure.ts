import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Mailgun signs inbound webhooks with HMAC-SHA256(signingKey, timestamp + token). */
export function verifyMailgunSignature(input: {
  timestamp?: string;
  token?: string;
  signature?: string;
  signingKey?: string | null;
}): boolean {
  const { timestamp, token, signature, signingKey } = input;
  if (!timestamp || !token || !signature || !signingKey) return false;
  const expected = createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
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
