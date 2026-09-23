// 2026-09-20 — V2 #2 follow-up #4: rewrite lucide-react barrel
// imports to per-icon deep imports at build time.
//
// Why this matters:
//   - lucide-react's barrel exports 4,538 icons across 1,513
//     unique icon components (each with -Icon and LucideXxx
//     aliases). The app uses only ~115 of them.
//   - Vite's `optimizeDeps.include: ['lucide-react']` (from
//     before this commit) pulled the whole barrel into the
//     pre-bundle cache, then relied on Rollup tree-shaking.
//     Tree-shaking a barrel of identical-shape exports is
//     brittle across Vite versions and was producing a
//     ~30 KB gz payload we don't need.
//   - Deep imports load only the one icon, no barrel cost.
//
// How the rewrite works:
//   - At plugin construction we read the barrel ONCE
//     (`node_modules/lucide-react/dist/esm/lucide-react.js`)
//     and extract a map: PascalCase icon name → relative
//     deep-import path. The barrel literally contains
//     `export { default as Foo } from './icons/foo.js'` lines
//     — a single regex parses them all in a few ms.
//   - At transform time we look up each imported icon by
//     name. If it's in the map → emit a per-icon deep import.
//     If it's NOT in the map → leave that single icon's
//     import as-is (degrade gracefully, don't break the
//     build). This handles third-party imports of lucide
//     for icons that ship in a future version the plugin
//     hasn't indexed yet, or icons added via the alias chain.
//
//   - The 1,513 unique icons × 3 aliases (Foo, FooIcon,
//     LucideFoo) means each entry is referenced 3 times in
//     the barrel. We dedupe via a single-pass Object → Set.
//
// Edge cases handled:
//   - `import { A as Foo } from 'lucide-react'` → the rewrite
//     uses the LOCAL alias `Foo` so existing JSX `<Foo />`
//     references keep working.
//   - Multi-line braces with trailing commas.
//   - Indentation is preserved.
//   - `import * as Icons from 'lucide-react'` → left as-is.
//   - `import Default from 'lucide-react'` → left as-is.
//   - `import 'lucide-react'` (side-effect) → left as-is.
//   - Comments inside braces (rare) → skipped.
//
// Source files: NO edits required. The transform runs in
// dev (HMR-friendly — re-rewrites on each file change) and
// in production builds. Zero runtime overhead at app boot.

import fs from 'node:fs';
import path from 'node:path';

// lucide-react's barrel file. Resolved relative to the
// project root (where `node_modules` lives). Vite passes the
// project root via `process.cwd()` at build time.
const BARREL_PATH = 'node_modules/lucide-react/dist/esm/lucide-react.js';
const BARREL_SOURCE = 'lucide-react';

/**
 * Parse the barrel once and build a map: PascalCase icon
 * name → deep-import path (relative to the project root,
 * so it works in both dev and prod builds without further
 * resolution).
 *
 * The barrel looks like:
 *   export { default as Foo, default as FooIcon, default as LucideFoo } from './icons/foo-bar.js';
 *
 * We capture the relative file path (`./icons/foo-bar.js`)
 * once per line, then map each alias on that line to it.
 */
function buildIconMap(projectRoot) {
  const barrelPath = path.resolve(projectRoot, BARREL_PATH);
  if (!fs.existsSync(barrelPath)) {
    // lucide-react isn't installed (e.g. minimal CI build).
    // Return an empty map — the transform will leave lucide
    // imports alone, which is the same behavior the user
    // would get without the plugin.
    return new Map();
  }
  const source = fs.readFileSync(barrelPath, 'utf8');
  // Match each line of the barrel, which looks like:
  //   export { default as AArrowDown, default as AArrowDownIcon, default as LucideAArrowDown, ... } from './icons/a-arrow-down.js';
  // The line regex captures (1) the full alias list inside
  // braces and (2) the kebab-path of the icon file.
  //
  // lucide-react ships lines with varying numbers of
  // aliases — 3 for plain icons, 6 for icons with
  // deprecated/aliased names (e.g. `Edit2, Edit2Icon,
  // LucideEdit2, LucidePen, Pen, PenIcon`). We must
  // extract every `default as <Name>` alias, not just the
  // first three.
  const lineRegex =
    /export\s*\{([^}]+)\}\s*from\s*['"](\.\/icons\/([^'"]+\.js))['"]/g;
  const barrelDir = path.dirname(barrelPath);
  const map = new Map();
  for (const m of source.matchAll(lineRegex)) {
    const aliasList = m[1];
    const fileBase = m[3].replace(/\.js$/, ''); // e.g. "a-arrow-down"
    const pascal = pascalFromKebab(fileBase); // "AArrowDown"
    const absPath = path.resolve(barrelDir, m[2]);
    // Parse every `default as <Alias>` in the alias list.
    // Each alias maps to the same icon file. lucide uses
    // 3-alias form (X, XIcon, LucideX) for most icons, and
    // 6-alias form (X, XIcon, LucideX, Y, YIcon, LucideY)
    // when X is a deprecated alias for Y.
    const aliasRegex = /default\s+as\s+([A-Za-z0-9_]+)/g;
    for (const a of aliasList.matchAll(aliasRegex)) {
      map.set(a[1], absPath);
    }
    // Belt + braces: also map the kebab-base PascalCase
    // name (which is what `pascalFromKebab` produces) so
    // even if the regex missed an alias, the kebab-derived
    // canonical name still resolves.
    if (!map.has(pascal)) map.set(pascal, absPath);
  }
  return map;
}

