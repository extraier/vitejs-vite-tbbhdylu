// 2026-08-02 (Option-B couple-invite) — guards on
// VendorInviteLinkModal's new optional `title` prop.
//
// Why a structural smoke test:
// The modal is rendered from two callers — AdminVendors (admin)
// and App.jsx's couple-side flow (new). The title prop lets each
// caller customize the heading without forking the component.
//
//   Admin path:  no `title` prop → "邀請 {vendor.name}"
//   Couple path: title="邀請 {vendor.name} 上線"
//
// Without a guard, a future refactor could silently drop the
// override and couples would see "邀請 {vendor.name}" (matches
// admin) which makes the onboarding-nudge intent unclear.
//
// What we check:
//   1. The component accepts the prop.
//   2. Default behavior produces "邀請 {vendor.name || vendorUid}".
//   3. Caller-provided `title` wins over the default.
//   4. The rendered <h3> uses the resolved title (not a stale
//      hardcoded string).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  process.cwd(),
  'src/components/modals/VendorInviteLinkModal.jsx',
);

describe('VendorInviteLinkModal title prop', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('accepts an optional title prop in the signature', () => {
    expect(source).toMatch(/function\s+VendorInviteLinkModal\s*\(\s*\{[^}]*title[^}]*\}/);
  });

  it('falls back to "邀請 {name}" when title is not provided', () => {
    expect(source).toContain("title ?? `邀請 ${");
    // The default expression must use the same fallback chain as
    // before: vendor.name || vendor.vendorUid. Otherwise admins
    // see "邀請 undefined" when a row has no name field.
    expect(source).toMatch(/vendor\.name\s*\|\|\s*vendor\.vendorUid/);
  });

  it('renders the resolved title (not a hardcoded "邀請 {vendor.name}")', () => {
    // The h3 must read from modalTitle, not the old literal. Catches
    // a refactor that adds the prop but forgets to wire it through.
    expect(source).toContain('{modalTitle}');
    expect(source).not.toContain('邀請 {vendor.name || vendor.vendorUid}');
  });
});