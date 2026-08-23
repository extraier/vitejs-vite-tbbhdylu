// guestExperience.pure.test.ts
// =============================
//
// 2026-08-23 — Manus P2a unit tests for the pure helpers in
// ./guestExperience.pure.ts. PDF §6.2 test contract.
//
// Pure-only: no firebase-admin imports, no emulator. Runs in <50ms.
//
// Coverage targets (PDF §6.2 row by row):
//   publishGuestExperience — rejects non-owner / non-publishable draft
//   getGuestPortalBootstrap — rejects expired / wrong-event / no-guestDocId
//   respondToRsvp — rejects invalid status / oversize party / bad meal
//   saveGuestMessage — caps at 280 chars

import { describe, it, expect } from 'vitest';

import {
  OwnershipError,
  LinkInvalidError,
  assertOwnerOrCoOwner,
  projectDraft,
  validateLinkShape,
  sanitizeRsvpRequest,
  mealChoiceIsAllowed,
  sanitizeGuestMessage,
  buildBootstrapGuest,
  safeHttpsUrl,
  PUBLIC_URL_ALLOWLIST,
  cleanText,
  clampInt,
  type GuestLinkDoc,
  type DraftInput,
  type TimestampLike,
} from '../src/guestExperience.pure';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const OWNER = 'owner-A';
const EVENT = 'event-X';
const GUEST_UID = 'guest-uid-1';
const GUEST_DOC_ID = 'guest-doc-1';
const GUEST_ID = 'g-1';

function ts(ms: number): TimestampLike {
  return { toMillis: () => ms };
}

function makeLink(overrides: Partial<GuestLinkDoc> = {}): GuestLinkDoc {
  return {
    ownerUid: OWNER,
    eventId: EVENT,
    guestId: GUEST_ID,
    guestDocId: GUEST_DOC_ID,
    redeemedByUid: GUEST_UID,
    expiresAt: ts(Date.now() + 60_000),
    ...overrides,
  };
}

