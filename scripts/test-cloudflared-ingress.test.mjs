// test-cloudflared-ingress.test.mjs — Asserts every URL path the Vercel
// proxy uses against the NAS has a matching rule in
// deploy/cloudflared/config.yml.
//
// Why this exists (2026-08-05): the photo-delete feature shipped
// with the CF function deployed, the Vercel proxy live, the NAS
// Python running — but the Cloudflare tunnel config was MISSING
// the /delete ingress rule. The user got a 404 with no CORS
// headers, which masqueraded as a CORS error. The fix was a
// hand-edit on the NAS at ~/.cloudflared/config.yml. There was
// no automated check that said "every URL the proxy hits has a
// matching tunnel rule". After this test, if a proxy URL changes
// or a new one is added, CI catches the ingress gap automatically.
//
// How it works:
//   1. Parse deploy/cloudflared/config.yml for hostname cdn.savetheday.io
//      entries and their service URL paths.
//   2. Scan api/*.js (savetheday) AND any
//      FLIGHT_DEALS_SRC_DIR/src/app/api/**/*.ts (flight-deals-app,
//      via FLIGHT_DEALS_SRC_DIR env var; ignored if unset) for
//      cdn.savetheday.io URL literals.
//   3. For each proxy URL path, assert at least one ingress rule
//      matches it.
//   4. Exit 1 on any mismatch.
//
// This is intentionally a minimal-yaml parser — no library. The
// config is small (~20 lines) and hand-edited.
//
// 2026-08-07 — flight-deals-app (CompareTiger) ALSO uses this tunnel
// (it piggybacks on the tunnel set up for savetheday photo uploads).
// Its Vercel route fetches cdn.savetheday.io/deals/*.json (see
// flight-deals-app/src/app/api/deals/route.ts). Without the /deals
// ingress rule, Vercel falls back to the build-time static JSON and
// CompareTiger alerts show stale/garbage data.
//
// Run with:
//   npx vitest run scripts/test-cloudflared-ingress.test.mjs
// Optional env: set the FD_SRC_DIR to the flight-deals-app root to
// also scan its api routes. Example path is given above.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const INGRESS_FILE = path.join(REPO_ROOT, 'deploy/cloudflared/config.yml');
const API_DIR = path.join(REPO_ROOT, 'api');

// --- 1. Parse ingress config ---

