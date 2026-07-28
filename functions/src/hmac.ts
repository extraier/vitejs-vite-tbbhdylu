// hmac.ts — pure HMAC primitives for partner-invite tokens.
//
// Split out of partnerInvite.ts on 2026-07-28 so the unit tests
// (functions/test/partnerInvite.test.ts) can import these helpers
// WITHOUT needing to import the partnerInvite.ts module — which
// pulls in firebase-admin/{app,firestore,auth} at module load and
// requires mocking three modules to avoid real GCP credentials.
//
// Everything here is a pure function over its arguments. No module-
// level state, no firebase-admin imports, no `process.env` reads.
// The fail-closed "key must be non-empty" check takes the key as
// an argument rather than reading it from process.env so the unit
// tests can drive both the happy path and the throw path directly.
//
// HttpsError is the only firebase-functions dependency — it's just
// a class, cheap to import, and the test asserts on .code / .message
// to verify the production contract. Swapping it for a generic Error
// would diverge from the deployed function's error shape.
//
// ────────────────────────────────────────────────────────────────────────────

import { HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'node:crypto';

/**
 * Magic-link token TTL: 7 days. Plenty for a partner to find the
 * email and click; short enough that abandoned invites don't
 * linger forever. Redeem/preview handlers depend on this invariant
 * (see tests/partnerInvite.test.ts "INVITE_TTL_MS is 7 days").
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fail-closed secret loader. Trims the input (Secret Manager values
 * arrive with a trailing newline — see
 * firebase-cf-v2-deploy-verify/references/secret-manager-trailing-newline-2026-07-27.md),
 * throws `HttpsError('failed-precondition')` when the trimmed key
 * is empty or undefined. Production callers pass
 * `HMAC_KEY.value()`; tests pass `vi.stubEnv('HMAC_KEY', ...)`
 * values via `process.env.HMAC_KEY`.
 *
 * Returns the trimmed key on success.
 */
export function getHmacKey(key: string | undefined): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) {
    // We do NOT throw at module load — the secret is resolved per
    // invocation in Cloud Functions v2. Throwing here surfaces as an
    // HttpsError to the caller with enough detail to debug. The
    // prior implementation had a hardcoded `DEFAULT_HMAC_KEY =
    // 'dev-only-do-not-ship-savetheday-2377a'` fallback that signed
    // production tokens if the secret wasn't set — see commit
    // `afabd73` for the fail-closed migration.
    throw new HttpsError(
      'failed-precondition',
      'HMAC_KEY secret is missing or empty; configure via ' +
        '`firebase functions:secrets:set HMAC_KEY` ' +
        'and add to onCall secrets[] array.',
    );
  }
  return trimmed;
}

/**
 * Sign a JSON payload into a `b64.sig` token using HMAC-SHA-256.
 * `key` is the trimmed HMAC secret (call getHmacKey() to load it).
 * The signature is deterministic over (payload, key), so the same
 * pair always produces the same token — useful for cache keys and
 * idempotent retries.
 */
export function signToken(payload: object, key: string): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', key)
    .update(b64)
    .digest('base64url');
  return `${b64}.${sig}`;
}

/**
 * Verify a `b64.sig` token produced by signToken. Throws on:
 *   - Malformed input (no '.', empty b64, empty sig) → 'invalid-argument'
 *   - Signature length mismatch (defensive: avoids timingSafeEqual
 *     blowing up on different-length buffers) → 'permission-denied'
 *   - Signature mismatch (using timingSafeEqual to avoid timing
 *     side-channels) → 'permission-denied'
 *   - B64 decodes to non-JSON → 'invalid-argument'
 *
 * Returns the parsed payload on success.
 */
export function verifyToken<T = any>(token: string, key: string): T {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) throw new HttpsError('invalid-argument', 'Malformed token.');
  const expected = crypto
    .createHmac('sha256', key)
    .update(b64)
    .digest('base64url');
  if (sig.length !== expected.length) {
    throw new HttpsError('permission-denied', 'Bad signature.');
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new HttpsError('permission-denied', 'Bad signature.');
  }
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    throw new HttpsError('invalid-argument', 'Bad payload.');
  }
}