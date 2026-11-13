import { describe, expect, it } from 'vitest';
import {
  attachOwnGiftStatus,
  hasLegacyGiftFields,
  legacyGiftRecord,
  previousGiftAmount,
  shouldReplaceGiftDoc,
  stripGiftFields,
} from '../src/guestGifts.pure';

describe('guest gift field split', () => {
  const guest = {
    name: '陳大文',
    giftAmount: 800,
    hasGifted: true,
    lastGiftedAt: 10,
    note: 'keep',
  };

  it('strips gift keys and keeps the rest of the guest doc', () => {
    expect(stripGiftFields(guest)).toEqual({ name: '陳大文', note: 'keep' });
    expect(hasLegacyGiftFields(guest)).toBe(true);
    expect(hasLegacyGiftFields({ name: '陳大文' })).toBe(false);
  });

  it('does not let a legacy zero clobber a confirmed gift record', () => {
    const incoming = legacyGiftRecord({ giftAmount: 0, hasGifted: false })!;
    expect(shouldReplaceGiftDoc({ hasGifted: true, giftAmount: 500 }, incoming)).toBe(false);
    expect(shouldReplaceGiftDoc(null, incoming)).toBe(true);
    expect(shouldReplaceGiftDoc({ hasGifted: false }, legacyGiftRecord(guest)!)).toBe(true);
  });

  it('reads the previous amount from the gift doc before the guest doc', () => {
    expect(previousGiftAmount({ hasGifted: true, giftAmount: 900 }, { hasGifted: true, giftAmount: 100 })).toBe(900);
    expect(previousGiftAmount(null, { hasGifted: true, giftAmount: 100 })).toBe(100);
    expect(previousGiftAmount({ hasGifted: false }, { hasGifted: false, giftAmount: 100 })).toBeNull();
  });

  it('attaches only the caller’s own gift status for the guest portal', () => {
    const base = { id: 'g1', name: '陳大文' };
    expect(attachOwnGiftStatus(base, { hasGifted: true, giftAmount: 600 })).toEqual({
      id: 'g1',
      name: '陳大文',
      hasGifted: true,
      giftAmount: 600,
    });
    expect(attachOwnGiftStatus(base, null)).toMatchObject({ hasGifted: false, giftAmount: 0 });
  });
});
