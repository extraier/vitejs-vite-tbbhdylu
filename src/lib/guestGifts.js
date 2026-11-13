import { sanitizeGuestForHelper } from './helpers';

/**
 * Owners (helperPerms == null) and helpers with canViewGiftAmount
 * read /guests plus /guestGifts. Everyone else with a helper perm
 * object reads the sanitized /guestDirectory projection.
 */
export function guestListCollectionName(helperPerms) {
  if (!helperPerms || helperPerms.canViewGiftAmount === true) return 'guests';
  return 'guestDirectory';
}

export function mergeGuestGifts(guests, giftDocs, helperPerms) {
  const byId = new Map((giftDocs || []).map((gift) => [gift.id, gift]));
  const merged = (guests || []).map((guest) => {
    const gift = byId.get(guest.id);
    if (!gift) return guest;
    const amount = typeof gift.giftAmount === 'number' && Number.isFinite(gift.giftAmount)
      ? gift.giftAmount
      : 0;
    return {
      ...guest,
      hasGifted: gift.hasGifted === true,
      giftAmount: gift.hasGifted === true ? amount : 0,
    };
  });
  if (!helperPerms || helperPerms.canViewGiftAmount === true) return merged;
  return merged.map((guest) => sanitizeGuestForHelper(guest, helperPerms));
}
