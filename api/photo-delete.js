// Vercel serverless function — proxy for photo deletes to the NAS.
//
// Why this exists:
// Same reason as api/photo-upload.js — the NAS's /delete endpoint
// sits behind the cdn.savetheday.io tunnel which doesn't return
// CORS headers for savetheday.io. The browser preflight is blocked
// so the actual DELETE never fires. Routing through Vercel keeps
// the call same-origin from the browser's POV and the proxy
// reaches the NAS server-to-server where CORS doesn't apply.
//
// 2026-08-05 — Photo-delete flow. Mirrors the
// upload-preferences-token pattern (api/photo-upload.js): the
// client calls a Firebase CF (mintPhotoDeleteToken) which verifies
// the caller is allowed to delete the photo (owner, co-owner, or
// the original uploader) and returns an HMAC-signed token using
// the shared HMAC_KEY secret. This proxy verifies that token
// server-side, then mints a fresh NAS-bound HMAC token over
// eventId|guestId|filename|expiresMs and forwards the DELETE.
//
// Three call paths reach this proxy:
//   1. Owner deletes any photo in their event.
//   2. Co-owner (event.coOwnerUIDs member) deletes any photo.
//   3. Guest deletes a photo they themselves uploaded (the
//      `uploadAuthUid` field on the photo doc matches their
//      auth.uid). This tier ONLY works while the guest's
//      anonymous Firebase Auth session is alive — re-opening
//      the share link in a different browser/anon UID returns
//      a fresh UID and the rule tier fails closed (the delete
//      button is hidden). The owner/co-owner tiers work
//      regardless because they're tied to the ownerUid, not
//      the guest's session.
//
// Security: same shape as the upload path. HMAC verification
// is server-side; the secret never reaches the browser. The
// browser only knows the signed token returned by the CF (which
// is short-lived: 5 min TTL).

const NAS_DELETE_URL =
  process.env.NAS_DELETE_URL ||
  process.env.NAS_UPLOAD_URL ||     // same host, different path
  process.env.VITE_NAS_UPLOAD_URL ||
  'https://cdn.savetheday.io/delete';

// Server-only HMAC secret for the NAS. Same secret the upload
// proxy uses; the NAS receiver doesn't care which endpoint
// minted the token, only that the signature is valid.
const NAS_HMAC_SECRET =
  process.env.NAS_UPLOAD_SECRET ||
  process.env.PHOTO_UPLOAD_SECRET ||
  process.env.PHOTO_HMAC_SECRET ||
  '';

// Mirror of Firebase's HMAC_KEY — same secret used by
// uploadPreferencesToken.ts + photoDeleteToken.ts. The CF mints
// a token with this secret; we verify it with the same secret.
// Falls back to legacy names so an existing deployment that
// already has one of the older vars keeps working.
const UPLOAD_PREFERENCES_HMAC_SECRET =
  process.env.HMAC_KEY ||
  process.env.UPLOAD_PREFERENCES_HMAC_SECRET ||
  '';

// 5 min — short on purpose; the token authorises ONE delete
// action, not a session. If the user clicks "delete" twice in
// a row, the client re-fires the CF and gets a fresh token.
const TOKEN_TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  // Top-level safety net. Same pattern as api/photo-upload.js.
  try {
    return await _handler(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-delete] FATAL:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: `Internal error: ${err && err.message ? err.message : String(err)}`,
      });
    }
  }
}

