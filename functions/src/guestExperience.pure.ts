// guestExperience.pure.ts
// ======================
//
// 2026-08-23 — Manus P2a pure-logic helpers for the guestExperience
// projection. Lives in its own module so test code can import without
// pulling in firebase-admin.
//
// PDF spec reference: §3.2 (2.2 Add functions/src/guestExperience.ts)
// and §6.2 (test contract).
//
// Why this is split out (firebase-functions-testability skill, Trap #1):
// The CF modules that import firebase-admin run `initializeApp()` on
// module load. Vitest explodes if it imports such a module without
// GOOGLE_APPLICATION_CREDENTIALS. The fix is to keep all *policy logic*
// (projection shape, link validation, RSVP clamping) in this pure file
// and let the impure `guestExperience.ts` be a thin onCall wrapper.
//
// Functions exported here:
//   - cleanText, clampInt: string/number sanitizers
//   - safeHttpsUrl: URL validator restricted to allowlisted hosts
//   - assertOwnerOrCoOwner: event-scoped permission check
//   - projectDraft: draft → public projection (the heart of P2)
//   - validateLinkShape: shape check on a /guestLinks/{uid} doc
//   - rsvpRequestIsValid: validates an RSVP submission's shape
//   - messageRequestIsValid: validates a guest-message submission

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

/**
 * Trim + cap a string. Non-strings return empty string (the convention
 * `cleanText` enforces everywhere — callers can pass arbitrary shapes
 * from JSON without crashing).
 */
export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Clamp an integer into [min, max]. Non-integers return `fallback`.
 *
 * The integer check matters: `Number(true) === 1`, `Number('3') === 3`,
 * and `Number(1.5) === 1.5`. Only `Number.isInteger` rejects the cases
 * that would corrupt downstream math (party size, retention minutes).
 */
export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isInteger(value)
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
}

// ---------------------------------------------------------------------------
// URL validator
// ---------------------------------------------------------------------------

/**
 * Returns the URL string if `value` is a parseable HTTPS URL whose host
 * is in the allowlist, else null. Critical security gate — public
 * projection never echoes a non-allowlisted URL because a malicious
 * draft could otherwise drive guests to phishing pages.
 *
 * The allowlist is exported so the test suite can pin it.
 */
export const PUBLIC_URL_ALLOWLIST: ReadonlySet<string> = new Set([
  'firebasestorage.googleapis.com',
  'cdn.savetheday.io',
]);

export function safeHttpsUrl(value: unknown): string | null {
  const candidate = cleanText(value, 500);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && PUBLIC_URL_ALLOWLIST.has(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ownership check (pure)
// ---------------------------------------------------------------------------

/**
 * Verifies that `authUid` is either the event owner or in the coOwners
 * list. Throws an Error with a stable `code` discriminator — the CF
 * wrapper maps it to HttpsError.
 *
 * Caller must have already validated that `event` was the result of a
 * Firestore get (so `undefined` means "missing", not "fake"). This is
 * a pure function; no Firestore calls.
 */
export class OwnershipError extends Error {
  constructor(
    public readonly code: 'not-found' | 'permission-denied',
    message: string,
  ) {
    super(message);
    this.name = 'OwnershipError';
  }
}

export function assertOwnerOrCoOwner(
  event: Record<string, unknown> | undefined,
  expectedOwnerUid: string,
  authUid: string,
): void {
  if (!event) throw new OwnershipError('not-found', 'event not found');
  const coOwners = Array.isArray(event.coOwners) ? event.coOwners : [];
  if (
    authUid !== expectedOwnerUid &&
    !coOwners.includes(authUid)
  ) {
    throw new OwnershipError('permission-denied', 'owner or co-owner required');
  }
}

// ---------------------------------------------------------------------------
// projectDraft — the heart of P2
// ---------------------------------------------------------------------------

/**
 * Shape the timestamp that Firestore Admin SDK returns when reading a
 * document. We duck-type instead of importing the Timestamp class so
 * this pure module stays firebase-admin-free.
 */
export interface TimestampLike {
  toMillis: () => number;
  toDate?: () => Date;
}

/**
 * Type guard: is `value` something Firestore admin returned as a Timestamp?
 *
 * Pure-side check: looks for `toMillis` (the only method we call) plus
 * the structural property name. Doesn't import the SDK.
 */
function isTimestamp(value: unknown): value is TimestampLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as TimestampLike).toMillis === 'function'
  );
}

