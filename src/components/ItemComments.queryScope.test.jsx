import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/ItemComments.jsx'),
  'utf8',
);

describe('ItemComments vendor subscription scope', () => {
  it('uses an equality query on the assigned vendor ID', () => {
    expect(source).toContain("currentRole === 'vendor'");
    expect(source).toContain("where('parentAssignedVendorUid', '==', currentUser.uid)");
  });

  it('resubscribes when the role or authenticated user changes', () => {
    expect(source).toContain('currentRole,');
    expect(source).toContain('currentUser?.uid,');
  });
});
