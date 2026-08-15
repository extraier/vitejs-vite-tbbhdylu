// Security regression guards for vendor claim-link issuance.
// Couples can submit a pending vendor request, but a raw claim link can
// transfer ownership of a seeded profile and must remain administrator-only.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), 'functions/src/vendorActivation.ts');

function handlerSource(source, exportName) {
  const match = source.match(
    new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*onCall\\([\\s\\S]*?async\\s*\\(req\\)[\\s\\S]*?\\n\\s*\\}\\s*,?\\s*\\)\\s*;`),
  );
  expect(match, `${exportName} handler should be parseable`).toBeTruthy();
  return match ? match[0] : '';
}

describe('vendorActivation.ts permission model', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('keeps raw activation links administrator-only', () => {
    const body = handlerSource(source, 'activateSeededVendor');
    expect(body).toContain("if (!isAdmin(req))");
    expect(body).toContain("throw new HttpsError('permission-denied', 'Admin only.')");
    expect(body).not.toMatch(/isAdmin\s*\(\s*req\s*\)\s*\|\|/);
  });

  it('keeps raw invitation emails administrator-only', () => {
    const body = handlerSource(source, 'sendVendorInviteEmail');
    expect(body).toContain("if (!isAdmin(req))");
    expect(body).toContain("throw new HttpsError('permission-denied', 'Admin only.')");
    expect(body).not.toMatch(/isAdmin\s*\(\s*req\s*\)\s*\|\|/);
  });

  it('does not retain the old global couple authorization helper', () => {
    expect(source).not.toMatch(/async\s+function\s+isCouple\s*\(/);
  });

  it('keeps bulk activation administrator-only', () => {
    const body = handlerSource(source, 'bulkActivateSeededVendors');
    expect(body).toContain("throw new HttpsError('permission-denied', 'Admin only.')");
  });
});