export interface DraftInput {
  theme?: {
    templateId?: unknown;
    accentColor?: unknown;
    coverUrl?: unknown;
    coverAlt?: unknown;
  };
  hero?: {
    coupleNames?: unknown;
    invitationLine?: unknown;
    dateLabel?: unknown;
    countdownEnabled?: unknown;
  };
  rsvp?: {
    enabled?: unknown;
    deadlineAt?: unknown;
    allowPartySize?: unknown;
    maxPartySize?: unknown;
    mealOptions?: unknown;
    allowNote?: unknown;
  };
  venues?: unknown;
  schedule?: unknown;
  calendar?: {
    enabled?: unknown;
    title?: unknown;
    timezone?: unknown;
    reminderMinutes?: unknown;
  };
  messages?: {
    welcome?: unknown;
    thankYou?: unknown;
    thankYouPublishedAt?: unknown;
  };
}

export interface ProjectedVenue {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  travelNotes: string;
  accessibilityNotes: string;
}

export interface ProjectedScheduleSlot {
  id: string;
  title: string;
  startsAt: TimestampLike;
  endsAt: TimestampLike;
  venueId: string;
  publicNote: string;
}

export interface ProjectedRsvp {
  enabled: boolean;
  deadlineAt: TimestampLike | null;
  allowPartySize: boolean;
  maxPartySize: number;
  mealOptions: string[];
  allowNote: boolean;
}

export interface ProjectedTheme {
  templateId: string;
  accentColor: string;
  coverUrl: string | null;
  coverAlt: string;
}

export interface ProjectedHero {
  coupleNames: string;
  invitationLine: string;
  dateLabel: string;
  countdownEnabled: boolean;
}

export interface ProjectedCalendar {
  enabled: boolean;
  title: string;
  timezone: string;
  reminderMinutes: number;
}

export interface ProjectedMessages {
  welcome: string;
  thankYou: string;
  thankYouPublishedAt: TimestampLike | null;
}

export interface PublicProjection {
  schemaVersion: 1;
  theme: ProjectedTheme;
  hero: ProjectedHero;
  rsvp: ProjectedRsvp;
  venues: ProjectedVenue[];
  schedule: ProjectedScheduleSlot[];
  calendar: ProjectedCalendar;
  messages: ProjectedMessages;
}

const MAX_TEXT = 1000;
const DEFAULT_ACCENT = '#D45478';

/**
 * Normalize a draft document into a public projection.
 *
 * PDF §3.2 (3.1 Data model) — the public projection intentionally
 * excludes guest identifiers, guest lists, email, phone, gift amount,
 * check-in fields, and internal notes. The same shape is what the
 * frontend renders via useGuestExperience.
 *
 * Returns null if the draft is too sparse to publish (no couple names
 * or no date label). The CF wrapper maps that to HttpsError
 * 'failed-precondition'.
 */
