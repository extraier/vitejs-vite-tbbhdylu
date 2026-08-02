// 2026-08-02 (Option-B couple-invite) — guards on
// functions/src/vendorActivation.ts permission widening.
//
// Why a structural smoke test (not a real-mount test):
// activateSeededVendor and sendVendorInviteEmail used to be hard
// admin-gated (`if (!isAdmin(req)) throw ...`). This is a
// permission-model decision that is easy to accidentally tighten
// again during a future refactor. The smoke test enforces:
//
//   1. isCouple helper exists and reads from /events/ subcollection.
//   2. activateSeededVendor accepts couples (the rejection branch
//      no longer mentions "Admin only.").
//   3. sendVendorInviteEmail accepts couples.
//   4. bulkActivateSeededVendors STAYS admin-only (different
//      surface — admin bulk tool, not couple nudge). A refactor
//      that widens all three together would let couples bulk-invite
//      500 vendors, which is not the intent.
//
// File lives in src/ instead of functions/ because the top-level
// vitest config (vitest.config.ts) excludes functions/ — see
// exclude config. The test reads the source file as a string and
// pattern-matches, so no transpile of TS is required.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  process.cwd(),
  'functions/src/vendorActivation.ts',
);

describe('vendorActivation.ts permission model (couple-widened)', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('defines an isCouple helper that checks /events/ subcollection', () => {
    expect(source).toMatch(/async\s+function\s+isCouple\s*\(/);
    // Must check the events collection — that's how we detect a
    // wedding-couple account. A wrong collection path would let
    // vendors (who have /portfolio/ but no /events/) mint invites.
    expect(source).toContain(".collection('events')");
  });

  it('activateSeededVendor accepts couples (not admin-only)', () => {
    const fnMatch = source.match(
      /export\s+const\s+activateSeededVendor\s*=\s*onCall\([\s\S]*?async\s*\(req\)[\s\S]*?\n\s*\}\s*,?\s*\)\s*;/,
    );
    expect(fnMatch, 'activateSeededVendor handler should be parseable').toBeTruthy();
    const body = fnMatch ? fnMatch[0] : '';
    // Must allow couples via isAdmin || isCouple
    expect(body).toMatch(/isAdmin\s*\(\s*req\s*\)\s*\|\|\s*\(\s*await\s+isCouple/);
    // Must NOT throw the old admin-only rejection (would mean a
    // tightening regression).
    expect(body).not.toContain("throw new HttpsError('permission-denied', 'Admin only.')");
  });

  it('sendVendorInviteEmail accepts couples (not admin-only)', () => {
    const fnMatch = source.match(
      /export\s+const\s+sendVendorInviteEmail\s*=\s*onCall\([\s\S]*?async\s*\(req\)[\s\S]*?\n\s*\}\s*,?\s*\)\s*;/,
    );
    expect(fnMatch, 'sendVendorInviteEmail handler should be parseable').toBeTruthy();
    const body = fnMatch ? fnMatch[0] : '';
    expect(body).toMatch(/isAdmin\s*\(\s*req\s*\)\s*\|\|\s*\(\s*await\s+isCouple/);
    expect(body).not.toContain("throw new HttpsError('permission-denied', 'Admin only.')");
  });

  it('bulkActivateSeededVendors STAYS admin-only', () => {
    const fnMatch = source.match(
      /export\s+const\s+bulkActivateSeededVendors\s*=\s*onCall\([\s\S]*?async\s*\(req\)[\s\S]*?\n\s*\}\s*,?\s*\)\s*;/,
    );
    expect(fnMatch, 'bulkActivateSeededVendors handler should be parseable').toBeTruthy();
    const body = fnMatch ? fnMatch[0] : '';
    // Must still have the admin-only rejection — couples should
    // never be able to bulk-mint 500 invites.
    expect(body).toContain("throw new HttpsError('permission-denied', 'Admin only.')");
  });
});