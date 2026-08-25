// 2026-08-25 — Manus P9. Entitlement gate matrix tests.
//
// The five-row matrix from the handoff §Patch 1 — Required test
// section. These prove the role gate is correct without rendering
// the full <App/> (which would pull in firebase and an auth gate).

import { describe, expect, it } from 'vitest';
import { getEntitlementEventId } from './entitlementGate';

const EVENT = 'event-42';
const OWNER = 'owner-uid';

describe('getEntitlementEventId', () => {
  it('passes the event ID for the original owner viewing their own event', () => {
    expect(
      getEntitlementEventId({
        userRole: 'owner',
        dataOwnerUid: OWNER,
        userUid: OWNER,
        eventId: EVENT,
      }),
    ).toBe(EVENT);
  });

  it('returns null when reception role is viewing the couple event', () => {
    expect(
      getEntitlementEventId({
        userRole: 'reception',
        dataOwnerUid: OWNER,
        userUid: 'reception-uid',
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null for the helper role', () => {
    expect(
      getEntitlementEventId({
        userRole: 'helper',
        dataOwnerUid: OWNER,
        userUid: 'helper-uid',
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null for the vendor role', () => {
    expect(
      getEntitlementEventId({
        userRole: 'vendor',
        dataOwnerUid: OWNER,
        userUid: 'vendor-uid',
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null for the guest / guest_portal role', () => {
    expect(
      getEntitlementEventId({
        userRole: 'guest_portal',
        dataOwnerUid: OWNER,
        userUid: 'guest-uid',
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null when a co-owner (different uid) views the event', () => {
    expect(
      getEntitlementEventId({
        userRole: 'owner',
        dataOwnerUid: OWNER,
        userUid: 'co-owner-uid',
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null when there is no selected event', () => {
    expect(
      getEntitlementEventId({
        userRole: 'owner',
        dataOwnerUid: OWNER,
        userUid: OWNER,
        eventId: null,
      }),
    ).toBeNull();
  });

  it('returns null when the dataOwnerUid is missing', () => {
    expect(
      getEntitlementEventId({
        userRole: 'owner',
        dataOwnerUid: null,
        userUid: OWNER,
        eventId: EVENT,
      }),
    ).toBeNull();
  });

  it('returns null when the userUid is missing (anonymous session)', () => {
    expect(
      getEntitlementEventId({
        userRole: 'owner',
        dataOwnerUid: OWNER,
        userUid: null,
        eventId: EVENT,
      }),
    ).toBeNull();
  });
});