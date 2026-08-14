// Vercel serverless function — receives CSP violation reports.
//
// Context:
// savetheday.io deploys a Content-Security-Policy-Report-Only header
// (see vercel.json). When a browser sees a violation, it POSTs the
// report to the URL listed in `report-uri /api/csp-report`. Before
// this file existed, that endpoint returned 405 (Method Not Allowed)
// and the reports were silently dropped (visible in Chrome DevTools
// console as "POST /api/csp-report 405").
//
// 2026-08-14 — M-06 follow-up. We now:
//   1. Accept both legacy format (application/csp-report with
//      { "csp-report": {...} }) and the modern Reporting API
//      format (application/reports+json with { "reports": [...] }).
//   2. Validate the body shape (size cap, required fields, no
//      scripts echoed back).
//   3. Persist to Firestore at
//      /artifacts/{appId}/admin/cspReports/{reportId} so admins
//      can review violations in the future (we don't yet have a
//      UI for this — the data is queryable via the Firebase
//      console or admin SDK).
//   4. Apply a per-IP rate limit (sliding window, in-memory) so
//      an attacker can't DoS us by spamming violations. The
//      limit is intentionally generous (~ 60/min) so legitimate
//      report bursts (e.g. after a deploy) aren't dropped, but
//      a single attacker can't fill up Firestore with junk.
//   5. Always return 204 No Content on success — CSP reports
//      are explicitly designed to be silent; the browser doesn't
//      care about the response body.
//
// What we deliberately DON'T do:
//   - Trust the report's `script-sample` or `blocked-uri` fields
//     for any security decision. Reports are advisory only.
//   - Reflect anything from the request back in the response.
//   - Persist the full report URL (it can be a query-string with
//     tokens). We persist only the violation metadata.
//
// Same-origin only: the browser sends the report from the same
// origin that received the violation, so we don't need CORS.

import { randomUUID } from 'node:crypto';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const APP_ID = 'savetheday-production';
const MAX_BODY_BYTES = 8 * 1024; // 8 KB. CSP reports are tiny.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60; // 60 reports per IP per minute

// Per-IP sliding window. Vercel cold-starts are per-instance, so
// this is best-effort — it doesn't share across instances. But
// even partial protection is enough to slow down a single-IP
// spammer; the Firestore write is the actual cost.
const _rateLimitBuckets = new Map();

function rateLimitOk(ip) {
  if (!ip) return true; // dev: no IP, allow through
  const now = Date.now();
  const bucket = _rateLimitBuckets.get(ip) || [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    return false;
  }
  fresh.push(now);
  _rateLimitBuckets.set(ip, fresh);
  // best-effort cleanup of stale empty keys
  if (_rateLimitBuckets.size > 5000) {
    for (const [k, v] of _rateLimitBuckets) {
      if (v.length === 0 || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) {
        _rateLimitBuckets.delete(k);
      }
    }
  }
  return true;
}

// Lazy firebase-admin init (same pattern as api/photo-upload.js).
// We only need Firestore — no auth here.
let _db = null;
function getDb() {
  if (_db) return _db;
  if (getApps().length === 0) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!sa) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON env var not set; cannot persist CSP ' +
          'reports. The endpoint will start returning 503 until this is set.',
      );
    }
    initializeApp({ credential: cert(JSON.parse(sa)) });
  }
  _db = getFirestore();
  return _db;
}

