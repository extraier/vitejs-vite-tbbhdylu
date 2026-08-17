// Regression guard (2026-08-17) — vendor dashboard "Cannot load" TDZ
//
// The vendor dashboard route previously threw
//   ReferenceError: Cannot access 'Vi' before initialization
// because the `vendorContacts` useState lived ~300 lines after the
// `vendorsForPicker` useMemo that read it. The dependency `Vi` (the
// minified name for vendorContacts) was in the hooks evaluation order
// before its declaration, hitting the temporal dead zone.
//
// This guard scans App.jsx for every `useMemo(() => f(X, ...), [X, ...])`
// and `useCallback((...X) => ..., [X, ...])` and verifies that each
// dep identifier that is declared in App.jsx (props + imports + module
// helpers are exempt) is declared textually earlier than the hook call.
// Source-level check is acceptable because Vite/esbuild propagates
// declaration order faithfully into the bundle; the minified name can
// be anything.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'),
  'utf8',
);

// Strip block + line comments so their prose doesn't register as
// identifiers when we search. Preserves line numbers.
function cleanup(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (i + 1 < source.length && source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      out += source.slice(i, i + 2).replace(/[^\n]/g, ' ');
      out += '\n';
      out += source.slice(i + 2, end).replace(/[^\n]/g, ' ');
      i = end + 2;
    } else if (i + 1 < source.length && source[i] === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i + 2);
      if (nl < 0) break;
      out += source.slice(i, nl).replace(/[^\n]/g, ' ');
      i = nl;
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

const cleaned = cleanup(appSource);

// Walk forward, find every `const|let|var` and read its binding
// pattern. Handle destructuring across multiple lines. Record the
// earliest line for each identifier that becomes a binding target.
function findDeclarations(source) {
  const decls = new Map(); // name -> line number

  let i = 0;
  while (i < source.length) {
    // Skip whitespace
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;

    // Match keyword
    const kwMatch = /^(const|let|var)\b\s*/y.exec(source.slice(i));
    if (!kwMatch) {
      i++;
      continue;
    }
    const kwStart = i;
    i += kwMatch[0].length;

    // Binding pattern: skip ahead
    const starts = i;
    let patternEnd = i;

    // Helper: walk to balanced closing
    function skipBalanced(openAt) {
      const opener = source[openAt];
      const closer = opener === '[' ? ']' : opener === '{' ? '}' : opener === '(' ? ')' : null;
      if (!closer) return openAt + 1;
      let depth = 1;
      let k = openAt + 1;
      while (k < source.length && depth > 0) {
        const c = source[k];
        if (c === '"' || c === "'" || c === '`') {
          // skip template/regular string literal (no escapes for simplicity)
          k++;
          while (k < source.length && source[k] !== c) k++;
          k++;
        } else if (c === opener) {
          depth++;
          k++;
        } else if (c === closer) {
          depth--;
          k++;
        } else {
          k++;
        }
      }
      return k;
    }

    const c = source[i];
    if (c === '[' || c === '{' || c === '(') {
      patternEnd = skipBalanced(i);
    } else {
      // Plain identifier (possibly with default `=...` later)
      // We just want the binding name itself. Take it.
      const m = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
      if (m) {
        patternEnd = i + m[0].length;
      } else {
        i++;
        continue;
      }
    }

    // Skip whitespace + default value
    let p = patternEnd;
    while (p < source.length && /\s/.test(source[p])) p++;
    if (source[p] === '=') {
      // Skip past the initializer until end-of-statement (;) or end of
      // statement across lines, with paren/bracket balance.
      p++;
      let depth = 0;
      while (p < source.length) {
        const ch = source[p];
        if (ch === ';') {
          p++;
          break;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === '\n' && depth === 0) {
          // Likely a new statement — break here
          break;
        }
        p++;
      }
      i = p;
    } else {
      i = p;
    }

    // Now extract binding names from source[starts..patternEnd]
    const lhs = source.slice(starts, patternEnd);
    const lineNo = source.slice(0, kwStart).split('\n').length;

    if (lhs.startsWith('[') && lhs.endsWith(']')) {
      // Array destructuring
      for (let t of lhs.slice(1, -1).split(',')) {
        t = t.trim().split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(t)) {
          if (!decls.has(t) || decls.get(t) > lineNo) decls.set(t, lineNo);
        }
      }
    } else if (lhs.startsWith('{') && lhs.endsWith('}')) {
      // Object destructuring
      for (let t of lhs.slice(1, -1).split(',')) {
        t = t.trim();
        if (t.includes(':')) t = t.split(':').pop().trim();
        t = t.split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(t)) {
          if (!decls.has(t) || decls.get(t) > lineNo) decls.set(t, lineNo);
        }
      }
    } else if (/^[A-Za-z_$][\w$]*$/.test(lhs)) {
      if (!decls.has(lhs) || decls.get(lhs) > lineNo) decls.set(lhs, lineNo);
    }
  }
  return decls;
}