async function _handler(req, res) {
  // CORS — open allow for now (the upload proxy does the same).
  // The request comes from the same-origin Vercel frontend
  // anyway, so this is mostly for direct API exploration.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Upload-Token, X-Upload-Expires',
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  // Accept POST so we don't have to deal with browser DELETE
  // quirks (some proxies strip DELETE bodies; the client sends
  // the photoUrl + token in the JSON body). The semantic is
  // still "delete one photo".
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'POST or DELETE only' });
    return;
  }

  // (1) Fail closed if either secret is missing.
  if (!NAS_HMAC_SECRET) {
    // eslint-disable-next-line no-console
    console.error('[photo-delete] FATAL: NAS_HMAC_SECRET not configured');
    res.status(500).json({
      error:
        'delete auth not configured on the server (missing NAS_HMAC_SECRET env var)',
    });
    return;
  }
  if (!UPLOAD_PREFERENCES_HMAC_SECRET) {
    // eslint-disable-next-line no-console
    console.error('[photo-delete] FATAL: HMAC_KEY not configured');
    res.status(500).json({
      error:
        'delete auth not configured on the server (missing HMAC_KEY env var)',
    });
    return;
  }

  // (2) Read JSON body. Vercel's default bodyParser parses
  // application/json into req.body automatically.
  const body = req.body || {};
  const eventId = body.eventId;
  const photoUrl = body.photoUrl;
  const photoDocId = body.photoDocId;
  const deleteToken = body.deleteToken;

  if (!eventId || !photoUrl || !photoDocId || !deleteToken) {
    res.status(400).json({
      error: 'eventId, photoUrl, photoDocId, and deleteToken are required.',
    });
    return;
  }

  // Defense in depth: validate id shape so we don't sign for
  // arbitrary strings. Same SAFE_ID the upload proxy uses.
  const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;
  if (!SAFE_ID.test(eventId) || !SAFE_ID.test(photoDocId)) {
    res.status(400).json({ error: 'bad eventId or photoDocId' });
    return;
  }

  // (3) Verify the deleteToken minted by the CF. The token
  // payload is { ownerUid, photoDocId, eventId, issuerUid,
  // issuedAt, expiresAt } signed with HMAC_KEY. We check:
  //   a) Signature is valid (HMAC_KEY integrity)
  //   b) Token hasn't expired (< now)
  //   c) Token's photoDocId + eventId match what the client
  //      claimed — prevents token reuse against a different
  //      photo (similar to the filename binding on the NAS
  //      token)
  //
  // We don't enforce issuerUid === any specific auth.uid here
  // because this proxy is stateless and doesn't know the
  // caller's auth.uid — the CF has already verified it.
  const verified = await verifyPhotoDeleteToken(
    deleteToken,
    UPLOAD_PREFERENCES_HMAC_SECRET,
  );
  if (!verified) {
    // eslint-disable-next-line no-console
    console.warn('[photo-delete] bad delete token, rejecting');
    res.status(401).json({ error: 'invalid delete token' });
    return;
  }
  if (verified.expiresAt < Date.now()) {
    // eslint-disable-next-line no-console
    console.warn('[photo-delete] expired delete token, rejecting', {
      expiresAt: verified.expiresAt,
      now: Date.now(),
    });
    res.status(401).json({ error: 'delete token expired' });
    return;
  }
  if (verified.photoDocId !== photoDocId || verified.eventId !== eventId) {
    // eslint-disable-next-line no-console
    console.warn('[photo-delete] token payload mismatch, rejecting', {
      tokenPhotoDocId: verified.photoDocId,
      bodyPhotoDocId: photoDocId,
      tokenEventId: verified.eventId,
      bodyEventId: eventId,
    });
    res.status(401).json({ error: 'token payload mismatch' });
    return;
  }

  // (4) Parse the photoUrl to extract eventId, guestId,
  // filename. The URL looks like:
  //   https://cdn.savetheday.io/photos/<eventId>/<guestId>/<filename>
  // We already trust eventId from the body (verified against
  // the token), but we still parse the URL for guestId +
  // filename because the NAS's DELETE handler binds the token
  // to those two fields.
  const urlParts = parsePhotoUrl(photoUrl);
  if (!urlParts) {
    res.status(400).json({
      error: 'photoUrl does not match expected cdn.savetheday.io/photos/... shape',
    });
    return;
  }
  if (urlParts.eventId !== eventId) {
    // The token is bound to eventId, but the URL points to a
    // different event — bail. A token for event A can't be
    // used to delete a photo in event B even if the caller's
    // auth would otherwise allow it.
    res.status(400).json({
      error: 'photoUrl eventId does not match token eventId',
    });
    return;
  }
  if (!SAFE_ID.test(urlParts.guestId) || !SAFE_ID.test(urlParts.filename)) {
    res.status(400).json({ error: 'photoUrl guestId or filename failed SAFE_ID' });
    return;
  }

  // (5) Mint a fresh NAS-bound HMAC token. Same algorithm the
  // NAS receiver verifies. The token binds the specific file
  // (eventId|guestId|filename|expiresMs) so it can't be
  // replayed against a different photo.
  const nasExpiresMs = Date.now() + TOKEN_TTL_MS;
  const nasToken = await mintNasDeleteToken(
    NAS_HMAC_SECRET,
    urlParts.eventId,
    urlParts.guestId,
    urlParts.filename,
    nasExpiresMs,
  );

  // (6) Build the NAS DELETE URL. The path is
  // /delete/<eventId>/<guestId>/<filename> per the NAS
  // receiver's do_DELETE handler.
  const targetUrl = `${NAS_DELETE_URL.replace(/\/+$/, '')}/${urlParts.eventId}/${urlParts.guestId}/${urlParts.filename}`;

  // eslint-disable-next-line no-console
  console.log('[photo-delete] forwarding', {
    photoDocId: photoDocId.slice(0, 12),
    eventId: eventId.slice(0, 8),
    guestId: urlParts.guestId.slice(0, 8),
    filename: urlParts.filename,
    issuerUid: verified.issuerUid,
    nasHost: new URL(NAS_DELETE_URL).host,
  });

  // (7) Forward the DELETE. Use a manual redirect: 'manual'
  // to avoid Vercel swallowing the response (we want the NAS's
  // 204 to bubble back to the client). Same pattern the upload
  // proxy uses (it doesn't need this because the NAS returns
  // the photo URL as JSON; the delete response is just a
  // status + the bytes-deleted path).
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: 'DELETE',
      redirect: 'manual',
      headers: {
        'X-Upload-Token': nasToken,
        'X-Upload-Expires': String(nasExpiresMs),
        'X-Upload-Op': 'delete',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[photo-delete] fetch to NAS failed:', err);
    res.status(502).json({
      error: '無法連接到 NAS delete server，請稍後再試',
    });
    return;
  }

  const responseText = await upstream.text();

  // eslint-disable-next-line no-console
  console.log('[photo-delete] upstream', {
    status: upstream.status,
    bytes: responseText.length,
    preview: responseText.slice(0, 200),
  });

  // Forward the response. If JSON, pass through with the
  // original status; if not, send raw text.
  try {
    const json = JSON.parse(responseText);
    res.status(upstream.status).json(json);
  } catch {
    res.status(upstream.status).send(responseText);
  }
}

