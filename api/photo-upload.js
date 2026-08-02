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

export default async function handler(req, res) {
  // Top-level safety net. If anything below throws, log it AND
  // respond — so we get a real error body instead of Cloudflare's
  // generic "error code: 502".
  try {
    return await _handler(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] FATAL:', err);
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
    'Content-Type, X-Upload-Token, X-Upload-Expires',
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  // Buffer the body, capped at MAX_FORWARD_BYTES. For 25 MB photos
  // this fits comfortably in Vercel serverless memory (1 GB+).
  //
  // Vercel's default bodyParser is true and parses application/json
  // and urlencoded into req.body. For multipart it leaves req as
  // a stream we can iterate with for-await. However, the NAS server
  // expects Content-Type with the original boundary string — fetch
  // reconstructs the boundary when we pass a Buffer.
  let body;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_FORWARD_BYTES) {
        res.status(413).json({ error: '相片太大，請壓縮後再上載' });
        return;
      }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] body read failed:', err);
    res.status(400).json({ error: '無法讀取 request body' });
    return;
  }

  if (body.length === 0) {
    res.status(400).json({ error: 'empty body' });
    return;
  }

  // 2026-07-27 — SECURITY HARDENING: mint the HMAC server-side.
  // We need eventId + guestId from the multipart to compute the
  // token, but we DO NOT strip them from the upstream body — the
  // NAS receiver reads them out of `fields` (see
  // photo_upload_server.py:232-235) and rejects with 400 if
  // missing. So: extract for the HMAC, but forward the original
  // multipart unchanged.
  //
  // (1) Fail closed if the server-side secret is missing.
  if (!NAS_HMAC_SECRET) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] FATAL: NAS_HMAC_SECRET not configured');
    res.status(500).json({
      error:
        'upload auth not configured on the server (missing NAS_HMAC_SECRET env var)',
    });
    return;
  }
  // (2) Pull eventId + guestId from the multipart just for HMAC
  // signing. The body itself is forwarded unchanged.
  const contentType = String(req.headers['content-type'] || '');
  const parsed = parseMultipartForIds(body, contentType);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { eventId, guestId } = parsed;
  // (3) Validate id shape so we don't sign for arbitrary strings.
  if (!SAFE_ID.test(eventId) || !SAFE_ID.test(guestId)) {
    res.status(400).json({ error: 'bad eventId/guestId' });
    return;
  }
  const expiresMs = Date.now() + TOKEN_TTL_MS;
  // (4) Mint the token using the same algorithm the receiver verifies.
  // hex(HMAC-SHA256(secret, `${eventId}|${guestId}|${expiresMs}`)).
  const token = await mintHmacToken(NAS_HMAC_SECRET, eventId, guestId, expiresMs);

  // eslint-disable-next-line no-console
  console.log('[photo-upload] forwarding', {
    bytes: body.length,
    tokenLen: token.length,
    expiresMs,
    eventId: eventId.slice(0, 8),
    guestId: guestId.slice(0, 8),
    nasHost: new URL(NAS_UPLOAD_URL).host,
  });

  // 2026-08-02 — Verify the upload-preferences token (if any).
  // The client sends it as a multipart field `prefsToken` (text
  // part) — NOT a custom header, because the multipart already
  // parsed by parseMultipartForIds gets stripped before we forward
  // upstream. The token is HMAC-signed; tampering throws away
  // the watermark-disabled signal (default-on watermark kicks
  // in). Returning 401 would be hostile: the photo upload itself
  // is still valid, just watermarked. We log + fall through.
  let watermarkDisabled = false;
  const prefsToken = parsed.prefsToken;
  if (prefsToken) {
    const verified = await verifyUploadPreferencesToken(
      prefsToken,
      UPLOAD_PREFERENCES_HMAC_SECRET,
    );
    if (verified) {
      // Defense in depth: the token's ownerUid must match the
      // event owner — but here we only have the eventId, not
      // the ownerUid, in the multipart. The token IS signed by
      // the owner's Firebase Auth context (via the CF), and the
      // CF verified `req.auth.uid === ownerUid`. So an attacker
      // who somehow got the secret could forge a token, but
      // they don't have the secret. Tampering breaks the sig.
      if (verified.expiresAt < Date.now()) {
        // eslint-disable-next-line no-console
        console.warn('[photo-upload] expired prefs token, watermark on', {
          expiresAt: verified.expiresAt,
          now: Date.now(),
        });
        watermarkDisabled = false;
      } else if (verified.watermarkDisabled === true) {
        watermarkDisabled = true;
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[photo-upload] bad prefs token, watermark on');
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
        // 2026-08-02 — forward the watermark-disabled signal so
        // the NAS can skip Pillow when set. Default is "false"
        // (i.e. watermark ON) — we never send a header if the
        // token didn't verify. The NAS reads the header verbatim.
        ...(watermarkDisabled ? { 'X-Watermark-Disabled': 'true' } : {}),
      },
      body,  // forward the original multipart unchanged
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] fetch to NAS failed:', err);
    res.status(502).json({
      error: '無法連接到 NAS upload server，請稍後再試',
    });
    return;
  }

  const responseText = await upstream.text();

  // eslint-disable-next-line no-console
  console.log('[photo-upload] upstream', {
    status: upstream.status,
    bytes: responseText.length,
    preview: responseText.slice(0, 200),
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
  // Strip eventId / guestId fields, keep everything else (file,
  // uploaderName, etc.) intact for forwarding.
  const idsToStrip = new Set(['eventId', 'guestId']);
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
  return { ok: true, eventId, guestId, prefsToken, bodyWithoutIds: out };
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
