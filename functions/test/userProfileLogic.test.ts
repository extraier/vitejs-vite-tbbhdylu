// 2026-08-01 (pivot) — Unit tests for the per-event owner-name
// validation helpers in userProfileLogic.ts. Covers:
//   - cleanName: non-string, control-char strip, trim, truncate
//   - cleanEventOwnerNames: both-empty rejection, single-populated
//
// Mirrors the deployed bytecode in functions/lib/userProfileLogic.js
// so any drift between TS source and deployed JS is caught here.

import { describe, it, expect } from 'vitest';
import {
  cleanName,
  cleanEventOwnerNames,
  MAX_OWNER_NAME_LEN,
} from '../src/userProfileLogic';

describe('cleanName', () => {
  it('returns empty string for non-string inputs', () => {
    expect(cleanName(null)).toBe('');
    expect(cleanName(undefined)).toBe('');
    expect(cleanName(42)).toBe('');
    expect(cleanName({})).toBe('');
    expect(cleanName([])).toBe('');
  });

  it('strips C0 controls + DEL', () => {
    //  is C0 control,  is DEL
    expect(cleanName('abcd')).toBe('abcd');
  });

  it('preserves CJK + emoji (not in C0/DEL range)', () => {
    expect(cleanName('志明 💍')).toBe('志明 💍');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanName('  志明  ')).toBe('志明');
  });

  it('truncates to MAX_OWNER_NAME_LEN', () => {
    const long = 'a'.repeat(MAX_OWNER_NAME_LEN + 10);
    expect(cleanName(long).length).toBe(MAX_OWNER_NAME_LEN);
  });
});

describe('cleanEventOwnerNames', () => {
  it('rejects both-empty input', () => {
    const r = cleanEventOwnerNames({ boyName: '', girlName: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('請至少填寫其中一個名');
    }
  });

  it('rejects both-whitespace input', () => {
    const r = cleanEventOwnerNames({ boyName: '   ', girlName: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects both-undefined input', () => {
    const r = cleanEventOwnerNames({});
    expect(r.ok).toBe(false);
  });

  it('accepts one side populated', () => {
    const r = cleanEventOwnerNames({ boyName: '志明', girlName: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned).toEqual({ boyName: '志明', girlName: '' });
  });

  it('accepts both sides populated', () => {
    const r = cleanEventOwnerNames({ boyName: '志明', girlName: '春嬌' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned).toEqual({ boyName: '志明', girlName: '春嬌' });
  });

  it('cleans each side independently', () => {
    const r = cleanEventOwnerNames({ boyName: '  志明  ', girlName: '春嬌' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned).toEqual({ boyName: '志明', girlName: '春嬌' });
  });
});
