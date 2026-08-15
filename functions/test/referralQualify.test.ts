// 2026-08-15 — Tests for the auto-qualify referral helpers
// (functions/src/referralQualify.ts). These are pure-logic pieces
// extracted so we can unit-test the decision logic without
// spinning up a Firestore emulator or pulling in firebase-admin.
//
// What we test:
//   1. nextQualifiedCount: bumps correctly on first qualify,
//      no-ops on idempotent re-fire, handles legacy/undefined
//      previous count.
//   2. isFirstEvent: only the user's first event qualifies.
//   3. makeQualifiedOutcome: structured outcome shape.
//
// The actual Firestore writes happen in qualifyReferrerOnFirstEvent
// (referralCodes.ts) and are covered by the integration smoke tests
// at the client layer via the full flow.

import { describe, it, expect } from 'vitest';
import {
  nextQualifiedCount,
  isFirstEvent,
  makeQualifiedOutcome,
} from '../src/referralQualify';

describe('nextQualifiedCount — auto-qualify bump logic', () => {
  it('first-time qualify: bumps by 1', () => {
    expect(nextQualifiedCount(0, false)).toBe(1);
    expect(nextQualifiedCount(5, false)).toBe(6);
  });

  it('idempotent re-fire: no-op (already qualified)', () => {
    expect(nextQualifiedCount(3, true)).toBe(3);
    expect(nextQualifiedCount(0, true)).toBe(0);
  });

  it('undefined previous count = 0 (legacy backfill path)', () => {
    expect(nextQualifiedCount(undefined, false)).toBe(1);
    expect(nextQualifiedCount(undefined, true)).toBe(0);
  });

  it('null previous count = 0 (defensive)', () => {
    expect(nextQualifiedCount(null, false)).toBe(1);
  });

  it('NaN previous count = 0 (defensive)', () => {
    expect(nextQualifiedCount(NaN, false)).toBe(1);
    expect(nextQualifiedCount(NaN, true)).toBe(0);
  });
});

describe('isFirstEvent — first-event detection', () => {
  it('zero other events → first event (qualify)', () => {
    expect(isFirstEvent(0)).toBe(true);
  });

  it('any other events → not first (skip)', () => {
    expect(isFirstEvent(1)).toBe(false);
    expect(isFirstEvent(5)).toBe(false);
    expect(isFirstEvent(100)).toBe(false);
  });

  it('handles negative defensively (corrupt count?)', () => {
    // Negative shouldn't happen but if it does, treat as not-first
    // to avoid double-counting.
    expect(isFirstEvent(-1)).toBe(false);
  });
});

describe('makeQualifiedOutcome — structured return shape', () => {
  it('builds a fully-qualified outcome', () => {
    const o = makeQualifiedOutcome(false, true, true);
    expect(o).toEqual({
      alreadyQualified: false,
      grantedStorage: true,
      grantedWatermark: true,
    });
  });

  it('builds an idempotent re-fire outcome', () => {
    const o = makeQualifiedOutcome(true, false, false);
    expect(o).toEqual({
      alreadyQualified: true,
      grantedStorage: false,
      grantedWatermark: false,
    });
  });

  it('builds a partial-grant outcome (rare but possible)', () => {
    // Edge case: user already had storage-500mb from social-proof
    // path but not watermark-removed. The auto-qualify grantUnlock
    // call is idempotent per type, so the second call still wins.
    // This shape exists in case grantUnlock returns alreadyGranted
    // for one type but not the other.
    const o = makeQualifiedOutcome(false, false, true);
    expect(o.grantedStorage).toBe(false);
    expect(o.grantedWatermark).toBe(true);
  });
});

// 2026-08-15 — Sanity-check the wire-through. The trigger flow
// is: isFirstEvent → if yes, bump count via nextQualifiedCount →
// grantUnlock twice. We can't unit-test the actual Firestore
// writes without an emulator, but we can verify the decision
// chain produces the expected outcome given realistic inputs.
describe('decision chain — first event → qualified → both granted', () => {
  it('happy path: new user, first event, both grants fresh', () => {
    const otherEvents = 0;
    const alreadyQualified = false; // (no qual doc exists)
    const previousCount = undefined; // (legacy user, no aggregate yet)
    const storageAlreadyGranted = false; // (no prior unlock)
    const watermarkAlreadyGranted = false;

    expect(isFirstEvent(otherEvents)).toBe(true);

    const expectedCount = nextQualifiedCount(previousCount, alreadyQualified);
    expect(expectedCount).toBe(1);

    const outcome = makeQualifiedOutcome(
      alreadyQualified,
      !storageAlreadyGranted,
      !watermarkAlreadyGranted,
    );
    expect(outcome).toEqual({
      alreadyQualified: false,
      grantedStorage: true,
      grantedWatermark: true,
    });
  });

  it('second event from same user: no-op', () => {
    const otherEvents = 1; // user already has 1 event
    const alreadyQualified = true; // (qual doc exists from first event)

    expect(isFirstEvent(otherEvents)).toBe(false);
    // Trigger returns early at the qual-doc check; no grant calls
    // are made. The outcome is reported for logging only.
    const outcome = makeQualifiedOutcome(alreadyQualified, false, false);
    expect(outcome).toEqual({
      alreadyQualified: true,
      grantedStorage: false,
      grantedWatermark: false,
    });
  });

  it('legacy user: first event after trigger shipped, both granted', () => {
    // Same as happy path but the referred user might have had
    // events BEFORE the trigger fired. We use limit(2) and check
    // otherEventCount === 0 to qualify. If the user has 1+ other
    // events, skip — they predate the trigger.
    const otherEvents = 0; // brand new user, no events before
    const alreadyQualified = false;

    expect(isFirstEvent(otherEvents)).toBe(true);
    expect(makeQualifiedOutcome(alreadyQualified, true, true).grantedStorage).toBe(true);
  });
});