// ---- HMAC helpers (mirroring api/photo-upload.js) ----

// Mint an NAS-bound delete token. Web Crypto for cross-runtime
// compatibility (Vercel Node 22 + local jest jsdom). The
// message is eventId|guestId|filename|expiresMs — same shape
// the NAS receiver verifies (see deploy/photo_upload_server.py
// _handle_delete_path).
async function mintNasDeleteToken(secret, eventId, guestId, filename, expiresMs) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${eventId}|${guestId}|${filename}|${expiresMs}`),
  );
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// Verify a CF delete token. Same algorithm as
// verifyUploadPreferencesToken: b64url(json(payload)).base64url(hmac).
// Returns null on any failure (missing secret, malformed
// token, bad signature) — caller treats null as "reject the
// request". Never throws so a malicious token can't take down
// the delete path.
async function verifyPhotoDeleteToken(token, secret) {
  if (!secret) return null;
  if (typeof token !== 'string' || token.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!b64 || !sig) return null;
  let expected;
  try {
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

// Parse the photoUrl to extract the (eventId, guestId,
// filename) triple. The URL shape is
//   https://cdn.savetheday.io/photos/<eventId>/<guestId>/<filename>
// where filename is a <ts>_<nonce>.<ext> string. We accept
// the host portion being anything that matches the path
// component /photos/<...> — cdn.savetheday.io is the canonical
// host but the same URL shape is produced on staging / in
// local dev where the NAS is reached directly.
function parsePhotoUrl(photoUrl) {
  if (typeof photoUrl !== 'string') return null;
  try {
    const u = new URL(photoUrl);
    // Strip query string + fragment.
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/');
    if (parts.length !== 4) return null;
    if (parts[0] !== 'photos') return null;
    return {
      eventId: parts[1],
      guestId: parts[2],
      filename: parts[3],
    };
  } catch {
    return null;
  }
}