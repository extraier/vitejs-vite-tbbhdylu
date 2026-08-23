// entitlementResolver.p4-3.test.ts
// =================================
//
// 2026-08-23 — Manus P4.3 (PDF Patch 4.3): tests for
// `resolveServerEntitlementLimit`. This is the bridge between
// Firestore unlocks (server-side, rules-denied) and the
// photo-upload proxy's quota gate (which used to read
// event.storageQuotaBytes — a client-writable field).
//
// Test surface:
//   - empty unlocks → FREE_TIER_BASE_BYTES (200 MB)
//   - storage-500mb unlock → FREE + BONUS (700 MB)
//   - custom-template / watermark-removed unlocks DON'T bump the limit
//   - malformed unlocks (missing `type`) are tolerated
//   - Firestore read error propagates (fail-closed)

import { describe, it, expect, vi } from 'vitest';
import {
  resolveServerEntitlementLimit,
  FREE_TIER_BASE_BYTES,
  BONUS_STORAGE_BYTES,
} from '../src/entitlementResolver';
import type { FirebaseFirestore } from 'firebase-admin/firestore';

const OWNER = 'couple-1';
const EVENT = 'event-A';

interface FakeUnlock {
  type: string;
  source?: string;
  eventId?: string | null;
}

/**
 * Build a minimal Firestore stub for the resolver's exact chain:
 *
 *   .collection('artifacts').doc(appId)
 *     .collection('users').doc(ownerUid)
 *       .collection('unlocks').get()
 *
 * Only the terminal `.collection('unlocks').get()` returns data;
 * every other link is a passthrough for the next call.
 *
 * We pre-build a SINGLE fixed map keyed by the document IDs in
 * the chain so there's no recursion to debug.
 */
function buildFakeFirestore(unlocks: FakeUnlock[]) {
  const unlocksGet = vi.fn(async () => ({
    docs: unlocks.map((u, i) => ({
      id: `unlock-${i}`,
      data: () => ({
        type: u.type,
        source: u.source,
        eventId: u.eventId === undefined ? null : u.eventId,
      }),
    })),
  }));

  // The terminal node: .collection('unlocks').get()
  const unlocksCol = { get: unlocksGet };

  // The `users` collection → its docs expose `.collection('unlocks')`
  const usersDoc = { collection: () => unlocksCol };

  // The `users` collection itself → its docs are `usersDoc`
  const usersCol = { doc: () => usersDoc };

  // The `artifacts/{appId}` doc → exposes `.collection('users')`
  const appDoc = { collection: () => usersCol };

  // The top-level `artifacts` collection → its docs are `appDoc`
  const artifactsCol = { doc: () => appDoc };

  // Top-level firestore has `.collection('artifacts')`.
  // Any other collection name returns an empty stub.
  return {
    collection: (name: string) => {
      if (name === 'artifacts') return artifactsCol;
      return { get: vi.fn(async () => ({ docs: [] })) };
    },
  } as unknown as FirebaseFirestore.Firestore;
}

describe('resolveServerEntitlementLimit (P4.3 server-side limit)', () => {
  it('returns FREE_TIER_BASE_BYTES (200 MB) for an empty unlocks list', async () => {
    const fs = buildFakeFirestore([]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    expect(limit).toBe(FREE_TIER_BASE_BYTES);
    expect(FREE_TIER_BASE_BYTES).toBe(200 * 1024 * 1024);
  });

  it('returns FREE + BONUS (700 MB) when storage-500mb is unlocked', async () => {
    const fs = buildFakeFirestore([{ type: 'storage-500mb', source: 'paid' }]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    expect(limit).toBe(FREE_TIER_BASE_BYTES + BONUS_STORAGE_BYTES);
    expect(limit).toBe(700 * 1024 * 1024);
  });

  it('storage-500mb unlock applies regardless of source (paid OR referral)', async () => {
    // The PDF: storage-500mb can be earned free via a referral
    // (granted alongside watermark-removed). Both code paths
    // produce the same 500 MB bump.
    const paid = buildFakeFirestore([{ type: 'storage-500mb', source: 'paid' }]);
    const referral = buildFakeFirestore([{ type: 'storage-500mb', source: 'referral' }]);
    expect(await resolveServerEntitlementLimit(paid, OWNER, EVENT)).toBe(700 * 1024 * 1024);
    expect(await resolveServerEntitlementLimit(referral, OWNER, EVENT)).toBe(700 * 1024 * 1024);
  });

  it('custom-template unlock does NOT change the storage limit', async () => {
    const fs = buildFakeFirestore([{ type: 'custom-template', source: 'paid' }]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    expect(limit).toBe(FREE_TIER_BASE_BYTES);
  });

  it('watermark-removed unlock does NOT change the storage limit', async () => {
    const fs = buildFakeFirestore([{ type: 'watermark-removed', source: 'paid' }]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    expect(limit).toBe(FREE_TIER_BASE_BYTES);
  });

  it('lifetimeRetention unlock does NOT change the storage limit (it changes retention, not bytes)', async () => {
    const fs = buildFakeFirestore([{ type: 'permanent-archive', source: 'paid' }]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    expect(limit).toBe(FREE_TIER_BASE_BYTES);
  });

  it('tolerates malformed unlocks (missing type) without throwing', async () => {
    const fs = buildFakeFirestore([
      // Missing type → resolver sets type to '' via the safe mapper.
      { type: '' as string },
      { type: 'storage-500mb', source: 'paid' },
    ]);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    // The malformed unlock is effectively ignored; the valid
    // storage-500mb unlock still applies the bonus.
    expect(limit).toBe(FREE_TIER_BASE_BYTES + BONUS_STORAGE_BYTES);
  });

  it('propagates Firestore read errors (fail-closed)', async () => {
    // 2026-08-23 — Manus P4.3: the proxy MUST NOT fall back to a
    // client-trustable default if Firestore is unreachable. The
    // resolver surfaces the error; the proxy catches it and
    // responds 503 to the client. Test that the resolver itself
    // does NOT swallow the error.
    const fs = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            // The resolver's chain has another .doc() between
            // .collection('users') and .collection('unlocks'),
            // so we have to thread it through. The error fires
            // from the .get() on .collection('unlocks').
            doc: () => ({
              collection: () => ({
                get: () => Promise.reject(new Error('Firestore unavailable')),
              }),
            }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore;

    await expect(
      resolveServerEntitlementLimit(fs, OWNER, EVENT),
    ).rejects.toThrow(/unavailable/);
  });

  it('returns the same value as computeEntitlement().storageLimitBytes (consistency)', async () => {
    // Sanity: the resolver path and the pure policy path must agree.
    // This catches the case where someone updates one without the
    // other (e.g. the proxy uses a stale constant from a previous
    // deploy while the CF uses the new one).
    const { computeEntitlement } = await import('../src/entitlementResolver');
    const unlocks = [
      { type: 'storage-500mb', source: 'paid' },
      { type: 'custom-template', source: 'paid' },
    ];
    const fs = buildFakeFirestore(unlocks);
    const limit = await resolveServerEntitlementLimit(fs, OWNER, EVENT);
    const ent = computeEntitlement(OWNER, EVENT, unlocks);
    expect(limit).toBe(ent.storageLimitBytes);
  });
});