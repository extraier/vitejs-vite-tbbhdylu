/**
 * Decision for issueGuestLink. The callable looks up the event and
 * guest, then refuses to mint a token unless both exist under the
 * signed-in owner. expiresAtMs is what the HMAC signs; the callable
 * persists it as a Firestore Timestamp, not a raw number.
 */

export interface GuestLinkIssueInput {
  ownerUid: string;
  eventId: string;
  guestId: string;
  eventExists: boolean;
  guestDocId: string | null;
  ambiguousGuest: boolean;
  expiresAtMs: number;
  nowMs: number;
}

export type GuestLinkIssueResult =
  | { ok: true; guestDocId: string; expiresAtMs: number }
  | { ok: false; code: 'not-found' | 'failed-precondition' | 'invalid-argument'; message: string };

export function evaluateGuestLinkIssue(input: GuestLinkIssueInput): GuestLinkIssueResult {
  if (!input.ownerUid || !input.eventId || !input.guestId) {
    return { ok: false, code: 'invalid-argument', message: 'eventId and guestId required.' };
  }
  if (!input.eventExists) {
    return { ok: false, code: 'not-found', message: 'Event not found.' };
  }
  if (input.ambiguousGuest) {
    return { ok: false, code: 'failed-precondition', message: 'Guest id is ambiguous on this event.' };
  }
  if (!input.guestDocId) {
    return { ok: false, code: 'not-found', message: 'Guest not found on this event.' };
  }
  if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= input.nowMs) {
    return { ok: false, code: 'invalid-argument', message: 'expiresAt must be in the future.' };
  }
  return { ok: true, guestDocId: input.guestDocId, expiresAtMs: input.expiresAtMs };
}
