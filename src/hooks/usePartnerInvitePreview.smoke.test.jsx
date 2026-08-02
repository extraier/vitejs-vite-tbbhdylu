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

  // 2026-08-02 (round 2) — clear sessionStorage too. The hook
  // stashes the token to sessionStorage at effect-start so App.jsx's
  // auto-redeem effect can find it after auth. Without clearing
  // sessionStorage on dead-token errors, App.jsx still finds the
  // stale token and fires redeemPartnerInviteV2 → another 403 Bad
  // signature in the console. localStorage alone is half the fix.
  it('clears the sessionStorage handoff key when the preview fails with a dead-token error', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).toContain(
      "sessionStorage.removeItem('pendingPartnerToken')",
    );
    // The sessionStorage clear must live INSIDE the isDeadToken
    // branch (not at top-level), so transient errors keep the
    // handoff intact for App.jsx's redeem path to retry.
    const isDeadTokenBranch = source.indexOf('if (isDeadToken)');
    const sessionClear = source.indexOf(
      "sessionStorage.removeItem('pendingPartnerToken')",
    );
    const branchEnd = source.indexOf('}', isDeadTokenBranch);
    expect(isDeadTokenBranch).toBeGreaterThan(-1);
    expect(sessionClear).toBeGreaterThan(isDeadTokenBranch);
    expect(sessionClear).toBeLessThan(branchEnd);
  });
});