// Walk forward, find every `useMemo(...)` / `useCallback(...)`, extract
// the trailing deps array, and identify the optional binding name.
function findHookCalls(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const m = /^(useMemo|useCallback)\s*\(/y.exec(source.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const callName = m[1];
    const callStart = i;
    i += m[0].length;

    // Skip balanced parens
    let j = i;
    let depth = 1;
    while (j < source.length && depth > 0) {
      const c = source[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    const callEnd = j;

    // Last `[...]` inside the call
    let lastBracket = -1;
    for (let k = callStart; k < callEnd; k++) {
      if (source[k] === '[') lastBracket = k;
    }
    if (lastBracket < 0) {
      i = callEnd;
      continue;
    }
    let bd = 1;
    let bk = lastBracket + 1;
    while (bk < callEnd && bd > 0) {
      if (source[bk] === '[') bd++;
      else if (source[bk] === ']') bd--;
      bk++;
    }
    const depsStr = source.slice(lastBracket + 1, bk - 1);
    // Split on commas at top level; each dep item may be a member
    // expression like `currentEvent?.id` or `obj.field` — keep those
    // intact so we don't extract `field` as if it were a local.
    const depItems = [];
    let itemDepth = 0;
    let cur = '';
    for (let k = 0; k < depsStr.length; k++) {
      const c = depsStr[k];
      if (c === ',' && itemDepth === 0) {
        depItems.push(cur.trim());
        cur = '';
      } else {
        cur += c;
        if (c === '(' || c === '[' || c === '{') itemDepth++;
        else if (c === ')' || c === ']' || c === '}') itemDepth--;
      }
    }
    if (cur.trim()) depItems.push(cur.trim());

    // For each dep item, extract only the BASE identifier (the leftmost
    // identifier before `.`, `?.`, `[`, or `(`).
    const deps = [];
    for (const item of depItems) {
      const base = /^([A-Za-z_$][\w$]*)/.exec(item);
      if (base && !['true', 'false', 'null', 'undefined'].includes(base[1])) {
        deps.push(base[1]);
      }
    }

    // Look back for `const NAME = `
    let hookName = null;
    const before = source.slice(Math.max(0, callStart - 250), callStart);
    const assignMatch = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
    if (assignMatch) hookName = assignMatch[1];

    const lineNo = source.slice(0, callStart).split('\n').length;
    out.push({ callName, hookName, deps, lineNo });
    i = callEnd;
  }
  return out;
}

const hooks = findHookCalls(cleaned);
const decls = findDeclarations(cleaned);

describe('App.jsx hook declaration order', () => {
  it('scans at least 10 hook calls (sanity check)', () => {
    if (hooks.length <= 10) {
      console.error('Hooks found:', hooks.map((h) => `${h.hookName || '?'}@L${h.lineNo}`).join(', '));
    }
    expect(hooks.length).toBeGreaterThan(10);
  });

  it('finds common declarations (sanity)', () => {
    expect(decls.get('user')).toBeDefined();
    expect(decls.get('currentEvent')).toBeDefined();
    expect(decls.get('inquiries')).toBeDefined();
    expect(decls.get('vendorContacts')).toBeDefined();
  });

  it('vendorsForPicker reads vendorContacts that is declared earlier', () => {
    const memo = hooks.find((h) => h.hookName === 'vendorsForPicker');
    expect(memo).toBeTruthy();
    expect(memo.deps).toContain('vendorContacts');
    const declLine = decls.get('vendorContacts');
    expect(declLine).toBeDefined();
    expect(declLine).toBeLessThan(memo.lineNo);
  });

  it('vendorsForPicker reads inquiries that is declared earlier', () => {
    const memo = hooks.find((h) => h.hookName === 'vendorsForPicker');
    expect(memo.deps).toContain('inquiries');
    const declLine = decls.get('inquiries');
    expect(declLine).toBeDefined();
    expect(declLine).toBeLessThan(memo.lineNo);
  });

  it('global: every hook deps identifier declared in App.jsx is declared before its hook', () => {
    const offenders = [];
    for (const h of hooks) {
      for (const id of h.deps) {
        const declLine = decls.get(id);
        if (declLine == null) continue;
        if (declLine >= h.lineNo) {
          offenders.push({
            hook: h.hookName || h.callName + '@' + h.lineNo,
            dep: id,
            hookLine: h.lineNo,
            declLine,
          });
        }
      }
    }
    expect(
      offenders,
      `TDZ offenders:\n${offenders
        .map((o) => `  - ${o.hook} (L${o.hookLine}) reads '${o.dep}' (declared L${o.declLine})`)
        .join('\n')}`,
    ).toEqual([]);
  });
});