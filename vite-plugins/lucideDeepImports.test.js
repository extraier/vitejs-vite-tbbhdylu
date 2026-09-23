// 2026-09-20 — tests for the lucide-deep-imports plugin.
//
// We test the plugin's public surface (resolveId, transform)
// with a hand-built icon map. The plugin normally builds its
// own map from the lucide barrel at construction; for tests
// we pass a small map directly via a side-channel — the
// plugin accepts an opts.projectRoot, but we extend it with
// an internal hook (testIconMap) for unit tests.
//
// Strategy: each test builds a tiny iconMap inline so the
// assertions are deterministic and don't depend on lucide's
// on-disk structure. We also include ONE end-to-end test
// that reads the real barrel and verifies the map covers
// every alias for every icon (the regression net).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { lucideDeepImportsPlugin, buildIconMap } from './lucideDeepImports';

// Tiny test helper — build a plugin with a hand-supplied map.
// The plugin normally builds the map from disk at construction
// time; this bypasses that for unit tests.
function makePlugin(map) {
  return lucideDeepImportsPlugin({ projectRoot: '/tmp/__no_lucide_here__' })
    // Replace the internally-built map with our test map.
    // We mutate the returned object's iconMap via a hack:
    // call the constructor again with the map set... but
    // since iconMap isn't exposed, we test through the real
    // barrel builder. For unit tests we just stub the disk.
    ;
}

// We test through the real builder. The real builder reads
// the project's node_modules. For unit tests we want
// deterministic input — so we write a tiny stub barrel into
// a temp dir and point the plugin at it.

import os from 'node:os';

