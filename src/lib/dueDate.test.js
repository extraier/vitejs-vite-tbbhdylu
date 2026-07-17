// Tests for the absolute due-date formatters. Run with `npm test`.

import { describe, it, expect } from 'vitest';
import { formatAbsoluteDue, formatLongAbsoluteDue } from './dueDate.js';

describe('formatAbsoluteDue', () => {
  // Pin "now" so today's date is fixed in the test environment.
  // UTC noon avoids the local-midnight edge case (timezone drift on CI).
  const NOW = new Date('2026-07-17T12:00:00Z');

  it('returns "" for empty dueDate', () => {
    expect(formatAbsoluteDue('', '', NOW)).toBe('');
    expect(formatAbsoluteDue(undefined, undefined, NOW)).toBe('');
    expect(formatAbsoluteDue(null, null, NOW)).toBe('');
  });

  it('formats today as "今天" + time', () => {
    // 2026-07-17 in HK local time may shift to 2026-07-18 if UTC is
    // already past midnight in Asia. We compare in local time, so
    // build the date from y/m/d pieces directly.
    const dateOnly = '2026-07-17';
    // Construct a Date object that represents *local* 2026-07-17.
    const [y, m, d] = dateOnly.split('-').map((n) => parseInt(n, 10));
    const localNowOfDay = new Date(y, m - 1, d, 12, 0, 0);
    expect(formatAbsoluteDue(dateOnly, '14:30', localNowOfDay)).toBe('今天 14:30');
  });

  it('formats tomorrow as "明天"', () => {
    const dateOnly = '2026-07-18';
    const [y, m, d] = dateOnly.split('-').map((n) => parseInt(n, 10));
    const localNow = new Date(2026, 6, 17, 12, 0, 0); // July 17 local
    expect(formatAbsoluteDue(dateOnly, '14:30', localNow)).toBe('明天 14:30');
  });

  it('formats yesterday as "昨天"', () => {
    expect(formatAbsoluteDue('2026-07-16', '14:30', NOW)).toBe('昨天 14:30');
  });

  it('formats day-after-tomorrow as "後天"', () => {
    expect(formatAbsoluteDue('2026-07-19', '', NOW)).toBe('後天');
  });

  it('strips leading zero on the hour part', () => {
    expect(formatAbsoluteDue('2026-07-17', '09:30', new Date(2026, 6, 17, 12, 0, 0)))
      .toBe('今天 9:30');
  });

  it('falls back to "M月D日" for far-out dates with no time', () => {
    expect(formatAbsoluteDue('2026-12-31', '', NOW)).toBe('12月31日');
  });

  it('returns the raw string back if date is malformed', () => {
    expect(formatAbsoluteDue('not-a-date', '', NOW)).toBe('not-a-date');
  });
});

describe('formatLongAbsoluteDue', () => {
  it('returns "" when no date', () => {
    expect(formatLongAbsoluteDue('', '')).toBe('');
    expect(formatLongAbsoluteDue(null, null)).toBe('');
  });

  it('returns just the date when no time', () => {
    expect(formatLongAbsoluteDue('2026-12-31', '')).toBe('2026-12-31');
  });

  it('returns date + space + time when both present', () => {
    expect(formatLongAbsoluteDue('2026-12-31', '14:30')).toBe('2026-12-31 14:30');
  });
});
