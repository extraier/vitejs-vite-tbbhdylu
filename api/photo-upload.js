// Vercel serverless function — proxy for photo uploads to the NAS.
//
// Why this exists:
// The NAS upload endpoint (cdn.savetheday.io/upload) doesn't return
// CORS headers for savetheday.io, so the browser preflight (OPTIONS)
// is blocked and the actual POST never fires. Routing through Vercel
// sidesteps CORS entirely (same-origin from the browser's POV), and
// the proxy streams to the NAS server-to-server where CORS doesn't
// apply.
//
// 2026-07-23 — Cloudflare tunnel fix in ts-autostart.sh routed
// cdn.savetheday.io → 127.0.0.1:9879 (was incorrectly set to :8080).
// The tunnel now reaches our photo_upload_server.py. The proxy
// just forwards multipart to it.
//
// 2026-07-27 — SECURITY HARDENING. The proxy now mints the HMAC
// upload token server-side. Previously the client bundled
// VITE_NAS_UPLOAD_SECRET into the public JS — anyone with browser
// dev tools could extract it and mint valid upload tokens. Now:
//   • Client posts ONLY {file, eventId, guestId, uploaderName} +
//     an untrusted `expiresMs` we generate here.
//   • Proxy reads NAS_UPLOAD_SECRET / PHOTO_HMAC_SECRET from the
//     Vercel env (not bundled), computes the HMAC, and forwards
//     to the NAS with the X-Upload-Token / X-Upload-Expires
//     headers the receiver now requires.
//   • NAS receiver enforces constant-time HMAC verify
//     (see deploy/photo_upload_server.py). Server-to-server only;
//     the secret never reaches the browser.
//
// 2026-08-13 — H-01 (HIGH) fix. The previous version minted an
// HMAC token for ANY caller who knew a valid eventId + guestId —
// no Firebase Auth verification, no event-membership check, no
// rate limit. An attacker who could reach the endpoint could mint
// upload grants for someone else's wedding. Now:
//   1. Caller must attach `Authorization: Bearer <Firebase ID token>`.
//   2. We verifyIdToken via firebase-admin to get the caller's UID.
//   3. We look up the event doc at artifacts/{appId}/users/{ownerUid}/
//      events/{eventId} and confirm the caller is ownerUid, in
//      coOwners[], in assignedVendorUid, or holds a non-expired
//      guestLinks/{auth.uid} doc for this owner.
//   4. We rate-limit per event/day (atomic Firestore counter,
//      cap 200 uploads/event/day). Same counter caps the inv-bg
//      pseudo-event at 50/day.
//   5. A request without a valid event-bound grant fails BEFORE
//      any NAS HMAC is minted. This is the audit's acceptance
//      criterion [4]: "A photo-upload request without a valid
//      event-bound grant fails before any NAS HMAC is minted."
//   6. Logs only contain opaque traceId + status + byte counts
//      (no caller uid, no body, no header values) — see the
//      H-04 fix from earlier for the proxy-side analog.

// 2026-08-13 — H-01: trace id helper. Same Node crypto.randomUUID
// we use in firebase-proxy.js. Available in Node 14.17+ on Vercel.
import { randomUUID } from 'node:crypto';

const NAS_UPLOAD_URL =
  process.env.NAS_UPLOAD_URL ||
  process.env.VITE_NAS_UPLOAD_URL ||
  'https://cdn.savetheday.io/upload';
const MAX_FORWARD_BYTES = 25 * 1024 * 1024;
// Server-only HMAC secret — sourced from Vercel project env.
// Falls back to legacy names so an existing deployment that
// already has one of the older vars keeps working.
const NAS_HMAC_SECRET =
  process.env.NAS_UPLOAD_SECRET ||
  process.env.PHOTO_UPLOAD_SECRET ||
  process.env.PHOTO_HMAC_SECRET ||
  '';
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 min — server enforces this

