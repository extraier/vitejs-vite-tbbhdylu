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

const NAS_UPLOAD_URL =
  process.env.NAS_UPLOAD_URL ||
  process.env.VITE_NAS_UPLOAD_URL ||
  'https://cdn.savetheday.io/upload';
const MAX_FORWARD_BYTES = 25 * 1024 * 1024;

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

  // Forward to NAS. Pass through auth headers — the NAS server
  // verifies the HMAC token and rejects expired/invalid tokens
  // with 401 (same as before).
  const token = String(req.headers['x-upload-token'] || '');
  const expires = String(req.headers['x-upload-expires'] || '');
  // Preserve the original multipart Content-Type so the boundary
  // matches what the client sent. Without this, the NAS can't
  // parse the multipart body and returns "expected multipart/
  // form-data" because our forwarded Content-Type doesn't have
  // a boundary parameter.
  const contentType = String(req.headers['content-type'] || '');

  // eslint-disable-next-line no-console
  console.log('[photo-upload] forwarding', {
    bytes: body.length,
    tokenLen: token.length,
    contentType: contentType.slice(0, 60),
    nasHost: new URL(NAS_UPLOAD_URL).host,
  });

  let upstream;
  try {
    upstream = await fetch(NAS_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Upload-Token': token,
        'X-Upload-Expires': expires,
      },
      body,
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
