// vendorActivation.ts — typed client wrappers for the 3 vendor
// activation cloud functions in functions/src/vendorActivation.ts.
//
// 2026-07-20 — new module. Used by:
//   • AdminVendors.jsx — admin sends "Send invite link" buttons
//   • VendorSignup.jsx — vendor claims a seeded slot via invite token
//   • public signup screen — accepts ?signup&venue=&token= links
//
// Wrapper pattern matches src/lib/helpers.ts (one function per CF,
// thin async / privacy wrapper, throws on HttpsError so call sites
// can catch friendly errors via showToast).

import { getFunctions, httpsCallable } from 'firebase/functions';

export interface ActivateSeededVendorInput {
  slug: string;
  ttlMs?: number;
}

export interface ActivateSeededVendorResult {
  ok: true;
  slug: string;
  signupUrl: string;
  signupStatus: 'invited';
  invitationExpiresAt: string;
}

export interface SendVendorInviteEmailInput {
  slug: string;
  email: string;
  signupUrl?: string;
}

export interface SendVendorInviteEmailResult {
  ok: true;
  sent: boolean;
  reason?: string;
}

export interface ClaimSeededVendorInput {
  slug: string;
  invitationToken: string;
}

export interface ClaimSeededVendorResult {
  ok: true;
  authUid: string;
  migratedStorageObjects: number;
}

export interface ClaimAndApplyAsVendorInput {
  slug: string;
  invitationToken: string;
  // Wizard payload — same shape as applyAsVendor
  name: string;
  category: string;
  subcategory?: string;
  description?: string;
  yearsInBusiness?: number;
  serviceArea?: string;
  priceMin: number;
  priceMax?: number | null;
  currency?: string;
  openEnded?: boolean;
  portfolio?: string[];
  tags?: string[];
}

export interface ClaimAndApplyAsVendorResult {
  ok: true;
  vendorUid: string;
  status: 'pending';
  migratedStorageObjects: number;
}

function getFns() {
  // Match the helpers.ts pattern. Some modules lazy-import firebase;
  // this avoids taking a hard import at module load.
  return getFunctions();
}

/** Admin-only. Mints a fresh invitation token on /vendors/{slug} and
 *  returns the deep link the vendor should click to claim their slot. */
export async function activateSeededVendor(
  slug: string,
  ttlMs?: number,
): Promise<ActivateSeededVendorResult> {
  const fn = httpsCallable<
    ActivateSeededVendorInput,
    ActivateSeededVendorResult
  >(getFns(), 'activateSeededVendor');
  const r = await fn({ slug, ttlMs });
  return r.data;
}

/** Admin-only. Sends the invitation link via SMTP. Failure to send is
 *  reported in `reason` rather than thrown so the UI can copy the link
 *  as a fallback. */
export async function sendVendorInviteEmail(
  slug: string,
  email: string,
  signupUrl?: string,
): Promise<SendVendorInviteEmailResult> {
  const fn = httpsCallable<
    SendVendorInviteEmailInput,
    SendVendorInviteEmailResult
  >(getFns(), 'sendVendorInviteEmail');
  const r = await fn({ slug, email, signupUrl });
  return r.data;
}

/** Vendor-side, called at the END of the public signup flow when the
 *  user visited ?signup&venue=&token=. Atomically migrates
 *  /vendors/{slug} → /vendors/{authUid} and moves storage. */
export async function claimSeededVendor(
  slug: string,
  invitationToken: string,
): Promise<ClaimSeededVendorResult> {
  const fn = httpsCallable<
    ClaimSeededVendorInput,
    ClaimSeededVendorResult
  >(getFns(), 'claimSeededVendor');
  const r = await fn({ slug, invitationToken });
  return r.data;
}

/** Combined "claim seeded slot" + "submit wizard data" — called from
 *  the vendor onboarding wizard when the user arrived via the
 *  invitation deep-link. Bypasses the "doc already exists" guard that
 *  blocks the two-step path (applyAsVendor + claimSeededVendor). */
export async function claimAndApplyAsVendor(
  input: ClaimAndApplyAsVendorInput,
): Promise<ClaimAndApplyAsVendorResult> {
  const fn = httpsCallable<
    ClaimAndApplyAsVendorInput,
    ClaimAndApplyAsVendorResult
  >(getFns(), 'claimAndApplyAsVendor');
  const r = await fn(input);
  return r.data;
}

/** 2026-07-20 — admin bulk invite. Mints invitation tokens for many
 *  vendors in one cloud function call. Optional email send per row.
 *  Used by AdminVendors "批量發邀請" to onboard the 643-vendor batch
 *  without clicking each row. */
export interface BulkActivateVendorItem {
  slug: string;
  email?: string;
}
export interface BulkActivateVendorRow {
  slug: string;
  ok: boolean;
  signupUrl?: string;
  emailSent?: boolean;
  emailError?: string;
  error?: string;
  signupStatus?: 'invited' | 'claimed';
  invitationExpiresAt?: string;
}
export interface BulkActivateSeededVendorsInput {
  items: BulkActivateVendorItem[];
  sendEmails?: boolean;
  ttlMs?: number;
}
export interface BulkActivateSeededVendorsResult {
  ok: true;
  totalRequested: number;
  minted: number;
  emailsSent: number;
  emailsFailed: number;
  rows: BulkActivateVendorRow[];
}

export async function bulkActivateSeededVendors(
  input: BulkActivateSeededVendorsInput,
): Promise<BulkActivateSeededVendorsResult> {
  const fn = httpsCallable<
    BulkActivateSeededVendorsInput,
    BulkActivateSeededVendorsResult
  >(getFns(), 'bulkActivateSeededVendors');
  const r = await fn(input);
  return r.data;
}