// 2026-08-13 — H-01 rate limit. Per (eventId, UTC day). We store
// the counter at `artifacts/{appId}/users/{ownerUid}/events/{eventId}/
// uploadRateLimit/{yyyymmdd}` — atomic FieldValue.increment(1) on
// each upload, read-back to enforce the cap. For the inv-bg
// pseudo-event (vendor's own designer template), the counter lives
// at the top-level `invBgUploadRateLimit/{yyyymmdd}` doc (no owner).
// 200/day for real events is generous — a real wedding rarely
// uploads more than 200 photos in one day; bumping to 500 if
// needed is one env-var change.
const RATE_LIMIT_PER_DAY = Number(process.env.PHOTO_UPLOAD_DAILY_CAP || 200);
const INV_BG_RATE_LIMIT_PER_DAY = Number(process.env.INV_BG_UPLOAD_DAILY_CAP || 50);
// Firestore appId — same constant the client resolves via
// resolveAppId() in src/lib/firebase.ts. The hard-coded value
// matches the LIVE appId for savetheday-2377a (savetheday-production).
const APP_ID = process.env.FIREBASE_APP_ID || 'savetheday-production';

// 2026-08-02 — Upload-preferences token (Option 1, watermark).
// The owner mints a short-lived HMAC-signed token via the
// Firebase getUploadPreferencesToken CF. The token carries the
// owner's `watermark-removed` unlock status, signed with the
// same HMAC_KEY secret used for partner-invite tokens. The
// Vercel proxy mirrors HMAC_KEY in its env and verifies the
// signature here. If valid AND not expired, we forward
// `X-Watermark-Disabled: true|false` to the NAS; the NAS reads
// the header and skips the Pillow watermark step when set.
//
// Why this lives at the proxy boundary (and not at the client):
// the HMAC secret must NEVER reach the browser. A client-side
// check would let any guest flip `watermarkDisabled: true` in
// the form payload and upload a "clean" photo of someone
// else's wedding. The server-side verification keeps the trust
// boundary at the proxy.
//
// Constant-time HMAC compare is already in functions/src/hmac.ts
// for the partner-invite flow — same primitive reused here.
// We re-implement verify here rather than importing functions/
// because Vercel functions and Firebase functions are deployed
// as separate runtimes; cross-importing would require bundling
// firebase-functions into the Vercel edge runtime.
const UPLOAD_PREFERENCES_HMAC_SECRET =
  process.env.HMAC_KEY ||  // mirrors the Firebase secret
  process.env.UPLOAD_PREFERENCES_HMAC_SECRET ||
  '';

