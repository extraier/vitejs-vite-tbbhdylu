/**
 * Gift-amount split.
 *
 * Firestore rules cannot redact fields. Helpers with canViewGuestList
 * were able to read giftAmount off the guest doc. The enforced store
 * is events/{eventId}/guestGifts/{guestId}. Guest docs and the
 * sanitized guestDirectory projection must not keep those keys.
 */

export const GIFT_FIELD_KEYS = ['giftAmount', 'hasGifted', 'lastGiftedAt'] as const;

export type GiftFieldKey = (typeof GIFT_FIELD_KEYS)[number];

export interface GiftRecord {
  giftAmount: number;
  hasGifted: boolean;
  lastGiftedAt: unknown;
}

export function hasLegacyGiftFields(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  return GIFT_FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

export function stripGiftFields(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if ((GIFT_FIELD_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function legacyGiftRecord(
  data: Record<string, unknown> | null | undefined,
): GiftRecord | null {
  if (!data || !hasLegacyGiftFields(data)) return null;
  const raw = data.giftAmount;
  const giftAmount = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return {
    giftAmount,
    hasGifted: data.hasGifted === true,
    lastGiftedAt: data.lastGiftedAt ?? null,
  };
}

/**
 * A later red-packet write lands on guestGifts directly. Don't let a
 * stale guest-doc zero (hasGifted false) clobber that record.
 */
export function shouldReplaceGiftDoc(
  existing: Record<string, unknown> | null | undefined,
  incoming: GiftRecord,
): boolean {
  if (!existing) return true;
  if (existing.hasGifted === true && incoming.hasGifted !== true) return false;
  return true;
}

export function previousGiftAmount(
  gift: Record<string, unknown> | null | undefined,
  guest: Record<string, unknown> | null | undefined,
): number | null {
  const sources = [gift, guest];
  for (const source of sources) {
    if (!source || source.hasGifted !== true) continue;
    if (typeof source.giftAmount === 'number' && Number.isFinite(source.giftAmount)) {
      return source.giftAmount;
    }
  }
  return null;
}

export function attachOwnGiftStatus<T extends object>(
  guest: T,
  gift: Record<string, unknown> | null | undefined,
): T & { hasGifted: boolean; giftAmount: number } {
  const hasGifted = gift?.hasGifted === true;
  const raw = gift?.giftAmount;
  const giftAmount = hasGifted && typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return { ...guest, hasGifted, giftAmount };
}
