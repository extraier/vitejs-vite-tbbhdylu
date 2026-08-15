/**
 * 2026-08-15 — Pure-logic helpers for the auto-qualify referral flow.
 *
 * Lives in its own file so test code can import it without triggering
 * firebase-admin's module-level initializeApp(). MUST NOT import any
 * firebase-* module.
 *
 * The actual grantUnlock / Firestore writes happen in
 * referralCodes.ts via this same flow; this file holds only the
 * decision logic that's safe to unit-test without infrastructure.
 */

/**
 * Compute the next qualifiedReferralCount given the previous
 * value and whether we just qualified a new referred user. Used by
 * qualifyReferrerOnFirstEvent() to decide whether to bump the
 * aggregate count atomically.
 *
 * Semantics:
 *   - first-time qualify (alreadyQualified=false): bump by 1
 *   - already qualified (idempotent re-fire): no-op
 *   - defensive: NaN / undefined previous = 0
 *
 * Pure function — same inputs, same output, no side effects.
 */
export function nextQualifiedCount(
  previousCount: number | undefined | null,
  alreadyQualified: boolean,
): number {
  const base = typeof previousCount === 'number' && !Number.isNaN(previousCount)
    ? previousCount
    : 0;
  return alreadyQualified ? base : base + 1;
}

/**
 * Decide what the trigger should report back. Used by the trigger's
 * outer catch to ensure we always return a structured result even on
 * partial failure.
 */
export interface QualifyOutcome {
  /** True if this referred user was already qualified (idempotent re-fire). */
  alreadyQualified: boolean;
  /** True if we just granted storage-500mb for the first time. */
  grantedStorage: boolean;
  /** True if we just granted watermark-removed for the first time. */
  grantedWatermark: boolean;
}

export function makeQualifiedOutcome(
  alreadyQualified: boolean,
  grantedStorage: boolean,
  grantedWatermark: boolean,
): QualifyOutcome {
  return { alreadyQualified, grantedStorage, grantedWatermark };
}

/**
 * Detect whether a user has any other events besides the one we just
 * saw created. Used by the trigger to decide whether to qualify —
 * only the FIRST event qualifies.
 *
 * Pure function: takes the count of OTHER events, returns whether
 * this is the user's first.
 *
 *   count === 0  → first event (qualify)
 *   count > 0    → not first event (skip)
 *
 * Note: at trigger fire time, the new event is already in the
 * collection. So "this is the first event" means "no other events
 * exist besides this one".
 */
export function isFirstEvent(otherEventCount: number): boolean {
  return otherEventCount === 0;
}