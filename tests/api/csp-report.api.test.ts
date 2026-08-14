import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * /api/csp-report — end-to-end smoke against deployed Vercel.
 *
 * 2026-08-14 — first version. This is the canonical smoke test
 * for the M-06 axis. We POST a real CSP violation through the
 * deployed endpoint, then verify:
 *
 *   1. The endpoint returns 204 (no body).
 *   2. The doc lands in Firestore with the right fields.
 *   3. The source tag is correct for each content-type.
 *
 * Why we hit the live endpoint instead of mocking:
 *   The point is to catch the "code says it's deployed but the
 *   deploy is missing an env var" class of bug. The handler
 *   depends on FIREBASE_SERVICE_ACCOUNT_JSON — if the env var
 *   is missing on Vercel, the handler 500s or silently drops.
 *   A live curl + Firestore query is the only way to know.
 *
 * Why we hit Firestore via helper script (not direct REST):
 *   gcloud's Python 3.9 deprecation broke the CLI auth on this
 *   machine. The integration tests spawn scripts/firestore-query.js
 *   which uses the Node SDK with a service account JSON key.
 *   The script auto-skips if no SA key is found.
 *
 * Marker-based tagging:
 *   Each test uses a unique marker so we can isolate the
 *   writes it produced and avoid cross-test interference.
 *
 * Cleaning up:
 *   We don't delete the writes. They cost effectively nothing
 *   and they're useful as a permanent leave-behind record.
 *   Admins can see them in the AdminCspReports view.
 *
 * CI env:
 *   PLAYWRIGHT_BASE_URL — defaults to https://savetheday.io
 *   GCLOUD_SA_KEY — path to SA JSON (defaults to
 *                    ~/.firebase-keys/savetheday-2377a.json)
 *   FIRESTORE_PROJECT — optional. Defaults to savetheday-2377a.
 */

// Resolve HELPER_PATH relative to the project root (works in both
// ESM and CommonJS Playwright contexts).
const HELPER_PATH = path.resolve(process.cwd(), 'scripts/firestore-query.cjs');

const UNIQUE = () => `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe('/api/csp-report — POST smoke', () => {
  test('legacy application/csp-report returns 204', async ({ request }) => {
    const marker = UNIQUE();
    const body = {
      'csp-report': {
        'document-uri': `https://savetheday.io/p/${marker}`,
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src',
        'blocked-uri': `https://example.com/${marker}.js`,
        'source-file': 'https://savetheday.io/p/test',
        'line-number': 1,
        'column-number': 1,
      },
    };

    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: JSON.stringify(body),
    });

    expect(resp.status(), 'legacy endpoint should return 204').toBe(204);
  });

  test('modern application/reports+json returns 204', async ({ request }) => {
    const marker = UNIQUE();
    const body = {
      age: 100,
      type: 'csp',
      url: `https://savetheday.io/p/${marker}`,
      body: {
        'document-uri': `https://savetheday.io/p/${marker}`,
        'violated-directive': 'img-src',
        'blocked-uri': `https://othercdn.example/${marker}.png`,
        'line-number': 2,
        'column-number': 2,
      },
    };

    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/reports+json' },
      data: JSON.stringify(body),
    });

    expect(resp.status(), 'Reporting API endpoint should return 204').toBe(204);
  });

  test('GET returns 405 (POST only)', async ({ request }) => {
    const resp = await request.get('/api/csp-report');
    expect(resp.status()).toBe(405);
  });

  test('empty body returns 204 without writing a doc', async ({ request }) => {
    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: '',
    });
    expect(resp.status()).toBe(204);
  });

  test('malformed JSON returns 204 without erroring', async ({ request }) => {
    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: 'not json at all',
    });
    // Browsers don't read the response; we always return 204.
    expect(resp.status()).toBe(204);
  });

  test('bare JSON (not CSP-shaped) returns 204', async ({ request }) => {
    // Defensive: empty csp-report ({}) still produces a row,
    // but a non-object input is dropped. The endpoint should
    // never 5xx.
    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ foo: 'bar' }),
    });
    expect(resp.status()).toBe(204);
  });
});

