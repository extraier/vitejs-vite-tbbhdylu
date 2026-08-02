// 2026-08-02 (bad-signature follow-up) — structural smoke test
// for the partner-invite redeem success path. Without
// `localStorage.removeItem('__heropartnerinvite_token')` after a
// successful redeem, every subsequent page load replays the dead
// token via usePartnerInvitePreview → previewPartnerInvite 403,
// AND re-stashes to sessionStorage which makes App.jsx's redeem
// effect fire redeemPartnerInviteV2 → 403 too.
//
// Why a static-string smoke test instead of a real mount test:
// App.jsx is 3500+ lines with deep provider chains (auth, firestore,
// ErrorBoundary, router). Spinning up a real mount test just to
// verify one line of cleanup logic would cost ~10s of test time
// and pull in heavy mocks. The source-level check is sufficient
// because the line is right next to sessionStorage.removeItem (the
// one that was already there) and we're only guarding against
// someone deleting it during a refactor.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), 'src/App.jsx');

describe('App.jsx partner-invite redeem cleanup', () => {
  it('clears the localStorage __heropartnerinvite_token stash after a successful redeem', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Must clear the key that usePartnerInvitePreview reads on
    // every mount. The key string MUST match the hook's
    // STORAGE_KEY constant exactly (case + underscores).
    expect(source).toContain(
      "localStorage.removeItem('__heropartnerinvite_token')",
    );

    // Sanity: ordering — the localStorage clear must appear AFTER
    // the existing sessionStorage clear (the line that was already
    // there) and AFTER the redeemPartnerInviteApi call. Otherwise
    // a refactor could move it to a finally{} that runs even on
    // failure, which would clear a still-valid token.
    const redeemAt = source.indexOf('partnerInviteApi.redeem({ token })');
    const ssAt = source.indexOf(
      "sessionStorage.removeItem('pendingPartnerToken')",
    );
    const lsAt = source.indexOf(
      "localStorage.removeItem('__heropartnerinvite_token')",
    );
    expect(redeemAt).toBeGreaterThan(-1);
    expect(ssAt).toBeGreaterThan(redeemAt);
    expect(lsAt).toBeGreaterThan(ssAt);
  });
});