function makeDraft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    hero: {
      coupleNames: 'Alice & Bob',
      dateLabel: '2026-12-25',
      invitationLine: '',
      countdownEnabled: false,
    },
    theme: { templateId: 'plain', accentColor: '#D45478' },
    rsvp: { enabled: false },
    venues: [],
    schedule: [],
    calendar: {},
    messages: { welcome: '', thankYou: '' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// cleanText + clampInt + safeHttpsUrl
// ---------------------------------------------------------------------------

describe('cleanText', () => {
  it('trims and caps', () => {
    expect(cleanText('  hi  ', 5)).toBe('hi');
    expect(cleanText('hello world', 5)).toBe('hello');
  });
  it('returns empty for non-strings', () => {
    expect(cleanText(123, 5)).toBe('');
    expect(cleanText(null, 5)).toBe('');
    expect(cleanText(undefined, 5)).toBe('');
  });
});

describe('clampInt', () => {
  it('clamps within range', () => {
    expect(clampInt(5, 1, 10, 1)).toBe(5);
    expect(clampInt(99, 1, 10, 1)).toBe(10);
    expect(clampInt(-3, 1, 10, 1)).toBe(1);
  });
  it('returns fallback for non-integers', () => {
    expect(clampInt(1.5, 1, 10, 1)).toBe(1);
    expect(clampInt('3', 1, 10, 1)).toBe(1); // Number('3') is 3, but '3' isn't an integer — guard fires
    expect(clampInt(undefined, 1, 10, 1)).toBe(1);
    expect(clampInt(NaN, 1, 10, 1)).toBe(1);
  });
});

describe('safeHttpsUrl', () => {
  it('accepts allowlisted hosts', () => {
    expect(safeHttpsUrl('https://firebasestorage.googleapis.com/v0/b/foo')).toBe(
      'https://firebasestorage.googleapis.com/v0/b/foo',
    );
    expect(safeHttpsUrl('https://cdn.savetheday.io/x.png')).toBe(
      'https://cdn.savetheday.io/x.png',
    );
  });
  it('rejects non-allowlisted hosts', () => {
    expect(safeHttpsUrl('https://evil.com/x.png')).toBeNull();
    expect(safeHttpsUrl('https://example.com')).toBeNull();
  });
  it('rejects non-https', () => {
    expect(safeHttpsUrl('http://firebasestorage.googleapis.com/x')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(safeHttpsUrl('')).toBeNull();
    expect(safeHttpsUrl('not a url')).toBeNull();
    expect(safeHttpsUrl(123)).toBeNull();
  });
  it('exports the allowlist as readonly', () => {
    expect(PUBLIC_URL_ALLOWLIST.has('firebasestorage.googleapis.com')).toBe(true);
    expect(PUBLIC_URL_ALLOWLIST.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// assertOwnerOrCoOwner
// ---------------------------------------------------------------------------

describe('assertOwnerOrCoOwner', () => {
  it('passes for owner', () => {
    expect(() =>
      assertOwnerOrCoOwner({ ownerUid: OWNER }, OWNER, OWNER),
    ).not.toThrow();
  });
  it('passes for co-owner', () => {
    expect(() =>
      assertOwnerOrCoOwner(
        { ownerUid: OWNER, coOwners: ['co-1'] },
        OWNER,
        'co-1',
      ),
    ).not.toThrow();
  });
  it('rejects random user', () => {
    expect(() =>
      assertOwnerOrCoOwner({ ownerUid: OWNER }, OWNER, 'random'),
    ).toThrow(OwnershipError);
  });
  it('rejects missing event', () => {
    expect(() =>
      assertOwnerOrCoOwner(undefined, OWNER, OWNER),
    ).toThrow(/not found/);
  });
  it('handles missing coOwners array', () => {
    expect(() =>
      assertOwnerOrCoOwner({ ownerUid: OWNER }, OWNER, 'random'),
    ).toThrow(OwnershipError);
  });
});

// ---------------------------------------------------------------------------
// projectDraft — the projection is the privacy boundary
// ---------------------------------------------------------------------------

describe('projectDraft', () => {
  it('returns null when couple names are missing', () => {
    expect(projectDraft(makeDraft({ hero: { dateLabel: '2026-12-25' } }))).toBeNull();
  });
  it('returns null when date label is missing', () => {
    expect(projectDraft(makeDraft({ hero: { coupleNames: 'A & B' } }))).toBeNull();
  });

  it('strips guest-list / private fields from the projection', () => {
    // Deliberately try to leak a "guests" field via the draft. The
    // projection must NOT echo it back.
    const draft = makeDraft({
      guests: [{ name: 'Secret', email: 'x@y.com' }],
      adminNotes: 'forbidden',
      paymentInfo: { card: '4242' },
    });
    const p = projectDraft(draft)!;
    expect(p).not.toBeNull();
    // No leaks:
    expect(JSON.stringify(p)).not.toContain('Secret');
    expect(JSON.stringify(p)).not.toContain('x@y.com');
    expect(JSON.stringify(p)).not.toContain('forbidden');
    expect(JSON.stringify(p)).not.toContain('4242');
  });

  it('rejects non-https URLs in theme.coverUrl', () => {
    const p = projectDraft(
      makeDraft({ theme: { coverUrl: 'http://evil.com/x.png' } }),
    )!;
    expect(p.theme.coverUrl).toBeNull();
  });

  it('rejects non-allowlisted URLs in theme.coverUrl', () => {
    const p = projectDraft(
      makeDraft({ theme: { coverUrl: 'https://evil.com/x.png' } }),
    )!;
    expect(p.theme.coverUrl).toBeNull();
  });

  it('falls back accent color when malformed', () => {
    expect(
      projectDraft(makeDraft({ theme: { accentColor: 'red' } }))!.theme
        .accentColor,
    ).toBe('#D45478');
    expect(
      projectDraft(makeDraft({ theme: { accentColor: '#D45478' } }))!.theme
        .accentColor,
    ).toBe('#D45478');
    expect(
      projectDraft(makeDraft({ theme: { accentColor: '#ABCDEF' } }))!.theme
        .accentColor,
    ).toBe('#ABCDEF');
  });

  it('drops schedule slots with future publishAt', () => {
    const future = Date.now() + 10_000_000;
    const draft = makeDraft({
      schedule: [
        {
          id: 's-1',
          title: 'Reception',
          startsAt: ts(Date.now() + 1000),
          endsAt: ts(Date.now() + 3600_000),
          publishAt: ts(future),
        },
      ],
    });
    const p = projectDraft(draft)!;
    expect(p.schedule).toHaveLength(0);
  });

  it('keeps schedule slots with past or absent publishAt', () => {
    const draft = makeDraft({
      schedule: [
        {
          id: 's-1',
          title: 'Ceremony',
          startsAt: ts(Date.now() + 1000),
          endsAt: ts(Date.now() + 3600_000),
        },
      ],
    });
    const p = projectDraft(draft)!;
    expect(p.schedule).toHaveLength(1);
    expect(p.schedule[0].title).toBe('Ceremony');
  });

  it('drops schedule slots where endsAt < startsAt', () => {
    const draft = makeDraft({
      schedule: [
        {
          id: 's-1',
          title: 'Bad',
          startsAt: ts(Date.now() + 1000),
          endsAt: ts(Date.now() - 1000),
        },
      ],
    });
    expect(projectDraft(draft)!.schedule).toHaveLength(0);
  });

  it('sorts schedule slots by startsAt', () => {
    const t1 = Date.now() + 1000;
    const t2 = Date.now() + 3600_000;
    const t3 = Date.now() + 7200_000;
    const draft = makeDraft({
      schedule: [
        { id: 's-3', title: 'Third', startsAt: ts(t3), endsAt: ts(t3 + 1000) },
        { id: 's-1', title: 'First', startsAt: ts(t1), endsAt: ts(t1 + 1000) },
        { id: 's-2', title: 'Second', startsAt: ts(t2), endsAt: ts(t2 + 1000) },
      ],
    });
    const titles = projectDraft(draft)!.schedule.map((s) => s.title);
    expect(titles).toEqual(['First', 'Second', 'Third']);
  });

  it('caps rsvp.mealOptions at 12 and trims each', () => {
    const draft = makeDraft({
      rsvp: {
        enabled: true,
        mealOptions: Array.from({ length: 20 }, (_, i) => ` meal-${i} `),
      },
    });
    const p = projectDraft(draft)!;
    expect(p.rsvp.mealOptions).toHaveLength(12);
    expect(p.rsvp.mealOptions[0]).toBe('meal-0');
    expect(p.rsvp.mealOptions[11]).toBe('meal-11');
  });

  it('drops venues missing name or address', () => {
    const draft = makeDraft({
      venues: [
        { id: 'v-1', name: 'Hall', address: '1 Main St' },
        { id: 'v-2', name: 'No address' },
        { id: 'v-3', address: 'No name' },
      ],
    });
    const p = projectDraft(draft)!;
    expect(p.venues).toHaveLength(1);
    expect(p.venues[0].id).toBe('v-1');
  });
});

// ---------------------------------------------------------------------------
// validateLinkShape — used by 3 of the 4 callables
// ---------------------------------------------------------------------------

describe('validateLinkShape', () => {
  it('passes a valid unexpired link', () => {
    const out = validateLinkShape(makeLink(), OWNER, EVENT, GUEST_UID);
    expect(out.guestId).toBe(GUEST_ID);
    expect(out.guestDocId).toBe(GUEST_DOC_ID);
  });

  it('rejects missing link', () => {
    expect(() =>
      validateLinkShape(null, OWNER, EVENT, GUEST_UID),
    ).toThrow(LinkInvalidError);
  });

  it('rejects wrong owner', () => {
    expect(() =>
      validateLinkShape(
        makeLink({ ownerUid: 'other-owner' }),
        OWNER,
        EVENT,
        GUEST_UID,
      ),
    ).toThrow(LinkInvalidError);
  });

  it('rejects wrong event (cross-event request)', () => {
    expect(() =>
      validateLinkShape(
        makeLink({ eventId: 'other-event' }),
        OWNER,
        EVENT,
        GUEST_UID,
      ),
    ).toThrow(LinkInvalidError);
  });

  it('rejects when redeemedByUid does not match authUid', () => {
    // The PDF explicitly calls out "a second different link on the
    // same auth UID" — the link must be the one THIS auth session
    // redeemed, not anyone's.
    expect(() =>
      validateLinkShape(makeLink(), OWNER, EVENT, 'different-uid'),
    ).toThrow(LinkInvalidError);
  });

  it('rejects missing guestDocId (PDF §6.2)', () => {
    expect(() =>
      validateLinkShape(
        makeLink({ guestDocId: undefined }),
        OWNER,
        EVENT,
        GUEST_UID,
      ),
    ).toThrow(LinkInvalidError);
  });

  it('rejects expired link', () => {
    expect(() =>
      validateLinkShape(
        makeLink({ expiresAt: ts(Date.now() - 1000) }),
        OWNER,
        EVENT,
        GUEST_UID,
      ),
    ).toThrow(LinkInvalidError);
  });
});

// ---------------------------------------------------------------------------
// sanitizeRsvpRequest + mealChoiceIsAllowed
// ---------------------------------------------------------------------------

describe('sanitizeRsvpRequest', () => {
  const cfg = { allowPartySize: true, maxPartySize: 5, allowNote: true };

  it('accepts a valid attending submission', () => {
    const r = sanitizeRsvpRequest(
      { status: 'attending', partySize: 3, mealChoice: 'beef', note: 'hi' },
      cfg,
    );
    expect(r).toEqual({
      status: 'attending',
      partySize: 3,
      mealChoice: 'beef',
      note: 'hi',
    });
  });

  it('accepts a valid declined submission (zeroes partySize)', () => {
    const r = sanitizeRsvpRequest(
      { status: 'declined', partySize: 99, mealChoice: 'beef' },
      cfg,
    );
    expect(r).toEqual({
      status: 'declined',
      partySize: 0,
      mealChoice: null,
      note: null,
    });
  });

  it('rejects unknown status', () => {
    expect(
      sanitizeRsvpRequest({ status: 'maybe' }, cfg),
    ).toBeNull();
  });

  it('rejects non-string status', () => {
    expect(sanitizeRsvpRequest({ status: 123 }, cfg)).toBeNull();
  });

  it('clamps partySize to config.maxPartySize', () => {
    const r = sanitizeRsvpRequest(
      { status: 'attending', partySize: 99 },
      cfg,
    );
    expect(r!.partySize).toBe(5);
  });

  it('clamps partySize to a minimum of 1 when allowPartySize', () => {
    const r = sanitizeRsvpRequest(
      { status: 'attending', partySize: -5 },
      cfg,
    );
    expect(r!.partySize).toBe(1);
  });

  it('forces partySize=1 when config disallows partySize', () => {
    const r = sanitizeRsvpRequest(
      { status: 'attending', partySize: 99 },
      { allowPartySize: false, maxPartySize: 1, allowNote: false },
    );
    expect(r!.partySize).toBe(1);
  });

  it('drops note when config disallows it', () => {
    const r = sanitizeRsvpRequest(
      { status: 'attending', note: 'secret' },
      { allowPartySize: false, maxPartySize: 1, allowNote: false },
    );
    expect(r!.note).toBeNull();
  });

  it('caps note to 280 chars', () => {
    const longNote = 'x'.repeat(500);
    const r = sanitizeRsvpRequest(
      { status: 'attending', note: longNote },
      cfg,
    );
    expect(r!.note!.length).toBe(280);
  });
});

describe('mealChoiceIsAllowed', () => {
  it('null is always allowed', () => {
    expect(mealChoiceIsAllowed(null, ['beef', 'fish'])).toBe(true);
    expect(mealChoiceIsAllowed(null, [])).toBe(true);
  });
  it('exact match allowed', () => {
    expect(mealChoiceIsAllowed('beef', ['beef', 'fish'])).toBe(true);
  });
  it('not in list rejected', () => {
    expect(mealChoiceIsAllowed('vegan', ['beef', 'fish'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeGuestMessage — caps at 280
// ---------------------------------------------------------------------------

describe('sanitizeGuestMessage', () => {
  it('caps at 280 chars (PDF §6.2)', () => {
    const r = sanitizeGuestMessage({ message: 'x'.repeat(1000) });
    expect(r.message.length).toBe(280);
  });
  it('trims whitespace', () => {
    expect(sanitizeGuestMessage({ message: '  hi  ' }).message).toBe('hi');
  });
  it('non-string returns empty', () => {
    expect(sanitizeGuestMessage({ message: 123 }).message).toBe('');
    expect(sanitizeGuestMessage({}).message).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildBootstrapGuest
// ---------------------------------------------------------------------------

describe('buildBootstrapGuest', () => {
  it('returns null when guestId does not match linkGuestId', () => {
    expect(
      buildBootstrapGuest(
        GUEST_DOC_ID,
        { guestId: 'other-guest', name: 'X' },
        GUEST_ID,
      ),
    ).toBeNull();
  });

  it('omits email / phone / gift amount (privacy boundary)', () => {
    const built = buildBootstrapGuest(
      GUEST_DOC_ID,
      {
        guestId: GUEST_ID,
        name: 'Alice',
        email: 'alice@example.com', // should be ignored
        phone: '+852 9999 9999',    // should be ignored
        giftAmount: 1000,           // should be ignored
        hasGifted: true,            // should be ignored
        rsvpStatus: 'attending',
      },
      GUEST_ID,
    );
    expect(built).not.toBeNull();
    // Bootstrap type has no email/phone/giftAmount keys — the type
    // system itself enforces this. Run a runtime check on the
    // serialised output too.
    const serialised = JSON.stringify(built);
    expect(serialised).not.toContain('alice@example.com');
    expect(serialised).not.toContain('9999');
    expect(serialised).not.toContain('1000');
    expect(serialised).not.toContain('hasGifted');
  });

  it('returns rsvpStatus default pending', () => {
    expect(
      buildBootstrapGuest(
        GUEST_DOC_ID,
        { guestId: GUEST_ID, name: 'Alice' },
        GUEST_ID,
      )!.rsvpStatus,
    ).toBe('pending');
  });

  it('passes through rsvpPartySize as integer', () => {
    const built = buildBootstrapGuest(
      GUEST_DOC_ID,
      { guestId: GUEST_ID, rsvpPartySize: 3 },
      GUEST_ID,
    );
    expect(built!.rsvpPartySize).toBe(3);
  });

  it('falls back rsvpPartySize to 1 for non-integer', () => {
    const built = buildBootstrapGuest(
      GUEST_DOC_ID,
      { guestId: GUEST_ID, rsvpPartySize: 'three' },
      GUEST_ID,
    );
    expect(built!.rsvpPartySize).toBe(1);
  });
});