export function projectDraft(draft: DraftInput): PublicProjection | null {
  const rsvp = draft.rsvp || {};

  // RSVP meal options — trim each, drop empties, cap at 12.
  const mealOptions: string[] = Array.isArray(rsvp.mealOptions)
    ? (rsvp.mealOptions as unknown[])
        .map((x) => cleanText(x, 60))
        .filter((s) => s.length > 0)
        .slice(0, 12)
    : [];

  // Venues — each venue needs a name and address to make it onto
  // the public projection. Privacy-relevant fields (gift amounts,
  // contact phones, etc.) were never in the venue object so we don't
  // need to strip them here — the absence of a fields list IS the
  // privacy filter.
  const venues: ProjectedVenue[] = (
    Array.isArray(draft.venues) ? draft.venues : []
  )
    .filter((x: unknown) => x !== null && typeof x === 'object')
    .map((x: unknown, i: number): ProjectedVenue | null => {
      const v = x as Record<string, unknown>;
      const name = cleanText(v.name, 120);
      const address = cleanText(v.address, 240);
      if (!name || !address) return null;
      return {
        id: cleanText(v.id, 80) || `venue-${i + 1}`,
        name,
        address,
        latitude: Number.isFinite(v.latitude) ? Number(v.latitude) : null,
        longitude: Number.isFinite(v.longitude) ? Number(v.longitude) : null,
        mapUrl: safeHttpsUrl(v.mapUrl),
        travelNotes: cleanText(v.travelNotes, 500),
        accessibilityNotes: cleanText(v.accessibilityNotes, 500),
      };
    })
    .filter((v): v is ProjectedVenue => v !== null);

  // Schedule — only slots with valid startsAt < endsAt AND no future
  // publishAt (lets owners hold a draft slot back until a future
  // publish time). Sorted chronologically; `publishAt` is dropped
  // before serialisation so guests can't infer release state.
  const schedule: ProjectedScheduleSlot[] = (
    Array.isArray(draft.schedule) ? draft.schedule : []
  )
    .filter((x: unknown) => x !== null && typeof x === 'object')
    .map((x: unknown, i: number): ProjectedScheduleSlot | null => {
      const s = x as Record<string, unknown>;
      const startsAt = isTimestamp(s.startsAt) ? s.startsAt : null;
      const endsAt = isTimestamp(s.endsAt) ? s.endsAt : null;
      const title = cleanText(s.title, 100);
      if (!title || !startsAt || !endsAt) return null;
      if (endsAt.toMillis() < startsAt.toMillis()) return null;
      const publishAt = isTimestamp(s.publishAt) ? s.publishAt : null;
      if (publishAt && publishAt.toMillis() > Date.now()) return null;
      return {
        id: cleanText(s.id, 80) || `slot-${i + 1}`,
        title,
        startsAt,
        endsAt,
        venueId: cleanText(s.venueId, 80),
        publicNote: cleanText(s.publicNote, 240),
      };
    })
    .filter((s): s is ProjectedScheduleSlot => s !== null)
    .sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis());

  // Accent color must match /^#[0-9a-fA-F]{6}$/. Anything else falls
  // back to the brand default. This stops a malicious draft from
  // shipping an XSS-via-CSS (e.g. `accentColor: 'red; background: url(javascript:...)'`).
  const accentCandidate = cleanText(draft.theme?.accentColor, 16);
  const accentColor =
    /^#[0-9a-fA-F]{6}$/.test(accentCandidate) && accentCandidate.length === 7
      ? accentCandidate
      : DEFAULT_ACCENT;

  const hero: ProjectedHero = {
    coupleNames: cleanText(draft.hero?.coupleNames, 120),
    invitationLine: cleanText(draft.hero?.invitationLine, 240),
    dateLabel: cleanText(draft.hero?.dateLabel, 80),
    countdownEnabled: draft.hero?.countdownEnabled === true,
  };

  // "Publishable" means the projection has couple names + date label.
  // Anything else and the owner will see a half-rendered portal.
  if (!hero.coupleNames || !hero.dateLabel) return null;

  return {
    schemaVersion: 1,
    theme: {
      templateId: cleanText(draft.theme?.templateId, 80) || 'plain',
      accentColor,
      coverUrl: safeHttpsUrl(draft.theme?.coverUrl),
      coverAlt: cleanText(draft.theme?.coverAlt, 140),
    },
    hero,
    rsvp: {
      enabled: rsvp.enabled === true,
      deadlineAt: isTimestamp(rsvp.deadlineAt) ? rsvp.deadlineAt : null,
      allowPartySize: rsvp.allowPartySize === true,
      maxPartySize: clampInt(rsvp.maxPartySize, 1, 10, 1),
      mealOptions,
      allowNote: rsvp.allowNote === true,
    },
    venues,
    schedule,
    calendar: {
      enabled: draft.calendar?.enabled === true,
      title: cleanText(draft.calendar?.title, 140),
      timezone: cleanText(draft.calendar?.timezone, 80) || 'Asia/Hong_Kong',
      reminderMinutes: clampInt(draft.calendar?.reminderMinutes, 0, 10080, 60),
    },
    messages: {
      welcome: cleanText(draft.messages?.welcome, MAX_TEXT),
      thankYou: cleanText(draft.messages?.thankYou, MAX_TEXT),
      thankYouPublishedAt: isTimestamp(draft.messages?.thankYouPublishedAt)
        ? (draft.messages!.thankYouPublishedAt as TimestampLike)
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Link-shape validator
// ---------------------------------------------------------------------------

/**
 * A guest-link doc shape (matches what verifyShareToken writes).
 *
 * Pure type; the actual document fetch lives in the CF module.
 */
export interface GuestLinkDoc {
  ownerUid?: unknown;
  eventId?: unknown;
  guestId?: unknown;
  guestDocId?: unknown;
  redeemedByUid?: unknown;
  expiresAt?: unknown;
}

/**
 * Errors thrown by link validators. CF wrapper maps to HttpsError.
 */
export class LinkInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkInvalidError';
  }
}

