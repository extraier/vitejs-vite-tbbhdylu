import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legalNoticeKey, legalNoticeTitle } from './legalNotice';

describe('legalNoticeKey', () => {
  it('recognises the privacy, terms, and vendor-terms paths the product already links to', () => {
    expect(legalNoticeKey('/privacy')).toBe('privacy');
    expect(legalNoticeKey('/terms')).toBe('terms');
    expect(legalNoticeKey('/tos')).toBe('tos');
    expect(legalNoticeKey('/vendor-terms/')).toBe('vendor-terms');
  });

  it('does not treat the login shell as a legal page', () => {
    expect(legalNoticeKey('/')).toBeNull();
    expect(legalNoticeKey('/forgot-password')).toBeNull();
  });
});

describe('legal page wiring', () => {
  it('does not exclude /privacy from the app, and does not publish the FoodSwipe policy', () => {
    const root = process.cwd();
    const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
    const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
    expect(vercel).not.toContain('privacy|');
    expect(existsSync(join(root, 'public/privacy.html'))).toBe(false);
    expect(app).toContain('legalNoticeKey(');
    expect(app).toContain('authEntryState(');
  });
});
describe('legalNoticeTitle', () => {
  it('names the page without adding policy clauses', () => {
    expect(legalNoticeTitle('privacy')).toEqual({ zh: '私隱', en: 'Privacy' });
    expect(legalNoticeTitle('vendor-terms').zh).toBe('商戶服務條款');
  });
});
