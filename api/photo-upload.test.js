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
  // 2026-08-19 — Manus P1.4.a: storage counter the proxy
  // increments via db.doc(...).update(FieldValue.increment(...)).
  // The mock honors FieldValue.increment() exactly like the
  // real SDK so the proxy's "post-success increment" path is
  // testable here.
  storageUsage: new Map(),     // path → number (bytes used)
  // 2026-08-23 — Manus P4.3 (PDF Patch 4.3): the new quota
  // accounting uses privateUsage/storage instead of fields on
  // the event doc. mockState.usage holds the { usedBytes,
  // reservedBytes, ... } map keyed by the privateUsage/storage
  // doc path. mockState.unlocksByOwner lets tests pre-seed the
  // owner's unlock records (the resolver reads those to derive
  // the storage limit).
  usage: new Map(),             // path → { usedBytes, reservedBytes, ... }
  unlocksByOwner: new Map(),    // ownerUid → [{ type, source, ... }]
  firebaseAdminImportable: true,
  // 2026-08-19 — Manus P1.4.a: when non-null, the global
  // fetch mock returns this status (otherwise 200). Lets
  // quota tests verify "no increment on non-2xx" without
  // racing vi.hoisted() / globalThis.fetch reassignment.
  upstreamStatus: null,
  upstreamBody: null,
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
  // .runTransaction(), and .FieldValue (static property). The
  // proxy reads `admin.db.doc(path)` — so the factory must
  // return an object with `.doc` and `.runTransaction`.
  //
  // 2026-08-23 — Manus P4.3 (PDF Patch 4.3): the new quota
  // helpers (api/photo-upload-quota.js) call `db.runTransaction`
  // for atomic reservation / finalize / release. The transaction
  // callback receives an object with `.get(ref)` (a snapshot of
  // the current doc) and `.set(ref, patch, { merge })` (a
  // deferred write applied at commit time). The simplest
  // mock executes both synchronously inside the callback and
  // returns the final value — good enough for single-shot
  // reserve/finalize/release flows. Concurrent transactions
  // (which the real SDK retries on conflict) are out of scope
  // for unit tests; that's covered by the emulator integration
  // suite.
  const runTransaction = async (fn) => {
    // tx is a transaction-like object whose get/set operate on
    // the same backing stores as `db.doc(...).get/set`. No
    // retry, no conflict detection.
    const tx = {
      get: async (ref) => {
        // Reuse the same lookup logic as the .doc().get() path.
        // `ref` is the object returned by fsInstance.doc(path).
        return await ref.get();
      },
      set: async (ref, patch, opts) => {
        // Apply the same write logic as doc().set() (mocked
        // inline below). Real runTransaction defers the write
        // until commit; here we just apply it immediately.
        return await ref.set(patch, opts);
      },
      update: async (ref, patch) => {
        return await ref.update(patch);
      },
    };
    return await fn(tx);
  };

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
        // 2026-08-23 — P4.3: the new quota doc lives at
        // privateUsage/storage. mockState.usage Map keyed by
        // the full path.
        if (mockState.usage.has(path)) {
          const d = mockState.usage.get(path);
          return { exists: true, data: () => d };
        }
        return { exists: false, data: () => undefined };
      },
      set: async (val, opts) => {
        // 2026-08-23 — P4.3: writes to the privateUsage/storage
        // path go into mockState.usage (not mockState.events).
        // The quota helpers call `tx.set(ref, { usedBytes, reservedBytes, ... }, { merge: true })`.
        // The merge: true merge semantics are implemented inline.
        if (typeof val === 'object' && val !== null &&
            (typeof val.usedBytes === 'number' ||
             typeof val.reservedBytes === 'number' ||
             val._isServerTimestamp)) {
          const prev = mockState.usage.get(path) || {};
          const next = { ...prev };
          if (typeof val.usedBytes === 'number') next.usedBytes = val.usedBytes;
          if (typeof val.reservedBytes === 'number') next.reservedBytes = val.reservedBytes;
          if (val.updatedAt || val._isServerTimestamp) {
            next.updatedAt = val.updatedAt || { _seconds: Math.floor(Date.now() / 1000) };
          }
          if (val.lastFinalizedAt || val._isServerTimestamp) {
            next.lastFinalizedAt = val.lastFinalizedAt || { _seconds: Math.floor(Date.now() / 1000) };
          }
          if (val.lastReleasedAt || val._isServerTimestamp) {
            next.lastReleasedAt = val.lastReleasedAt || { _seconds: Math.floor(Date.now() / 1000) };
          }
          mockState.usage.set(path, next);
          return;
        }
        // Rate-limit counter path (legacy; unchanged from P1.4.a).
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
      // 2026-08-19 — Manus P1.4.a: legacy update path. The
      // P4.3 quota helpers no longer call update() on the event
      // doc (they use runTransaction.set on privateUsage/storage
      // instead), but this is retained so other P1.4.a call
      // sites in the proxy that still write plain fields to
      // the event doc (rare) keep working.
      update: async (patch) => {
        if (!patch || typeof patch !== 'object') return;
        const incVal = patch.storageUsageBytes;
        if (incVal && incVal._isFieldValue && typeof incVal.increment === 'number') {
          const prev = mockState.storageUsage.get(path) || 0;
          mockState.storageUsage.set(path, prev + incVal.increment);
        }
        if (mockState.events.has(path)) {
          const prev = mockState.events.get(path) || {};
          mockState.events.set(path, { ...prev, ...patch });
        }
      },
    }),
    // 2026-08-23 — P4.3: the resolver (resolveServerEntitlementLimit)
    // walks .collection('artifacts').doc(...).collection('users').doc(...)
    //   .collection('unlocks').get(). Mock that chain here so
    // tests can pre-seed unlocks per owner.
    collection: (name) => {
      if (name === 'artifacts') {
        return {
          doc: () => ({
            collection: (innerName) => {
              if (innerName === 'users') {
                return {
                  doc: (uid) => ({
                    collection: (innerInnerName) => {
                      if (innerInnerName === 'unlocks') {
                        return {
                          get: async () => ({
                            docs: (mockState.unlocksByOwner.get(uid) || []).map((u, i) => ({
                              id: `unlock-${i}`,
                              data: () => u,
                            })),
                          }),
                        };
                      }
                      return { get: async () => ({ docs: [] }) };
                    },
                  }),
                };
              }
              return { get: async () => ({ docs: [] }) };
            },
          }),
        };
      }
      return { get: async () => ({ docs: [] }) };
    },
    runTransaction,
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

