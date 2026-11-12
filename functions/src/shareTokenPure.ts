/**
 * Single-use check for verifyShareToken.
 * A guestId already redeemed by a different auth uid cannot be
 * redeemed again, even if that earlier link was later revoked.
 */
export function shareTokenReuse(docs: Array<{
  id: string;
  redeemedByUid?: unknown;
}>, authUid: string): 'taken' | null {
  for (const doc of docs) {
    if (doc.id === authUid) continue;
    if (typeof doc.redeemedByUid === 'string' && doc.redeemedByUid.length > 0) {
      return 'taken';
    }
  }
  return null;
}
