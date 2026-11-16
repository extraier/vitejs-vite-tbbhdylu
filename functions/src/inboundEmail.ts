/**
 * inboundEmail — Mailgun catch-all for *@savetheday.io.
 *
 * Verifies the Mailgun HMAC, stores the message and attachments, and
 * sends one thread-aware auto-reply on the first message. Secrets stay
 * in Firebase Secret Manager (defineSecret); nothing is hardcoded.
 */

import { createHash, randomBytes } from 'crypto';
import Busboy = require('busboy');
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Mailgun from 'mailgun.js';
import {
  asArray,
  attachmentsWithinLimits,
  autoReplyGate,
  autoReplyPayload,
  autoReplyRateDecision,
  AUTO_REPLY_GLOBAL_MAX_PER_WINDOW,
  AUTO_REPLY_GLOBAL_WINDOW_MS,
  INBOUND_MAX_BODY_BYTES,
  INBOUND_MAX_FILE_BYTES,
  INBOUND_MAX_FILES,
  parsePlusAddress,
  recipientToAddress,
  threadIdForInbound,
  verifyMailgunSignature,
} from './inboundEmail.pure';

const MAILGUN_API_KEY = defineSecret('MAILGUN_API_KEY');
const MAILGUN_DOMAIN = defineSecret('MAILGUN_DOMAIN');
const MAILGUN_SIGNING_KEY = defineSecret('MAILGUN_SIGNING_KEY');
const MAILGUN_REGION = defineSecret('MAILGUN_REGION');
const MAILGUN_FROM_EMAIL = defineSecret('MAILGUN_FROM_EMAIL');
const MAILGUN_FROM_NAME = defineSecret('MAILGUN_FROM_NAME');
const DEV_MODE = defineSecret('DEV_MODE');

export interface InboundRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  pipe: (dest: NodeJS.WritableStream) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  /** Cloud Functions v2 already buffers the body here after consuming the stream. */
  rawBody?: Buffer | string;
  body?: unknown;
}

export interface InboundResponse {
  status: (code: number) => InboundResponse;
  send: (body: string) => unknown;
}

interface StoredFile {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface InboundRuntime {
  devMode: boolean;
  signingKey: string;
  domain: string;
  fromEmail: string;
  fromName: string;
  region: string;
  apiKey: string;
  db: {
    collection: (name: string) => {
      doc: (id?: string) => {
        set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
      };
    };
  };
  bucket: {
    name: string;
    file: (objectPath: string) => {
      save: (content: Buffer, opts: { contentType?: string; metadata?: Record<string, string> }) => Promise<void>;
    };
  };
  sendMessage: (domain: string, payload: Record<string, unknown>) => Promise<unknown>;
  /**
   * Reserve a one-per-address auto-reply slot. Return false to skip
   * the send (cooldown, global cap, or a storage failure). Missing
   * implementation fails closed — no reply is sent.
   */
  claimAutoReply?: (toEmail: string, nowMs: number) => Promise<boolean>;
  now?: () => number;
}

function headerValue(headers: InboundRequest['headers'], name: string): string {
  const value = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function parseMultipart(req: InboundRequest): Promise<{ fields: Record<string, unknown>; files: StoredFile[]; limited: boolean }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, unknown> = {};
    const files: StoredFile[] = [];
    let limited = false;
    const bb = Busboy({
      headers: req.headers as Record<string, string>,
      limits: {
        files: INBOUND_MAX_FILES,
        fileSize: INBOUND_MAX_FILE_BYTES,
        fields: 40,
        fieldSize: 1024 * 1024,
        parts: INBOUND_MAX_FILES + 40,
      },
    });
    const markLimited = () => {
      limited = true;
    };
    bb.on('filesLimit', markLimited);
    bb.on('fieldsLimit', markLimited);
    bb.on('partsLimit', markLimited);
    bb.on('field', (name: string, val: string) => {
      if (fields[name] === undefined) fields[name] = val;
      else if (Array.isArray(fields[name])) (fields[name] as string[]).push(val);
      else fields[name] = [fields[name], val];
    });
    bb.on('file', (name: string, stream: NodeJS.ReadableStream, info: { filename?: string; mimeType?: string }) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
        limited = true;
      });
      stream.on('data', (chunk: Buffer) => {
        if (truncated || size >= INBOUND_MAX_FILE_BYTES) {
          truncated = true;
          limited = true;
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (truncated) return;
        files.push({
          filename: info.filename || `unnamed-${name}`,
          mimeType: info.mimeType || 'application/octet-stream',
          content: Buffer.concat(chunks),
        });
      });
    });
    bb.on('finish', () => resolve({ fields, files, limited }));
    bb.on('error', reject);
    const buffered = rawBodyIfPresent(req);
    if (buffered) {
      bb.end(buffered);
    } else {
      req.pipe(bb);
    }
  });
}

