/**
 * Partner-invite HMAC unit tests — savetheday-2377a
 *
 * Covers the 2026-07-27 commit `afabd73` "fail-closed HMAC_KEY secret
 * + drop preview eventId leak" fixes:
 *
 *   1. `getHmacKey` throws HttpsError('failed-precondition') when
 *      the HMAC key is empty (no dev fallback — the prior
 *      'dev-only-do-not-ship-savetheday-2377a' default was the
 *      critical security hole).
 *   2. `signToken` + `verifyToken` round-trip recovers the original
 *      payload.
 *   3. Tampering with the payload b64 (e.g. swapping partnerEmail
 *      for a different one) breaks the signature and throws
 *      'Bad signature'.
 *   4. Tampering with the signature b64 also throws 'Bad signature'.
 *   5. Malformed tokens (no '.', empty string, garbage) throw
 *      'Malformed token'.
 *   6. The INVITE_TTL_MS constant is 7 days (invariant the
 *      redeem/preview handlers depend on).
 *   7. Token payload includes `iat` (issued-at) — required for
 *      the TTL check in redeemPartnerInviteV2 / previewPartnerInvite.
 *
 * The onCall wrappers (sendPartnerInviteV2, redeemPartnerInviteV2,
 * previewPartnerInvite, removePartnerInviteV2, listPartnerInvites)
 * are NOT exercised here — they require a live Firebase
 * Auth/Firestore emulator. End-to-end coverage of those is the
 * deployed Cloud Function (verified via gcloud functions describe
 * + live source-zip grep; see skills `firebase-cf-v2-deploy-verify`
 * for the verification recipe).
 *
 * 2026-07-28 — Refactored: imports come from `../src/hmac` (the
 * pure module) instead of `../src/partnerInvite` (which pulls in
 * firebase-admin/{app,firestore,auth}). The previous revision
 * required `vi.mock()` for three firebase-admin modules just to
 * instantiate the module. After splitting hmac.ts out, the test
 * needs ZERO mocks — `getHmacKey(key)` is a pure function of its
 * argument, `signToken(payload, key)` likewise, and `verifyToken`
 * only needs `crypto` + `HttpsError` (the latter is just a class).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  getHmacKey,
  signToken,
  verifyToken,
  INVITE_TTL_MS,
} from '../src/hmac';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TEST_HMAC = 'unit-test-only-key-do-not-ship';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('partnerInvite HMAC primitives', () => {
  it('INVITE_TTL_MS is 7 days', () => {
    expect(INVITE_TTL_MS).toBe(SEVEN_DAYS_MS);
  });

  describe('getHmacKey fail-closed', () => {
    it('throws failed-precondition when HMAC key is empty', () => {
      expect(() => getHmacKey('')).toThrow(HttpsError);
      try {
        getHmacKey('');
      } catch (e) {
        const err = e as HttpsError;
        expect(err.code).toBe('failed-precondition');
        expect(err.message).toMatch(/HMAC_KEY/i);
      }
    });

    it('throws failed-precondition when HMAC key is undefined', () => {
      expect(() => getHmacKey(undefined)).toThrow(HttpsError);
    });

    it('returns the trimmed key when set to a non-empty value', () => {
      expect(getHmacKey(TEST_HMAC)).toBe(TEST_HMAC);
    });

    it('trims a leading/trailing newline (Secret Manager trailing-\\n mitigation)', () => {
      // Secret Manager values arrive with a trailing newline; see
      // firebase-cf-v2-deploy-verify/references/secret-manager-trailing-newline-2026-07-27.md
      expect(getHmacKey(TEST_HMAC + '\n')).toBe(TEST_HMAC);
      expect(getHmacKey('\n' + TEST_HMAC)).toBe(TEST_HMAC);
    });
  });

  describe('signToken / verifyToken round-trip', () => {
    beforeEach(() => {
      vi.stubEnv('HMAC_KEY', TEST_HMAC);
    });

    it('recovers the original payload', () => {
      const payload = {
        ownerUid: 'owner-A',
        eventId: 'E1',
        partnerEmail: 'partner@example.com',
        iat: 1234567890,
      };
      const token = signToken(payload, TEST_HMAC);
      const recovered = verifyToken<typeof payload>(token, TEST_HMAC);
      expect(recovered).toEqual(payload);
    });

    it('emits a token with the b64.sig shape', () => {
      const token = signToken({ iat: 1 }, TEST_HMAC);
      expect(token).toContain('.');
      const [b64, sig] = token.split('.');
      expect(b64).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(sig).toMatch(/^[A-Za-z0-9_-]+$/); // base64url HMAC
      expect(b64.length).toBeGreaterThan(0);
      expect(sig.length).toBeGreaterThan(0);
    });
  });

  describe('signature integrity', () => {
    beforeEach(() => {
      vi.stubEnv('HMAC_KEY', TEST_HMAC);
    });

    it('rejects a token whose payload b64 was tampered with', () => {
      const token = signToken({
        ownerUid: 'owner-A',
        eventId: 'E1',
        partnerEmail: 'partner@example.com',
        iat: 100,
      }, TEST_HMAC);
      const [b64, sig] = token.split('.');
      // Decode the b64, swap the email, re-encode WITHOUT re-signing.
      const decoded = JSON.parse(
        Buffer.from(b64, 'base64url').toString('utf8'),
      );
      decoded.partnerEmail = 'attacker@example.com';
      const tamperedB64 = Buffer.from(
        JSON.stringify(decoded),
        'utf8',
      ).toString('base64url');
      const tamperedToken = `${tamperedB64}.${sig}`;
      try {
        verifyToken(tamperedToken, TEST_HMAC);
        throw new Error('expected verifyToken to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpsError);
        expect((e as HttpsError).code).toBe('permission-denied');
        expect((e as HttpsError).message).toBe('Bad signature.');
      }
    });

    it('rejects a token whose signature was tampered with', () => {
      const token = signToken({ iat: 100 }, TEST_HMAC);
      const [b64, sig] = token.split('.');
      // Flip the last char of the sig to make it invalid base64url.
      const tamperedSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
      const tamperedToken = `${b64}.${tamperedSig}`;
      try {
        verifyToken(tamperedToken, TEST_HMAC);
        throw new Error('expected verifyToken to throw');
      } catch (e) {
        expect((e as HttpsError).code).toBe('permission-denied');
        expect((e as HttpsError).message).toBe('Bad signature.');
      }
    });

    it('rejects a token signed with a different key', () => {
      const token = signToken({ iat: 100 }, TEST_HMAC);
      // Rotate the key — the same payload should no longer verify.
      expect(() => verifyToken(token, 'a-different-key')).toThrow(HttpsError);
      try {
        verifyToken(token, 'a-different-key');
      } catch (e) {
        expect((e as HttpsError).code).toBe('permission-denied');
      }
    });
  });

  describe('malformed tokens', () => {
    beforeEach(() => {
      vi.stubEnv('HMAC_KEY', TEST_HMAC);
    });

    it('rejects a token with no dot separator', () => {
      try {
        verifyToken('not-a-token', TEST_HMAC);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpsError).code).toBe('invalid-argument');
        expect((e as HttpsError).message).toBe('Malformed token.');
      }
    });

    it('rejects an empty string', () => {
      try {
        verifyToken('', TEST_HMAC);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpsError).code).toBe('invalid-argument');
      }
    });

    it('rejects a token whose b64 decodes to invalid JSON', () => {
      // The only path to "Bad payload" is: signature shape matches but
      // the b64 is structurally valid base64url that decodes to text
      // which is NOT valid JSON. The way to hit it: forge a token
      // where the b64 is base64url of a non-JSON string and the
      // signature matches. We use crypto directly here since the
      // signing path is covered by the round-trip test above.
      const { createHmac } = require('node:crypto') as typeof import('node:crypto');
      const nonJsonB64 = Buffer.from('definitely not json', 'utf8').toString('base64url');
      const sig = createHmac('sha256', TEST_HMAC).update(nonJsonB64).digest('base64url');
      const forgedToken = `${nonJsonB64}.${sig}`;
      try {
        verifyToken(forgedToken, TEST_HMAC);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpsError).code).toBe('invalid-argument');
        expect((e as HttpsError).message).toBe('Bad payload.');
      }
    });
  });
});