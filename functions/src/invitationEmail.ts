/**
 * 2026-08-14 — Pure-logic helpers for the electronic invitation
 * email pipeline. Extracted from invitations.ts so test code can
 * import them without triggering firebase-admin's initializeApp()
 * at module load time.
 *
 * This file MUST NOT import any firebase-* module. It is pure JS
 * + types. It is consumed by:
 *   - invitations.ts (the actual Cloud Function, via re-export)
 *   - test/invitations.email.test.ts (unit tests)
 */

/**
 * Merge a single invitation-level override with the canonical event
 * value. Semantics:
 *   - non-empty override (after trim) wins
 *   - empty / whitespace-only / undefined / null override falls
 *     back to the event value (which itself may be empty)
 *
 * This is the expression used at the renderEmailHtml call site in
 * sendInvitationsV2 (invitations.ts:354). Keep them in sync.
 */
export function mergeOverride(
  override: string | undefined | null,
  eventVal: string,
): string {
  const trimmed = (override ?? '').trim();
  return trimmed || eventVal;
}