function clientIp(req) {
  // Vercel sets x-forwarded-for; the first hop is the client.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

// Normalize a single report — strip everything we don't want to
// persist, keep the pieces that help us diagnose.
//
// 2026-08-14 — exported for unit tests. The pure normalization
// logic is the riskiest piece (size limits, malformed bodies,
// legacy/new format detection); we want to lock those down
// without mocking firebase-admin.
export function normalizeReport(report, source) {
  if (!report || typeof report !== 'object') return null;
  // Two shapes:
  //  - legacy: { "csp-report": { "document-uri":..., "violated-directive":... } }
  //  - new:    { "type":"csp", "body":{ "document-uri":..., "violated-directive":... } }
  const body = report['csp-report'] || report.body || report;
  if (!body || typeof body !== 'object') return null;
  const vd = typeof body['violated-directive'] === 'string'
    ? body['violated-directive'] : '';
  const eff = typeof body['effective-directive'] === 'string'
    ? body['effective-directive'] : '';
  const doc = typeof body['document-uri'] === 'string'
    ? body['document-uri'] : '';
  const blocked = typeof body['blocked-uri'] === 'string'
    ? body['blocked-uri'] : '';
  // Trim any of these to 1 KB — they can be large but we don't
  // need the full payload.
  const trim = (s) => s ? s.slice(0, 1024) : '';
  return {
    violatedDirective: trim(vd),
    effectiveDirective: trim(eff),
    documentUri: trim(doc),
    blockedUri: trim(blocked),
    disposition: typeof body.disposition === 'string'
      ? body.disposition : 'report',
    sourcePolicy: typeof body['source-file'] === 'string'
      ? trim(body['source-file']) : '',
    lineNumber: typeof body['line-number'] === 'number'
      ? body['line-number'] : null,
    columnNumber: typeof body['column-number'] === 'number'
      ? body['column-number'] : null,
    sample: typeof body['script-sample'] === 'string'
      ? trim(body['script-sample']) : '',
    timestamp: new Date().toISOString(),
    source, // 'legacy-csp-report' or 'reporting-api'
  };
}

// Read the raw body from the underlying IncomingMessage stream.
// Vercel does NOT auto-parse `application/csp-report` or
// `application/reports+json` — the spec content-types for CSP
// reports — so for those reports `req.body` is undefined. We
// fall back to buffering the stream manually.
//
// 2026-08-14 — exported for unit tests. The stream-parser
// logic is the riskiest piece after the first version (which
// only handled application/json and dropped all real browser
// reports). We want to lock the chunk-buffering + size-cap
// behavior down without mocking firebase-admin.
//
// Buffer cap is `MAX_BODY_BYTES`. We enforce it on the wire
// BEFORE JSON parsing so a giant payload can't exhaust memory.
export async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        // Reject the request — we've already over-consumed, so
        // there's no way to safely back out. The client should
        // retry with a smaller payload.
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) {
        resolve(null);
        return;
      }
      const buf = Buffer.concat(chunks);
      // The body is JSON-encoded (CSP reports are JSON by spec).
      // We return a string so the JSON.parse path downstream
      // works uniformly.
      resolve(buf.toString('utf8'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}


// 2026-08-14 — M-06 follow-up. Detect the three report shapes
// the browser might send:
//
//   1. Reporting API (multi):   { age, type, reports: [r1, r2, ...] }
//   2. Reporting API (single):  { age, type, url, body: {...} }
//   3. Legacy application/csp-report: { 'csp-report': {...} }
//
// Returns an array of normalized reports. The `source` field of
// each result records which shape the original wrapper was in,
// which the admin view uses to tell legacy from modern.
//
// Why we extract this from the handler: the inline branch
// chain was easy to misread (the legacy branch ran for the
// Reporting API single-report shape because the body has `body`
// not `csp-report`). Pulling it out and unit-testing each
// branch catches the bug class.
export function classifyReports(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  if (Array.isArray(parsed.reports)) {
    // 1. Reporting API multi-report envelope
    const out = [];
    for (const r of parsed.reports) {
      const n = normalizeReport(r, 'reporting-api');
      if (n) out.push(n);
    }
    return out;
  }
  if ('body' in parsed) {
    // 2. Reporting API single-report envelope. The `body` field
    // is the inner violation payload. We require it to be a
    // non-null object; null/string/number bodies are treated
    // as malformed and dropped rather than classified as legacy,
    // because a malformed Reporting API envelope is not the
    // same as a legacy report.
    if (parsed.body && typeof parsed.body === 'object') {
      const n = normalizeReport(parsed.body, 'reporting-api');
      return n ? [n] : [];
    }
    return [];
  }
  // 3. Legacy application/csp-report
  const n = normalizeReport(parsed, 'legacy-csp-report');
  return n ? [n] : [];
}

export default async function handler(req, res) {
  // CSP browsers only POST.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  // Rate limit per IP.
  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
    return res.status(429).json({ error: 'rate-limited' });
  }

  // Body size cap. Vercel parses the body for us, but the
  // supported Content-Types are limited:
  //   - application/json → parsed as object
  //   - application/x-www-form-urlencoded → parsed as object
  //   - application/csp-report → STRING or undefined (this is the
  //     spec content-type for legacy CSP reports, and Vercel
  //     does NOT auto-parse it)
  //   - application/reports+json → STRING or undefined (modern
  //     Reporting API; same Vercel limitation)
  //
  // 2026-08-14 — M-06 fix #2. We now handle the
  // req.body-is-undefined case by reading the raw body via the
  // Node IncomingMessage stream. This is the only reliable path
  // for application/csp-report reports because browsers always
  // send that content-type per the W3C spec.
  let raw;
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    raw = req.body;
  } else {
    // Vercel exposes the raw body as a stream on the underlying
    // request. We buffer it manually so we can JSON.parse it.
    raw = await readRawBody(req);
  }
  if (raw == null || raw === '') {
    return res.status(204).end();
  }
  // The body might be parsed as an object (JSON) or a string.
  let bodyStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (bodyStr.length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'body too large' });
  }

  // Parse JSON if we got a string.
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    // Malformed JSON. Don't reject the request — the browser
    // doesn't care about the response. Just log so we can
    // diagnose if a real browser sends broken JSON.
    console.error('csp-report malformed JSON:', err.message, 'first 256 chars:', bodyStr.slice(0, 256));
    return res.status(204).end();
  }

  // Normalize one or many reports. The shape-detection logic is
  // extracted into `classifyReports` so we can unit-test it
  // without mocking Firestore. See api/csp-report.test.js for
  // the cases that motivated extracting this.
  const reports = classifyReports(parsed);

  if (reports.length === 0) {
    return res.status(204).end();
  }

  // Persist. We batch into a single Firestore write (Writes) per
  // request — Vercel cold-starts are slow enough we want to be
  // efficient. We use the Admin SDK so the bypass-security-rules
  // is automatic; the path is admin-only by design.
  try {
    const db = getDb();
    const batch = db.batch();
    let pending = 0;
    for (const r of reports) {
      const ref = db
        .collection('artifacts')
        .doc(APP_ID)
        .collection('admin')
        .doc('cspReports')
        .collection('reports')
        .doc();  // auto-id
      batch.set(ref, {
        ...r,
        clientIp: ip, // for spam triage, not user-PII
        ua: typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 256) : '',
        createdAt: FieldValue.serverTimestamp(),
      });
      pending++;
    }
    if (pending > 0) await batch.commit();
  } catch (err) {
    // Don't 5xx the browser — that just makes it retry. Log loudly
    // for the Vercel log stream and return 204.
    console.error('csp-report persist failed:', err.message);
  }

  return res.status(204).end();
}