/**
 * Verify that a guest-link doc is valid for the given (ownerUid,
 * eventId, authUid) tuple AND that it hasn't expired.
 *
 * Returns the typed guestId + guestDocId for downstream use.
 *
 * This is the single source of truth for "is this guest allowed to act
 * on this event?" — every guest-side callable routes through here.
 *
 * Pure function: pass the doc, get a verdict. No Firestore calls.
 */
export function validateLinkShape(
  link: GuestLinkDoc | null | undefined,
  ownerUid: string,
  eventId: string,
  authUid: string,
  nowMs: number = Date.now(),
): { guestId: string; guestDocId: string } {
  if (!link) throw new LinkInvalidError('guest link is not valid for this event');
  if (link.ownerUid !== ownerUid) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  if (link.eventId !== eventId) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  if (link.redeemedByUid !== authUid) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  if (typeof link.guestDocId !== 'string' || !link.guestDocId) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  if (typeof link.guestId !== 'string' || !link.guestId) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  const expiresAt = link.expiresAt;
  const expiresMs =
    isTimestamp(expiresAt) ? expiresAt.toMillis() : NaN;
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    throw new LinkInvalidError('guest link is not valid for this event');
  }
  return { guestId: link.guestId, guestDocId: link.guestDocId };
}

// ---------------------------------------------------------------------------
// RSVP submission shape
// ---------------------------------------------------------------------------

