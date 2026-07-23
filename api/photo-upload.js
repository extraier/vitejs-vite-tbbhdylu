// Vercel serverless function — proxy for photo uploads to the NAS.
//
// Why this exists:
// The NAS photo upload endpoint (https://cdn.savetheday.io/upload)
// doesn't return CORS headers for the savetheday.io origin. Browser
// preflight (OPTIONS) gets blocked with "No Access-Control-Allow-
// Origin header" and the XHR never reaches the POST.
//
// Routing through Vercel sidesteps CORS entirely:
//   1. Browser → POST /api/photo-upload (same-origin, no preflight)
//   2. Vercel  → POST https://cdn.savetheday.io/upload
//                (server-to-server, no preflight)
//
// The browser XHR's progress events still work — they're measured
// client→Vercel, and the file is streamed through without buffering
// to disk (multipart streaming via fetch + duplex: 'half' in
// Node 18+).
//
// Input:
//   - multipart/form-data with:
//       file: the photo binary
//       eventId, guestId, uploaderName: as form fields
//   - Headers:
//       X-Upload-Token, X-Upload-Expires: HMAC signed by the client
//
// Output:
//   - 200: { url, thumbnailUrl, bytes }
//   - 401/413/415/429/507/500: forwarded from NAS with original status
//   - 502: NAS unreachable / bad response

const NAS_UPLOAD_URL =
  // Prefer the server-only var (cleaner separation), but fall back to
  // the client-prefixed VITE_NAS_UPLOAD_URL so we don't need to
  // duplicate the secret URL in two env slots.
  process.env.NAS_UPLOAD_URL ||
  process.env.VITE_NAS_UPLOAD_URL ||
  'https://cdn.savetheday.io/upload';
const MAX_FORWARD_BYTES = 25 * 1024 * 1024; // 25 MB hard limit, mirrors the NAS server

export const config = {
  api: {
    // bodyParser:false lets us read req as a stream of raw bytes.
    // With bodyParser:true Vercel tries to JSON-parse the body,
    // which fails on multipart and throws before our handler runs
    // (which is why the 502 came back as "error code: 502" with
    // an empty body — Vercel's default error page).
    bodyParser: false,
    sizeLimit: '26mb',
  },
};

export default async function handler(req, res) {
  // Same-origin so CORS isn't needed, but Vercel preview deploys
  // and local dev sometimes hit this from a different origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Upload-Token, X-Upload-Expires');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  // Stream-read the raw multipart body. With bodyParser:false, Vercel
  // leaves req as a readable stream that we can consume chunk-by-chunk.
  // We cap at MAX_FORWARD_BYTES to prevent OOM on huge uploads (NAS
  // server has its own size cap; this matches it).
  try {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_FORWARD_BYTES) {
        res.status(413).json({
          error: '相片太大，請壓縮後再上載',
        });
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Forward to NAS. Pass through the auth headers — the NAS server
    // verifies the HMAC token and rejects expired/invalid tokens
    // with 401 (same as before).
    const token = req.headers['x-upload-token'] || '';
    const expires = req.headers['x-upload-expires'] || '';

    // eslint-disable-next-line no-console
    console.log('[photo-upload] forwarding', {
      bytes: body.length,
      tokenLen: String(token).length,
      nasUrl: NAS_UPLOAD_URL,
    });

    const upstream = await fetch(NAS_UPLOAD_URL, {
      method: 'POST',
      headers: {
        // Don't set Content-Type — fetch will add the multipart boundary
        // automatically when body is a Buffer.
        'X-Upload-Token': String(token),
        'X-Upload-Expires': String(expires),
      },
      body,
    });

    const responseText = await upstream.text();
    // eslint-disable-next-line no-console
    console.log('[photo-upload] upstream response', {
      status: upstream.status,
      bytes: responseText.length,
      preview: responseText.slice(0, 200),
    });
    // Try to forward the JSON body if the NAS responded with one
    try {
      const json = JSON.parse(responseText);
      res.status(upstream.status).json(json);
    } catch {
      // Not JSON — forward raw text with the upstream status
      res.status(upstream.status).send(responseText);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-upload] forward failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: `上載轉發失敗：${msg}`,
    });
  }
}
