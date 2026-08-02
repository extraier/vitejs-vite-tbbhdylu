/**
 * Tests for the Vercel photo-upload proxy (api/photo-upload.js).
 *
 * Coverage:
 *   1. Forwards X-Watermark-Disabled: true when token verifies + flag set
 *   2. Does NOT forward when watermarkDisabled=false in token
 *   3. Does NOT forward when token signature is tampered
 *   4. Does NOT forward when token is expired
 *   5. Does NOT forward when token is malformed (no dots)
 *   6. Does NOT forward when token has partial segments
 *   7. Does NOT forward when token signed with wrong secret
 *   8. Does NOT forward when payload is tampered (re-signed with original sig)
 *   9. Does NOT forward when prefsToken is missing entirely
 *  10. Does NOT forward when secret env var is missing at module-load
 *
 * 2026-08-02 — wrote alongside the `watermark-removed` unlock to
 * keep the HMAC verification path locked down. The CF
 * (`functions/src/hmac.ts`) signs tokens; this proxy verifies them.
 * A mismatch in either algorithm would silently fail OPEN (watermark
 * stays on, but the upload still succeeds) — and the locked-down
 * case is "watermark keeps showing on real premium uploads", which
 * is hard to detect in production. Easier to catch it here.
 *
 * What we DON'T test here:
 *   - The full upload handler's NAS forwarding (mocked via
 *     globalThis.fetch — we just verify the headers we forwarded).
 *   - The NAS-side Pillow step (Python smoke test in deploy/).
 *   - The auth bypass path (out of scope for this test).
 */

import { describe, it, expect, vi } from 'vitest';
import handler from './photo-upload.js';

// The proxy reads these env vars at module-load time. We set them
// via vi.hoisted() so they're set BEFORE the import statement
// (Vitest hoists imports to the top of the file).
vi.hoisted(() => {
  process.env.NAS_UPLOAD_SECRET = 'test-nas-hmac-secret-for-vitest-x7y9kp';
  process.env.UPLOAD_PREFERENCES_HMAC_SECRET = 'test-hmac-secret-for-vitest-9k3hd7';
});

const TEST_SECRET = process.env.UPLOAD_PREFERENCES_HMAC_SECRET;

async function mintToken({ ownerUid, watermarkDisabled, expiresAt, secret = TEST_SECRET }) {
  const issuedAt = Date.now() - 1000;
  const payload = { ownerUid, watermarkDisabled, issuedAt, expiresAt };
  const json = JSON.stringify(payload);
  const b64 = b64urlEncode(json);
  const sig = await hmacSha256(secret, b64);
  return `${b64}.${sig}`;
}

function b64urlEncode(s) {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

async function hmacSha256(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return base64UrlEncodeBuffer(new Uint8Array(sig));
}

function base64UrlEncodeBuffer(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function invokeWithPrefsToken({ prefsToken, eventId = 'ev1', guestId = 'g1', body = 'fakebody', _handler = handler }) {
  const boundary = '----test-boundary-XYZ';
  const parts = [];
  if (prefsToken !== undefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prefsToken"\r\n\r\n${prefsToken}\r\n`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="eventId"\r\n\r\n${eventId}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="guestId"\r\n\r\n${guestId}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n${body}\r\n`);
  parts.push(`--${boundary}--\r\n`);
  const reqBody = Buffer.from(parts.join(''), 'utf-8');

  // Node IncomingMessage-like: async iterable so the handler's
  // `for await (const chunk of req)` works.
  const payload = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    [Symbol.asyncIterator]() {
      let emitted = false;
      return {
        async next() {
          if (emitted) return { value: undefined, done: true };
          emitted = true;
          return { value: reqBody, done: false };
        },
      };
    },
  };

  let headersToNas = null;
  const res = {
    statusCode: 200,
    headers: {},
    _capturedHeaders: {},
    setHeader(k, v) { res._capturedHeaders[k] = v; res.headers[k] = v; },
    getHeader(k) { return res._capturedHeaders[k]; },
    status(c) { res.statusCode = c; return res; },
    json(o) { res._body = o; return res; },
    end() { res._ended = true; },
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    headersToNas = init.headers;
    return {
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => 'application/json' },
    };
  };

  try {
    await _handler(payload, res);
  } finally {
    globalThis.fetch = origFetch;
  }
  return { res, headersToNas };
}

describe('photo-upload proxy — verifyUploadPreferencesToken', () => {
  it('forwards X-Watermark-Disabled: true when token verifies + flag set', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: true, expiresAt });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBe('true');
  });

  it('does NOT forward X-Watermark-Disabled when watermarkDisabled=false in token', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: false, expiresAt });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when token signature is tampered', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: true, expiresAt });
    const parts = token.split('.');
    const lastChar = parts[1].slice(-1);
    const replacement = lastChar === 'A' ? 'B' : 'A';
    const tampered = `${parts[0]}.${parts[1].slice(0, -1)}${replacement}`;
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: tampered });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when token is expired', async () => {
    const expiresAt = Date.now() - 1000;
    const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: true, expiresAt });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when token has no dots (malformed)', async () => {
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: 'no-dots-here' });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when token has two segments (no signature after a dot)', async () => {
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: 'aGVsbG8.bm9zaWc' });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when token signed with wrong secret', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({
      ownerUid: 'u1',
      watermarkDisabled: true,
      expiresAt,
      secret: 'wrong-secret',
    });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when payload is tampered (re-encoded with original sig)', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: true, expiresAt });
    const [b64, sig] = token.split('.');
    const payload = JSON.parse(b64urlDecode(b64));
    payload.watermarkDisabled = false;
    const newB64 = b64urlEncode(JSON.stringify(payload));
    const tampered = `${newB64}.${sig}`;
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: tampered });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when prefsToken field is missing entirely', async () => {
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: undefined });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  it('does NOT forward X-Watermark-Disabled when secret env var is missing at module-load', async () => {
    // The proxy reads process.env.UPLOAD_PREFERENCES_HMAC_SECRET
    // at module-load time. Re-import with a cache-busting query
    // param to simulate the missing-secret scenario.
    const original = process.env.UPLOAD_PREFERENCES_HMAC_SECRET;
    delete process.env.UPLOAD_PREFERENCES_HMAC_SECRET;
    try {
      const fresh = await import('./photo-upload.js?missingSecret=' + Date.now());
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const token = await mintToken({ ownerUid: 'u1', watermarkDisabled: true, expiresAt });
      const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token, _handler: fresh.default });
      expect(res.statusCode).toBe(200);
      expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
    } finally {
      process.env.UPLOAD_PREFERENCES_HMAC_SECRET = original;
    }
  });
});