describe('Cloudflare tunnel ingress coverage', () => {
  let configText;
  let ingressBlock;
  let ingressPaths = [];
  let proxyUrls = new Set();

  it('parses ingress config + matches every proxy URL to a rule', () => {
    try {
      configText = readFileSync(INGRESS_FILE, 'utf8');
    } catch (e) {
      throw new Error(`Cannot read ${INGRESS_FILE} — run from repo root.`);
    }

    // Match lines like:
    //   - hostname: cdn.savetheday.io
    //     path: /delete
    //     service: http://localhost:9879
    // Or:
    //   - hostname: cdn.savetheday.io
    //     service: https://ugreen-nas.tail20bf1.ts.net
    // (no `path:` means catch-all for the hostname)
    ingressBlock = configText.match(
      /- hostname: ([^\n]+)\n((?:    [^\n]+\n)*)/g
    ) || [];

    for (const block of ingressBlock) {
      const lines = block.split('\n').filter(Boolean);
      const hostnameMatch = lines[0].match(/- hostname:\s*(\S+)/);
      if (!hostnameMatch) continue;
      const hostname = hostnameMatch[1];

      let pathLine = null;
      let serviceLine = null;
      for (const line of lines.slice(1)) {
        const p = line.match(/^\s+path:\s*(\S+)/);
        const s = line.match(/^\s+service:\s*(\S+)/);
        if (p) pathLine = p[1];
        if (s) serviceLine = s[1];
      }
      ingressPaths.push({
        hostname,
        path: pathLine, // null means catch-all on the hostname
        service: serviceLine || '(unknown)',
      });
    }

    console.log(`Found ${ingressPaths.length} ingress rules for relevant hostnames.`);
    for (const r of ingressPaths) {
      console.log(`  - ${r.hostname}${r.path ? r.path : ' (catch-all)'} → ${r.service}`);
    }

    // --- 2. Scan api/ for cdn.savetheday.io URLs ---

    const apiFiles = readdirSync(API_DIR).filter((f) => f.endsWith('.js'));
    const urlRe = /https?:\/\/(cdn\.savetheday\.io)[^\s'"`)]+/g;

    for (const file of apiFiles) {
      const fullPath = path.join(API_DIR, file);
      const text = readFileSync(fullPath, 'utf8');
      let m;
      while ((m = urlRe.exec(text)) !== null) {
        const url = m[0].replace(/[)\].,;:]+$/, ''); // strip trailing punctuation
        proxyUrls.add(url);
      }
    }

    console.log(`Found ${proxyUrls.size} unique cdn.savetheday.io URLs in api/.`);

    // Also scan flight-deals-app if FLIGHT_DEALS_SRC_DIR (formerly
    // FD_SRC_DIR) is set. flight-deals-app stores api routes under
    // src/app/api/**/*.ts (Next.js App Router), and uses
    // cdn.savetheday.io/deals/* via the shared Cloudflare Tunnel.
    const fdSrcDir = process.env.FLIGHT_DEALS_SRC_DIR
      || process.env.FD_SRC_DIR; // legacy alias
    if (fdSrcDir) {
      const fdApiDir = path.join(fdSrcDir, 'src', 'app', 'api');
      let fdApiFiles = [];
      try {
        const walk = (dir) => {
          const out = [];
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) out.push(...walk(p));
            else if (e.isFile() && p.endsWith('.ts')) out.push(p);
          }
          return out;
        };
        fdApiFiles = walk(fdApiDir);
      } catch (e) {
        console.log(
          `FLIGHT_DEALS_SRC_DIR=${fdSrcDir} but could not scan ${fdApiDir}: ${e.message}`
        );
      }
      let fdAdded = 0;
      for (const fullPath of fdApiFiles) {
        const text = readFileSync(fullPath, 'utf8');
        let m;
        urlRe.lastIndex = 0;
        while ((m = urlRe.exec(text)) !== null) {
          const url = m[0].replace(/[)\].,;:]+$/, '');
          if (!proxyUrls.has(url)) fdAdded++;
          proxyUrls.add(url);
        }
      }
      console.log(
        `Found ${fdApiFiles.length} flight-deals-app api files; ` +
        `${fdAdded} new unique URLs added (total now ${proxyUrls.size}).`
      );
    } else {
      console.log(
        'FLIGHT_DEALS_SRC_DIR not set — only scanning savetheday api/. ' +
        'Set it to the flight-deals-app root to also scan src/app/api/**/*.ts.'
      );
    }

    expect(proxyUrls.size).toBeGreaterThan(0);

    // --- 3. Cross-check each URL against ingress rules ---

    function pathOf(url) {
      return new URL(url).pathname;
    }

    // Cloudflare path rules are prefix matches by default. The path
    // in the config can be `/delete`, `/upload`, or `/photos` —
    // and the URL pathname `/delete/something` should match `/delete`.
    //
    // CRITICAL: catch-all rules (path === null) do NOT count as
    // coverage. They produce 404s, which is exactly the failure
    // mode we're trying to catch. A URL is "covered" only if it
    // matches at least one SPECIFIC path rule on its hostname.
    function ruleMatches(rule, urlPath) {
      if (rule.path === null) return false; // catch-all — excluded
      return urlPath === rule.path || urlPath.startsWith(rule.path + '/');
    }

    const gaps = [];
    for (const url of proxyUrls) {
      const urlPath = pathOf(url);
      const matching = ingressPaths.filter((r) => {
        if (r.hostname !== 'cdn.savetheday.io') return false;
        return ruleMatches(r, urlPath);
      });
      if (matching.length === 0) {
        gaps.push({ url, urlPath });
      } else {
        console.log(`  ✓ ${url} (path=${urlPath}) matched ${matching.length} specific ingress rule(s)`);
      }
    }

    if (gaps.length > 0) {
      const msg = gaps
        .map((g) => `  - ${g.url} (path=${g.urlPath})`)
        .join('\n');
      throw new Error(
        `Ingress coverage gaps found:\n${msg}\n` +
        `These URLs would fall through to the catch-all 404. ` +
        `Add specific ingress rules to deploy/cloudflared/config.yml.`
      );
    }
  });
});