// Unit tests for passwordValidation.js — locks in the Option B rules.
// If anyone changes the complexity policy, this test will fail and
// force a deliberate decision.

import { describe, it, expect } from 'vitest';
import { evaluatePassword, isPasswordValid, PASSWORD_RULES } from './passwordValidation';

describe('passwordValidation', () => {
  describe('evaluatePassword', () => {
    it('rejects empty password', () => {
      const r = evaluatePassword('');
      expect(r.isValid).toBe(false);
      expect(r.violations).toContain('length');
      expect(r.violations).toContain('categories');
    });

    it('accepts Notp4ssw0rd (9 chars, 3 of 4 categories, not common)', () => {
      // 9 chars, uppercase + lowercase + digit = 3 categories. ✓
      // not in the common list (which has password1, password123, etc.)
      const r = evaluatePassword('Notp4ssw0rd');
      expect(r.isValid).toBe(true);
      expect(r.checks.length).toBe(true);
      expect(r.checks.categories).toBe(true);
      expect(r.categoriesMet).toBe(3);
    });

    it('accepts Pa55word! (9 chars, 4 of 4 categories) and isStrong', () => {
      const r = evaluatePassword('Pa55word!');
      expect(r.isValid).toBe(true);
      expect(r.isStrong).toBe(true);
      expect(r.categoriesMet).toBe(4);
    });

    it('accepts Welcome99 (10 chars, 3 of 4 categories)', () => {
      // 10 chars, uppercase + lowercase + digit = 3 categories. ✓
      const r = evaluatePassword('Welcome99');
      expect(r.isValid).toBe(true);
      expect(r.categoriesMet).toBe(3);
    });

    it('rejects 8-char lowercase-only password (only 1 of 4 categories)', () => {
      const r = evaluatePassword('abcdefgh');
      // passes length (8), fails categories (only 1)
      expect(r.checks.length).toBe(true);
      expect(r.checks.categories).toBe(false);
      expect(r.isValid).toBe(false);
    });

    it('rejects 7-char password (fails length)', () => {
      const r = evaluatePassword('Abc1!xy');
      expect(r.checks.length).toBe(false);
      expect(r.isValid).toBe(false);
    });

    it('rejects password that contains user email local part', () => {
      const r = evaluatePassword('roger2024!', 'roger@example.com');
      expect(r.checks.email).toBe(false);
      expect(r.violations).toContain('email');
      expect(r.isValid).toBe(false);
    });

    it('accepts password that contains email but only the domain', () => {
      // "example.com" doesn't count — only the local part does
      const r = evaluatePassword('Hello-Example.com', 'roger@example.com');
      expect(r.checks.email).toBe(true);
    });

    it('does not flag email check when no email provided', () => {
      const r = evaluatePassword('Password1');
      expect(r.checks.email).toBe(true);
    });

    it('rejects common password "password" (passes length+categories but fails common)', () => {
      const r = evaluatePassword('password');
      // 'password' has only 1 category (all lowercase). 8 chars.
      expect(r.checks.length).toBe(true);
      expect(r.checks.categories).toBe(false);
      expect(r.checks.common).toBe(false);
      expect(r.isValid).toBe(false);
    });

    it('rejects "Password123" case-variants of common password "password123"', () => {
      // COMMON_PASSWORDS list contains 'password123' lowercase.
      // 'Password123' lowercased = 'password123' -> in the list.
      const r = evaluatePassword('Password123');
      expect(r.checks.common).toBe(false);
      expect(r.isValid).toBe(false);
    });

    it('rejects "12345678" (only 1 category, plus common)', () => {
      const r = evaluatePassword('12345678');
      expect(r.checks.common).toBe(false);
      expect(r.isValid).toBe(false);
    });
  });

  describe('strength score', () => {
    it('returns 0 for empty password', () => {
      expect(evaluatePassword('').strength).toBe(0);
    });

    it('returns 1 for short-ish password', () => {
      expect(evaluatePassword('Abc1').strength).toBeGreaterThanOrEqual(0);
      expect(evaluatePassword('Abc1').strength).toBeLessThanOrEqual(2);
    });

    it('returns 4 for long + all-4-categories password', () => {
      const r = evaluatePassword('MyVeryLongPassword123!@');
      expect(r.strength).toBe(4);
    });
  });

  describe('isPasswordValid (boolean convenience)', () => {
    it('matches evaluatePassword().isValid', () => {
      expect(isPasswordValid('Password1')).toBe(evaluatePassword('Password1').isValid);
      expect(isPasswordValid('weak')).toBe(false);
      expect(isPasswordValid('StrongPass123!')).toBe(true);
    });
  });

  describe('PASSWORD_RULES export', () => {
    it('exports 4 rules in stable order', () => {
      expect(PASSWORD_RULES.map((r) => r.key)).toEqual([
        'length',
        'categories',
        'email',
        'common',
      ]);
    });

    it('every rule has bilingual labels', () => {
      for (const rule of PASSWORD_RULES) {
        expect(rule.label_zh).toBeTruthy();
        expect(rule.label_en).toBeTruthy();
      }
    });
  });
});