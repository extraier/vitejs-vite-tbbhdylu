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
 * 2026-08-13 — H-01 added. Every existing test now needs:
 *   - `ownerUid` in the multipart (new required field).
 *   - `Authorization: Bearer <fake>` header (proxy now verifyIdTokens).
 *   - A mocked __getAdmin__ stub via vi.mock so the handler can
 *     decode the fake token + look up a fake event doc. We stub
 *     the firebase-admin layer at the __getAdmin__ boundary — no
 *     real Firebase calls in unit tests.
 *
 * What we DON'T test here:
 *   - The full upload handler's NAS forwarding (mocked via
 *     globalThis.fetch — we just verify the headers we forwarded).
 *   - The NAS-side Pillow step (Python smoke test in deploy/).
 *   - End-to-end auth — covered by live curl probes against Vercel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock firebase-admin via vi.mock ----
// We stub the __getAdmin__ export so tests can control what
// verifyIdToken returns + what the event-doc lookup returns.
// Mocked module shape:
//   export async function __getAdmin__() { return { auth, db }; }
// where auth.verifyIdToken(token) returns { uid } or throws,
// and db.doc(path).get() returns { exists, data() }.
const mockState = {
  uidByToken: new Map(),       // token → uid (or absent → throws)
  events: new Map(),           // path → { exists, data }
  guestLinks: new Map(),       // path → { exists, data }
  rateCounters: new Map(),     // path → count
  firebaseAdminImportable: true,
};

vi.mock('./photo-upload.js', async (importOriginal) => {
  // We don't actually mock the proxy module — we just expose a
  // way for the test to set up the mock state and then re-import
  // the proxy. The "trick" is that the proxy itself doesn't
  // import firebase-admin until __getAdmin__() is called, so we
  // can intercept by replacing the dynamic import via vi.doMock.
  return await importOriginal();
});

// Helper to install a fake firebase-admin before each test.
async function installFakeAdmin() {
  // Reset module-level cache so __getAdmin__ picks up the new
  // firebase-admin replacement.
  vi.resetModules();
  // Stub the dynamic import of firebase-admin inside __getAdmin__.
  // 2026-08-13 — H-01: vi.hoisted() runs before vi.doMock. Each
// constant must be defined as its own hoisted block because
// vi.hoisted() doesn't run the closures lazily.
const mockFieldValue = vi.hoisted(() => ({
  increment: (n) => ({ increment: n, _isFieldValue: true }),
  serverTimestamp: () => ({ _isServerTimestamp: true }),
}));

const mockFirebaseAdminAuth = vi.hoisted(() => ({
  verifyIdToken: async (token) => {
    console.log('[mock-verify]', { token, size: mockState.uidByToken.size, keys: Array.from(mockState.uidByToken.keys()) });
    if (mockState.uidByToken.has(token)) {
      return { uid: mockState.uidByToken.get(token) };
    }
    const err = new Error('auth/argument-error: invalid token');
    err.code = 'auth/argument-error';
    throw err;
  },
}));

const mockFirebaseAdminFs = vi.hoisted(() => {
  // 2026-08-13 — H-01: in real firebase-admin, `firestore(app)` returns
  // a Firestore *instance* with methods like .doc(), .collection(),
  // and .FieldValue (static property). The proxy reads
  // `admin.db.doc(path)` — so the factory must return an object
  // with `.doc`. FieldValue is hung off the returned object too.
  const fsInstance = {
    doc: (path) => ({
      get: async () => {
        if (mockState.events.has(path)) {
          const d = mockState.events.get(path);
          return { exists: true, data: () => d };
        }
        if (mockState.guestLinks.has(path)) {
          const d = mockState.guestLinks.get(path);
          return { exists: true, data: () => d };
        }
        if (mockState.rateCounters.has(path)) {
          return { exists: true, data: () => ({ count: mockState.rateCounters.get(path) }) };
        }
        return { exists: false, data: () => undefined };
      },
      set: async (val, opts) => {
        const prev = mockState.rateCounters.get(path) || 0;
        let inc;
        if (val && val.count && val.count._isFieldValue && typeof val.count.increment === 'number') {
          inc = val.count.increment;
        } else if (typeof val?.count === 'number') {
          inc = val.count;
        } else {
          inc = 0;
        }
        mockState.rateCounters.set(path, prev + inc);
      },
    }),
    FieldValue: mockFieldValue,
  };
  return fsInstance;
});

const mockFirebaseAdmin = vi.hoisted(() => {
  // 2026-08-13 — H-01: tests mock the three sub-modules
  // (firebase-admin/app, /auth, /firestore), not the top-level
  // package. The shape here is the "logical admin" view used by
  // the mock factory wrapper below.
  return {
    apps: [],
    getApps: () => [],
    initializeApp: () => {},
    cert: () => ({}),
    applicationDefault: () => ({}),
    auth: () => mockFirebaseAdminAuth,
    firestore: () => mockFirebaseAdminFs,
    FieldValue: mockFieldValue,
    initializeAppCalls: 0,
    certCalls: 0,
  };
});

vi.doMock('firebase-admin/app', () => ({
  initializeApp: (...args) => mockFirebaseAdmin.initializeApp(...args),
  getApps: () => mockFirebaseAdmin.getApps(),
  cert: (...args) => mockFirebaseAdmin.cert(...args),
  applicationDefault: (...args) => mockFirebaseAdmin.applicationDefault(...args),
}));

vi.doMock('firebase-admin/auth', () => ({
  getAuth: (app) => mockFirebaseAdminAuth,
}));

vi.doMock('firebase-admin/firestore', () => ({
  getFirestore: (app) => mockFirebaseAdminFs,
  FieldValue: mockFieldValue,
}));
}

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

