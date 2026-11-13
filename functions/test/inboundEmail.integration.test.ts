import { createHash, createHmac } from 'crypto';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { handleInboundEmail, type InboundRequest, type InboundResponse, type InboundRuntime } from '../src/inboundEmail';

interface Store {
  messages: Array<Record<string, unknown>>;
  threads: Record<string, Record<string, unknown>>;
  files: Array<{ path: string; size: number }>;
}

function freshStore(): Store {
  return { messages: [], threads: {}, files: [] };
}

function runtimeFrom(store: Store, sendMessage: InboundRuntime['sendMessage']): InboundRuntime {
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
});
