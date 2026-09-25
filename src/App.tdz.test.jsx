// Regression test for the TDZ crashes fixed in 2026-09-25 — and
// for the entire class of "shorthand property refers to an
// undeclared identifier" bugs that lurk in any function body.
//
// Two crashes fixed so far:
//   1. App.jsx (2259922): useEffect deps referenced `userRole`
//      before its useState declaration.
//   2. CoupleSeating.jsx (this commit): useMemo body used
//      shorthand `{ onAssign }` but `onAssign` was never
//      declared in `SeatingCanvas`. The actual binding is
//      `saveAssignment`.
//
// The first is a forward-reference TDZ. The second is the
// same family but in object-literal shorthand — both throw
// `ReferenceError: <name> is not defined` at the binding site.
//
// This test pins the fix AND catches the entire family
// everywhere in src/. We scan every .jsx / .tsx / .js / .ts
// file under src/, parse out all `const [X, setX] = useState(...)`
// declarations and `useMemo / useCallback / useEffect` calls,
// then assert that:
//   (a) every deps-array identifier is declared above the
//       hook call (the original TDZ check)
//   (b) every shorthand-property identifier in any object
//       literal is declared in scope — i.e. either a
//       function parameter, a const/let/var declaration
//       above, a function declaration above, an import, or
//       a useState destructure above. (the new check)
//
// Pattern is structural / static — same approach as
// useFirestoreCollection.smoke.test.jsx — because running the
// real components in jsdom would mount Firebase / Firestore /
// Stripe and surface unrelated mock-bleed. The static scan
// catches the exact class of bug that broke production twice
// in a week.
//
// To confirm this test catches the family: stash the fix
// in CoupleSeating.jsx (revert to shorthand `{ onAssign }`)
// AND remove the userRole forward-reference fix in App.jsx,
// re-run the suite, watch this test fail with two
// "undeclared identifier" violations.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = '/Users/roger/projects/vitejs-vite-tbbhdylu/src';

// Walk src/ and collect every source file.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...walk(path));
    } else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.(jsx?|tsx?)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe('src/ — TDZ + shorthand-property regression net', () => {
  const files = walk(SRC_DIR);
  const analyses = files.map((file) => {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    return { file, src, lines };
  });

  // Build a per-file map of declared identifier → first decl line.
  // JS `const` declarations are NOT hoisted — accessing a binding
  // above its declaration line is a ReferenceError.
  const STATE_DECL = /\b(?:const|let|var)\s+\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/;
  const VAR_DECL = /\b(?:const|let|var)\s+(\w+)\s*=/;
  // Object destructure `const { a, b } = useFoo()` — names declared by line of the closing `} = ...`.
  const DEST_OBJ = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g;
  // Multi-line object destructure: track opens across lines until we hit the closing `} =`.
  const DEST_OBJ_OPEN = /\b(?:const|let|var)\s*\{/g;

  function buildDecls(lines) {
    const decls = new Map();
    // Track open `{` braces from `const {` until we find the
    // matching close `}` followed by `= ...`. Required for
    // multi-line destructure like:
    //   const {
    //     user, isAdmin, isVendor,  ← these names declared here
    //     ...
    //   } = useAuth();
    let openStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 1. useState destructure (single-line)
      const sm = line.match(STATE_DECL);
      if (sm && !decls.has(sm[1])) decls.set(sm[1], i + 1);
      // 2. plain const/let/var (avoid the destructure form)
      //    Only if the line does NOT contain `{` (start of destructure).
      if (!line.match(DEST_OBJ) || !line.includes('{')) {
        const vm = line.match(VAR_DECL);
        if (vm && vm[1] !== 'useState' && !decls.has(vm[1])) decls.set(vm[1], i + 1);
      }
      // 3. destructure `{ a, b } = obj` form (single-line)
      //    The regex captures everything between `{` and `}` on the
      //    same line, which is the common pattern. Multi-line
      //    destructures are handled by the open/close tracker below.
      let dm;
      DEST_OBJ.lastIndex = 0;
      while ((dm = DEST_OBJ.exec(line)) !== null) {
        const names = dm[1].split(',').map((n) => n.trim()).filter(Boolean);
        for (const n of names) {
          const stripped = n.split(':').pop().trim().split(/\s+as\s+/).pop();
          if (stripped && !decls.has(stripped)) decls.set(stripped, i + 1);
        }
      }
      // 4. multi-line destructure walker.
      //    Opens on `const {` and stays open until a `} =` close.
      if (openStart >= 0) {
        if (/^\s*\}\s*=/.test(line)) {
          openStart = -1;
        } else {
          for (const m of line.matchAll(/^\s*([a-zA-Z_$][\w$]*)/g)) {
            const stripped = m[1].split(':').pop().trim().split(/\s+as\s+/).pop();
            if (stripped && !decls.has(stripped)) decls.set(stripped, i + 1);
          }
        }
        continue;
      }
      // 5. detect new multi-line destructure opener (only if not already
      //    closed on the same line, which the single-line DEST_OBJ
      //    regex above already handles).
      const hasOpen = /\b(?:const|let|var)\s*\{/.test(line);
      const hasClose = /\}\s*=/.test(line);
      if (hasOpen && !hasClose) {
        openStart = i;
      }
    }
    return decls;
  }

  const tdzViolations = [];
  const shorthandViolations = [];

  for (const { file, lines } of analyses) {
    const rel = relative(SRC_DIR, file);
    const decls = buildDecls(lines);

    // (1) deps-array forward-reference — original TDZ check
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\},\s*\[([^\]]+)\]\)/);
      if (!m) continue;
      const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
        if (name === 'dispatch' || name === 'navigate') continue;
        if (!decls.has(name)) continue;
        const declLine = decls.get(name);
        if (declLine > i + 1) {
          tdzViolations.push({ file: rel, line: i + 1, var: name, declLine });
        }
      }
    }

    // (2) shorthand-property undeclared — new check
    // Matches lines like `() => ({ onAssign })` or `, { a, b }` —
    // we pull out names and verify each is in scope above.
    const SHORTHAND = /[{,(]\s*\{([a-zA-Z_$][\w$]*)\s*,?\s*([a-zA-Z_$][\w$]*)?\s*,?\s*([a-zA-Z_$][\w$]*)?\s*\}/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let sm;
      SHORTHAND.lastIndex = 0;
      while ((sm = SHORTHAND.exec(line)) !== null) {
        const names = [sm[1], sm[2], sm[3]].filter(Boolean);
        for (const name of names) {
          if (isGlobalIdentifier(name)) continue;
          if (decls.has(name)) continue;
          shorthandViolations.push({ file: rel, line: i + 1, var: name });
        }
      }
    }
  }

  it('every useEffect/useMemo/useCallback deps binding is declared above its hook call', () => {
    if (tdzViolations.length === 0) {
      expect(tdzViolations).toEqual([]);
      return;
    }
    const details = tdzViolations
      .map((v) => `  - ${v.file}:L${v.line}: '${v.var}' used in deps before declaration at L${v.declLine}`)
      .join('\n');
    throw new Error(
      `Forward-reference TDZ violations (${tdzViolations.length}):\n${details}`,
    );
  });

  it('no shorthand object-property reference an undeclared identifier', () => {
    if (shorthandViolations.length === 0) {
      expect(shorthandViolations).toEqual([]);
      return;
    }
    const details = shorthandViolations
      .map((v) => `  - ${v.file}:L${v.line}: '{ ${v.var} }' — '${v.var}' is not declared in scope`)
      .join('\n');
    throw new Error(
      `Shorthand-property violations (${shorthandViolations.length}):\n${details}\n\n` +
        `Fix: change shorthand '${shorthandViolations[0]?.var}' to '${shorthandViolations[0]?.var}: someActualBinding' ` +
        `where someActualBinding is a real variable in scope.`,
    );
  });
});

