import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checklist = readFileSync(path.join(root, 'DEPLOY_CHECKLIST.md'), 'utf8');
const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));

describe('deploy checklist cloudflared section', () => {
  it('points at the in-repo config and the ingress test, not a missing deploy script', () => {
    expect(checklist).toMatch(/Last revised: 2026-11-13/);
    expect(checklist).toContain('deploy/cloudflared/config.yml');
    expect(checklist).toContain('scripts/test-cloudflared-ingress.test.mjs');
    expect(checklist).toContain('rsync deploy/cloudflared/config.yml');
    expect(checklist).not.toContain('scripts/deploy-cloudflared.sh');
    expect(checklist).not.toContain('It is NOT in source control today');
  });
});

describe('tracked env ignore', () => {
  it('ignores .env.deploy', () => {
    expect(ignore.split('\n')).toContain('.env.deploy');
  });
});

describe('report-only CSP', () => {
  it('drops unsafe-inline and unsafe-eval from script-src without enforcing the policy', () => {
    const header = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(header).toBeTruthy();
    expect(vercel.headers[0].headers.some((h) => h.key === 'Content-Security-Policy')).toBe(false);
    const scriptSrc = header.value.split(';').map((p) => p.trim()).find((p) => p.startsWith('script-src '));
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(header.value).toContain("style-src 'self' 'unsafe-inline'");
  });
});
