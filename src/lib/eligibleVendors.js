// 2026-08-15 — Vendor Onboarding & Assignment Audit (Root Cause 2 + 3).
//
// The single canonical resolver that turns "this couple's stuff" into
// "vendors this couple can assign to a rundown entry / resource item
// / to-do task". Replaces the inquiry-only list that used to drive
// VendorPicker (which created the circular dependency: "must chat
// first before assigning", but chat only opened if the catalog-picked
// vendor had a link — which was being erased in handleAddVendorContact).
//
// Source data:
//   1. /artifacts/{appId}/users/{uid}/vendorContacts — every contact
//      the couple has saved. Linked contacts (linkedVendorUid set)
//      are *immediate* onboarded vendors and always eligible.
//   2. /artifacts/{appId}/vendorInquiries/* — chats the couple has
//      started with vendors not yet in their address book. These
//      come from the couple-side inquiry form or the shared chat.
//      We only treat inquiries where the vendorUid is present and
//      not already in the linked-contact list.
//
// Dedup rule: by uid. First source wins (linked-contact first, so a
// vendor the couple explicitly added is preferred over a passive
// chat thread). The shape matches VendorPicker's existing
// { uid, name } contract + category for the rundown card.
//
// Source tag is preserved for analytics / debugging:
//   - 'linked-contact' — picked from catalog or manually added with
//                        a real platform vendor link.
//   - 'inquiry'        — chat thread exists but the couple hasn't
//                        added the vendor to their address book.

/**
 * @typedef {Object} EligibleVendor
 * @property {string} uid          Auth UID of the onboarded vendor.
 * @property {string} name         Display name for the picker chip.
 * @property {string} [category]   Top-level category key, e.g. 'photographer'.
 * @property {'linked-contact'|'inquiry'} source
 */

/**
 * Build the canonical assignable-vendor list from contacts + inquiries.
 *
 * @param {Array} vendorContacts  Couple's saved contacts (each may have
 *                                linkedVendorUid; vendorName; category).
 * @param {Array} inquiries       Vendor inquiry docs (each may have
 *                                vendorUid; vendorName).
 * @returns {EligibleVendor[]}    Sorted by name; deduplicated by uid.
 */
export function resolveEligibleAssignedVendors(
  vendorContacts = [],
  inquiries = []
) {
  /** @type {Map<string, EligibleVendor>} */
  const byUid = new Map();

  // 1. Linked contacts first — these are the "I picked this vendor from
  //    the catalog" entries. Always eligible; category from the contact.
  for (const c of vendorContacts) {
    const uid = c?.linkedVendorUid;
    if (!uid) continue;
    if (byUid.has(uid)) continue;
    byUid.set(uid, {
      uid,
      name: c.vendorName || '商戶',
      category: c.category || '',
      source: 'linked-contact',
    });
  }

  // 2. Inquiry-only vendors — chats with vendors the couple hasn't
  //    explicitly saved. We surface these too so the couple can
  //    assign to a vendor they're already chatting with. The
  //    contact's category may be missing (inquiries don't always
  //    carry it), so we leave it empty rather than guessing.
  for (const i of inquiries) {
    const uid = i?.vendorUid;
    if (!uid) continue;
    if (byUid.has(uid)) continue;
    byUid.set(uid, {
      uid,
      name: i.vendorName || i.vendorDisplayName || '商戶',
      category: '',
      source: 'inquiry',
    });
  }

  const list = Array.from(byUid.values());
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return list;
}

/**
 * Lightweight variant for cases that only care about the deduped
 * { uid, name } pair (e.g. legacy callers that ignore source/category).
 *
 * @param {Array} vendorContacts
 * @param {Array} inquiries
 * @returns {Array<{ uid: string, name: string }>}
 */
export function resolveAssignableVendorsShort(vendorContacts = [], inquiries = []) {
  return resolveEligibleAssignedVendors(vendorContacts, inquiries).map((v) => ({
    uid: v.uid,
    name: v.name,
  }));
}
