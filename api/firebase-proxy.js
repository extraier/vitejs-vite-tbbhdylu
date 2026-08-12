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
//
// 2026-08-13 — H-04 (HIGH) fix: previously this function logged the
// first 20 chars of the Authorization header AND the first 100 chars
// of every forwarded request body. Forwarded bodies can include
// vendor invitationToken, comment text, contact data, etc. — so
// those logs were leaking secrets into Vercel's log stream. Logging
// is now reduced to { traceId, fn, status, durationMs, bodyBytes }
// — enough to diagnose routing/timeout/upstream-5xx without leaking
// auth headers or payload contents.

import { randomUUID } from 'node:crypto';

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
    'autoLinkVendorContactsV2',
    // 2026-07-23 — couples post 徵求報價 via this callable because
    // direct Firestore writes to /jobRequests hit the catch-all
    // deny (the rule match is under /artifacts/{appId}/jobRequests
    // but the collection lives at the top level).
    'postJobRequest',
    // 2026-08-08 — vendors reply to a job posting via this callable
    // (was previously a stub that only mutated in-memory React state,
    // so nothing actually reached the couple). Same routing pattern
    // as postJobRequest — see the jobBoard.ts docstring for the
    // 1-click / vendor-composer UX flow.
    'submitProposal',
    'verifyShareToken',
    // 2026-07-27 — 電子人情 QR upload/delete. Server-side because
    // client-side Storage rules with firestore.exists() don't work
    // reliably (see memory). The CFs verify owner/coOwner via Admin
    // SDK and write both Storage + Firestore.
    'uploadRedPacketV2',
    'deleteRedPacketV2',
    // 2026-07-27 — Partner invite preview (?t=<token> on landing).
    // Previously called directly via httpsCallable() which hit Cloud
    // Run's preflight rejection at the edge (403 Bad signature).
    // Routing through the proxy bypasses preflight entirely.
    'previewPartnerInvite',
    // 2026-08-11 — Social proof (Instagram / Facebook screenshot
    // unlock path). submitSocialProof + listSocialProofs are
    // called by the couple (SocialProofModal) when submitting
    // IG/FB proof; adminVerifySocialProof is called by the admin
    // from AdminQueue. All three must be in the allowlist or the
    // proxy returns 403 NOT_ALLOWED before the call reaches the
    // Cloud Function, even when the CF is ACTIVE and IAM is
    // correct (Trap 15 — see firebase-cf-v2-deploy-verify
    // references/cloud-functions-proxy-allowlist-2026-08-09.md).
    'submitSocialProof',
    'listSocialProofs',
    'adminVerifySocialProof',
    // 2026-08-12 — Vendor-side comment write via Cloud Function.
    // Vendor/helper chat writes have been silently failing on the
    // vendor's Incognito tab despite the live rules verifying OK on
    // REST probes — most likely a runQuery-vs-listDocuments divergence
    // in the rules engine on collectionGroup LISTEN channels. This
    // routes around the rules layer entirely: the CF verifies caller
    // authorization via Admin SDK and writes the comment via Admin
    // SDK. Without these two entries, vendor / helper chat stays
    // stuck on the rules-engine quirk indefinitely. See
    // functions/src/vendorComment.ts for the auth shape.
    'vendorPostComment',
    'vendorPostCommentHelper',
  ]);
  if (!ALLOWED.has(fnName)) {
    return res.status(403).json({
      error: { code: 'NOT_ALLOWED', message: 'Function not in allowlist' },
    });
  }

  // Forward the Authorization header (if any) so Firebase Functions
  // receives the user's ID token. NEVER log this header or the body
  // content — the body can carry invitationToken / vendor claims /
  // contact data, and the header carries the user's Firebase ID
  // token. See H-04 fix note at the top of this file.
  const authHeader = req.headers.authorization || '';
  const body = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body || {});

  const targetUrl = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${fnName}`;

  // 2026-08-13 — H-04 fix. Trace id ties the request log to any
  // downstream Cloud Function log without needing to echo payload
  // content. The caller passes `x-trace-id` if it has one (so logs
  // align across browser → proxy → CF); otherwise we mint a fresh
  // UUID for this proxy invocation.
  const traceId = (req.headers['x-trace-id'] && typeof req.headers['x-trace-id'] === 'string')
    ? req.headers['x-trace-id']
    : randomUUID();
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  const startedAt = Date.now();

  console.log('[firebase-proxy] request', {
    traceId,
    fn: fnName,
    hasAuthHeader: !!authHeader,
    bodyBytes,
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
        'x-trace-id': traceId,
      },
      body,
    });
    const text = await upstream.text();
    console.log('[firebase-proxy] response', {
      traceId,
      fn: fnName,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      responseBytes: Buffer.byteLength(text, 'utf8'),
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Upstream returned non-JSON. Don't echo the raw body back to
      // the caller (it can contain stack traces with secrets) — log
      // only the trace id + size so we can find the body in Vercel's
      // logs if we really need it.
      console.error('[firebase-proxy] upstream-not-json', {
        traceId,
        fn: fnName,
        status: upstream.status,
        responseBytes: Buffer.byteLength(text, 'utf8'),
      });
      json = {
        error: {
          code: 'UPSTREAM_NOT_JSON',
          message: 'Upstream returned non-JSON response',
          traceId,
        },
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
    console.error('[firebase-proxy] fetch-failed', {
      traceId,
      fn: fnName,
      durationMs: Date.now() - startedAt,
      err: err?.message,
    });
    return res.status(502).json({
      error: {
        code: 'PROXY_FAILED',
        message: err?.message || String(err),
        traceId,
      },
    });
  }
}
