// Shared payload for a couple's first event. Both the signed-in
// create path and the guest-upgrade replay use this.
//
// tier, coOwners, and userId are intentionally absent. Rules reject
// client writes of those fields. Premium comes from the entitlement
// resolver. Co-owners are added by acceptPartnerInvite (Admin SDK).
// The creator's access is the path users/{uid}/events/{eventId}.

export function buildNewEventFields(name, ownerUid, now = Date.now()) {
  if (typeof ownerUid !== 'string' || !ownerUid) {
    throw new Error('ownerUid is required');
  }
  return {
    name,
    budget: 350000,
    createdAt: now,
  };
}