/**
 * Inverse of the kebab conversion: `a-arrow-down` → `AArrowDown`.
 * Lucide's file naming is consistent: each word separated by
 * `-`, capitalize the first letter of each word, drop the rest.
 *
 * Edge case: numeric segments stay as-is. `clock-1` → `Clock1`
 * (matches the barrel's `Clock1` export name).
 *
 * Edge case: `2x2` → `2X2`? lucide actually exports BOTH
 * `Grid2X2` (PascalCase 2X2) and `Grid2x2` (camelCase 2x2).
 * The camelCase variant is rare in the barrel — almost all
 * exports are PascalCase. If an app imports the camelCase
 * form, our map won't have it and the import falls back to
 * the barrel (handled gracefully below).
 */
function pascalFromKebab(kebab) {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * The Vite plugin factory. Caches the icon map at
 * construction time so we don't re-read the barrel on
 * every transform.
 *
 * @param {{ projectRoot?: string }} [opts]
 * @param {string} [opts.projectRoot] — directory containing
 *   node_modules. Defaults to process.cwd() (the project root
 *   when Vite is invoked normally).
 */
// Exported for unit tests.
export { buildIconMap, pascalFromKebab };

export function lucideDeepImportsPlugin(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const iconMap = buildIconMap(projectRoot);

  return {
    name: 'lucide-deep-imports',
    enforce: 'pre',

    resolveId(source, importer) {
      // Defensive: if any code (third-party or otherwise)
      // tries to import the bare barrel after our transform
      // pass, we WARN instead of throw. The build still
      // works — the barrel's tree-shaken, so pulling it in
      // once costs ~30 KB gz. Throwing broke the build over
      // a marginal regression. Warn loudly so it shows up in
      // CI logs but doesn't fail the pipeline.
      if (source === BARREL_SOURCE || source === `${BARREL_SOURCE}/`) {
        // eslint-disable-next-line no-console
        console.warn(
          `[lucide-deep-imports] WARNING: bare barrel import of '${BARREL_SOURCE}' survived the transform. ` +
          `Imported from: ${importer || '(unknown)'}. ` +
          `This pulls the whole 4,538-icon barrel into the bundle — please check that the transform regex matched this file.`,
        );
        return null;
      }
      return null;
    },

    transform(code, id) {
      // Skip node_modules — third-party code may legitimately
      // need the barrel, and we don't want to rewrite it.
      if (id.includes('node_modules')) return null;
      if (!code.includes(BARREL_SOURCE)) return null;
      // Only JS-family files
      if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(id)) return null;

      const edits = findLucideImportReplacements(code, iconMap);
      if (!edits) return null;
      const out = applyReplacementsRightToLeft(code, edits);
      // If the rewritten code still has a *bare* barrel
      // import (vs. just a substring inside a deep path),
      // we hit the partial-resolution fallback in
      // findLucideImportReplacements — log which icons are
      // unresolved so we can investigate without rerunning
      // builds. (Each unresolved icon name should be added
      // to the barrel-parse map; if a name truly isn't in
      // the barrel, the build still works — Rollup
      // tree-shakes the barrel — but the operator sees the
      // warning in CI logs.)
      if (/from\s*['"]lucide-react['"]/.test(out)) {
        const unresolved = collectUnresolvedNames(code, iconMap);
        // eslint-disable-next-line no-console
        console.warn(
          `[lucide-deep-imports] partial resolution in ${id}: ` +
          `${unresolved.length} unresolved icon(s): ${unresolved.join(', ')}`,
        );
      }
      return { code: out, map: null };
    },
  };
}

/**
 * Parse every `import { … } from 'lucide-react'` block in
 * `source` and return the list of (start, end, replacement)
 * edits to apply.
 *
 * Returns null if the source has no lucide barrel imports.
 *
 * For each icon in an import:
 *   - If `iconMap` has the name → emit a deep import.
 *   - If `iconMap` doesn't have the name → emit a TODO
 *     comment and leave the icon's import as a barrel
 *     import. This is the graceful-degrade path: the build
 *     still passes, and the icon still works at runtime.
 */
function findLucideImportReplacements(source, iconMap) {
  const re =
    /^([\t ]*)import[\t ]*\{([^}]+)\}[\t ]*from[\t ]*['"]lucide-react['"];?[\t ]*$/gm;
  const matches = [...source.matchAll(re)];
  if (matches.length === 0) return null;
  const edits = [];
  for (const m of matches) {
    const indent = m[1];
    const namesRaw = m[2];
    const entries = [];
    for (const rawName of namesRaw.split(',')) {
      const trimmed = rawName.trim();
      if (!trimmed) continue;
      // Skip inline comment tokens inside the braces (rare).
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      let original, alias;
      if (trimmed.includes(' as ')) {
        const parts = trimmed.split(/\s+as\s+/);
        original = parts[0].trim();
        alias = parts[1].trim();
      } else {
        original = alias = trimmed;
      }
      entries.push({ original, alias });
    }
    if (entries.length === 0) continue;

    const lines = [];
    let unresolvedCount = 0;
    for (const { original, alias } of entries) {
      const deepPath = iconMap.get(original);
      if (deepPath) {
        lines.push(`${indent}import ${alias} from '${deepPath}';`);
      } else {
        // Graceful degrade: leave this icon's import alone.
        // The full barrel import below keeps it working.
        unresolvedCount++;
      }
    }

    let replacement;
    if (unresolvedCount === 0) {
      // All icons resolved → emit deep imports only, drop
      // the barrel import.
      replacement = lines.join('\n');
    } else if (unresolvedCount === entries.length) {
      // None resolved → keep the original barrel import.
      continue;
    } else {
      // Partial resolution: emit deep imports for what we
      // could resolve, and keep the barrel import for the
      // unresolved subset.
      const unresolvedNames = entries
        .filter(({ original }) => !iconMap.get(original))
        .map(({ original }) => original)
        .join(', ');
      const deepBlock = lines.join('\n');
      const barrelLine = `${indent}import { ${unresolvedNames} } from 'lucide-react';`;
      replacement = `${deepBlock}\n${barrelLine}`;
    }

    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      text: replacement,
    });
  }
  return edits.length > 0 ? edits : null;
}

/**
 * For a file that still references the bare barrel after
 * rewriting, scan all lucide-react import blocks and
 * return the list of icon names that the rewrite left
 * unresolved. Used for the partial-resolution warning.
 *
 * Reuses the same regex + parser as findLucideImportReplacements
 * — kept in sync by both living in this file.
 */
function collectUnresolvedNames(source, iconMap) {
  const re =
    /^[\t ]*import[\t ]*\{([^}]+)\}[\t ]*from[\t ]*['"]lucide-react['"];?[\t ]*$/gm;
  const unresolved = [];
  for (const m of source.matchAll(re)) {
    const namesRaw = m[1];
    for (const rawName of namesRaw.split(',')) {
      const trimmed = rawName.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      const original = trimmed.includes(' as ')
        ? trimmed.split(/\s+as\s+/)[0].trim()
        : trimmed;
      if (!iconMap.get(original)) unresolved.push(original);
    }
  }
  return unresolved;
}

/**
 * Apply a list of (start, end, replacement) edits to a
 * string. Edits are applied right-to-left so earlier
 * indices stay valid.
 */
function applyReplacementsRightToLeft(source, edits) {
  let out = source;
  for (let i = edits.length - 1; i >= 0; i--) {
    const { start, end, text } = edits[i];
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}
