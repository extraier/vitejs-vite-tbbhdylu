import { describe, expect, it } from 'vitest';
import { eventsListPending } from './eventsListPending';

describe('eventsListPending', () => {
  it('stays pending until the signed-in couple’s own events have loaded', () => {
    expect(eventsListPending({
      signedIn: true,
      guestDataReady: true,
      ownLoading: true,
      ownCount: 0,
    })).toBe(true);
  });

  it('stays pending while the co-owner query is the only place an event could be', () => {
    expect(eventsListPending({
      signedIn: true,
      guestDataReady: true,
      ownLoading: false,
      ownCount: 0,
      coOwnedActive: true,
      coOwnedLoading: true,
    })).toBe(true);
  });

  it('shows the list as soon as the couple owns an event, even if co-owned is still loading', () => {
    expect(eventsListPending({
      signedIn: true,
      ownLoading: false,
      ownCount: 1,
      coOwnedActive: true,
      coOwnedLoading: true,
    })).toBe(false);
  });

  it('shows the empty state only after both queries have settled', () => {
    expect(eventsListPending({
      signedIn: true,
      ownLoading: false,
      ownCount: 0,
      coOwnedActive: true,
      coOwnedLoading: false,
    })).toBe(false);
  });

  it('does not wait on a co-owner query that already failed', () => {
    expect(eventsListPending({
      signedIn: true,
      ownLoading: false,
      ownCount: 0,
      coOwnedActive: true,
      coOwnedLoading: true,
      coOwnedError: new Error('permission-denied'),
    })).toBe(false);
  });
});
