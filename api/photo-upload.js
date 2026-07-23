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
// 2026-07-23 — refactored after two failed attempts (502 from
// Cloudflare). Root cause was an `export const config` block that
// triggered Vercel's legacy Pages-Router config code path. Removed.
// Now using the simplest possible Vercel default-config handler.
//
// Approach: buffer the multipart body in memory (capped at 25 MB),
// forward to NAS as a Buffer with X-Upload-Token / X-Upload-Expires
// headers preserved. Vercel's default bodyParser is fine because
// we read req as a stream ourselves in the try block.

const NAS_UPLOAD_URL =
  process.env.NAS_UPLOAD_URL ||
  process.env.VITE_NAS_UPLOAD_URL ||
  'https://cdn.savetheday.io/upload';
const MAX_FORWARD_BYTES = 25 * 1024 * 1024;

export default async function handler(req, res) {
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

  // Forward to NAS. Pass through auth headers — the NAS server
  // verifies the HMAC token and rejects expired/invalid tokens
  // with 401 (same as before).
  const token = String(req.headers['x-upload-token'] || '');
  const expires = String(req.headers['x-upload-expires'] || '');

  // eslint-disable-next-line no-console
  console.log('[photo-upload] forwarding', {
    bytes: body.length,
    tokenLen: token.length,
    nasHost: new URL(NAS_UPLOAD_URL).host,
  });

  let upstream;
  try {
    upstream = await fetch(NAS_UPLOAD_URL, {
      method: 'POST',
      headers: {
        // Don't set Content-Type — fetch will add multipart boundary.
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
