import { describe, expect, it } from 'vitest';
import { evaluateGuestLinkIssue } from '../src/guestLinkIssue.pure';

const base = {
  ownerUid: 'owner-1',
  eventId: 'event-1',
  guestId: 'guest-1',
  eventExists: true,
  guestDocId: 'doc-1',
  ambiguousGuest: false,
  expiresAtMs: 2_000,
  nowMs: 1_000,
};

describe('evaluateGuestLinkIssue', () => {
  it('mints when the event and guest both exist', () => {
    expect(evaluateGuestLinkIssue(base)).toEqual({
      ok: true,
      guestDocId: 'doc-1',
      expiresAtMs: 2_000,
    });
  });

  it('refuses a missing event, a missing guest, and an ambiguous guest', () => {
    expect(evaluateGuestLinkIssue({ ...base, eventExists: false }).ok).toBe(false);
    expect(evaluateGuestLinkIssue({ ...base, guestDocId: null }).ok).toBe(false);
    expect(evaluateGuestLinkIssue({ ...base, ambiguousGuest: true, guestDocId: null }).ok).toBe(false);
  });

  it('refuses a non-future expiry', () => {
    const result = evaluateGuestLinkIssue({ ...base, expiresAtMs: 1_000, nowMs: 1_000 });
    expect(result.ok).toBe(false);
  });
});
