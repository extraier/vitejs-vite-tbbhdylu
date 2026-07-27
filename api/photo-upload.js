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
  // Parse the multipart just enough to pull eventId + guestId, then
  // HMAC-sign and forward to the NAS with the auth headers the
  // receiver now requires. The client never sees the secret.
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
  // Pull the multipart Content-Type from the request so we can
  // extract the boundary for parsing. The receiver needs the
  // original boundary for its own multipart parser.
  const contentType = String(req.headers['content-type'] || '');
  // (2) Pull eventId + guestId from the multipart body, then strip
  // them so the upstream forward doesn't carry them twice (once
  // as a multipart field, once as the bound headers).
  const parsed = parseMultipartForIds(body, contentType);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { eventId, guestId, bodyWithoutIds } = parsed;
  // (3) Validate id shape so we don't sign for arbitrary strings.
  if (!SAFE_ID.test(eventId) || !SAFE_ID.test(guestId)) {
    res.status(400).json({ error: 'bad eventId/guestId' });
    return;
  }
  const expiresMs = Date.now() + TOKEN_TTL_MS;
  // (4) Mint the token using the same algorithm the receiver verifies.
  // hex(HMAC-SHA256(secret, `${eventId}|${guestId}|${expiresMs}`)).
  const token = await mintHmacToken(NAS_HMAC_SECRET, eventId, guestId, expiresMs);
  // (5) Recompute the boundary because we rewrote the multipart.
  const upstreamContentType = rebuildMultipartContentType(contentType, bodyWithoutIds);

  // eslint-disable-next-line no-console
  console.log('[photo-upload] forwarding', {
    bytes: bodyWithoutIds.length,
    tokenLen: token.length,
    expiresMs,
    eventId: eventId.slice(0, 8),
    guestId: guestId.slice(0, 8),
    nasHost: new URL(NAS_UPLOAD_URL).host,
  });

  let upstream;
  try {
    upstream = await fetch(NAS_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': upstreamContentType,
        'X-Upload-Token': token,
        'X-Upload-Expires': String(expiresMs),
      },
      body: bodyWithoutIds,
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
  const parts = splitBufferOnBoundary(buf, delimStr);
  let out = Buffer.alloc(0);
  const delimBuf = Buffer.from(delimStr, 'utf-8');
  let eventId = null;
  let guestId = null;
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
  return { ok: true, eventId, guestId, bodyWithoutIds: out };
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

// The multipart's boundary is in the original Content-Type. We
// strip the parts but the body still uses the same boundary, so
// we pass the existing Content-Type through. (The receiver parses
// it the same way the client did.)
function rebuildMultipartContentType(originalCt /* , newBody */) {
  return originalCt;
}