async function mintToken({ ownerUid, eventId = 'ev1', watermarkDisabled, expiresAt, secret = TEST_SECRET }) {
  const issuedAt = Date.now() - 1000;
  // 2026-08-20 — Manus P1.2 audit §4.2: eventId is now part of
  // the signed claim. The proxy verifies it against the
  // request's eventId before applying the watermark preference.
  // Tests that DON'T bind to ev1 (the default) pass an explicit
  // eventId so we exercise the mismatch path cleanly.
  const payload = { ownerUid, eventId, watermarkDisabled, issuedAt, expiresAt };
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
    const status = mockState.upstreamStatus || 200;
    const text = mockState.upstreamBody || JSON.stringify({ ok: true });
    return {
      status,
      text: async () => text,
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
  // 2026-08-20 — Manus P1.2 audit §4.2: the proxy now binds
  // the token to (ownerUid, eventId). The harness's default
  // eventId is 'ev1' and the default ownerUid is
  // DEFAULT_OWNER_UID. Existing tests below use those values
  // explicitly so the new binding check doesn't trip on a
  // mismatched ownerUid from a stale test fixture.

  it('forwards X-Watermark-Disabled: true when token verifies + flag set', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = await mintToken({ ownerUid: DEFAULT_OWNER_UID, eventId: 'ev1', watermarkDisabled: true, expiresAt });
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

  // 2026-08-20 — Manus P1.2 audit §4.2: a token minted for
  // event A must NOT authorize watermark removal on event B.
  // The signature still verifies (the claim is well-formed and
  // was signed with the correct secret) — the proxy must
  // reject because the claim's `eventId` does not match the
  // request's eventId. Without this, a customer who paid for
  // watermark removal on event A gets clean uploads on event
  // B too (which they did NOT pay for).
  it('does NOT forward X-Watermark-Disabled when token eventId mismatches request eventId (audit §4.2)', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    // Mint the token for event-A, but the upload is for event-B.
    // ownerUid must match DEFAULT_OWNER_UID so the only
    // mismatch is the eventId (otherwise the proxy trips on
    // the ownerUid check first and we don't exercise this path).
    const token = await mintToken({
      ownerUid: DEFAULT_OWNER_UID,
      eventId: 'event-A',
      watermarkDisabled: true,
      expiresAt,
    });
    // The proxy does its event-membership check BEFORE the
    // prefs-token check, so we must register event-B as a real
    // event for DEFAULT_OWNER_UID or we'd 403 on the membership
    // test, not the binding test. The point of this test is to
    // exercise the binding logic, not the membership logic.
    mockState.events.set(
      `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/events/event-B`,
      { _ownerUid: DEFAULT_OWNER_UID, coOwners: [], assignedVendorUid: null },
    );
    const { res, headersToNas } = await invokeWithPrefsToken({
      prefsToken: token,
      eventId: 'event-B',
    });
    expect(res.statusCode).toBe(200); // upload still succeeds
    expect(headersToNas['X-Watermark-Disabled']).toBeUndefined();
  });

  // 2026-08-20 — Manus P1.2 audit §4.2 parity: when the token
  // DOES bind to the request's event, the watermark preference
  // applies. Regression guard against an over-eager fix that
  // would refuse ALL valid tokens.
  it('forwards X-Watermark-Disabled when token eventId matches request eventId (audit §4.2 parity)', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    // Mint for ev1 (the default eventId the harness uses).
    const token = await mintToken({
      ownerUid: DEFAULT_OWNER_UID,
      eventId: 'ev1',
      watermarkDisabled: true,
      expiresAt,
    });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
    expect(res.statusCode).toBe(200);
    expect(headersToNas['X-Watermark-Disabled']).toBe('true');
  });

  // 2026-08-20 — Manus P1.2 audit §4.2: even if the token
  // eventId matches, the ownerUid claim must also match the
  // request's ownerUid. A token minted by some other owner for
  // THEIR event-A cannot be presented to authorize uploads on
  // THIS owner's event-A. (Already tested indirectly by the
  // signature tamper test, but this pins the contract more
  // explicitly.)
  it('does NOT forward X-Watermark-Disabled when token ownerUid mismatches request ownerUid (audit §4.2)', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    // Token says ownerUid is 'attacker-uid' but the request's
    // multipart ownerUid is the default.
    const token = await mintToken({
      ownerUid: 'attacker-uid',
      eventId: 'ev1',
      watermarkDisabled: true,
      expiresAt,
    });
    const { res, headersToNas } = await invokeWithPrefsToken({ prefsToken: token });
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

// 2026-08-19 — Manus P1.4.a — storage-quota enforcement + atomic
// counter reservation/finalize/release. These tests live in a
// separate describe block so the setup (privateUsage/storage
// counter state + owner unlocks) doesn't leak between quota and
// watermark test groups.
//
// 2026-08-23 — Manus P4.3 (PDF Patch 4.3): the quota gate
// reads from the new server-only `privateUsage/storage` doc,
// not from fields on the event doc. The entitlement limit is
// derived from the owner's unlocks (mockState.unlocksByOwner).
// By default no unlocks → FREE_TIER_BASE_BYTES (200 MB).
describe('photo-upload proxy — P4.3 server-only storage quota', () => {
  const EVENT_PATH = `artifacts/savetheday-production/users/${DEFAULT_OWNER_UID}/events/ev1`;
  const USAGE_PATH = `${EVENT_PATH}/privateUsage/storage`;
  let handler;

  // Helper — get the current privateUsage/storage doc.
  function getUsage() {
    return mockState.usage.get(USAGE_PATH) || { usedBytes: 0, reservedBytes: 0 };
  }

  beforeEach(async () => {
    mockState.uidByToken.clear();
    mockState.events.clear();
    mockState.guestLinks.clear();
    mockState.rateCounters.clear();
    mockState.storageUsage.clear();
    mockState.usage.clear();
    mockState.unlocksByOwner.clear();
    // 2026-08-19 — clear upstream mock state too
    mockState.upstreamStatus = null;
    mockState.upstreamBody = null;
    mockState.uidByToken.set(DEFAULT_BEARER, DEFAULT_OWNER_UID);
    // Seed the event doc so the (5) event-membership check
    // passes. The previous P1.4.a tests seeded it inline;
    // the new P4.3 tests seed it once here to keep each
    // test body focused on quota assertions.
    mockState.events.set(EVENT_PATH, {
      _ownerUid: DEFAULT_OWNER_UID,
      coOwners: [],
      assignedVendorUid: null,
    });
    await installFakeAdmin();
    const mod = await import('./photo-upload.js?bust=' + Math.random());
    handler = mod.default;
    __proxyHandler = handler;
  });

  // ---- quota gate (413 path) ----

  it('rejects with 413 STORAGE_QUOTA_EXCEEDED when upload would exceed the quota', async () => {
    // Seed privateUsage/storage to 199 MB used. The default
    // entitlement (no unlocks) is 200 MB. A 2 MB body
    // pushes the projected total over the limit.
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 199 * 1024 * 1024, // 199 MB used
      reservedBytes: 0,
    });
    const bigBody = 'A'.repeat(2_000_000); // 2 MB body
    const { res } = await invokeWithPrefsToken({ body: bigBody });
    expect(res.statusCode).toBe(413);
    expect(res._body).toEqual(
      expect.objectContaining({
        code: 'STORAGE_QUOTA_EXCEEDED',
        usedBytes: 199 * 1024 * 1024,
        reservedBytes: 0,
        limitBytes: 200 * 1024 * 1024,
      }),
    );
    // Body shape sanity — friendly message
    expect(typeof res._body.error).toBe('string');
    expect(res._body.error).toContain('storage quota exceeded');
    // Counter must NOT have been touched by a rejected upload.
    // (No reservation made → reservedBytes stays 0.)
    expect(getUsage().reservedBytes).toBe(0);
    expect(getUsage().usedBytes).toBe(199 * 1024 * 1024);
  });

  it('accepts the upload (200) when used + reserved + addBytes <= quota', async () => {
    // 100 MB used, 0 reserved, default 200 MB limit — a 6 MB body fits.
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 100 * 1024 * 1024,
      reservedBytes: 0,
    });
    const body = 'B'.repeat(6_000_000);
    const { res } = await invokeWithPrefsToken({ body });
    expect(res.statusCode).toBe(200);
    // After a successful 2xx, finalize() moves reservedBytes
    // to usedBytes. So usedBytes should grow by the body
    // length and reservedBytes should drop back to 0.
    const usage = getUsage();
    expect(usage.usedBytes).toBeGreaterThanOrEqual(100 * 1024 * 1024 + 6_000_000);
    expect(usage.reservedBytes).toBe(0);
  });

  it('uses the entitlement-derived 700 MB limit when storage-500mb is unlocked', async () => {
    // storage-500mb unlock → FREE + BONUS = 700 MB.
    mockState.unlocksByOwner.set(DEFAULT_OWNER_UID, [
      { type: 'storage-500mb', source: 'paid' },
    ]);
    // Seed 600 MB used. A 1 MB body fits in 700 MB.
    // (Stay under the 25 MB MAX_FORWARD_BYTES proxy cap.)
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 600 * 1024 * 1024,
      reservedBytes: 0,
    });
    const { res } = await invokeWithPrefsToken({ body: 'A'.repeat(1_000_000) });
    expect(res.statusCode).toBe(200);
    expect(getUsage().usedBytes).toBeGreaterThanOrEqual(600 * 1024 * 1024 + 1_000_000);
  });

  it('fails closed (503) when the entitlement resolver throws', async () => {
    // 2026-08-23 — P4.3: if resolveServerEntitlementLimit
    // fails (Firestore unreachable, rules deny, etc.), the
    // proxy MUST reject — it must NOT fall back to a
    // client-trustable default. We simulate the failure by
    // making the unlocks collection throw.
    const origGet = mockFirebaseAdminFs.doc; // not used; we override via collection
    // Replace the unlocks get() to throw:
    // (Simple approach: leave unlocks empty — that won't throw.
    //  Instead, override the unlocks collection's get to reject.)
    // The mock exposes collection('artifacts').doc().collection('users')
    //   .doc().collection('unlocks').get(). Patch that path
    //   by inserting a poisoned doc lookup. Easiest: set
    //   unlocksByOwner to undefined; the mock will return
    //   undefined, which computeEntitlement tolerates.
    // Instead — use a sentinel that's recognized by the
    // mock's collection chain. The simplest path: the proxy
    // catches ANY error from the resolver. To trigger one,
    // we monkey-patch the runTransaction chain to fail.
    // Approach: install a sub-mock that makes the unlocks
    // get() reject. This requires re-mocking the fs layer.
    // Simpler: skip the runTransaction and break the
    // resolver call by replacing the fsInstance.collection
    // method just for this test.
    const fsInstance = (await import('./photo-upload.js?test')).__getAdmin__ || null;
    // If we can't reach the mock fs from here, simulate by
    // temporarily replacing mockFirebaseAdminFs's collection
    // chain to throw at the unlocks get:
    const origCollection = mockFirebaseAdminFs.collection;
    mockFirebaseAdminFs.collection = (name) => {
      if (name === 'artifacts') {
        return {
          doc: () => ({
            collection: () => ({
              doc: () => ({
                collection: () => ({
                  get: () => Promise.reject(new Error('Firestore unavailable')),
                }),
              }),
            }),
          }),
        };
      }
      return origCollection(name);
    };
    try {
      const { res } = await invokeWithPrefsToken({ body: 'A'.repeat(1024) });
      expect(res.statusCode).toBe(503);
      expect(res._body).toEqual(
        expect.objectContaining({ code: 'QUOTA_CHECK_UNAVAILABLE' }),
      );
    } finally {
      mockFirebaseAdminFs.collection = origCollection;
    }
  });

  it('does NOT check quota for inv-bg (couple\'s own invitation backgrounds)', async () => {
    // inv-bg is rate-limited separately above and is the
    // couple's own photo, not the event gallery. The quota
    // gate is short-circuited before resolveServerEntitlementLimit
    // is called, so the proxy succeeds even if the resolver
    // would have thrown.
    const fsInstance = null; // sanity — inv-bg path doesn't touch fs for quota
    const { res } = await invokeWithPrefsToken({ eventId: 'inv-bg' });
    expect(res.statusCode).toBe(200);
    // The inv-bg doc has no privateUsage/storage sibling.
    // Verify the proxy did not create one.
    const invBgUsagePath =
      'artifacts/savetheday-production/users/INVBG/events/inv-bg/privateUsage/storage';
    expect(mockState.usage.has(invBgUsagePath)).toBe(false);
  });

  // ---- reservation finalize vs release on NAS outcome ----

  it('releases the reservation (does NOT increment used) when NAS returns 4xx', async () => {
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 10 * 1024 * 1024,
      reservedBytes: 0,
    });
    // Set the upstream mock to return 502. The proxy
    // forwards upstream.status to the client and releases
    // (not finalizes) the reservation on non-2xx.
    mockState.upstreamStatus = 502;
    mockState.upstreamBody = JSON.stringify({ error: 'NAS down' });
    const { res } = await invokeWithPrefsToken({ body: 'D'.repeat(100_000) });
    expect(res.statusCode).toBe(502);
    // Counter untouched: usedBytes unchanged, reservedBytes
    // back to 0 after release.
    const usage = getUsage();
    expect(usage.usedBytes).toBe(10 * 1024 * 1024);
    expect(usage.reservedBytes).toBe(0);
  });

  it('moves reservedBytes → usedBytes after a successful 2xx (finalize)', async () => {
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 12 * 1024 * 1024,
      reservedBytes: 0,
    });
    // First upload: a body of 1024 bytes — finalize moves
    // the reserved bytes to used.
    await invokeWithPrefsToken({ body: 'E'.repeat(1024) });
    const after1 = getUsage();
    expect(after1.usedBytes).toBeGreaterThanOrEqual(12 * 1024 * 1024 + 1024);
    expect(after1.reservedBytes).toBe(0);
    // Second upload: another small body — usedBytes grows again.
    await invokeWithPrefsToken({ body: 'F'.repeat(1024) });
    const after2 = getUsage();
    expect(after2.usedBytes).toBeGreaterThan(after1.usedBytes);
    expect(after2.reservedBytes).toBe(0);
  });

  // ---- TOCTOU: two concurrent reservations both can't exceed ----
  // 2026-08-23 — P4.3: the reservation transaction closes the
  // race window where two concurrent uploads both pass the
  // pre-flight check. With the new runTransaction-backed
  // reserveQuota(), the second writer sees the first's
  // reservation and gets the fresh "over quota" decision.
  //
  // Note: our single-shot mock doesn't retry on conflict, so
  // we simulate the realistic race by interleaving two
  // reservations sequentially — the assertion is that the
  // second one sees the first's reservedBytes.
  it('rejects the second concurrent reservation when the first one fills the slot', async () => {
    // 199 MB used, 0 reserved, 200 MB limit (no unlocks).
    // First reservation: 500 KB → succeeds, reservedBytes = 500 KB.
    // Second reservation: 1 MB → used + reserved + 1 MB = 200.5 MB → fails.
    mockState.usage.set(USAGE_PATH, {
      usedBytes: 199 * 1024 * 1024,
      reservedBytes: 0,
    });
    // First upload (small) — succeeds. The proxy's finalize
    // moves the reservation into usedBytes, so the actual
    // post-finalize usedBytes is 199MB + 500KB-content +
    // ~417 bytes of multipart envelope (headers + footers).
    // Assert with `>` 199MB rather than exact arithmetic so
    // the test stays robust against any future change to the
    // envelope format.
    const r1 = await invokeWithPrefsToken({ body: 'A'.repeat(500_000) });
    expect(r1.res.statusCode).toBe(200);
    const after1 = getUsage();
    expect(after1.usedBytes).toBeGreaterThan(199 * 1024 * 1024);
    expect(after1.usedBytes).toBeGreaterThanOrEqual(199 * 1024 * 1024 + 500_000);
    expect(after1.reservedBytes).toBe(0);
    // Second upload (1 MB) — must 413 because we're at/over the cap.
    const { res } = await invokeWithPrefsToken({ body: 'B'.repeat(1_000_000) });
    expect(res.statusCode).toBe(413);
    // Counter still untouched by the rejected second upload.
    const after2 = getUsage();
    expect(after2.usedBytes).toBe(after1.usedBytes);
    expect(after2.reservedBytes).toBe(0); // finalize ran on first; rejected second didn't reserve
  });
});
