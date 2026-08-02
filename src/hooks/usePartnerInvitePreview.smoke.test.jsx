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

  // 2026-08-02 (bad-signature follow-up) — guarantee the dead-token
  // cleanup path stays in place. Without this, a stale localStorage
  // token replays previewPartnerInvite → 403 on every page load,
  // AND re-stashes to sessionStorage which makes App.jsx's redeem
  // effect fire redeemPartnerInviteV2 → 403 too. Console noise forever.
  it('clears the localStorage stash when the preview fails with a dead-token error', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Error must be classified before deciding to clear.
    expect(source).toContain('isDeadToken');
    // Must classify Bad signature specifically (the error code seen
    // on production today via the Vercel proxy).
    expect(source).toContain("'Bad signature'");
    // Must call clearStash() in the dead-token branch.
    expect(source).toContain('if (isDeadToken)');
    expect(source).toContain('clearStash();');

    // Sanity: ordering — isDeadToken classification appears before
    // the clearStash call (otherwise the test is meaningless).
    const classifyAt = source.indexOf('isDeadToken');
    const clearAt = source.indexOf('clearStash();');
    expect(classifyAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(classifyAt);
  });
});