// 2026-08-13 — H-01 defaults. Tests should use a stable owner uid
// + a fake ID token that the mock verifies to that uid. The mock
// looks up tokens in mockState.uidByToken, so callers can either
// pass `bearerToken` explicitly or use this default.
const DEFAULT_OWNER_UID = 'fakeOwnerUid00000000000000000000';
const DEFAULT_BEARER = 'fake-bearer-token-for-vitest';
// 2026-08-13 — H-01: the proxy module is re-imported by beforeEach
// after vi.doMock('firebase-admin', ...). Store it here so
// invokeWithPrefsToken picks it up without each caller having to
// pass it explicitly. The "missing secret" test overrides by
// passing _handler directly.
let __proxyHandler = null;
async function invokeWithPrefsToken({ prefsToken, eventId = 'ev1', guestId = 'g1', ownerUid = DEFAULT_OWNER_UID, bearerToken = DEFAULT_BEARER, body = 'fakebody', _handler }) {
  const handler = _handler || __proxyHandler;
  if (!handler) {
    throw new Error('invokeWithPrefsToken: no _handler and __proxyHandler is null — beforeEach not run?');
  }
  const boundary = '----test-boundary-XYZ';
  const parts = [];
  if (prefsToken !== undefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prefsToken"\r\n\r\n${prefsToken}\r\n`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="eventId"\r\n\r\n${eventId}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="guestId"\r\n\r\n${guestId}\r\n`);
  // 2026-08-13 — H-01: ownerUid is now required.
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="ownerUid"\r\n\r\n${ownerUid}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n${body}\r\n`);
  parts.push(`--${boundary}--\r\n`);
  const reqBody = Buffer.from(parts.join(''), 'utf-8');

  // Node IncomingMessage-like: async iterable so the handler's
  // `for await (const chunk of req)` works.
  const payload = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      // 2026-08-13 — H-01: Authorization Bearer is required.
      'authorization': `Bearer ${bearerToken}`,
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
    await handler(payload, res);
  } finally {
    globalThis.fetch = origFetch;
  }
  return { res, headersToNas };
}

describe('photo-upload proxy — verifyUploadPreferencesToken', () => {
  let handler;
  beforeEach(async () => {
    // Reset mocks between tests so each one starts clean.
    mockState.uidByToken.clear();
    mockState.events.clear();
    mockState.guestLinks.clear();
    mockState.rateCounters.clear();
    // Default: the DEFAULT_BEARER token verifies to the DEFAULT_OWNER_UID.
    mockState.uidByToken.set(DEFAULT_BEARER, DEFAULT_OWNER_UID);
    // Default: the event doc exists with the DEFAULT_OWNER_UID as owner.
    mockState.events.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/events/ev1`,
      { _ownerUid: DEFAULT_OWNER_UID, coOwners: [], assignedVendorUid: null },
    );
    await installFakeAdmin();
    // Re-import the proxy module so __getAdmin__ picks up the
    // mocked firebase-admin.
    const mod = await import('./photo-upload.js?bust=' + Math.random());
    handler = mod.default;
    __proxyHandler = handler;
  });

  // ---- H-01 auth tests (2026-08-13) ----

  it('rejects with 401 when Authorization header is missing', async () => {
    // Build a custom request without the Bearer header.
    const boundary = '----test-boundary-XYZ';
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="eventId"\r\n\r\nev1\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="guestId"\r\n\r\ng1\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerUid"\r\n\r\n${DEFAULT_OWNER_UID}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nx\r\n`,
      `--${boundary}--\r\n`,
    ];
    const reqBody = Buffer.from(parts.join(''), 'utf-8');
    const req = {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      [Symbol.asyncIterator]() {
        let emitted = false;
        return { async next() { if (emitted) return { value: undefined, done: true }; emitted = true; return { value: reqBody, done: false }; } };
      },
    };
    let captured;
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { captured = c; return this; },
      json(o) { this._body = o; return this; },
    };
    await handler(req, res);
    expect(captured).toBe(401);
    expect(res._body.error).toMatch(/missing Authorization/);
  });

  it('rejects with 401 when Firebase ID token is invalid', async () => {
    const { res } = await invokeWithPrefsToken({
      prefsToken: undefined,
      bearerToken: 'totally-not-a-real-token',
    });
    expect(res.statusCode).toBe(401);
    expect(res._body.error).toMatch(/invalid or expired/);
  });

  it('rejects with 403 when caller is not a member of the event', async () => {
    // Set up the default event for one owner, then call with a
    // token that verifies to a DIFFERENT uid.
    const otherUid = 'otherUid99999999999999999999';
    mockState.uidByToken.set('token-other', otherUid);
    const { res } = await invokeWithPrefsToken({
      prefsToken: undefined,
      bearerToken: 'token-other',
    });
    expect(res.statusCode).toBe(403);
    expect(res._body.error).toMatch(/not a member/);
  });

  it('accepts a caller who is in the event coOwners array', async () => {
    const coOwner = 'coOwner99999999999999999999';
    mockState.uidByToken.set('token-coowner', coOwner);
    // Add co-owner to the event.
    mockState.events.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/events/ev1`,
      { _ownerUid: DEFAULT_OWNER_UID, coOwners: [coOwner], assignedVendorUid: null },
    );
    const { res } = await invokeWithPrefsToken({
      prefsToken: undefined,
      bearerToken: 'token-coowner',
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a guest caller with a non-expired guestLinks doc', async () => {
    const guestUid = 'guestUid00000000000000000000';
    mockState.uidByToken.set('token-guest', guestUid);
    // guestLinks/{guestUid} exists with expiresAt in the future.
    const futureExpires = Date.now() + 24 * 60 * 60 * 1000;
    mockState.guestLinks.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/guestLinks/${guestUid}`,
      { expiresAt: { toMillis: () => futureExpires } },
    );
    const { res } = await invokeWithPrefsToken({
      prefsToken: undefined,
      bearerToken: 'token-guest',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a guest caller whose guestLinks doc is expired', async () => {
    const guestUid = 'expiredGuest0000000000000000000';
    mockState.uidByToken.set('token-expired', guestUid);
    const pastExpires = Date.now() - 24 * 60 * 60 * 1000;
    mockState.guestLinks.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/guestLinks/${guestUid}`,
      { expiresAt: { toMillis: () => pastExpires } },
    );
    const { res } = await invokeWithPrefsToken({
      prefsToken: undefined,
      bearerToken: 'token-expired',
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 429 when event exceeds daily rate limit', async () => {
    // Pre-populate the rate counter to the cap so the next
    // increment trips the limit.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    mockState.rateCounters.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/events/ev1/uploadRateLimit/${today}`,
      200, // already at cap
    );
    const { res } = await invokeWithPrefsToken({ prefsToken: undefined });
    expect(res.statusCode).toBe(429);
    expect(res._body.error).toMatch(/exceeded/);
  });

  // ---- Existing prefsToken tests (now with auth) ----

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
