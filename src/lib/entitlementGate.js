// 2026-08-25 — Manus P9.
//
// getEventEntitlement currently resolves an event from the
// authenticated owner's namespace. Reception, helper, vendor,
// guest, and co-owner views must not request it until the
// callable gains canonical shared-event support.
//
// This helper centralises the gate so App.jsx has one obvious
// place to pass the role context through, and so the matrix
// can be exercised in unit tests without rendering <App/>.

/**
 * @param {object} params
 * @param {string | null} params.userRole     Current active role.
 * @param {string | null} params.dataOwnerUid Canonical owner for the
 *                                            currently loaded event.
 * @param {string | null} params.userUid      The signed-in user's UID.
 * @param {string | null} params.eventId      The active event ID.
 * @returns {string | null}  The event ID to pass to
 *                            useEventEntitlement, or null to skip.
 */
export function getEntitlementEventId({
  userRole,
  dataOwnerUid,
  userUid,
  eventId,
}) {
  // Only the canonical owner (signed in as themselves, viewing
  // their own event) is permitted to call getEventEntitlement.
  // Co-owners, helpers, vendors, reception, and guest roles must
  // pass null until the callable supports them server-side.
  if (userRole !== 'owner') return null;
  if (!dataOwnerUid || !userUid) return null;
  if (dataOwnerUid !== userUid) return null;
  return eventId || null;
}