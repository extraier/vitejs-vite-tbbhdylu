/**
 * uploadPreferencesToken tests — savetheday-2377a
 *
 * Unit tests for the HMAC token shape used by
 * getUploadPreferencesToken + the Vercel /api/photo-upload
 * proxy. The CF itself (Firestore lookup, auth gate) is
 * covered by the deployed function (verified via gcloud
 * functions describe + live source-zip grep, like other CFs).
 *
 * What's tested here:
 *   1. signToken / verifyToken round-trip on the new payload
 *      shape (ownerUid, watermarkDisabled, issuedAt, expiresAt).
 *   2. Tampering with the ownerUid flips verifyToken to
 *      'permission-denied' (defense in depth: Vercel proxy
 *      re-checks ownerUid against the eventId in the upload).
 *   3. Tampering with watermarkDisabled flag also fails.
 *   4. Token payload includes `expiresAt` (Vercel proxy
 *      rejects expired tokens).
 *
 * 2026-08-02 — initial release.
 */

import { describe, expect, it } from 'vitest';
import {
  getHmacKey,
  signToken,
  verifyToken,
} from '../src/hmac';

// Matches the shape produced by getUploadPreferencesToken.
// Extracted here so a future schema change forces the test to
// update too.
type UploadPreferencesToken = {
  ownerUid: string;
  watermarkDisabled: boolean;
  issuedAt: number;
  expiresAt: number;
};

const TEST_KEY = 'unit-test-hmac-key-do-not-ship';

describe('uploadPreferencesToken payload shape', () => {
  it('round-trips signToken → verifyToken', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'abc123firebaseUid',
      watermarkDisabled: true,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60 * 60 * 1000,
    };
    const token = signToken(payload, getHmacKey(TEST_KEY));
    const decoded = verifyToken<UploadPreferencesToken>(token, getHmacKey(TEST_KEY));
    expect(decoded).toEqual(payload);
  });

  it('flips to permission-denied when ownerUid is swapped', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'owner-A',
      watermarkDisabled: true,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60 * 60 * 1000,
    };
    const token = signToken(payload, getHmacKey(TEST_KEY));
    // Attacker re-b64s the payload with a different ownerUid.
    // They can't forge the signature, so verifyToken MUST throw.
    const [b64, sig] = token.split('.');
    const tamperedPayload: UploadPreferencesToken = { ...payload, ownerUid: 'owner-B' };
    const tamperedB64 = Buffer.from(JSON.stringify(tamperedPayload), 'utf8').toString('base64url');
    const tampered = `${tamperedB64}.${sig}`;
    // Sanity: the b64 portion actually differs from the original.
    expect(tamperedB64).not.toBe(b64);
    expect(() => verifyToken<UploadPreferencesToken>(tampered, getHmacKey(TEST_KEY)))
      .toThrow(/Bad signature/);
  });

  it('flips to permission-denied when watermarkDisabled is flipped', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'owner-A',
      watermarkDisabled: false,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60 * 60 * 1000,
    };
    const token = signToken(payload, getHmacKey(TEST_KEY));
    const [, sig] = token.split('.');
    const flipped: UploadPreferencesToken = { ...payload, watermarkDisabled: true };
    const flippedB64 = Buffer.from(JSON.stringify(flipped), 'utf8').toString('base64url');
    const tampered = `${flippedB64}.${sig}`;
    expect(() => verifyToken<UploadPreferencesToken>(tampered, getHmacKey(TEST_KEY)))
      .toThrow(/Bad signature/);
  });

  it('rejects when signed with a different key', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'owner-A',
      watermarkDisabled: true,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60 * 60 * 1000,
    };
    const token = signToken(payload, getHmacKey(TEST_KEY));
    expect(() => verifyToken<UploadPreferencesToken>(token, getHmacKey('a-totally-different-key')))
      .toThrow(/Bad signature/);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyToken<UploadPreferencesToken>('garbage', getHmacKey(TEST_KEY)))
      .toThrow(/Malformed token/);
    expect(() => verifyToken<UploadPreferencesToken>('', getHmacKey(TEST_KEY)))
      .toThrow(/Malformed token/);
    expect(() => verifyToken<UploadPreferencesToken>('only-one-part', getHmacKey(TEST_KEY)))
      .toThrow(/Malformed token/);
  });
});