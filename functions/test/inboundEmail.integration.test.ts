import { createHash, createHmac } from 'crypto';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { handleInboundEmail, type InboundRequest, type InboundResponse, type InboundRuntime } from '../src/inboundEmail';
import { AUTO_REPLY_GLOBAL_WINDOW_MS, autoReplyRateDecision, INBOUND_MAX_FILES } from '../src/inboundEmail.pure';

interface Store {
  messages: Array<Record<string, unknown>>;
  threads: Record<string, Record<string, unknown>>;
  files: Array<{ path: string; size: number }>;
}

function freshStore(): Store {
  return { messages: [], threads: {}, files: [] };
}

function runtimeFrom(
  store: Store,
  sendMessage: InboundRuntime['sendMessage'],
  extra: Partial<InboundRuntime> = {},
): InboundRuntime {
  const sentAt = new Map<string, number>();
  let globalSends: number[] = [];
  return {
    devMode: true,
    signingKey: 'testkey',
    domain: 'savetheday.io',
    fromEmail: 'support@savetheday.io',
    fromName: 'Savetheday Support',
    region: 'US',
    apiKey: 'test',
    now: () => 1743513600000,
    db: {
      collection(name: string) {
        return {
          doc(id?: string) {
            return {
              async set(data: Record<string, unknown>) {
                if (name === 'inbound_threads') {
                  const key = id || '';
                  const prev = store.threads[key] || {};
                  let messageCount = Number(prev.messageCount || 0);
                  const incoming = data.messageCount;
                  if (incoming && typeof incoming === 'object') {
                    messageCount += 1;
                  } else if (typeof incoming === 'number') {
                    messageCount = incoming;
                  }
                  store.threads[key] = {
                    ...prev,
                    ...data,
                    messageCount,
                    status: prev.status || data.status || 'open',
                  };
                } else {
                  store.messages.push({ id, ...data });
                }
              },
            };
          },
        };
      },
    },
    bucket: {
      name: 'stub-bucket',
      file(objectPath: string) {
        return {
          async save(content: Buffer) {
            store.files.push({ path: objectPath, size: content.length });
          },
        };
      },
    },
    sendMessage,
    claimAutoReply: async (toEmail, nowMs) => {
      const last = sentAt.has(toEmail) ? sentAt.get(toEmail)! : null;
      const recent = globalSends.filter((t) => nowMs - t < AUTO_REPLY_GLOBAL_WINDOW_MS);
      const decision = autoReplyRateDecision({
        lastSentAtMs: last,
        recentGlobalSends: recent.length,
        nowMs,
      });
      if (!decision.allow) return false;
      sentAt.set(toEmail, nowMs);
      globalSends = [...recent, nowMs];
      return true;
    },
    ...extra,
  };
}

function multipartBody(
  fields: Record<string, string>,
  files: Array<{ fieldName: string; filename: string; mimeType: string; content: Buffer }> = [],
) {
  const boundary = '----MailgunBoundaryXYZ';
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${crlf}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${key}"${crlf}${crlf}`));
    parts.push(Buffer.from(`${value}${crlf}`));
  }
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}${crlf}`));
    parts.push(Buffer.from(
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"${crlf}` +
      `Content-Type: ${file.mimeType}${crlf}${crlf}`,
    ));
    parts.push(Buffer.concat([file.content, Buffer.from(crlf)]));
  }
  parts.push(Buffer.from(`--${boundary}--${crlf}`));
  return {
    body: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function makeReq(body: Buffer, headers: Record<string, string>, method = 'POST'): InboundRequest {
  const req = new Readable({ read() {} });
  req.push(body);
  req.push(null);
  return Object.assign(req, { headers, method });
}

/** Mimic Cloud Functions v2: the stream is already consumed and the body lives on rawBody. */
function makeConsumedReq(body: Buffer, headers: Record<string, string>, method = 'POST'): InboundRequest {
  const req = new Readable({ read() {} });
  req.push(null);
  return Object.assign(req, { headers, method, rawBody: body });
}

function makeRes(): InboundResponse & { statusCode: number; body: string } {
  const res = { statusCode: 200, body: '' };
  return Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    send(body: string) {
      res.body = body;
      return this;
    },
  });
}

