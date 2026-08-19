// 2026-08-19 — Manus P0.1 unit tests for the trigger's pure
// pre-Firestore validation helper.
//
// These tests pin the namespace guard + missing-params +
// parentKind whitelisting rules without needing a Firestore
// emulator. The end-to-end fan-out path is covered by the
// existing emulator tests; this file guards the cheap
// "did we even reach the read?" decision that fires on every
// comment write.

import { describe, it, expect } from 'vitest';

// 2026-08-19 — the trigger imports `initializeApp` at module-load
// time, which throws in our test env (no Firebase Admin context).
// Stub `firebase-admin/app` so the module evaluates.
import { vi } from 'vitest';
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  FieldValue: { serverTimestamp: vi.fn(() => ({})) },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: () => (_h: unknown) => ({}),
}));

import { validateBigDayCommentEvent } from '../src/commentAlertTrigger';

const PRODUCTION = 'savetheday-production';

const validParams = {
  appId: PRODUCTION,
  ownerUid: 'couple-1',
  eventId: 'event-1',
  parentKind: 'rundown',
  parentId: 'rd-1',
  commentId: 'cm-1',
  expectedAppId: PRODUCTION,
};

describe('validateBigDayCommentEvent (P0.1 namespace guard)', () => {
  it('returns null for a fully-valid production event', () => {
    expect(validateBigDayCommentEvent(validParams)).toBe(null);
  });

  it('returns "foreign-app" when appId is undefined', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, appId: undefined }),
    ).toBe('foreign-app');
  });

  it('returns "foreign-app" when appId is empty', () => {
    expect(validateBigDayCommentEvent({ ...validParams, appId: '' })).toBe(
      'foreign-app',
    );
  });

  it('returns "foreign-app" for a staging appId', () => {
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        appId: 'savetheday-staging',
      }),
    ).toBe('foreign-app');
  });

  it('returns "foreign-app" for a typo-ed appId (off-by-one)', () => {
    // Defensive: a single character change in appId should still
    // trip the guard. Documents the constant's exact spelling.
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        appId: 'savetheday-productio',
      }),
    ).toBe('foreign-app');
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        appId: 'savetheday-productionX',
      }),
    ).toBe('foreign-app');
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        appId: 'savetheday-prod',
      }),
    ).toBe('foreign-app');
  });

  it('returns "foreign-app" BEFORE checking other params (priority order)', () => {
    // Even if all the other params are present and valid, a
    // foreign appId must short-circuit. Otherwise the handler
    // would attempt to read from the production tree using
    // foreign parent ids.
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        appId: 'something-else',
        ownerUid: undefined,
        eventId: undefined,
      }),
    ).toBe('foreign-app');
  });

  it('returns "missing-params" when appId matches but ownerUid is missing', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, ownerUid: undefined }),
    ).toBe('missing-params');
  });

  it('returns "missing-params" when eventId is missing', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, eventId: undefined }),
    ).toBe('missing-params');
  });

  it('returns "missing-params" when parentKind is missing', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, parentKind: undefined }),
    ).toBe('missing-params');
  });

  it('returns "missing-params" when parentId is missing', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, parentId: undefined }),
    ).toBe('missing-params');
  });

  it('returns "missing-params" when commentId is missing', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, commentId: undefined }),
    ).toBe('missing-params');
  });

  it('returns "missing-params" for empty-string params', () => {
    expect(
      validateBigDayCommentEvent({ ...validParams, ownerUid: '' }),
    ).toBe('missing-params');
    expect(
      validateBigDayCommentEvent({ ...validParams, commentId: '   ' }),
    ).toBe('missing-params');
  });

  it('returns "unknown-parent-kind" for vendors or other unexpected segments', () => {
    // The wildcard pattern could match /events/{eventId}/vendors/
    // {vendorId}/comments/{commentId} if a future caller wrote
    // there. We don't fan out for those.
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        parentKind: 'vendors',
      }),
    ).toBe('unknown-parent-kind');
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        parentKind: 'tasks',
      }),
    ).toBe('unknown-parent-kind');
  });

  it('returns "unknown-parent-kind" BEFORE checking other params after the namespace', () => {
    // The hierarchy: foreign-app > missing-params >
    // unknown-parent-kind. If parentKind is bogus, return that
    // reason even when everything else is present.
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        parentKind: 'vendors',
        commentId: 'cm-1',
      }),
    ).toBe('unknown-parent-kind');
  });

  it('accepts both rundown and resources parentKinds', () => {
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        parentKind: 'rundown',
      }),
    ).toBe(null);
    expect(
      validateBigDayCommentEvent({
        ...validParams,
        parentKind: 'resources',
      }),
    ).toBe(null);
  });
});