// Regression guard for the production blank-screen incident (2026-08-03).
//
// App() must not evaluate the upload-preferences hook with
// `dataOwnerUid` before that const is initialized. Vite/esbuild accepts
// the source, but the browser throws a minified TDZ ReferenceError at
// runtime, which the ErrorBoundary displays as the generic error page.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'),
  'utf8',
);

describe('App upload-preferences initialization order', () => {
  it('uses an owner uid that is initialized before the token hook call', () => {
    const currentEventDeclaration = appSource.indexOf('const [currentEvent, setCurrentEvent]');
    const ownerDeclaration = appSource.indexOf('const dataOwnerUid =');
    const tokenHookCall = appSource.indexOf('useUploadPreferencesToken({');
    const tokenBlockEnd = appSource.indexOf('\n  });', tokenHookCall);
    const tokenBlock = appSource.slice(tokenHookCall, tokenBlockEnd);

    expect(currentEventDeclaration).toBeGreaterThanOrEqual(0);
    expect(ownerDeclaration).toBeGreaterThan(currentEventDeclaration);
    expect(ownerDeclaration).toBeLessThan(tokenHookCall);
    expect(tokenBlock).toContain('ownerUid: dataOwnerUid');
  });
});

// 2026-08-09 — Second TDZ regression guard. Vendors-for-picker hook
// was previously declared next to `dataOwnerUid` (line ~942) but its
// deps array referenced `inquiries` which is declared ~290 lines
// later. The deps array evaluates at hook-call time, BEFORE any
// subsequent useState in the same component runs, so the browser
// threw `Cannot access 'Ye' before initialization` and the whole
// app crashed with the generic error page.
//
// 2026-08-15 — Updated for the resolver refactor. The hook is now
// `vendorsForPicker = useMemo(... resolveEligibleAssignedVendors(vendorContacts, inquiries) ..., [vendorContacts, inquiries])`.
// The deps array still reads `inquiries`; the TDZ invariant
// (hook AFTER inquiries declaration) is the same. The test now
// matches `inquiries` as a dep-member instead of the literal
// `[inquiries]` substring (deps array may have other members first).
describe('App vendorsForPicker initialization order', () => {
  it('reads `inquiries` in a deps array AFTER the inquiries useState declaration', () => {
    const inquiriesDeclaration = appSource.indexOf('const [inquiries, setInquiries]');
    const vendorsPickerHook = appSource.indexOf('const vendorsForPicker = useMemo');
    // Match the deps array start — `}, [` followed by other
    // optional members then `inquiries`. Covers `[inquiries]`
    // (where the hook body might end with `]`) and
    // `[vendorContacts, inquiries]` (ends with `}`). Both
    // shapes must end up matching.
    const depsRegex = /[\]\}]\s*,\s*\[[^\]]*\binquiries\b/;
    const vendorsPickerDeps = appSource.slice(vendorsPickerHook).search(depsRegex);

    expect(inquiriesDeclaration).toBeGreaterThanOrEqual(0);
    expect(vendorsPickerHook).toBeGreaterThanOrEqual(0);
    expect(vendorsPickerDeps).toBeGreaterThanOrEqual(0);
    // The smoking-gun guard: if `vendorsForPicker` ever ends up
    // BEFORE the inquiries useState again, the deps array is
    // evaluated against an uninitialized binding. Catch it here
    // before it ships to production.
    expect(vendorsPickerHook).toBeGreaterThan(inquiriesDeclaration);
  });
});