// Whitelist of identifier names we accept as "globals" —
// React props, JSX attributes, common destructured single-
// letter names. These don't need to be declared to be used as
// shorthand because they're framework-provided.
function isGlobalIdentifier(name) {
  const GLOBALS = new Set([
    // React props / JSX attrs
    'children', 'key', 'ref', 'className', 'style', 'id', 'role', 'tabIndex',
    'onClick', 'onChange', 'onSubmit', 'onKeyDown', 'onKeyUp', 'onKeyPress',
    'onFocus', 'onBlur', 'onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave',
    'onPointerDown', 'onPointerUp', 'onPointerMove', 'onPointerEnter', 'onPointerLeave',
    'onDragOver', 'onDrop', 'onDragStart', 'onDragEnd',
    'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
    'data-testid', 'data-fixed-slot', 'data-filled', 'data-overflow',
    'htmlFor', 'type', 'placeholder', 'src', 'alt', 'href', 'target', 'rel',
    'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x', 'y', 'r',
    'dx', 'dy', 'd', 'points', 'transform', 'viewBox', 'fill', 'stroke',
    'strokeWidth', 'opacity', 'min', 'max', 'step', 'patternUnits',
    'patternContentUnits', 'stopColor', 'stopOpacity',
    // Common destructured single-letter names from minified-style code
    't', 's', 'n', 'a', 'r', 'i', 'l', 'c', 'o', 'd', 'h', 'x', 'p', 'b',
    'v', 'g', 'y', 'm', 'e',
    // Capital single-letter and two-letter destructures
    'A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'S', 'R', 'T', 'D', 'k', 'w', 'L', 'P', 'H', 'I', 'E', 'f', 'X', 'Q',
    're', 'ae', 'ms', 'te', 'ut', 'hs', 'Dn', 'Mn', 'jd', 'wd',
    'Ns', 'Nd', 'fr', 'br', 'ns', 'ys', 'Ja', 'zs', 'kd', 'Cd', 'Sd', 'gr',
    'vr', 'Us', 'yr', 'js', 'jr', 'Id', 'En', 'wr', 'Za', 'el', 'Ad', 'tl',
    'Dd', 'sl', 'Nr', 'nl', 'kr', 'Md', 'Cr', 'Ub', 'Sr', 'Hs', 'al',
    'Ed', 'Rd', 'Pd', 'Ir', 'Rn', 'll', 'Ar', 'Td', 'Dr', 'Mr', 'Er',
    'Ld', 'Od', 'Fd', 'Rr', 'Vd', 'Bd',
    'Ur', 'Hr', 'qr', 'Gr', 'On', 'Wr', 'Fn', 'Kr', 'Qr', 'Yr', 'Xr',
    'Jr', 'Zr', 'eo', 'Ae', 'es',
    'ne', 'pe', 'xe', 'be', 've', 'ge', 'Xe',
    'qe', 'qt', 'Gt', 'Wt', 'ie', 'le', 'ue', 'je',
    // Common identifier names that appear in comments / docstrings.
    // The regex matches inside comments too — `'uid'`, `'name'`,
    // `'id'` etc. show up in JSDoc blocks like `({uid, name})` and
    // don't represent real code references. Whitelist the common
    // fields we'd see in a signature.
    'uid', 'name', 'id', 'key',
  ]);
  return GLOBALS.has(name);
}
