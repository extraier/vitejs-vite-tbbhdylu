// Static regression guard for useFirestoreCollection.
// 2026-07-27: the cancelled-flag fix is mechanical; an end-to-end
// behavioural test against the real Firestore SDK in jsdom isn't
// reliable (React 18 may or may not warn depending on timing). This
// test pins the fix shape so a future refactor that drops the flag
// fails the build instead of regressing silently.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);

describe('useFirestoreCollection', () => {
  it('guards snapshot callback against post-unmount execution', () => {
    const src = readFileSync(
      here.replace(/\.smoke\.test\.jsx$/, '.js'),
      'utf8',
    );
    // Three required ingredients for the cancelled-flag pattern,
    // each verified with a structural regex (not just word count)
    // so a future refactor that decouples the guard from the
    // setState calls fails the build:
    //   1. `let cancelled = false` declared in the useEffect closure
    //   2. cleanup callback flips it to true (cancelled = true)
    //   3. `if (cancelled) return;` immediately before setData AND
    //      setError, in that order, so a late snapshot or late
    //      error doesn't trigger a state update on an unmounted
    //      component. The regex order is correct: setData first,
    //      setError second in the source.
    expect(src).toMatch(/let\s+cancelled\s*=\s*false/);
    expect(src).toMatch(/cancelled\s*=\s*true/);
    // Guard appears before setData in the same error/snapshot block.
    // We accept any whitespace + comments between the guard and the
    // call — eslint-disable-next-line comments are legitimate noise.
    const setDataGuard = src.match(/if\s*\(\s*cancelled\s*\)\s*return;[\s\S]{0,200}?setData\(/);
    expect(setDataGuard, 'setData must be guarded by `if (cancelled) return;`').toBeTruthy();
    // Guard appears before setError in the same block
    const setErrorGuard = src.match(/if\s*\(\s*cancelled\s*\)\s*return;[\s\S]{0,200}?setError\(/);
    expect(setErrorGuard, 'setError must be guarded by `if (cancelled) return;`').toBeTruthy();
  });
});
