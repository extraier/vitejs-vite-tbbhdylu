// Shared payload for a couple's first event. Both the signed-in create
// path and the guest-upgrade replay must stamp coOwners with the creator.
// Partner invites and the collection-group "weddings I co-own" query read
// that array; the path owner is not implied by it.

export function buildNewEventFields(name, ownerUid, now = Date.now()) {
  return {
    name,
    tier: 'free',
    budget: 350000,
    coOwners: [ownerUid],
    createdAt: now,
  };
}
