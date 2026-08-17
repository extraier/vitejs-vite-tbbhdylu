// 2026-08-15 — Vendor Onboarding & Assignment Audit (Fix 4).
// Cloud Function wrappers for the "重新連結商戶" repair path.
// Couples whose contacts lost the catalog link (the 2026-08-09
// incident where `handleAddVendorContact` defaulted
// `linkedVendorUid` to null) can use this to search the vendor
// directory and re-stamp the link.
//
//   linkVendorContact   — { contactId, vendorUid, dryRun? }
//     Validates ownership of the contact + existence of the
//     vendor. With dryRun, returns the resolved vendor without
//     writing. Without, stamps linkedVendorUid +
//     invitationAccepted + audit fields (linkedAt, linkSource).
//
//   searchVendorsByName — { name?, category?, limit? }
//     Lightweight lookup against /vendors. Filters by category
//     via Firestore query (indexed) and by case-insensitive
//     substring on name in-memory. Cap at 50.

import { getFunctions, httpsCallable } from 'firebase/functions';

function getFn() {
  return getFunctions();
}

export type VendorSearchHit = {
  uid: string;
  name: string;
  category: string;
  serviceAreaCity: string;
};

export type VendorLinkPreview = {
  contactId: string;
  vendorUid: string;
  vendorName: string;
  vendorCategory: string;
  currentLinkedVendorUid: string | null;
};

export async function searchVendorsByName(args: {
  name?: string;
  category?: string;
  limit?: number;
}): Promise<VendorSearchHit[]> {
  const fn = httpsCallable(getFn(), 'searchVendorsByName');
  const res = await fn(args);
  const data = res.data as { ok: boolean; hits: VendorSearchHit[] };
  return data.hits || [];
}

export async function previewLinkVendorContact(args: {
  contactId: string;
  vendorUid: string;
}): Promise<VendorLinkPreview> {
  const fn = httpsCallable(getFn(), 'linkVendorContact');
  const res = await fn({ ...args, dryRun: true });
  const data = res.data as { ok: boolean; dryRun: true; wouldLink: VendorLinkPreview };
  return data.wouldLink;
}

export async function linkVendorContact(args: {
  contactId: string;
  vendorUid: string;
}): Promise<VendorLinkPreview> {
  const fn = httpsCallable(getFn(), 'linkVendorContact');
  const res = await fn(args);
  const data = res.data as {
    ok: boolean;
    linked: { contactId: string; vendorUid: string; vendorName: string; vendorCategory: string };
  };
  return {
    contactId: data.linked.contactId,
    vendorUid: data.linked.vendorUid,
    vendorName: data.linked.vendorName,
    vendorCategory: data.linked.vendorCategory,
    currentLinkedVendorUid: null,
  };
}

export const vendorRelinkApi = {
  searchVendorsByName,
  previewLinkVendorContact,
  linkVendorContact,
};