function rawBodyIfPresent(req: InboundRequest): Buffer | undefined {
  if (req.rawBody == null) return undefined;
  return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
}

function readBody(req: InboundRequest): Promise<string> {
  const buffered = rawBodyIfPresent(req);
  if (buffered) {
    if (buffered.length > INBOUND_MAX_BODY_BYTES) {
      return Promise.reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
    }
    return Promise.resolve(buffered.toString('utf8'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > INBOUND_MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function formDataImpl(): typeof FormData {
  return globalThis.FormData;
}

export function makeMailgunClient(apiKey: string, region: string): {
  messages: { create: (domain: string, payload: Record<string, unknown>) => Promise<unknown> };
} {
  const mg = new Mailgun(formDataImpl());
  const url = region === 'EU' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return mg.client({ username: 'api', key: apiKey, url }) as unknown as {
    messages: { create: (domain: string, payload: Record<string, unknown>) => Promise<unknown> };
  };
}

export async function handleInboundEmail(
  req: InboundRequest,
  res: InboundResponse,
  runtime: InboundRuntime,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('method not allowed');
    return;
  }

  const earlyBody = rawBodyIfPresent(req);
  if (earlyBody && earlyBody.length > INBOUND_MAX_BODY_BYTES) {
    res.status(413).send('payload too large');
    return;
  }

  const contentType = headerValue(req.headers, 'content-type');
  let fields: Record<string, unknown> = {};
  let files: StoredFile[] = [];
  if (contentType.startsWith('multipart/form-data')) {
    const parsed = await parseMultipart(req);
    if (parsed.limited || !attachmentsWithinLimits(parsed.files.map((file) => ({ size: file.content.length })))) {
      res.status(413).send('attachment too large');
      return;
    }
    fields = parsed.fields;
    files = parsed.files;
  } else if (contentType.startsWith('application/x-www-form-urlencoded')) {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 413) {
        res.status(413).send('payload too large');
        return;
      }
      throw err;
    }
    const params = new URLSearchParams(raw);
    for (const [key, value] of params) {
      if (fields[key] === undefined) fields[key] = value;
      else if (Array.isArray(fields[key])) (fields[key] as string[]).push(value);
      else fields[key] = [fields[key], value];
    }
  } else {
    console.error('unsupported content-type', contentType);
    res.status(415).send('unsupported content-type');
    return;
  }

  // DEV_MODE === '1' skips verification for local fixtures only.
  // Unset (the production default) stays fail-closed: bad, stale,
  // or non-hex signatures are 401, never 500.
  if (!runtime.devMode) {
    let ok = false;
    try {
      ok = verifyMailgunSignature({
        timestamp: String(asArray(fields.timestamp)[0] || ''),
        token: String(asArray(fields.token)[0] || ''),
        signature: String(asArray(fields.signature)[0] || ''),
        signingKey: runtime.signingKey,
        nowMs: runtime.now ? runtime.now() : Date.now(),
      });
    } catch (err) {
      console.warn('mailgun signature check failed closed', err);
      ok = false;
    }
    if (!ok) {
      console.warn('mailgun signature mismatch');
      res.status(401).send('invalid signature');
      return;
    }
  }

  const sender = String(asArray(fields.from)[0] || '');
  const recipient = String(asArray(fields.to)[0] || asArray(fields.recipient)[0] || '');
  const subject = String(asArray(fields.subject)[0] || '(no subject)');
  const bodyPlain = String(asArray(fields['body-plain'])[0] || '');
  const bodyHtml = String(asArray(fields['body-html'])[0] || '');
  const strippedText = String(asArray(fields['stripped-text'])[0] || '');
  const strippedHtml = String(asArray(fields['stripped-html'])[0] || '');
  const messageId = String(asArray(fields['Message-ID'])[0] || '');
  const rawRecipient = String(asArray(fields.recipient)[0] || recipient);

  const recipientAddr = recipientToAddress(rawRecipient);
  if (!recipientAddr) {
    console.error('could not parse recipient', rawRecipient);
    res.status(400).send('invalid recipient');
    return;
  }
  const { base: recipientBase, tag: threadTag } = parsePlusAddress(recipientAddr.local);
  const { threadId, isFirstInbound } = threadIdForInbound({
    threadTag,
    messageId,
    sender,
    subject,
    rawRecipient,
  });

  const stamp = runtime.now ? runtime.now() : Date.now();
  const attachmentRefs = [];
  for (const file of files) {
    const safeName = (file.filename || 'attachment').replace(/[^A-Za-z0-9._-]/g, '_');
    const objectPath = `messages/${threadId}/${stamp}-${safeName}`;
    await runtime.bucket.file(objectPath).save(file.content, {
      contentType: file.mimeType,
      metadata: { firebaseStorageDownloadTokens: randomBytes(16).toString('hex') },
    });
    attachmentRefs.push({
      path: objectPath,
      name: file.filename,
      mimeType: file.mimeType,
      size: file.content.length,
      bucket: runtime.bucket.name,
    });
  }

  const now = FieldValue.serverTimestamp();
  await runtime.db.collection('inbound_messages').doc().set({
    threadId,
    messageId,
    from: sender,
    to: rawRecipient,
    recipientBase,
    subject,
    bodyPlain,
    bodyHtml,
    strippedText,
    strippedHtml,
    attachments: attachmentRefs,
    attachmentCount: attachmentRefs.length,
    createdAt: now,
  });

  await runtime.db.collection('inbound_threads').doc(threadId).set({
    threadId,
    recipientBase,
    subject,
    lastMessageAt: now,
    lastFrom: sender,
    lastSnippet: (strippedText || bodyPlain).slice(0, 240) || '(no body)',
    messageCount: FieldValue.increment(1),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  if (isFirstInbound) {
    const messageHeaders = String(asArray(fields['message-headers'])[0] || '');
    const envelopeSender = String(asArray(fields.sender)[0] || '');
    const gate = autoReplyGate({
      fromHeader: sender,
      envelopeSender,
      messageHeaders,
    });
    if (!gate.ok) {
      console.warn('auto-reply suppressed', gate.reason);
    } else if (!runtime.claimAutoReply) {
      console.warn('auto-reply suppressed', 'no-rate-limiter');
    } else {
      try {
        const claimed = await runtime.claimAutoReply(gate.toEmail, stamp);
        if (claimed) {
          await runtime.sendMessage(
            runtime.domain,
            autoReplyPayload({
              fromEmail: runtime.fromEmail,
              fromName: runtime.fromName,
              toEmail: gate.toEmail,
              threadId,
              domain: runtime.domain,
              subject,
            }),
          );
        } else {
          console.warn('auto-reply suppressed', 'rate-limit');
        }
      } catch (err) {
        console.error('auto-reply failed (mail stored anyway)', err);
      }
    }
  }

  res.status(200).send('ok');
}

function secretOrEnv(secret: { value: () => string }, envName: string): string {
  try {
    const fromSecret = secret.value();
    if (fromSecret) return fromSecret;
  } catch {
    // Secret binding is absent in local unit tests.
  }
  return process.env[envName] || '';
}

function liveRuntime(): InboundRuntime {
  if (getApps().length === 0) initializeApp();
  const bucket = getStorage().bucket();
  return {
    devMode: secretOrEnv(DEV_MODE, 'DEV_MODE') === '1',
    signingKey: secretOrEnv(MAILGUN_SIGNING_KEY, 'MAILGUN_SIGNING_KEY'),
    domain: secretOrEnv(MAILGUN_DOMAIN, 'MAILGUN_DOMAIN'),
    fromEmail: secretOrEnv(MAILGUN_FROM_EMAIL, 'MAILGUN_FROM_EMAIL'),
    fromName: secretOrEnv(MAILGUN_FROM_NAME, 'MAILGUN_FROM_NAME'),
    region: secretOrEnv(MAILGUN_REGION, 'MAILGUN_REGION') || 'US',
    apiKey: secretOrEnv(MAILGUN_API_KEY, 'MAILGUN_API_KEY'),
    db: getFirestore() as unknown as InboundRuntime['db'],
    bucket: {
      name: bucket.name,
      file: (objectPath) => bucket.file(objectPath),
    },
    sendMessage: async (domain, payload) => {
      const client = makeMailgunClient(
        secretOrEnv(MAILGUN_API_KEY, 'MAILGUN_API_KEY'),
        secretOrEnv(MAILGUN_REGION, 'MAILGUN_REGION') || 'US',
      );
      return client.messages.create(domain, payload);
    },
    claimAutoReply: (toEmail, nowMs) => claimInboundAutoReply(getFirestore(), toEmail, nowMs),
  };
}

/**
 * Transactional one-per-address cooldown plus a global hourly cap.
 * Any storage error fails closed (returns false) so a blip cannot
 * turn the catch-all into an open relay.
 */
export async function claimInboundAutoReply(
  db: FirebaseFirestore.Firestore,
  toEmail: string,
  nowMs: number,
): Promise<boolean> {
  const email = toEmail.trim().toLowerCase();
  const id = createHash('sha256').update(email).digest('hex');
  const perRef = db.collection('inbound_autoreplies').doc(id);
  const globalRef = db.collection('inbound_autoreplies').doc('_global');
  try {
    return await db.runTransaction(async (tx) => {
      const perSnap = await tx.get(perRef);
      const globalSnap = await tx.get(globalRef);
      const lastRaw = perSnap.exists ? perSnap.data()?.lastSentAtMs : null;
      const sentAt = Array.isArray(globalSnap.data()?.sentAtMs)
        ? (globalSnap.data()!.sentAtMs as unknown[]).filter((n): n is number => typeof n === 'number')
        : [];
      const recent = sentAt.filter((t) => nowMs - t < AUTO_REPLY_GLOBAL_WINDOW_MS);
      const decision = autoReplyRateDecision({
        lastSentAtMs: typeof lastRaw === 'number' ? lastRaw : null,
        recentGlobalSends: recent.length,
        nowMs,
      });
      if (!decision.allow) return false;
      recent.push(nowMs);
      tx.set(perRef, { email, lastSentAtMs: nowMs }, { merge: true });
      tx.set(globalRef, {
        sentAtMs: recent.slice(-AUTO_REPLY_GLOBAL_MAX_PER_WINDOW),
      }, { merge: true });
      return true;
    });
  } catch (err) {
    console.error('auto-reply rate limit failed closed', err);
    return false;
  }
}

export const inboundEmail = onRequest(
  {
    region: 'us-central1',
    cors: false,
    // Default 256MiB OOMs on a large multipart body. The parser also
    // rejects oversized attachments before they are stored.
    memory: '512MiB',
    maxInstances: 10,
    secrets: [
      MAILGUN_API_KEY,
      MAILGUN_DOMAIN,
      MAILGUN_SIGNING_KEY,
      MAILGUN_REGION,
      MAILGUN_FROM_EMAIL,
      MAILGUN_FROM_NAME,
      DEV_MODE,
    ],
  },
  async (req, res) => {
    await handleInboundEmail(req, res, liveRuntime());
  },
);
