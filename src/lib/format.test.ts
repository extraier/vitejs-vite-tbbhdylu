// Unit tests for src/lib/format.ts
// ===============================
// Pure-logic money-formatting helpers. No Firebase calls.
//
// 2026-08-08 — added coverage for formatBudgetString (the
// free-form budget display in the vendor board listings).

import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatMoney,
  parseFormattedNumber,
  formatBudgetString,
  formatVendorPrice,
  budgetFitTier,
  budgetDistance,
} from './format';

describe('formatNumber', () => {
  it('inserts commas every 3 digits', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
  it('handles small numbers', () => {
    expect(formatNumber(100)).toBe('100');
    expect(formatNumber(0)).toBe('0');
  });
  it('accepts strings', () => {
    expect(formatNumber('1234567')).toBe('1,234,567');
  });
  it('returns "0" for null / undefined / empty / NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber('')).toBe('0');
    expect(formatNumber('not a number')).toBe('0');
  });
});

describe('formatMoney', () => {
  it('prepends $', () => {
    expect(formatMoney(1234567)).toBe('$1,234,567');
  });
  it('returns "$0" for empty / null', () => {
    expect(formatMoney(null)).toBe('$0');
    expect(formatMoney(undefined)).toBe('$0');
  });
});

describe('parseFormattedNumber', () => {
  it('strips commas and parses', () => {
    expect(parseFormattedNumber('1,234,567')).toBe(1234567);
  });
  it('handles arbitrary separators (strips commas + decimals)', () => {
    expect(parseFormattedNumber('1,234,567.89')).toBe(123456789);
  });
  it('returns 0 for empty / null', () => {
    expect(parseFormattedNumber('')).toBe(0);
    expect(parseFormattedNumber('null')).toBe(0);
  });
});

describe('formatVendorPrice', () => {
  it('formats a normal range', () => {
    expect(
      formatVendorPrice({ priceMin: 8000, priceMax: 18000, currency: 'HKD' }),
    ).toBe('HKD $8,000 - $18,000');
  });
  it('formats open-ended top as "$X+"', () => {
    expect(
      formatVendorPrice({ priceMin: 18000, priceMax: null, currency: 'HKD' }),
    ).toBe('HKD $18,000+');
  });
  it('formats price-on-request (priceMin=0) as "價格另議"', () => {
    expect(
      formatVendorPrice({ priceMin: 0, priceMax: null, currency: 'HKD' }),
    ).toBe('HKD 價格另議');
  });
  it('falls back to legacy price string', () => {
    expect(formatVendorPrice({ price: '電話報價' })).toBe('電話報價');
  });
  it('defaults currency to HKD', () => {
    expect(formatVendorPrice({ priceMin: 1000, priceMax: 2000 })).toBe(
      'HKD $1,000 - $2,000',
    );
  });
});

describe('budgetFitTier', () => {
  it('returns 0 when range contains the budget exactly', () => {
    expect(budgetFitTier({ priceMin: 8000, priceMax: 18000 }, 10000)).toBe(0);
  });
  it('returns 1 when range is fully under budget', () => {
    expect(budgetFitTier({ priceMin: 5000, priceMax: 8000 }, 10000)).toBe(1);
  });
  it('returns 2 when slightly over (within 20%)', () => {
    expect(budgetFitTier({ priceMin: 11000, priceMax: 12000 }, 10000)).toBe(2);
  });
  it('returns 3 when way over', () => {
    expect(budgetFitTier({ priceMin: 50000, priceMax: 60000 }, 10000)).toBe(3);
  });
  it('returns 4 when no budget / no vendor price', () => {
    expect(budgetFitTier({ priceMin: 1000 }, null)).toBe(4);
    expect(budgetFitTier({}, 10000)).toBe(4);
  });
});

describe('budgetDistance', () => {
  it('returns Infinity for missing inputs', () => {
    expect(budgetDistance({}, 10000)).toBe(Infinity);
    expect(budgetDistance({ priceMin: 1000 }, null)).toBe(Infinity);
  });
  it('returns infinity when priceMin=0 (price-on-request)', () => {
    expect(budgetDistance({ priceMin: 0, priceMax: null }, 10000)).toBe(Infinity);
  });
  it('computes |midpoint - budget|', () => {
    // midpoint = (8000 + 18000) / 2 = 13000
    // dist = |13000 - 10000| = 3000
    expect(budgetDistance({ priceMin: 8000, priceMax: 18000 }, 10000)).toBe(3000);
  });
  it('uses priceMin * 1.5 for open-ended top', () => {
    // midpoint = 18000 * 1.5 = 27000
    // dist = |27000 - 10000| = 17000
    expect(budgetDistance({ priceMin: 18000, priceMax: null }, 10000)).toBe(17000);
  });
});

describe('formatBudgetString', () => {
  it('adds commas to a single number', () => {
    expect(formatBudgetString('10000')).toBe('10,000');
  });
  it('adds commas to each number in a range', () => {
    expect(formatBudgetString('10000-20000')).toBe('10,000-20,000');
  });
  it('preserves a currency prefix', () => {
    expect(formatBudgetString('HK$10000')).toBe('HK$10,000');
    expect(formatBudgetString('$10000')).toBe('$10,000');
  });
  it('leaves already-formatted strings unchanged (idempotent)', () => {
    expect(formatBudgetString('$20,000 - $30,000')).toBe('$20,000 - $30,000');
    expect(formatBudgetString('10,000 - 20,000')).toBe('10,000 - 20,000');
  });
  it('passes through strings with no numbers', () => {
    expect(formatBudgetString('面議')).toBe('面議');
    expect(formatBudgetString('電話報價')).toBe('電話報價');
  });
  it('preserves Chinese suffix characters', () => {
    expect(formatBudgetString('10000起')).toBe('10,000起');
    expect(formatBudgetString('HK$10000左右')).toBe('HK$10,000左右');
  });
  it('handles 7-digit numbers', () => {
    expect(formatBudgetString('1234567')).toBe('1,234,567');
  });
  it('does NOT touch numbers below 1000', () => {
    expect(formatBudgetString('999')).toBe('999');
    expect(formatBudgetString('100')).toBe('100');
  });
  it('returns em-dash for empty / null / undefined', () => {
    expect(formatBudgetString('')).toBe('—');
    expect(formatBudgetString(null)).toBe('—');
    expect(formatBudgetString(undefined)).toBe('—');
  });
  it('accepts a number (not just a string)', () => {
    expect(formatBudgetString(10000)).toBe('10,000');
  });
  it('does not split floats below 1000', () => {
    expect(formatBudgetString('12.5')).toBe('12.5');
  });
  it('is idempotent: running twice yields the same string', () => {
    const once = formatBudgetString('10000');
    const twice = formatBudgetString(once);
    expect(twice).toBe(once);
  });
});