function withStubBarrel(stubContent, fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lucide-test-'));
  const barrelDir = path.join(tmpRoot, 'node_modules', 'lucide-react', 'dist', 'esm');
  fs.mkdirSync(barrelDir, { recursive: true });
  fs.writeFileSync(path.join(barrelDir, 'lucide-react.js'), stubContent);
  try {
    return fn(tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const SIMPLE_BARREL = `
export { default as Star, default as StarIcon, default as LucideStar } from './icons/star.js';
export { default as Heart, default as HeartIcon, default as LucideHeart } from './icons/heart.js';
export { default as Download, default as DownloadIcon, default as LucideDownload } from './icons/download.js';
export { default as Clock1, default as Clock1Icon, default as LucideClock1 } from './icons/clock-1.js';
export { default as Grid2X2, default as Grid2X2Icon, default as LucideGrid2X2 } from './icons/grid-2-x-2.js';
export { default as Image, default as ImageIcon, default as LucideImage } from './icons/image.js';
`;

describe('buildIconMap', () => {
  it('returns an empty map when the barrel does not exist', () => {
    const map = buildIconMap('/tmp/__definitely_not_a_real_path__');
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  it('parses a simple barrel into a complete alias map', () => {
    withStubBarrel(SIMPLE_BARREL, (root) => {
      const map = buildIconMap(root);
      // Each stub-barrel icon has 3 aliases (X, XIcon,
      // LucideX). 6 icons × 3 aliases = 18 entries.
      // (Real lucide lines can have 6 aliases when an icon
      // has a deprecated-name alias — the multi-alias
      // parser handles that too, but the stub doesn't
      // exercise it.)
      expect(map.size).toBe(18);
      expect(map.get('Star')).toBe(stubIconPath(root, './icons/star.js'));
      expect(map.get('StarIcon')).toBe(stubIconPath(root, './icons/star.js'));
      expect(map.get('LucideStar')).toBe(stubIconPath(root, './icons/star.js'));
      expect(map.get('Heart')).toBe(stubIconPath(root, './icons/heart.js'));
      expect(map.get('Image')).toBe(stubIconPath(root, './icons/image.js'));
      expect(map.get('ImageIcon')).toBe(stubIconPath(root, './icons/image.js'));
    });
  });

  it('handles digit-separated names (Clock1 → clock-1.js)', () => {
    withStubBarrel(SIMPLE_BARREL, (root) => {
      const map = buildIconMap(root);
      expect(map.get('Clock1')).toBe(stubIconPath(root, './icons/clock-1.js'));
      expect(map.get('Clock1Icon')).toBe(stubIconPath(root, './icons/clock-1.js'));
    });
  });

  it('handles digit-letter-digit names (Grid2X2 → grid-2-x-2.js)', () => {
    withStubBarrel(SIMPLE_BARREL, (root) => {
      const map = buildIconMap(root);
      expect(map.get('Grid2X2')).toBe(stubIconPath(root, './icons/grid-2-x-2.js'));
    });
  });
});

describe('lucideDeepImportsPlugin (with stub barrel)', () => {
  it('passes through bare barrel imports (with a warning) instead of throwing', () => {
    // The plugin no longer THROWS on a bare barrel import
    // — it logs a warning and returns null so Rollup can
    // still resolve it. The barrel is tree-shaken, so a
    // single survivor is a 30 KB gz regression at most,
    // not a build-breaking failure.
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const resolveId = plugin.resolveId.bind(plugin);
    // Capture warnings emitted by the plugin.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      expect(resolveId('lucide-react', undefined, {})).toBeNull();
      expect(resolveId('lucide-react/', undefined, {})).toBeNull();
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toMatch(/bare barrel import of 'lucide-react'/);
    expect(warnings[1]).toMatch(/bare barrel import of 'lucide-react'/);
  });

  it('passes through non-lucide imports unchanged', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const resolveId = plugin.resolveId.bind(plugin);
    expect(resolveId('react', undefined, {})).toBeNull();
    expect(resolveId('./App.jsx', undefined, {})).toBeNull();
  });

  it('returns null for files that do not mention lucide-react', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `
import React from 'react';
import { db } from './firebase';
export default function App() { return null; }
    `.trim();
    expect(transform(code, '/some/file.jsx')).toBeNull();
  });

  it('rewrites a single-line import to per-icon deep imports', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Star, Heart, Download } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out).not.toBeNull();
    expect(out.code).toBe(
      `import Star from '${
stubIconPath(root, './icons/star.js')
}';\n` +
      `import Heart from '${
stubIconPath(root, './icons/heart.js')
}';\n` +
      `import Download from '${
stubIconPath(root, './icons/download.js')
}';\n`,
    );
  });

  it('handles aliases (ImageIcon resolves to image.js, not image-icon.js)', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { ImageIcon } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toBe(`import ImageIcon from '${
stubIconPath(root, './icons/image.js')
}';\n`);
  });

  it('handles digit-separated icons (Clock1 → clock-1.js)', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Clock1 } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toBe(`import Clock1 from '${
stubIconPath(root, './icons/clock-1.js')
}';\n`);
  });

  it('handles Grid2X2 → grid-2-x-2.js (the previously broken case)', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Grid2X2 } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toBe(`import Grid2X2 from '${
stubIconPath(root, './icons/grid-2-x-2.js')
}';\n`);
  });

  it('preserves aliased imports', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Star as S } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toBe(`import S from '${
stubIconPath(root, './icons/star.js')
}';\n`);
  });

  it('handles multiple separate lucide imports in the same file', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code =
      `import { Star } from 'lucide-react';\n` +
      `import { useState } from 'react';\n` +
      `import { Heart, Download } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toContain(`import Star from '${
stubIconPath(root, './icons/star.js')
}';`);
    expect(out.code).toContain(`import Heart from '${
stubIconPath(root, './icons/heart.js')
}';`);
    expect(out.code).toContain(`import Download from '${
stubIconPath(root, './icons/download.js')
}';`);
    expect(out.code).toContain(`import { useState } from 'react';`);
    expect(out.code).not.toMatch(/from 'lucide-react'/);
  });

  it('handles multi-line imports with trailing commas', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code =
      `import {\n` +
      `  Star,\n` +
      `  Heart,\n` +
      `} from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toContain(`import Star from '${
stubIconPath(root, './icons/star.js')
}';`);
    expect(out.code).toContain(`import Heart from '${
stubIconPath(root, './icons/heart.js')
}';`);
  });

  it('skips node_modules', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Star } from 'lucide-react';\n`;
    expect(transform(code, '/some/node_modules/some-lib/index.js')).toBeNull();
  });

  it('skips non-JS files', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `import { Star } from 'lucide-react';\n`;
    expect(transform(code, '/some/file.css')).toBeNull();
    expect(transform(code, '/some/file.html')).toBeNull();
  });

  it('does not rewrite namespace or default imports', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code =
      `import * as Icons from 'lucide-react';\n` +
      `import Default from 'lucide-react';\n`;
    expect(transform(code, '/some/file.jsx')).toBeNull();
  });

  it('preserves indentation of the original import block', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    const code = `    import { Star } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toBe(`    import Star from '${
stubIconPath(root, './icons/star.js')
}';\n`);
  });

  it('gracefully degrades when an icon is not in the map', () => {
    let root;
    const plugin = withStubBarrel(SIMPLE_BARREL, (r) => {
      root = r;
      return lucideDeepImportsPlugin({ projectRoot: r });
    });
    const transform = plugin.transform.bind(plugin);
    // UnknownIcon isn't in our stub barrel
    const code = `import { Star, UnknownIcon } from 'lucide-react';\n`;
    const out = transform(code, '/some/file.jsx');
    expect(out.code).toContain(`import Star from '${
stubIconPath(root, './icons/star.js')
}';`);
    expect(out.code).toContain(`import { UnknownIcon } from 'lucide-react';`);
    // The barrel import is preserved for the unresolved icon
    expect(out.code).toMatch(/from 'lucide-react'/);
  });
});

describe('buildIconMap against the real lucide-react barrel', () => {
  // This is the regression net — if lucide-react ever changes
  // its barrel format (e.g. drops the from ./icons/xxx.js
  // pattern), this test catches it.
  it('parses every export from the real barrel', () => {
    const projectRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
    );
    if (!fs.existsSync(path.join(projectRoot, 'node_modules/lucide-react/dist/esm/lucide-react.js'))) {
      // lucide-react isn't installed (CI matrix without it).
      // Skip — the stub-based tests above still cover the
      // core logic.
      return;
    }
    const map = buildIconMap(projectRoot);
    // Sanity: every icon should have all 3 aliases.
    const iconNames = new Set();
    for (const key of map.keys()) {
      if (key.startsWith('Lucide')) continue;
      const base = key.endsWith('Icon') ? key.slice(0, -4) : key;
      iconNames.add(base);
    }
    // For each unique icon, verify all 3 aliases map to the
    // same deep path.
    let checked = 0;
    for (const icon of iconNames) {
      const paths = new Set([
        map.get(icon),
        map.get(`${icon}Icon`),
        map.get(`Lucide${icon}`),
      ]);
      expect(paths.size).toBe(1); // all three aliases resolve to one file
      checked++;
    }
    expect(checked).toBeGreaterThan(500); // real lucide has 1.5k+ icons
  });
});


function stubIconPath(root, relPath) {
  const barrelDir = path.join(
    root, 'node_modules', 'lucide-react', 'dist', 'esm',
  );
  return path.resolve(barrelDir, relPath);
}

