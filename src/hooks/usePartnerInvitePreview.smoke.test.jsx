import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  process.cwd(),
  'src/hooks/usePartnerInvitePreview.js',
);

describe('usePartnerInvitePreview token handoff', () => {
  it('mirrors the resolved raw token so URL and localStorage resumes can redeem', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain("sessionStorage.setItem('pendingPartnerToken', token)");
    expect(source).toContain('stashToken(token)');
    expect(source).not.toContain("JSON.stringify({ token: urlToken");

    const mirrorAt = source.indexOf("sessionStorage.setItem('pendingPartnerToken', token)");
    const previewAt = source.indexOf("callFirebaseFn('previewPartnerInvite'");
    expect(mirrorAt).toBeGreaterThan(-1);
    expect(mirrorAt).toBeLessThan(previewAt);
  });
});