export const RSVP_STATUSES = ['attending', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export interface RsvpRequestInput {
  status?: unknown;
  partySize?: unknown;
  mealChoice?: unknown;
  note?: unknown;
}

export interface RsvpSanitized {
  status: RsvpStatus;
  partySize: number;
  mealChoice: string | null;
  note: string | null;
}

/**
 * Validate + sanitize an RSVP submission's shape. The CF wrapper then
 * combines this with `projection.rsvp` policy (enabled? deadline
 * passed? meal allowed?) to decide the final write.
 *
 * Pure function. Returns null on any invalid field.
 */
export function sanitizeRsvpRequest(
  req: RsvpRequestInput,
  config: { allowPartySize: boolean; maxPartySize: number; allowNote: boolean },
): RsvpSanitized | null {
  const status = cleanText(req.status, 20);
  if (!RSVP_STATUSES.includes(status as RsvpStatus)) return null;
  const typedStatus = status as RsvpStatus;

  // partySize: only honored when allowPartySize is on; clamps to
  // [1, maxPartySize]; defaults to 1.
  const partySize = config.allowPartySize
    ? clampInt(req.partySize, 1, config.maxPartySize || 1, 1)
    : 1;

  // mealChoice: plain string or null. The CF wrapper checks against
  // config.mealOptions AFTER this sanitises — we don't have the meal
  // list here, just the shape check.
  const mealChoice = cleanText(req.mealChoice, 60) || null;

  // note: only honored when allowNote is on. Max 280 chars.
  const note = config.allowNote ? cleanText(req.note, 280) || null : null;

  // If status is declined, the backend zeroes partySize and clears
  // mealChoice regardless of what the client sent. Defense against a
  // client that sends partySize: 99 + status: 'declined' trying to
  // bias owner stats.
  if (typedStatus === 'declined') {
    return { status: 'declined', partySize: 0, mealChoice: null, note };
  }
  return { status: 'attending', partySize, mealChoice, note };
}

/**
 * Validate that an RSVP submission's mealChoice is in the projection's
 * allowlist. Pure — pass (meal, allowedList), get verdict.
 */
export function mealChoiceIsAllowed(
  mealChoice: string | null,
  allowed: string[],
): boolean {
  if (mealChoice === null) return true;
  return allowed.includes(mealChoice);
}

// ---------------------------------------------------------------------------
// Guest-message submission shape
// ---------------------------------------------------------------------------

export const GUEST_MESSAGE_MAX = 280;

export interface GuestMessageSanitized {
  message: string;
}

/**
 * Sanitize a guest-message submission. Just trim+cap — the only
 * policy. The CF wrapper checks the link is valid; the message itself
 * has no field-level allowlist.
 */
export function sanitizeGuestMessage(
  req: { message?: unknown },
): GuestMessageSanitized {
  return { message: cleanText(req.message, GUEST_MESSAGE_MAX) };
}

// ---------------------------------------------------------------------------
// Bootstrap output shape
// ---------------------------------------------------------------------------

export interface BootstrapGuestDoc {
  guestId?: unknown;
  name?: unknown;
  tableNumber?: unknown;
  rsvpStatus?: unknown;
  rsvpPartySize?: unknown;
  rsvpMealChoice?: unknown;
  rsvpNote?: unknown;
  guestMessage?: unknown;
}

/**
 * Shape the public-facing guest bootstrap response. Privacy-relevant
 * fields (email, phone, gift amount, check-in status, internal notes)
 * are intentionally NOT in this shape — they're never read from the
 * Firestore doc here. The CF wrapper passes only the fields we want
 * to return.
 */
export interface BootstrapGuest {
  id: string;
  guestId: string;
  name: string;
  tableNumber: string;
  rsvpStatus: string;
  rsvpPartySize: number;
  rsvpMealChoice: string | null;
  rsvpNote: string | null;
  guestMessage: string;
}

export function buildBootstrapGuest(
  guestDocId: string,
  g: BootstrapGuestDoc,
  linkGuestId: string,
): BootstrapGuest | null {
  if (g.guestId !== linkGuestId) return null;
  return {
    id: guestDocId,
    guestId: cleanText(g.guestId, 80),
    name: cleanText(g.name, 120),
    tableNumber: cleanText(g.tableNumber, 40),
    rsvpStatus: typeof g.rsvpStatus === 'string' ? g.rsvpStatus : 'pending',
    rsvpPartySize: Number.isInteger(g.rsvpPartySize)
      ? Number(g.rsvpPartySize)
      : 1,
    rsvpMealChoice:
      typeof g.rsvpMealChoice === 'string' ? g.rsvpMealChoice : null,
    rsvpNote: typeof g.rsvpNote === 'string' ? g.rsvpNote : null,
    guestMessage: typeof g.guestMessage === 'string' ? g.guestMessage : '',
  };
}