describe('inboundEmail handler', () => {
  it('persists the first inbound, stores the attachment, and sends one auto-reply', async () => {
    const store = freshStore();
    const replies: Array<Record<string, unknown>> = [];
    const signingKey = 'testkey';
    const ts = '1743513600';
    const token = 'tok123';
    const signature = createHmac('sha256', signingKey).update(ts + token).digest('hex');
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      to: 'Savetheday Support <support@savetheday.io>',
      recipient: 'support@savetheday.io',
      subject: 'Help with RSVP',
      'body-plain': 'Hi! Our wedding is 7/14.',
      'stripped-text': 'Hi! Our wedding is 7/14.',
      'Message-ID': '<abc@mail.example.com>',
      timestamp: ts,
      token,
      signature,
    }, [{
      fieldName: 'attachment',
      filename: 'venue.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 test'),
    }]);

    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async (domain, payload) => {
        replies.push({ domain, payload });
        return { id: '<stub@mailgun>' };
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(store.files).toHaveLength(1);
    expect(store.files[0].path.startsWith('messages/')).toBe(true);
    expect(store.messages).toHaveLength(1);
    expect((store.messages[0].attachments as Array<{ mimeType: string }>)[0].mimeType).toBe('application/pdf');
    expect(replies).toHaveLength(1);
    expect((replies[0].payload as { to: string[] }).to[0]).toMatch(/couple@example\.com/);
    const expectedThreadId = createHash('sha1').update('<abc@mail.example.com>').digest('hex').slice(0, 16);
    expect(Object.keys(store.threads)[0]).toBe(expectedThreadId);
  });

  it('routes a plus-address reply onto the existing thread and does not auto-reply', async () => {
    const store = freshStore();
    const seedId = 'abc123thread';
    store.threads[seedId] = { messageCount: 1, status: 'open' };
    const replies: unknown[] = [];
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      to: 'Savetheday Support <support+abc123thread@savetheday.io>',
      recipient: 'support+abc123thread@savetheday.io',
      subject: 'Re: Help with RSVP',
      'body-plain': 'Oh, one more thing...',
      'stripped-text': 'Oh, one more thing...',
      'Message-ID': '<reply@mail.example.com>',
    });
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => {
        replies.push(true);
        return {};
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].threadId).toBe(seedId);
    expect(store.threads[seedId].messageCount).toBe(2);
    expect(replies).toHaveLength(0);
  });

  it('reads a Cloud Functions-style request whose stream is already consumed', async () => {
    const store = freshStore();
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      to: 'Savetheday Support <support@savetheday.io>',
      recipient: 'support@savetheday.io',
      subject: 'Already consumed body',
      'body-plain': 'This should still be parsed.',
      'stripped-text': 'This should still be parsed.',
      'Message-ID': '<rawbody@mail.example.com>',
    });
    const res = makeRes();
    await handleInboundEmail(
      makeConsumedReq(body, headers),
      res,
      runtimeFrom(store, async () => ({})),
    );

    expect(res.statusCode).toBe(200);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].bodyPlain).toBe('This should still be parsed.');
  });

  it('returns 401 for a non-hex signature instead of throwing', async () => {
    const store = freshStore();
    const now = Date.now();
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      recipient: 'support@savetheday.io',
      subject: 'bad sig',
      'body-plain': 'nope',
      timestamp: String(Math.floor(now / 1000)),
      token: 'tok123',
      signature: 'z'.repeat(64),
    });
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => ({}), { devMode: false, now: () => now }),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('invalid signature');
    expect(store.messages).toHaveLength(0);
  });

  it('returns 401 for a stale but otherwise valid signature', async () => {
    const store = freshStore();
    const signingKey = 'testkey';
    const timestamp = '1000000000';
    const token = 'tok123';
    const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      recipient: 'support@savetheday.io',
      subject: 'replay',
      'body-plain': 'old',
      timestamp,
      token,
      signature,
    });
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => ({}), { devMode: false, signingKey, now: () => Date.now() }),
    );
    expect(res.statusCode).toBe(401);
    expect(store.messages).toHaveLength(0);
  });

  it('accepts a fresh signature when dev mode is off', async () => {
    const store = freshStore();
    const replies: unknown[] = [];
    const now = Date.now();
    const signingKey = 'testkey';
    const timestamp = String(Math.floor(now / 1000));
    const token = 'tok123';
    const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      recipient: 'support@savetheday.io',
      subject: 'fresh',
      'body-plain': 'hello',
      'Message-ID': '<fresh@mail.example.com>',
      timestamp,
      token,
      signature,
    });
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => {
        replies.push(true);
        return {};
      }, { devMode: false, signingKey, now: () => now }),
    );
    expect(res.statusCode).toBe(200);
    expect(replies).toHaveLength(1);
  });

  it('does not auto-reply when From and the envelope sender disagree', async () => {
    const store = freshStore();
    const replies: unknown[] = [];
    const { body, headers } = multipartBody({
      from: 'victim@example.com',
      sender: 'attacker@evil.test',
      recipient: 'support@savetheday.io',
      subject: 'spoofed',
      'body-plain': 'please reply to the victim',
      'Message-ID': '<spoof@mail.example.com>',
    });
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => {
        replies.push(true);
        return {};
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(store.messages).toHaveLength(1);
    expect(replies).toHaveLength(0);
  });

  it('rate-limits a second first-contact auto-reply to the same address', async () => {
    const store = freshStore();
    const replies: unknown[] = [];
    const runtime = runtimeFrom(store, async () => {
      replies.push(true);
      return {};
    });
    const send = async (messageId: string) => {
      const { body, headers } = multipartBody({
        from: 'couple@example.com',
        sender: 'couple@example.com',
        recipient: 'support@savetheday.io',
        subject: 'again',
        'body-plain': messageId,
        'Message-ID': messageId,
      });
      const res = makeRes();
      await handleInboundEmail(makeReq(body, headers), res, runtime);
      expect(res.statusCode).toBe(200);
    };
    await send('<one@mail.example.com>');
    await send('<two@mail.example.com>');
    expect(store.messages).toHaveLength(2);
    expect(replies).toHaveLength(1);
  });

  it('returns 413 when the attachment count exceeds the limit', async () => {
    const store = freshStore();
    const files = Array.from({ length: INBOUND_MAX_FILES + 1 }, (_, i) => ({
      fieldName: 'attachment',
      filename: `f${i}.txt`,
      mimeType: 'text/plain',
      content: Buffer.from('x'),
    }));
    const { body, headers } = multipartBody({
      from: 'couple@example.com',
      sender: 'couple@example.com',
      recipient: 'support@savetheday.io',
      subject: 'too many',
      'body-plain': 'files',
    }, files);
    const res = makeRes();
    await handleInboundEmail(
      makeReq(body, headers),
      res,
      runtimeFrom(store, async () => ({})),
    );
    expect(res.statusCode).toBe(413);
    expect(store.messages).toHaveLength(0);
    expect(store.files).toHaveLength(0);
  });
});