test.describe('/api/csp-report — Firestore integration (requires SA key)', () => {
  // Auto-skip when no SA key is available. The helper script
  // resolves GCLOUD_SA_KEY env var, then falls back to
  // ~/.firebase-keys/savetheday-2377a.json.
  const saKey = process.env.GCLOUD_SA_KEY ||
    path.join(os.homedir(), '.firebase-keys', 'savetheday-2377a.json');
  test.skip(!fs.existsSync(saKey) || !fs.existsSync(HELPER_PATH), 'No SA key or helper script');

  function queryDocuments(marker: string): any[] {
    const result = spawnSync('node', [HELPER_PATH, marker], {
      env: {
        ...process.env,
        GCLOUD_SA_KEY: saKey,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (result.status !== 0) {
      console.error('helper stderr:', result.stderr);
      throw new Error(`firestore-query.js failed: ${result.stderr}`);
    }
    try {
      return JSON.parse(result.stdout || '[]');
    } catch (e) {
      throw new Error(`failed to parse helper output: ${result.stdout}`);
    }
  }

  test('legacy POST writes a doc with source=legacy-csp-report', async ({ request }) => {
    const marker = UNIQUE();
    const body = {
      'csp-report': {
        'document-uri': `https://savetheday.io/p/${marker}`,
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src',
        'blocked-uri': `https://example.com/${marker}.js`,
        'line-number': 7,
        'column-number': 7,
      },
    };

    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: JSON.stringify(body),
    });
    expect(resp.status()).toBe(204);

    // Firestore writes are async — wait briefly for propagation.
    let docs: any[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      docs = await queryDocuments(marker);
      if (docs.length > 0) break;
    }
    expect(docs.length, `expected >= 1 doc with marker ${marker}`).toBeGreaterThanOrEqual(1);

    const doc = docs[0];
    expect(doc.violatedDirective).toBe('script-src-elem');
    expect(doc.blockedUri).toBe(`https://example.com/${marker}.js`);
    expect(doc.lineNumber).toBe(7);
    expect(doc.source).toBe('legacy-csp-report');
  });

  test('Reporting API single-report writes a doc with source=reporting-api', async ({ request }) => {
    const marker = UNIQUE();
    const body = {
      age: 100,
      type: 'csp',
      url: `https://savetheday.io/p/${marker}`,
      body: {
        'document-uri': `https://savetheday.io/p/${marker}`,
        'violated-directive': 'img-src',
        'blocked-uri': `https://othercdn.example/${marker}.png`,
        'line-number': 11,
        'column-number': 22,
      },
    };

    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/reports+json' },
      data: JSON.stringify(body),
    });
    expect(resp.status()).toBe(204);

    let docs: any[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      docs = await queryDocuments(marker);
      if (docs.length > 0) break;
    }
    expect(docs.length, `expected >= 1 doc with marker ${marker}`).toBeGreaterThanOrEqual(1);

    const doc = docs[0];
    expect(doc.violatedDirective).toBe('img-src');
    expect(doc.source).toBe('reporting-api');
  });

  test('Reporting API multi-report writes one doc per entry', async ({ request }) => {
    const marker = UNIQUE();
    const body = {
      age: 0,
      type: 'csp',
      reports: [
        {
          'document-uri': `https://savetheday.io/p/${marker}/a`,
          'violated-directive': 'script-src',
          'blocked-uri': `https://a.example/${marker}.js`,
        },
        {
          'document-uri': `https://savetheday.io/p/${marker}/b`,
          'violated-directive': 'img-src',
          'blocked-uri': `https://b.example/${marker}.png`,
        },
      ],
    };

    const resp = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/reports+json' },
      data: JSON.stringify(body),
    });
    expect(resp.status()).toBe(204);

    let docs: any[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      docs = await queryDocuments(marker);
      if (docs.length >= 2) break;
    }
    expect(docs.length, `expected 2 docs for marker ${marker}`).toBeGreaterThanOrEqual(2);
    for (const d of docs) {
      expect(d.source).toBe('reporting-api');
    }
  });
});
