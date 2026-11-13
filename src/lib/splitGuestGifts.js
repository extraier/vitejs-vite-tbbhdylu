async function defaultSplitCall(data) {
  const { httpsCallable } = await import('firebase/functions');
  const { functions } = await import('./firebase');
  const fn = httpsCallable(functions, 'splitEventGuestGifts');
  await fn(data);
}

/**
 * Ask the server to move legacy gift fields off guest docs.
 * Failures are non-fatal: the list still renders, and rules
 * hide guestGifts from helpers who cannot view amounts.
 * Vitest skips the real callable unless a stub is passed.
 */
export async function requestGuestGiftSplit(ownerUid, eventId, call = defaultSplitCall) {
  if (!ownerUid || !eventId) return { ok: false, skipped: true };
  if (import.meta.env.VITEST && call === defaultSplitCall) return { ok: false, skipped: true };
  await call({ ownerUid, eventId });
  return { ok: true, skipped: false };
}
