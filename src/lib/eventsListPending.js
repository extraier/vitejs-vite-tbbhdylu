// The lobby must not treat "subscription not back yet" as "zero events".
// Own events are enough to paint the list. If the couple owns nothing,
// wait for the co-owner query too, unless that query already failed
// (it falls back to the own list).

export function eventsListPending({
  signedIn = false,
  guestMode = false,
  guestDataReady = true,
  ownLoading = false,
  ownCount = 0,
  coOwnedActive = false,
  coOwnedLoading = false,
  coOwnedError = null,
} = {}) {
  if (!signedIn || guestMode) return false;
  if (!guestDataReady || ownLoading) return true;
  if (ownCount > 0) return false;
  return Boolean(coOwnedActive && coOwnedLoading && !coOwnedError);
}
