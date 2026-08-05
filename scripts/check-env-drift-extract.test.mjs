/**
 * test-check-env-drift-logic.test.mjs — verifies the
 * check-env-drift.sh script's alias-chain extraction logic.
 *
 * The script's awk-based extraction is the most fragile part. It
 * handles multi-line `process.env.X || Y || ''` chains, picks the
 * first member per chain, and excludes `.test.js` files. If any
 * of these rewrites incorrectly, the drift check will produce
 * false positives (or worse, miss real drift).
 *
 * This vitest spec runs the awk in isolation against synthetic
 * proxy source files and asserts the extraction is correct.
 *
 * Run with: npx vitest run scripts/test-check-env-drift-logic.test.mjs
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Awk script for env-drift chain extraction. Mirrors the script embed
// in scripts/check-env-drift.sh. A chain is a sequence of
// `process.env.X` lines that all end with `||`. The first member is
// the primary. The chain ends when a line does NOT end with `||`.
const AWK_SCRIPT = [
  '/process\\.env\\./ {',
  '  pos = index($0, "process.env.")',
  '  name = substr($0, pos + 12)',
  '  sub(/[^A-Z0-9_].*$/, "", name)',
  '  ends_with_or = ($0 ~ /\\|\\| *(\\\\\\\\ *)?$/) || ($0 ~ /\\|\\| +\\/\\//)',
  '  if (ends_with_or) {',
  '    if (buf == 0) {',
  '      chain_start = name',
  '    }',
  '    buf = 1',
  '    next',
  '  }',
  '  if (buf == 1) {',
  '    print chain_start',
  '    buf = 0',
  '    chain_start = ""',
  '  }',
  '  print name',
  '  next',
  '}',
  '{',
  '  if (buf == 1) {',
  '    print chain_start',
  '    buf = 0',
  '    chain_start = ""',
  '  }',
  '}',
  'END {',
  '  if (buf == 1) {',
  '    print chain_start',
  '  }',
  '}',
].join('\n');

function runAwk(source) {
  // Write the awk script to a temp file. Pipe input via stdin
  // (execSync's `input:` option) — `<<<` heredoc doesn't work
  // reliably in non-interactive shell mode.
  const tmp = mkdtempSync(join(tmpdir(), 'awk-extract-'));
  const scriptPath = join(tmp, 'extract.awk');
  writeFileSync(scriptPath, AWK_SCRIPT);
  try {
    const out = execSync(
      `awk -f ${JSON.stringify(scriptPath)}`,
      { encoding: 'utf8', input: source }
    ).trim();
    return out.split('\n').filter(Boolean);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('check-env-drift.sh awk extraction', () => {
  it('extracts a single process.env.X', () => {
    const out = runAwk(`
      const X = process.env.HMAC_KEY;
    `);
    expect(out).toEqual(['HMAC_KEY']);
  });

  it('extracts the FIRST member of a multi-line alias chain', () => {
    const out = runAwk(`
      const X =
        process.env.NAS_UPLOAD_SECRET ||
        process.env.PHOTO_UPLOAD_SECRET ||
        process.env.PHOTO_HMAC_SECRET ||
        '';
    `);
    expect(out).toEqual(['NAS_UPLOAD_SECRET']);
  });

  it('handles trailing comment after || on the first line', () => {
    // The actual culprit from the 2026-08-05 incident file:
    //   process.env.HMAC_KEY ||  // mirrors the Firebase secret
    //   process.env.UPLOAD_PREFERENCES_HMAC_SECRET ||
    //   '';
    // The first line ENDS with a comment, not with ||. The previous
    // version of this script missed this and treated the second
    // line as a new chain. The fix: any line containing `||` is
    // part of a chain.
    const out = runAwk(`
      const X =
        process.env.HMAC_KEY ||  // mirrors the Firebase secret
        process.env.UPLOAD_PREFERENCES_HMAC_SECRET ||
        '';
    `);
    expect(out).toEqual(['HMAC_KEY']);
  });

  it('handles multiple separate chains in one file', () => {
    const out = runAwk(`
      const A = process.env.NAS_DELETE_URL || process.env.NAS_UPLOAD_URL || '';
      const B = process.env.NAS_UPLOAD_SECRET || process.env.PHOTO_UPLOAD_SECRET || '';
      const C = process.env.HMAC_KEY;
    `);
    expect(out).toEqual(['NAS_DELETE_URL', 'NAS_UPLOAD_SECRET', 'HMAC_KEY']);
  });

  it('handles a chain followed by a single-line ref', () => {
    const out = runAwk(`
      const A = process.env.A || process.env.B || '';
      const B = process.env.SINGLE;
    `);
    expect(out).toEqual(['A', 'SINGLE']);
  });

  it('handles a single-line chain (X || Y only, no followup)', () => {
    const out = runAwk(`
      const X = process.env.A || process.env.B;
    `);
    expect(out).toEqual(['A']);
  });

  it('extracts multiple chains across a multiline const block', () => {
    const out = runAwk(`
      const NAS_UPLOAD_URL =
        process.env.NAS_UPLOAD_URL ||
        process.env.VITE_NAS_UPLOAD_URL ||
        'https://cdn.savetheday.io/upload';
      const UPLOAD_PREFERENCES_HMAC_SECRET =
        process.env.HMAC_KEY ||
        process.env.UPLOAD_PREFERENCES_HMAC_SECRET ||
        '';
    `);
    expect(out).toEqual(['NAS_UPLOAD_URL', 'HMAC_KEY']);
  });

  it('handles lines with no process.env between two chains', () => {
    const out = runAwk(`
      const X = process.env.A || process.env.B || '';
      // some unrelated comment
      const Y = process.env.C || process.env.D || '';
    `);
    expect(out).toEqual(['A', 'C']);
  });

  it('excludes test files (this is enforced outside awk, but we verify the finder would pick the right files)', () => {
    // The script uses `find api -type f -name "*.js" ! -name "*.test.js"`.
    // Verify the finder pattern is correct.
    const tmp = mkdtempSync(join(tmpdir(), 'env-drift-'));
    try {
      writeFileSync(join(tmp, 'proxy.js'), "const X = process.env.HMAC_KEY;");
      writeFileSync(join(tmp, 'proxy.test.js'), "process.env.UPLOAD_PREFERENCES_HMAC_SECRET = 'fake';");
      const files = execSync(
        `find ${tmp} -type f -name "*.js" ! -name "*.test.js"`,
        { encoding: 'utf8' }
      ).trim().split('\n').filter(Boolean);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/proxy\.js$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
