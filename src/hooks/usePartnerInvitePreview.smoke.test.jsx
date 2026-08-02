import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  process.cwd(),
  'src/hooks/usePartnerInvitePreview.js',
);

describe('usePartnerInvitePreview token handoff', () => {
  // 2026-08-02 (round 3) — replaces the old "mirrors the
  // resolved raw token so URL and localStorage resumes can
  // redeem" test. The old test asserted the hook wrote the
  // raw token to sessionStorage at effect-start as a hand-off
  // for App.jsx's redeem effect. That hand-off was the round-3
  // race condition we eliminated (the write happened BEFORE
  // preview validation, so App.jsx could fire a redeem on a
  // dead token).
  //
  // The new design: the hook exposes validatedToken via React
  // state, set ONLY on preview success. App.jsx reads it from
  // the return value (no storage hand-off at all). This test
  // guards the new contract.
  it('exposes validatedToken via state (no more sessionStorage hand-off)', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Hook declares the validatedToken state.
    expect(source).toMatch(/const \[validatedToken/);
    // Hook stashes the localStorage resume key (this still
    // happens — it's how the hook finds the token across
    // tab reopens).
    expect(source).toContain('stashToken(token)');
    // Hook does NOT stash the raw token to sessionStorage.
    expect(source).not.toContain(
      "sessionStorage.setItem('pendingPartnerToken', token)",
    );

    // sanity: stashToken (localStorage) appears BEFORE the
    // preview call (it must, so a future mount can resume).
    const stashAt = source.indexOf('stashToken(token)');
    const previewAt = source.indexOf("callFirebaseFn('previewPartnerInvite'");
    expect(stashAt).toBeGreaterThan(-1);
    expect(stashAt).toBeLessThan(previewAt);
  });

  // 2026-08-02 (bad-signature follow-up) — guarantee the dead-token
  // cleanup path stays in place. Without this, a stale localStorage
  // token replays previewPartnerInvite → 403 on every page load.
  // Console noise forever.
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

  // 2026-08-02 (round 3) — the hook now exposes a validatedToken
  // state that App.jsx's redeem effect depends on. It is set ONLY
  // on preview success. Without this gate, App.jsx's parallel
  // redeem effect could fire BEFORE the preview validated the
  // token, producing a parallel 403 Bad signature on every dead
  // token. validatedToken serialises the flow: preview first,
  // redeem second. Dead tokens never make it past the gate.
  it('exposes validatedToken that is null on preview failure and set on success', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Hook declares the state
    expect(source).toContain('useState(null)');
    expect(source).toMatch(/const \[validatedToken/);

    // Hook returns it
    expect(source).toMatch(/return\s*\{[^}]*validatedToken[^}]*\}/);

    // validatedToken is set ONLY on the preview-success branch
    // (after the data validation), NOT on dead-token errors or
    // transient errors. Count the SETTER CALLS — the actual
    // setValidatedToken(value) invocations, NOT the destructure
    // in useState (which writes `setValidatedToken = useState(...)`
    // without a `(`. The regex `setValidatedToken\s*\(` matches
    // only the SET calls, not the destructure.
    const setterCalls = (source.match(/\bsetValidatedToken\s*\(/g) || [])
      .length;
    // Exactly 1 SET call — the success branch.
    expect(setterCalls).toBe(1);

    // The set call must live inside the success branch (after
    // partnerEmail is set, before the catch). Use a positional
    // check: setValidatedToken must appear AFTER `setInvite(` AND
    // BEFORE the catch block.
    const setInviteAt = source.indexOf('setInvite({');
    const setValidatedAt = source.indexOf('setValidatedToken(token);');
    const catchAt = source.indexOf('} catch (err) {');
    expect(setInviteAt).toBeGreaterThan(-1);
    expect(setValidatedAt).toBeGreaterThan(setInviteAt);
    expect(setValidatedAt).toBeLessThan(catchAt);
  });

  // 2026-08-02 (round 3) — the sessionStorage hand-off is gone.
  // Previously the hook wrote the RAW token to sessionStorage at
  // effect-start so App.jsx's redeem effect could find it after
  // auth. That write-before-validation was the race condition that
  // caused dead-token 403s. The hook must NOT write to
  // sessionStorage anywhere.
  it('does not write to sessionStorage (round-3 race condition is gone)', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).not.toMatch(/sessionStorage\.setItem/);
  });
});