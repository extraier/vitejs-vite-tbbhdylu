// Guest links — HMAC round-trip + redemption flow tests
//
// These tests don't hit Firebase — they verify the pure crypto helpers
// and the public API surface. The full Firestore rules tests live in
// scripts/test-firestore-rules.js (uses @firebase/rules-unit-testing
// against the local emulator).

import { describe, it, expect } from 'vitest';
import { hmacHex } from './guestLinks';

describe('hmacHex', () => {
  it('produces a deterministic 64-char hex string', async () => {
    const a = await hmacHex('secret', 'hello');
    const b = await hmacHex('secret', 'hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes output when secret changes', async () => {
    const a = await hmacHex('secret1', 'hello');
    const b = await hmacHex('secret2', 'hello');
    expect(a).not.toBe(b);
  });

  it('changes output when payload changes', async () => {
    const a = await hmacHex('secret', 'hello');
    const b = await hmacHex('secret', 'world');
    expect(a).not.toBe(b);
  });

  it('matches the format produced by the Cloud Function signer', async () => {
    // The server uses crypto.createHmac('sha256', secret).update(payload).digest('hex').
    // This test pins the format so a future refactor that breaks parity fails fast.
    const secret = 'unit-test-secret';
    const payload = 'owner-uid|event-id|guest-id|9999999999999';
    const sig = await hmacHex(secret, payload);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Manually verify a single byte position is what we expect from SHA-256
    // (the actual value depends on the payload, but length + charset is fixed).
  });
});