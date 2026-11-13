import { describe, expect, it } from 'vitest';
import { guestListCollectionName, mergeGuestGifts } from './guestGifts';
import { requestGuestGiftSplit } from './splitGuestGifts';

const guest = { id: 'g1', name: '陳大文', giftAmount: 800, hasGifted: true };
const gifts = [{ id: 'g1', giftAmount: 1200, hasGifted: true }];

describe('guest list gift enforcement on the client', () => {
  it('sends helpers without canViewGiftAmount to guestDirectory', () => {
    expect(guestListCollectionName(null)).toBe('guests');
    expect(guestListCollectionName({ canViewGiftAmount: true })).toBe('guests');
    expect(guestListCollectionName({ canViewGuestList: true })).toBe('guestDirectory');
  });

  it('overlays guestGifts for the owner and strips them for a helper', () => {
    const ownerView = mergeGuestGifts([guest], gifts, null);
    expect(ownerView[0].giftAmount).toBe(1200);
    const helperView = mergeGuestGifts([guest], gifts, { canViewGiftAmount: false });
    expect(helperView[0].giftAmount).toBe(0);
    expect(helperView[0].hasGifted).toBe(false);
    expect(helperView[0].name).toBe('陳大文');
  });

  it('still strips a legacy amount when no gift doc has been split yet', () => {
    const helperView = mergeGuestGifts([guest], [], { canViewGuestList: true });
    expect(helperView[0].giftAmount).toBe(0);
    expect(helperView[0].hasGifted).toBe(false);
  });
});

describe('requestGuestGiftSplit', () => {
  it('does not call the network without an event, and uses the injected callable', async () => {
    expect(await requestGuestGiftSplit('', 'e1')).toEqual({ ok: false, skipped: true });
    const calls = [];
    const result = await requestGuestGiftSplit('owner', 'event', async (data) => {
      calls.push(data);
    });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(calls).toEqual([{ ownerUid: 'owner', eventId: 'event' }]);
  });
});
