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
