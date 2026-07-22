// Vercel serverless function (ES module) — proxies Firebase Cloud
// Function calls to bypass Cloud Run's CORS preflight rejection.
//
// Why this exists:
// Cloud Functions v2 (running on Cloud Run) rejects OPTIONS preflight
// requests at the edge with 403 even when the function has `cors: true`
// set. This means browser-based calls from the savetheday.io front-end
// fail with "No Access-Control-Allow-Origin header". This proxy accepts
// same-origin requests from the browser and forwards them server-to-
// server to Firebase, where there's no preflight.
//
// Usage:
//   POST /api/firebase-proxy?fn=sendInvitationsV2
//   POST /api/firebase-proxy?fn=autoLinkVendorContactsV2
//   POST /api/firebase-proxy?fn=verifyShareToken
//
// Body: standard Firebase callable envelope — { data: {...args} }
//
// Returns: Firebase callable response — { data: ..., result?: ... }
//          or { error: { code, message, details } }

const PROJECT_ID = 'savetheday-2377a';
const REGION = 'us-central1';

export default async function handler(req, res) {
  // CORS for the proxy itself (same-origin so not strictly needed,
  // but useful for local dev / cross-origin testing).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' },
    });
  }

  const fnName = req.query.fn;
  if (!fnName) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Missing ?fn=' },
    });
  }

  // Whitelist allowed functions — otherwise anyone could proxy
  // arbitrary calls through this endpoint.
  const ALLOWED = new Set([
    'sendInvitationsV2',
    'sendInvitations',
    'autoLinkVendorContactsV2',
    'autoLinkVendorContacts',
    'verifyShareToken',
  ]);
  if (!ALLOWED.has(fnName)) {
    return res.status(403).json({
      error: { code: 'NOT_ALLOWED', message: 'Function not in allowlist' },
    });
  }

  // Forward the Authorization header (if any) so Firebase Functions
  // receives the user's ID token.
  const authHeader = req.headers.authorization || '';
  const body = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body || {});

  const targetUrl = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${fnName}`;

  // 2026-07-22 — Debug: log what we're forwarding.
  console.log('[firebase-proxy]', {
    fn: fnName,
    hasAuthHeader: !!authHeader,
    authHeaderPrefix: authHeader.slice(0, 20),
    bodyPreview: body.slice(0, 100),
  });

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        // 2026-07-22 — Forward User-Agent so Cloud Run can
        // recognize the request as coming from the Firebase SDK
        // (or a similar browser client). Without this, Cloud
        // Run's edge rejects Bearer tokens with
        // "access token could not be verified" because it
        // can't tell the difference between a Firebase ID
        // token and a Google OAuth access token.
        'User-Agent': req.headers['user-agent'] || 'savetheday-proxy/1.0',
      },
      body,
    });
    const text = await upstream.text();
    console.log('[firebase-proxy] upstream response', {
      fn: fnName,
      status: upstream.status,
      bodyPreview: text.slice(0, 200),
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = {
        error: { code: 'UPSTREAM_NOT_JSON', message: text.slice(0, 500) },
      };
    }
    // Firebase callable protocol: server returns
    //   { result: <data> } on success
    //   { error: { code, message, details } } on error
    // The Firebase SDK unwraps `result` → `data` for callers.
    // Since our proxy replaces the SDK, do the same here so
    // callers can do `result.data.sent` as they would with
    // httpsCallable().
    if (json && typeof json === 'object' && !json.error) {
      if (json.result !== undefined) {
        json = { data: json.result };
      } else if (json.data === undefined) {
        // Some custom functions return bare data without
        // wrapping in `result`. Preserve as-is.
        json = { data: json };
      }
    }
    return res.status(upstream.status).json(json);
  } catch (err) {
    console.log('[firebase-proxy] fetch failed', { fn: fnName, err: err?.message });
    return res.status(502).json({
      error: {
        code: 'PROXY_FAILED',
        message: err?.message || String(err),
      },
    });
  }
}
