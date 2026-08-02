// 2026-08-02 (BrowseOnlyNotice WhatsApp shortcut) — static
// regression guards for the WhatsApp-button wiring.
//
// Why static instead of mounting the modal: VendorModal pulls in
// heavyweight deps (firestore, storage, chat lib, lightbox) and is
// already covered by its own test surface. The new behavior is a
// pure-derivation from `vendor.contact.phone` to a wa.me URL —
// guarding the source shape and URL template is sufficient to catch
// refactors that drop the button, break the deep-link format, or
// regress the visibility condition.
//
// What we check:
//   1. The component reads `vendor.contact?.phone` (not `vendor.phone`,
//      `vendor.whatsapp`, or another shape).
//   2. The URL is built from digits-only (regex strips non-digits
//      so "+852 9123 4567" → "85291234567").
//   3. The URL uses `wa.me/{digits}` (cross-platform entry point).
//   4. The button has `data-testid="browse-only-whatsapp"` so
//      end-to-end tests can target it.
//   5. A phone shorter than 7 digits does NOT produce a button
//      (guards against blank/spoofed numbers producing broken
//      wa.me links that 404 to WhatsApp's "invalid number" page).
//
// If you change this file, also update the corresponding inline
// comments inside VendorModal.jsx so future readers know where the
// phone field is sourced from.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  process.cwd(),
  'src/components/modals/VendorModal.jsx',
);

describe('BrowseOnlyNotice WhatsApp shortcut', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('reads the phone from vendor.contact?.phone (CSV import shape)', () => {
    expect(source).toMatch(/vendor\?\.contact\?\.phone|vendor\.contact\?\.phone/);
  });

  it('strips non-digits before building the wa.me URL', () => {
    // Defends against "+852 9123 4567" or "9123-4567" landing in the URL
    expect(source).toContain('.replace(/\\D/g, \'\')');
  });

  it('builds a wa.me/{digits} URL with a greeting in the text query', () => {
    expect(source).toContain('https://wa.me/');
    expect(source).toContain('?text=');
    expect(source).toContain('encodeURIComponent');
  });

  it('exposes data-testid for end-to-end targeting', () => {
    expect(source).toContain('data-testid="browse-only-whatsapp"');
  });

  it('hides the button when the phone is too short to be real', () => {
    // 7-digit threshold: HK mobile is 8 digits, with country code 11.
    // Anything under 7 is almost certainly a typo / placeholder /
    // partial import. Without this guard, the wa.me link would 404
    // and the couple would think the button is broken.
    expect(source).toContain('phoneDigits.length >= 7');
  });

  it('opens in a new tab with noopener (security hygiene)', () => {
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });

  // 2026-08-02 (Option-B half) — second action: couples can also
  // open the same VendorInviteLinkModal admins use, retitled. The
  // button only renders when onOpenInvite is provided (so admins
  // who mount VendorModal without that prop don't see the button
  // by accident).
  it('renders an invite-vendor button when onOpenInvite is provided', () => {
    expect(source).toContain('onOpenInvite');
    expect(source).toContain('data-testid="browse-only-invite"');
    expect(source).toContain('✉️ 邀請商戶上線');
    // Button must call onOpenInvite with the vendor — not navigate
    // away, not copy a link, not open wa.me. The actual minting
    // happens inside VendorInviteLinkModal which talks to
    // activateSeededVendor (couple-widened via functions/src/vendorActivation.ts).
    expect(source).toMatch(/onClick=\{?\(\)\s*=>\s*onOpenInvite\(vendor\)/);
  });
});