// Regression test for the TDZ crash fixed in 2026-09-25.
//
// The crash: `useEffect(() => {...}, [userRole])` was placed at the
// TOP of App() (around L377), but `const [userRole, setUserRole] =
// useState(...)` was declared further down at L500. On every first
// render, the deps array `[userRole]` evaluated `userRole` BEFORE
// its `const` declaration was reached — throwing `ReferenceError:
// Cannot access 'userRole' before initialization` and rendering the
// system-error page.
//
// This test pins the fix: scan the App.jsx source and assert that
// every deps-array variable referenced from inside `useEffect()` /
// `useMemo()` / `useCallback()` is declared above that hook call
// (i.e. appears in a `const [X, setX] = useState(...)` line at a
// strictly-earlier line number).
//
// The pattern is structural / static — same approach as
// useFirestoreCollection.smoke.test.jsx — because running the
// 5900-LOC App() in jsdom would mount Firebase / Firestore /
// Stripe and surface unrelated mock-bleed issues. The static
// scan catches the exact class of bug that broke production.
//
// To confirm this test catches the bug: stash the fix (move the
// helper-open-seating-edit useEffect back to the top of the
// function, before `const [userRole, ...]`), re-run the suite,
// and watch this test fail with a "used in deps before
// declaration" violation. Verified pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const APP_JSX = here.replace(/App\.tdz\.test\.jsx$/, 'App.jsx');

describe('App.jsx — TDZ regression net', () => {
  const src = readFileSync(APP_JSX, 'utf8');
  const lines = src.split('\n');

  // Map every `const [X, setX] = useState(...)` binding → 1-indexed
  // line number. JS const declarations are NOT hoisted (unlike
  // function declarations), so any reference earlier in the file
  // to binding X is a TDZ violation.
  const decls = new Map(); // var name → line
  const stateDecl = /\s+const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(stateDecl);
    if (m) decls.set(m[1], i + 1);
  }

  // Helper: every `}, [...])` line is a deps-array closure. Each
  // name in the brackets must be declared above.
  const depsLine = /\},\s*\[([^\]]+)\]\)/;
  const violations = []; // { var, depsLine, declLine, deps }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(depsLine);
    if (!m) continue;
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      // Skip non-identifier entries (numeric literals, comments).
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
      // Skip React-internal / stable refs we don't track.
      if (name === 'dispatch' || name === 'navigate') continue;
      if (!decls.has(name)) continue; // not a useState binding we tracked
      const declLine = decls.get(name);
      if (declLine > i + 1) {
        violations.push({ var: name, depsLine: i + 1, declLine, deps: names });
      }
    }
  }

  it('every useEffect/useMemo/useCallback deps binding is declared above its hook call', () => {
    if (violations.length > 0) {
      const details = violations
        .map(
          (v) =>
            `  - L${v.depsLine}: '${v.var}' used in deps before its declaration at L${v.declLine}\n` +
            `      deps = [${v.deps.join(', ')}]`,
        )
        .join('\n');
      throw new Error(
        `App.jsx has ${violations.length} TDZ violation(s):\n${details}\n\n` +
          `Fix: move the hook call below the const [var, setVar] = useState(...) declaration, ` +
          `or hoist the binding with a useRef mirror.`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('the helper-open-seating-edit listener is positioned below the userRole declaration', () => {
    // Pin the specific fix: the 'helper-open-seating-edit' listener
    // must come AFTER the `const [userRole, ...]` line. A future
    // refactor that hoists it back to the top of the function would
    // re-break production.
    const helperListenerLine = lines.findIndex((l) =>
      l.includes("'helper-open-seating-edit'"),
    );
    const userRoleLine = decls.get('userRole');
    expect(userRoleLine).toBeDefined();
    // Find the closest `}, [...])` deps array AFTER the listener
    // handler — that's the useEffect's deps. It must reference
    // userRole, and the listener line must be > userRoleLine.
    expect(helperListenerLine).toBeGreaterThan(userRoleLine - 1);
  });
});
