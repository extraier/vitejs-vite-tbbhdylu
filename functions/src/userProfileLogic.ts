/**
 * Cloud Functions — User Profile (Event-Level Owner Names)
 * =========================================================
 *
 * 2026-08-01 — Original release: per-user owner names on
 * `users/{uid}.boyName/girlName`.
 *
 * 2026-08-01 (pivot) — Owner names now live PER-EVENT on
 * `users/{uid}/events/{eventId}.boyName/girlName`. Helpers
 * renamed: cleanOwnerNames → cleanEventOwnerNames. MAX_OWNER_NAME_LEN
 * unchanged (30 chars).
 *
 * This file holds pure logic so it can be unit-tested without an
 * emulator. The onCall wrapper (auth check, event access check,
 * firestore write, server timestamp) lives in userProfile.ts.
 *
 * If you add a new owner-name field or a new validation invariant,
 * add it here AND in userProfile.ts (the wrapper re-uses these
 * helpers so they can never drift, but the test contract is in
 * this file).
 */

export const MAX_OWNER_NAME_LEN = 30;

/**
 * Strips C0 controls + DEL + trims + truncates a single
 * displayed-name field. Returns '' for non-string inputs
 * (defensive against `null` / `undefined` / numbers slipping
 * through the JSON wire).
 *
 * 2026-08-01 — strip C0 controls + DEL. Newlines in a name
 * field would corrupt the 大日流程 badge layout and split the
 * chip across two lines.
 */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_OWNER_NAME_LEN);
}

export type CleanedEventOwnerNames = { boyName: string; girlName: string };

/**
 * Same trim+truncate as cleanName but applied to both fields at
 * once and returns the validation result the onCall handler needs:
 *   - cleaned pair (always non-trimmed beyond the MAX cap)
 *   - boolean indicating whether at least one field is set
 *   - optional error message for the `invalid-argument` case
 *
 * Returns the failure result on invalid input. The onCall
 * handler treats `ok: false` as 「reject with invalid-argument」.
 */
export function cleanEventOwnerNames(input: {
  boyName?: unknown;
  girlName?: unknown;
}):
  | { ok: true; cleaned: CleanedEventOwnerNames }
  | { ok: false; message: string } {
  const boyName = cleanName(input.boyName);
  const girlName = cleanName(input.girlName);
  if (!boyName && !girlName) {
    return {
      ok: false,
      message: '請至少填寫其中一個名 (newBoy or newGirl required).',
    };
  }
  return { ok: true, cleaned: { boyName, girlName } };
}
