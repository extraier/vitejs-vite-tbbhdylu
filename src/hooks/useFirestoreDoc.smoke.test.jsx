// Static regression guard for useFirestoreDoc — same shape as the
// collection hook's guard.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);

describe('useFirestoreDoc', () => {
  it('guards snapshot callback against post-unmount execution', () => {
    const src = readFileSync(
      here.replace(/\.smoke\.test\.jsx$/, '.js'),
      'utf8',
    );
    expect(src).toMatch(/let\s+cancelled\s*=\s*false/);
    expect(src).toMatch(/cancelled\s*=\s*true/);
    // Guard appears before setData in the same block (allowing
    // whitespace + eslint-disable-next-line comments between).
    const setDataGuard = src.match(/if\s*\(\s*cancelled\s*\)\s*return;[\s\S]{0,200}?setData\(/);
    expect(setDataGuard, 'setData must be guarded by `if (cancelled) return;`').toBeTruthy();
    // Guard appears before setError in the same block
    const setErrorGuard = src.match(/if\s*\(\s*cancelled\s*\)\s*return;[\s\S]{0,200}?setError\(/);
    expect(setErrorGuard, 'setError must be guarded by `if (cancelled) return;`').toBeTruthy();
  });
});
