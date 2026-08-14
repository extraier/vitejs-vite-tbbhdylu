// @vitest-environment node
/**
 * Tests for the Vercel CSP-report endpoint (api/csp-report.js).
 *
 * We only test the pure `normalizeReport` function — the actual
 * handler's Firestore writes + rate-limit are best tested by a
 * live curl probe against the deployed Vercel instance (see
 * verify-csp-report.sh). The pure-function tests cover the
 * risky parts: size caps, malformed bodies, legacy vs Reporting
 * API format detection, and field trimming.
 *
 * Why we don't mock firebase-admin here:
 * The handler's Firestore path is straightforward
 * (db.batch().set(ref, ...)). Mocking the entire
 * firebase-admin/firestore API would be more code than the
 * handler. Instead, the live verify-csp-report.sh probe
 * confirms the writes work end-to-end against production.
 *
 * 2026-08-14 — M-06 follow-up. The endpoint was added because
 * the `report-uri /api/csp-report` in vercel.json had no
 * handler (returned 405) and Chrome was silently dropping
 * CSP violation reports.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { normalizeReport, classifyReports, readRawBody } from './csp-report.js';

describe('normalizeReport — legacy application/csp-report', () => {
  it('extracts the inner csp-report fields', () => {
    const out = normalizeReport(
      {
        'csp-report': {
          'document-uri': 'https://savetheday.io/p/foo',
          'violated-directive': 'script-src-elem',
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example/x.js',
          disposition: 'report',
          'source-file': 'https://savetheday.io/p/foo',
          'line-number': 42,
          'column-number': 13,
        },
      },
      'legacy-csp-report',
    );
    expect(out).toMatchObject({
      documentUri: 'https://savetheday.io/p/foo',
      violatedDirective: 'script-src-elem',
      effectiveDirective: 'script-src',
      blockedUri: 'https://evil.example/x.js',
      disposition: 'report',
      sourcePolicy: 'https://savetheday.io/p/foo',
      lineNumber: 42,
      columnNumber: 13,
      source: 'legacy-csp-report',
    });
    expect(out.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null when input is null/undefined', () => {
    expect(normalizeReport(null, 'legacy-csp-report')).toBe(null);
    expect(normalizeReport(undefined, 'legacy-csp-report')).toBe(null);
  });

  it('returns null when csp-report is not an object', () => {
    expect(normalizeReport({ 'csp-report': 'string' }, 'legacy-csp-report')).toBe(null);
    expect(normalizeReport({ 'csp-report': 42 }, 'legacy-csp-report')).toBe(null);
  });

  it('returns the empty-shape object when input is {}', () => {
    // An empty report is still a valid report — it just has no
    // violation metadata. The handler treats it as a real
    // report and writes a row, but most fields are empty.
    const out = normalizeReport({}, 'legacy-csp-report');
    expect(out).toMatchObject({
      violatedDirective: '',
      effectiveDirective: '',
      documentUri: '',
      blockedUri: '',
      sourcePolicy: '',
      lineNumber: null,
      columnNumber: null,
      disposition: 'report',
    });
  });

  it('defaults missing fields when csp-report is empty', () => {
    const out = normalizeReport({ 'csp-report': {} }, 'legacy-csp-report');
    expect(out).toMatchObject({
      violatedDirective: '',
      effectiveDirective: '',
      documentUri: '',
      blockedUri: '',
      sourcePolicy: '',
      lineNumber: null,
      columnNumber: null,
      disposition: 'report',
    });
  });

  it('trims string fields to 1 KB', () => {
    const longUri = 'https://example.com/' + 'a'.repeat(2048);
    const out = normalizeReport(
      { 'csp-report': { 'document-uri': longUri } },
      'legacy-csp-report',
    );
    expect(out.documentUri.length).toBe(1024);
  });

  it('falls back to disposition=report when missing', () => {
    const out = normalizeReport(
      { 'csp-report': { 'document-uri': 'x' } },
      'legacy-csp-report',
    );
    expect(out.disposition).toBe('report');
  });

  it('preserves disposition=enforce when present', () => {
    const out = normalizeReport(
      { 'csp-report': { 'document-uri': 'x', disposition: 'enforce' } },
      'legacy-csp-report',
    );
    expect(out.disposition).toBe('enforce');
  });
});

describe('normalizeReport — Reporting API (application/reports+json)', () => {
  it('extracts the body field', () => {
    const out = normalizeReport(
      {
        type: 'csp',
        body: {
          'document-uri': 'https://savetheday.io/p/bar',
          'violated-directive': 'img-src https://cdn.savetheday.io',
          'blocked-uri': 'https://othercdn.example/x.png',
        },
      },
      'reporting-api',
    );
    expect(out).toMatchObject({
      documentUri: 'https://savetheday.io/p/bar',
      violatedDirective: 'img-src https://cdn.savetheday.io',
      blockedUri: 'https://othercdn.example/x.png',
      source: 'reporting-api',
    });
  });

  it('does not gate on type field (handler is responsible for filtering)', () => {
    // The handler actually filters by `r.type === 'csp'` BEFORE
    // calling normalizeReport, but the pure function still
    // handles non-csp reports defensively. This documents that
    // contract: normalizeReport is shape-only, not type-aware.
    const out = normalizeReport(
      {
        type: 'coep',
        body: { 'document-uri': 'https://x' },
      },
      'reporting-api',
    );
    expect(out.documentUri).toBe('https://x');
  });
});

describe('normalizeReport — defensive edge cases', () => {
  it('does not throw when blocked-uri is not a string', () => {
    expect(() =>
      normalizeReport(
        { 'csp-report': { 'blocked-uri': { malicious: true } } },
        'legacy-csp-report',
      ),
    ).not.toThrow();
  });

  it('returns null for non-object inputs', () => {
    expect(normalizeReport('', 'legacy-csp-report')).toBe(null);
    expect(normalizeReport(42, 'legacy-csp-report')).toBe(null);
    expect(normalizeReport(true, 'legacy-csp-report')).toBe(null);
  });

  it('returns the empty-shape object for [] (array)', () => {
    // Edge case: if the browser sends an array (e.g. wrapped
    // reporting API), we don't unwrap it — we treat it as an
    // empty report. The handler handles arrays separately.
    const out = normalizeReport([], 'legacy-csp-report');
    expect(out).toMatchObject({ violatedDirective: '', disposition: 'report' });
  });

  it('coerces line-number to null when it is a string', () => {
    // Defensive: many browsers send these as strings.
    const out = normalizeReport(
      { 'csp-report': { 'line-number': '42' } },
      'legacy-csp-report',
    );
    expect(out.lineNumber).toBe(null);
  });

  it('trims script-sample to 1 KB', () => {
    const longSample = 'var x = ' + '"a"'.repeat(1024) + ';';
    const out = normalizeReport(
      { 'csp-report': { 'script-sample': longSample } },
      'legacy-csp-report',
    );
    expect(out.sample.length).toBe(1024);
  });
});

describe('readRawBody — chunk-buffered stream reader', () => {
  // Helper: build a fake IncomingMessage-like stream from a string.
  // Vercel handoffs the raw body via the underlying Node stream,
  // so we mimic that shape.
  function mockReq(body) {
    const stream = new Readable({ read() {} });
    if (body != null) {
      stream.push(Buffer.from(body, 'utf8'));
      stream.push(null);
    }
    return stream;
  }

  it('buffers a single chunk into a string', async () => {
    const req = mockReq('{"csp-report": {"violated-directive": "x"}}');
    const out = await readRawBody(req);
    expect(typeof out).toBe('string');
    expect(out).toBe('{"csp-report": {"violated-directive": "x"}}');
  });

  it('returns null when the stream is empty', async () => {
    // Close an empty stream immediately.
    const stream = new Readable({ read() {} });
    stream.push(null);
    const out = await readRawBody(stream);
    expect(out).toBe(null);
  });

  it('buffers multiple chunks in order', async () => {
    const stream = new Readable({ read() {} });
    stream.push('{"csp-');
    stream.push('report": {"violated-');
    stream.push('directive": "x"}}');
    stream.push(null);
    const out = await readRawBody(stream);
    expect(out).toBe('{"csp-report": {"violated-directive": "x"}}');
  });

  it('rejects when the body exceeds MAX_BODY_BYTES (8 KB)', async () => {
    const stream = new Readable({ read() {} });
    // Push one chunk that's already over the limit.
    const tooBig = 'a'.repeat(9000);
    stream.push(Buffer.from(tooBig, 'utf8'));
    stream.push(null);
    await expect(readRawBody(stream)).rejects.toThrow('body too large');
  });

  it('propagates stream errors', async () => {
    const stream = new Readable({ read() {} });
    // Emit an error asynchronously.
    setImmediate(() => {
      stream.destroy(new Error('connection reset'));
    });
    await expect(readRawBody(stream)).rejects.toThrow('connection reset');
  });
});


describe('classifyReports — body shape detection', () => {
  // The shape detection is the most error-prone piece of the
  // handler. We want each branch tested explicitly so a future
  // refactor doesn't accidentally collapse them. The bug we're
  // guarding against: the single-report Reporting API wrapper
  // (`{ age, type, url, body: {...} }`) was being misclassified
  // as legacy because the inner fields match the legacy shape.

  it('returns [] for null/undefined', () => {
    expect(classifyReports(null)).toEqual([]);
    expect(classifyReports(undefined)).toEqual([]);
  });

  it('returns [] for arrays (handler treats them as no-op)', () => {
    expect(classifyReports([])).toEqual([]);
    expect(classifyReports([{ 'csp-report': {} }])).toEqual([]);
  });

  it('returns [] for non-object inputs', () => {
    expect(classifyReports('string')).toEqual([]);
    expect(classifyReports(42)).toEqual([]);
    expect(classifyReports(true)).toEqual([]);
  });

  it('classifies the legacy application/csp-report wrapper', () => {
    const out = classifyReports({
      'csp-report': {
        'document-uri': 'https://savetheday.io/p/foo',
        'violated-directive': 'script-src-elem',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('legacy-csp-report');
    expect(out[0].documentUri).toBe('https://savetheday.io/p/foo');
  });

  it('classifies the Reporting API multi-report envelope', () => {
    const out = classifyReports({
      age: 100,
      type: 'csp',
      reports: [
        { 'document-uri': 'https://a', 'violated-directive': 'script-src' },
        { 'document-uri': 'https://b', 'violated-directive': 'img-src' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe('reporting-api');
    expect(out[1].source).toBe('reporting-api');
  });

  it('classifies the Reporting API single-report envelope (the bug case)', () => {
    // Before M-06 follow-up, this shape fell through to the
    // legacy branch and got tagged `source: 'legacy-csp-report'`.
    const out = classifyReports({
      age: 0,
      type: 'csp',
      url: 'https://savetheday.io/p/single',
      body: {
        'document-uri': 'https://savetheday.io/p/single',
        'violated-directive': 'img-src',
        'blocked-uri': 'https://othercdn.example/x.png',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('reporting-api');
    expect(out[0].documentUri).toBe('https://savetheday.io/p/single');
    expect(out[0].blockedUri).toBe('https://othercdn.example/x.png');
  });

  it('drops malformed entries in multi-report envelopes', () => {
    const out = classifyReports({
      reports: [
        { 'document-uri': 'https://good' },
        null,
        'string',
        { 'document-uri': 'https://also-good' },
      ],
    });
    expect(out).toHaveLength(2);
  });

  it('returns [] when body is not an object', () => {
    // Some browsers send the single-report envelope with body=null
    // or missing. We should NOT misclassify that as legacy.
    expect(classifyReports({ body: null })).toEqual([]);
    expect(classifyReports({ body: 'string' })).toEqual([]);
    expect(classifyReports({ body: 42 })).toEqual([]);
  });
});
