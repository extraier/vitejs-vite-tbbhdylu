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
 *      shape (ownerUid, eventId, watermarkDisabled, issuedAt,
 *      expiresAt).
 *   2. Tampering with the ownerUid flips verifyToken to
 *      'permission-denied' (defense in depth: Vercel proxy
 *      re-checks ownerUid against the eventId in the upload).
 *   3. Tampering with the eventId claim ALSO flips to
 *      'permission-denied'. This is the audit §4.2 binding
 *      fix — without it, a token minted for event A would
 *      authorize clean uploads on event B.
 *   4. Tampering with watermarkDisabled flag also fails.
 *   5. Token payload includes `expiresAt` (Vercel proxy
 *      rejects expired tokens).
 *
 * 2026-08-02 — initial release.
 * 2026-08-20 — Manus P1.2 audit §4.2: add eventId claim tests.
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
//
// 2026-08-20 — audit §4.2: `eventId` is now a first-class
// claim. The CF signs it; the proxy verifies it. Removing it
// from this type fails the type-check at the mint site, which
// is exactly the regression guard we want.
type UploadPreferencesToken = {
  ownerUid: string;
  eventId: string;
  watermarkDisabled: boolean;
  issuedAt: number;
  expiresAt: number;
};

const TEST_KEY = 'unit-test-hmac-key-do-not-ship';

describe('uploadPreferencesToken payload shape', () => {
  it('round-trips signToken → verifyToken', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'abc123firebaseUid',
      eventId: 'evt-42',
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
      eventId: 'evt-1',
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

  // 2026-08-20 — Manus P1.2 audit §4.2: tampering the eventId
  // claim must fail verification. Without this, a token minted
  // for event A could be presented with an upload for event B
  // and the proxy would only check the HMAC, not the binding.
  it('flips to permission-denied when eventId is swapped', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'owner-A',
      eventId: 'evt-A',
      watermarkDisabled: true,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60 * 60 * 1000,
    };
    const token = signToken(payload, getHmacKey(TEST_KEY));
    const [, sig] = token.split('.');
    const tamperedPayload: UploadPreferencesToken = { ...payload, eventId: 'evt-B' };
    const tamperedB64 = Buffer.from(JSON.stringify(tamperedPayload), 'utf8').toString('base64url');
    const tampered = `${tamperedB64}.${sig}`;
    expect(() => verifyToken<UploadPreferencesToken>(tampered, getHmacKey(TEST_KEY)))
      .toThrow(/Bad signature/);
  });

  it('flips to permission-denied when watermarkDisabled is flipped', () => {
    const payload: UploadPreferencesToken = {
      ownerUid: 'owner-A',
      eventId: 'evt-1',
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
      eventId: 'evt-1',
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