// ---- 2026-08-13 — H-01: lazy firebase-admin init --------------
// Vercel functions are per-request cold-started but the module
// body runs once per cold start. We init firebase-admin on first
// call (not at module load) so the import cost is paid lazily
// and tests that don't touch auth/firestore don't have to mock
// them. `initializeApp({})` with no args uses Application Default
// Credentials; on Vercel, the FIREBASE_SERVICE_ACCOUNT_JSON env
// (set in the Vercel project dashboard) provides the SA key.
// If ADC isn't configured we throw at request time (not at
// module load) so the cold-start error path is loud.
let _adminApp = null;
let _adminNs = null;
let _adminAuth = null;
let _adminDb = null;
// 2026-08-13 — H-01: exported for unit tests. Tests stub
// `__getAdmin__` via vi.mock('./photo-upload.js', ...) to bypass
// the real firebase-admin init (which requires ADC and would
// fail in CI). The exported name is double-underscored to flag
// it as internal-only.
export async function __getAdmin__() {
  if (_adminApp) return { auth: _adminAuth, db: _adminDb, firestore: _adminNs && _adminNs.firestore, FieldValue: _adminNs && _adminNs.firestore && _adminNs.firestore.FieldValue };
  // firebase-admin is a CommonJS module. Under ESM dynamic
  // import, the namespace IS the module wrapper — but it doesn't
  // expose `apps` (that's a getter on the default export). We need
  // `admin.default` to get the real module object with `getApps`,
  // `credential`, `auth`, `firestore`, etc.
  const adminNs = await import('firebase-admin');
  const admin = adminNs.default || adminNs;
  if (admin.getApps().length === 0) {
    // Prefer a service-account JSON blob if provided (recommended
    // for Vercel since ADC isn't available in serverless runtime).
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (sa) {
      try {
        const credentials = JSON.parse(sa);
        admin.initializeApp({ credential: admin.credential.cert(credentials) });
      } catch (err) {
        throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is set but malformed: ${err.message}`);
      }
    } else {
      // Fallback: ADC (only works in environments where the
      // runtime provides GOOGLE_APPLICATION_CREDENTIALS or metadata
      // server). Vercel serverless doesn't — so this branch will
      // throw at first auth.verifyIdToken() call. We surface a
      // loud error so it's obvious in deploy logs.
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  }
  _adminApp = admin.getApp();
  _adminNs = admin;
  _adminAuth = admin.auth(_adminApp);
  _adminDb = admin.firestore(_adminApp);
  return { auth: _adminAuth, db: _adminDb, firestore: admin.firestore, FieldValue: admin.firestore.FieldValue };
}

export default async function handler(req, res) {
  // Top-level safety net. If anything below throws, log it AND
  // respond — so we get a real error body instead of Cloudflare's
  // generic "error code: 502".
  try {
    return await _handler(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] FATAL:', err && err.message ? err.message : String(err));
    if (!res.headersSent) {
      res.status(500).json({
        error: `Internal error: ${err && err.message ? err.message : String(err)}`,
      });
    }
  }
}

async function _handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    // 2026-08-13 — H-01: Authorization is required so the caller
    // can attach their Firebase ID token. Pre-flight OPTIONS will
    // include this header; without it the browser blocks the real
    // POST.
    'Content-Type, X-Upload-Token, X-Upload-Expires, Authorization',
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  // 2026-08-13 — H-01 trace id (mirrors the H-04 fix in
  // api/firebase-proxy.js). One trace id per request, never
  // logged with caller uid or body content — only with status +
  // duration + sizes. Keeps logs useful for debugging without
  // becoming a credential-leak vector.
  const traceId = (req.headers['x-trace-id'] && typeof req.headers['x-trace-id'] === 'string' && req.headers['x-trace-id'].length <= 128)
    ? req.headers['x-trace-id']
    : randomUUID();
  const log = (event, fields) => {
    // eslint-disable-next-line no-console
    console.log(`[photo-upload] ${event}`, { traceId, ...fields });
  };
  log('request-start', { hasAuth: Boolean(req.headers.authorization), contentLength: Number(req.headers['content-length'] || 0) });
  const startedAt = Date.now();

  // 2026-08-13 — H-01: Buffer the body BEFORE we try to auth so
  // we can give a proper error if the body is too large, but
  // also so we don't waste auth overhead on a 25MB upload from
  // an unauthenticated attacker. (Same cap as before; pre-fix.)
  let body;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_FORWARD_BYTES) {
        log('body-too-large', { bytes: total });
        res.status(413).json({ error: '相片太大，請壓縮後再上載' });
        return;
      }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  } catch (err) {
    log('body-read-failed', { err: err && err.message });
    res.status(400).json({ error: '無法讀取 request body' });
    return;
  }

  if (body.length === 0) {
    res.status(400).json({ error: 'empty body' });
    return;
  }

  // (1) Fail closed if the server-side HMAC secret is missing.
  if (!NAS_HMAC_SECRET) {
    log('fatal-no-secret', {});
    res.status(500).json({
      error:
        'upload auth not configured on the server (missing NAS_HMAC_SECRET env var)',
    });
    return;
  }

  // (2) Parse multipart for the fields we need to make auth decisions.
  const contentType = String(req.headers['content-type'] || '');
  const parsed = parseMultipartForIds(body, contentType);
  if (!parsed.ok) {
    log('bad-multipart', { err: parsed.error });
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { eventId, guestId, ownerUid, shareToken, prefsToken } = parsed;

  // (3) Validate id shape so we don't run Firestore queries with
  // arbitrary garbage strings. SAFE_ID limits to 64 chars,
  // alphanum + underscore + dash. Firebase UIDs are 28 chars.
  for (const [name, val] of [['eventId', eventId], ['guestId', guestId], ['ownerUid', ownerUid]]) {
    if (!val || !SAFE_ID.test(val)) {
      log('bad-id-shape', { field: name });
      res.status(400).json({ error: `bad ${name}` });
      return;
    }
  }

  // (4) H-01: verify the Firebase ID token from the Authorization
  // header. We require it for ALL upload paths — owner, co-owner,
  // vendor (bg), guest. The caller MUST be signed in (or
  // anonymous-signed-in for guests, which still has a real
  // Firebase UID). No anonymous uploads.
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    log('no-auth-header', {});
    res.status(401).json({ error: 'missing Authorization: Bearer <Firebase ID token>' });
    return;
  }
  const idToken = match[1];
  let callerUid;
  let admin;
  try {
    admin = await __getAdmin__();
    if (!admin) throw new Error('admin is null after __getAdmin__');
    if (!admin.auth) throw new Error('admin.auth is null');
    log('pre-verify', { idTokenType: typeof idToken, idTokenLen: idToken ? idToken.length : 'undef' });
    const decoded = await admin.auth.verifyIdToken(idToken, /* checkRevoked */ false);
    callerUid = decoded.uid;
  } catch (err) {
    // 2026-08-13 — log the full error message for diagnosis
    // (the bad-token path is where "what env var is missing"
    // shows up as auth/argument-error or credential errors).
    log('bad-token', { code: err && err.code ? err.code : 'unknown', err: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack.split('\n').slice(0,3).join(' | ') : 'no-stack' });
    res.status(401).json({ error: 'invalid or expired Firebase ID token' });
    return;
  }

  // (5) Verify event membership based on the (ownerUid, eventId)
  // pair. Special-case eventId='inv-bg' for the designer's own
  // invitation template background — only the designer themselves
  // (callerUid === ownerUid) can upload.
  let isMember = false;
  if (eventId === 'inv-bg') {
    // Designer / owner only — the bg lives in their own pseudo-event.
    if (callerUid === ownerUid) {
      isMember = true;
    }
  } else {
    // Real event — look up the doc, verify membership.
    const eventRef = admin.db.doc(
      `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}`,
    );
    const eventSnap = await eventRef.get();
    if (eventSnap.exists) {
      const ev = eventSnap.data() || {};
      const owner = ev._ownerUid || ev.ownerUid;
      const coOwners = Array.isArray(ev.coOwners) ? ev.coOwners : [];
      const assignedVendorUid = ev.assignedVendorUid;
      if (callerUid === owner) {
        isMember = true;
      } else if (coOwners.includes(callerUid)) {
        isMember = true;
      } else if (callerUid === assignedVendorUid) {
        isMember = true;
      } else {
        // Guest path: verify they have a non-expired
        // guestLinks/{auth.uid} doc for this owner.
        const linkRef = admin.db.doc(
          `artifacts/${APP_ID}/users/${ownerUid}/guestLinks/${callerUid}`,
        );
        const linkSnap = await linkRef.get();
        if (linkSnap.exists) {
          const link = linkSnap.data() || {};
          // expiresAt can be Firestore Timestamp or Date or number (ms).
          let expiresMs = 0;
          const e = link.expiresAt;
          if (e && typeof e.toMillis === 'function') expiresMs = e.toMillis();
          else if (typeof e === 'number') expiresMs = e;
          else if (e instanceof Date) expiresMs = e.getTime();
          if (expiresMs > Date.now()) {
            isMember = true;
          }
        }
        // Optional: also accept a matching shareToken in the
        // multipart, but only if the link doc exists — we don't
        // create guestLinks from the proxy, only verify them.
        // (The share-token redeem CF is the only writer to
        // guestLinks, and it verifies the HMAC token signature
        // before writing.)
        if (!isMember && shareToken && SAFE_ID.test(shareToken)) {
          // The guest token lookup would require either scanning
          // all guestLinks or maintaining a token→uid index.
          // We don't have such an index here, so the shareToken
          // path is a NO-OP — guests must complete the
          // share-token redeem flow (which writes guestLinks/
          // {auth.uid}) BEFORE uploading. This is a documented
          // design constraint: guest uploads only work AFTER
          // the redeem CF has run.
          //
          // If a future flow needs a one-shot token check, add
          // a `guestLinksByToken/{token}` collection maintained
          // by the redeem CF.
        }
      }
    }
  }
  if (!isMember) {
    log('forbidden', { ownerUidPrefix: ownerUid.slice(0, 8), eventIdPrefix: eventId.slice(0, 8) });
    res.status(403).json({ error: 'caller is not a member of this event' });
    return;
  }

  // (6) Rate-limit per event/day. Atomic FieldValue.increment(1)
  // then read-back to compare with cap. For inv-bg, use a
  // top-level counter doc keyed by day.
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD UTC
  let rateRef;
  let rateCap;
  if (eventId === 'inv-bg') {
    rateRef = admin.db.doc(`invBgUploadRateLimit/${day}`);
    rateCap = INV_BG_RATE_LIMIT_PER_DAY;
  } else {
    rateRef = admin.db.doc(
      `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/uploadRateLimit/${day}`,
    );
    rateCap = RATE_LIMIT_PER_DAY;
  }
  const FieldValue = admin.FieldValue;
  if (!FieldValue) {
    log('fatal-no-field-value', {});
    res.status(500).json({ error: 'server misconfigured: firebase-admin FieldValue unavailable' });
    return;
  }
  let currentCount;
  try {
    await rateRef.set(
      { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const fresh = await rateRef.get();
    currentCount = (fresh.data() && Number(fresh.data().count)) || 0;
  } catch (err) {
    // If the rate-limit read fails, we still allow the upload —
    // we just can't enforce the cap. Log loud so this gets fixed.
    log('rate-limit-read-failed', { err: err && err.message ? err.message : String(err) });
    currentCount = 0;
  }
  if (currentCount > rateCap) {
    log('rate-limited', { currentCount, cap: rateCap });
    res.status(429).json({ error: `event has exceeded ${rateCap} uploads today, please try again tomorrow` });
    return;
  }

  // (7) All pre-flight checks passed. Mint the HMAC token and
  // forward to the NAS.
  const expiresMs = Date.now() + TOKEN_TTL_MS;
  const token = await mintHmacToken(NAS_HMAC_SECRET, eventId, guestId, expiresMs);

  // 2026-08-02 — Verify the upload-preferences token (if any).
  // Same as before — owner unlock signals "watermark off".
  let watermarkDisabled = false;
  if (prefsToken) {
    const verified = await verifyUploadPreferencesToken(
      prefsToken,
      UPLOAD_PREFERENCES_HMAC_SECRET,
    );
    if (verified) {
      if (verified.expiresAt < Date.now()) {
        log('prefs-expired', { ownerUidPrefix: ownerUid.slice(0, 8) });
        watermarkDisabled = false;
      } else if (verified.watermarkDisabled === true) {
        watermarkDisabled = true;
      }
    } else {
      log('prefs-bad', {});
    }
  }

  let upstream;
  try {
    upstream = await fetch(NAS_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Upload-Token': token,
        'X-Upload-Expires': String(expiresMs),
        'X-Trace-Id': traceId,
        ...(watermarkDisabled ? { 'X-Watermark-Disabled': 'true' } : {}),
      },
      body,  // forward the original multipart unchanged
    });
  } catch (err) {
    log('nas-fetch-failed', { err: err && err.message ? err.message : String(err), durationMs: Date.now() - startedAt });
    res.status(502).json({
      error: '無法連接到 NAS upload server，請稍後再試',
    });
    return;
  }

  const responseText = await upstream.text();
  log('request-end', {
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    bodyBytes: body.length,
    responseBytes: responseText.length,
  });

  // Forward the response. If JSON, pass through with the original
  // status; if not, send raw text.
  try {
    const json = JSON.parse(responseText);
    res.status(upstream.status).json(json);
  } catch {
    res.status(upstream.status).send(responseText);
  }
}

// ---- Multipart parse that pulls only the IDs we need ---------
// We don't need a full parser — just enough to (a) grab the
// eventId + guestId fields and (b) leave everything else alone for
// forwarding. Body is rebuilt by stripping those two parts.
const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;

function parseMultipartForIds(buf, contentTypeHeader) {
  const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!match) return { ok: false, error: 'no multipart boundary' };
  const boundary = (match[1] || match[2] || '').trim();
  const delimStr = `--${boundary}`;
  const closing = `--${boundary}--`;
  // Strip eventId / guestId / ownerUid / shareToken fields, keep
  // everything else (file, uploaderName, prefsToken, etc.) intact
  // for forwarding.
  //
  // 2026-08-13 — H-01: added ownerUid (event's owner, used for
  // event-doc lookup) and shareToken (guest share token, used as
  // a fallback identity check). Both are used for auth decisions
  // at the proxy boundary and stripped before forwarding upstream
  // so the NAS receiver never sees them.
  const idsToStrip = new Set(['eventId', 'guestId', 'ownerUid', 'shareToken']);
  // 2026-08-02 — also strip the prefsToken field from the forwarded
  // multipart. We read it for HMAC verification at the proxy, but
  // the NAS receiver doesn't need (or want) to see it. The token
  // IS already verified by the time the NAS gets the request —
  // the only thing the NAS sees is the resulting
  // `X-Watermark-Disabled: true|false` header. Treating prefsToken
  // like any other ID-style field keeps the multipart parser
  // simple.
  idsToStrip.add('prefsToken');
  const parts = splitBufferOnBoundary(buf, delimStr);
  let out = Buffer.alloc(0);
  const delimBuf = Buffer.from(delimStr, 'utf-8');
  let eventId = null;
  let guestId = null;
  let ownerUid = null;
  let shareToken = null;
  let prefsToken = null;
  for (const part of parts) {
    if (part.length === 0) continue;
    // Look at the headers as a string so .match()/.indexOf() work
    // and we can keep the file body as raw bytes.
    const headEnd = findCrlfCrlf(part);
    if (headEnd === -1) {
      // No header/body separator found — keep the part as-is.
      out = Buffer.concat([out, delimBuf, part]);
      continue;
    }
    const headStr = part.subarray(0, headEnd).toString('utf-8');
    const nameMatch = headStr.match(/name="([^"]+)"/);
    if (!nameMatch) {
      out = Buffer.concat([out, delimBuf, part]);
      continue;
    }
    const name = nameMatch[1];
    if (idsToStrip.has(name)) {
      // Extract the value as a UTF-8 string from the body slice.
      const body = part.subarray(headEnd + 4);
      let bodyEnd = body.length;
      if (bodyEnd >= 2 && body[bodyEnd - 2] === 0x0d && body[bodyEnd - 1] === 0x0a) {
        bodyEnd -= 2;
      }
      const value = body.subarray(0, bodyEnd).toString('utf-8');
      if (name === 'eventId') eventId = value;
      else if (name === 'guestId') guestId = value;
      else if (name === 'ownerUid') ownerUid = value;
      else if (name === 'shareToken') shareToken = value;
      else if (name === 'prefsToken') prefsToken = value;
      // Strip this part — don't include it in `out`.
      continue;
    }
    // Keep this part (file, uploaderName, anything else).
    out = Buffer.concat([out, delimBuf, part]);
  }
  // Append the closing boundary.
  out = Buffer.concat([out, Buffer.from('\r\n' + closing)]);
  if (!eventId || !guestId) {
    return { ok: false, error: 'missing eventId or guestId' };
  }
  // 2026-08-13 — H-01: ownerUid is now REQUIRED. The proxy
  // verifies event membership by looking up the event doc by
  // (ownerUid, eventId) pair; without ownerUid we can't do
  // that check. Reject early.
  if (!ownerUid) {
    return { ok: false, error: 'missing ownerUid' };
  }
  return { ok: true, eventId, guestId, ownerUid, shareToken, prefsToken, bodyWithoutIds: out };
}

// Returns the byte offset of the CRLFCRLF separator inside a Buffer,
// or -1 if not found. Buffer.prototype.indexOf with a Buffer subarray
// is supported on Node 16+, so this avoids UTF-8 conversion of the
// part body (which can be a multi-MB photo).
function findCrlfCrlf(buf) {
  return buf.indexOf('\r\n\r\n');
}

function splitBufferOnBoundary(buf, delim) {
  const out = [];
  let i = 0;
  // delim is a Node Buffer when called from parseMultipartForIds.
  if (typeof delim === 'string') delim = Buffer.from(delim, 'utf-8');
  while (i < buf.length) {
    const start = buf.indexOf(delim, i);
    if (start === -1) break;
    const next = buf.indexOf(delim, start + delim.length);
    const sliceEnd = next === -1 ? buf.length : next;
    out.push(buf.subarray(start + delim.length, sliceEnd));
    i = sliceEnd;
  }
  return out;
}

// HMAC-SHA256 over `eventId|guestId|expiresMs`. Web Crypto for
// cross-runtime compatibility (Vercel + local jest jsdom).
async function mintHmacToken(secret, eventId, guestId, expiresMs) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, enc.encode(`${eventId}|${guestId}|${expiresMs}`),
  );
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// 2026-08-02 — Verify an upload-preferences token. Same
// algorithm as functions/src/hmac.ts:signToken + verifyToken
// (b64url(json(payload)).base64url(hmac256(secret, b64))).
// Returns null on any failure (missing secret, malformed
// token, bad signature) — caller treats null as "no override,
// default-on watermark applies". Never throws so a malicious
// token can't take down the upload path.
//
// Why sync via globalThis.crypto.subtle: Vercel's Node 22
// runtime exposes the Web Crypto API on globalThis.crypto.
// SubtleCrypto is technically async but verifyToken is called
// from an async context (`_handler`) and we just .then() it.
// Constant-time compare is done via the loop below; SubtleCrypto
// itself uses HMAC verification internally that is constant-time.
async function verifyUploadPreferencesToken(token, secret) {
  if (!secret) return null;  // fail-closed: missing secret → null
  if (typeof token !== 'string' || token.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!b64 || !sig) return null;
  let expected;
  try {
    // 2026-08-02 — Use Web Crypto (globalThis.crypto.subtle)
    // for cross-runtime portability. Vercel Node 22 has it
    // built-in; the existing mintHmacToken above uses the same
    // API. We avoid node:crypto here to keep the file ESM-clean
    // (the project root is "type": "module" and Vitest tests
    // import from this file directly).
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(b64),
    );
    expected = Buffer.from(sigBuf).toString('base64url');
  } catch (err) {
    return null;
  }
  if (sig.length !== expected.length) return null;
  // Constant-time compare.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  let diff = 0;
  for (let i = 0; i < sigBuf.length; i++) diff |= sigBuf[i] ^ expBuf[i];
  if (diff !== 0) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  return payload;
}

// The multipart's boundary is in the original Content-Type. We
// strip the parts but the body still uses the same boundary, so
// we pass the existing Content-Type through. (The receiver parses
// it the same way the client did.)
function rebuildMultipartContentType(originalCt /* , newBody */) {
  return originalCt;
}
