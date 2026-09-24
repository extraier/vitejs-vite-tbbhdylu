// Static regression guard for useMergedVendors.
//
// Covers the contract the App.jsx call site depends on:
//
//   1. Hook wires up useFirestoreCollection(collection(db, 'vendors'))
//      — not a manual onSnapshot.
//   2. Hook normalizes each live doc through normalizeLiveVendor
//      before merging (so rejected/suspended vendors get filtered).
//   3. Hook merges with DEFAULT_VENDORS via mergeVendors — NOT
//      a custom inline merge that would diverge from the pure
//      helper over time.
//   4. Return shape: { vendors, loading, error } — exactly the
//      fields the App.jsx destructures. Renaming any of these
//      would break the consumer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);

describe('useMergedVendors', () => {
  const src = readFileSync(
    here.replace(/\.smoke\.test\.jsx$/, '.js'),
    'utf8',
  );

  it('subscribes to /vendors via useFirestoreCollection', () => {
    // Avoid the bare `collection(` substring matching the test
    // doc itself; require the function-call form AND the
    // db-sourced collection ref AND a destructured { data, ... }
    // pattern so a future hand-rolled onSnapshot fails the build.
    expect(src).toMatch(
      /useFirestoreCollection\(\s*collection\(\s*db,\s*['"]vendors['"]\s*\)\s*,\s*\)/,
    );
  });

  it('destructures { data, loading, error } from useFirestoreCollection', () => {
    // The hook must surface loading + error so App.jsx can show
    // a spinner during the initial fetch and log subscription
    // failures. A refactor that drops `error` would silence
    // auth failures (which would only surface as silent empty
    // catalog).
    expect(src).toMatch(
      /const\s*\{\s*data:\s*liveDocs\s*,\s*loading\s*,\s*error\s*\}\s*=\s*useFirestoreCollection/,
    );
  });

  it('normalizes each live doc via normalizeLiveVendor', () => {
    // .map + .filter(Boolean) ensures null returns from
    // normalizeLiveVendor (rejected/suspended vendors) are
    // dropped before the merge.
    expect(src).toMatch(/normalizeLiveVendor/);
    expect(src).toMatch(/\.filter\(Boolean\)/);
  });

  it('merges with DEFAULT_VENDORS via mergeVendors helper', () => {
    // Must use the pure helper, not an inline spread or custom
    // dedup — otherwise the pure tests in vendorPure.test.ts
    // don't actually cover the App.jsx code path.
    expect(src).toMatch(/mergeVendors\s*\(\s*live\s*,\s*DEFAULT_VENDORS\s*\)/);
  });

  it('returns { vendors, loading, error }', () => {
    // Pinned return shape — App.jsx destructures exactly these
    // three. Adding new fields is fine; renaming or removing
    // would break the call site.
    expect(src).toMatch(
      /return\s*\{\s*vendors\s*,\s*loading\s*,\s*error\s*\}\s*;?/,
    );
  });

  it('memoizes the merged list on liveDocs identity', () => {
    // useMemo prevents recomputing the merge on every render
    // when nothing relevant changed. Without useMemo, every
    // re-render of App would re-allocate the merged array,
    // defeating downstream React.memo on vendor-list children.
    expect(src).toMatch(/useMemo\s*\(\s*\(\s*\)\s*=>\s*\{/);
    expect(src).toMatch(/\},\s*\[liveDocs\]\)/);
  });

  it('imports from the correct relative paths', () => {
    // Pin import paths so a future move keeps the wiring
    // honest. firebase, useFirestoreCollection, vendorPure,
    // and config must all be imported.
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/firebase['"]/);
    expect(src).toMatch(/from\s+['"]\.\/useFirestoreCollection['"]/);
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/vendorPure['"]/);
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/config['"]/);
  });
});
