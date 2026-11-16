// Premium UI reads the event entitlement resolver only.
// The event document's tier field is not a grant: owners could
// write it, and revokeUnlock never cleared it. A loading
// resolver must not fall back to that field, or an expired
// unlock keeps premium UI for as long as the request is in flight.

export function entitlementIsPremium(features) {
  if (!features || typeof features !== 'object') return false;
  return !!(
    features.customInvitation
    || features.watermarkRemoved
    || features.extraStorage
    || features.lifetimeRetention
  );
}

// Invitation custom backgrounds follow customInvitation alone.
// Storage and watermark unlocks do not open the editor.
export function invitationOwnerTier(features) {
  return features?.customInvitation ? 'premium' : 'free';
}
