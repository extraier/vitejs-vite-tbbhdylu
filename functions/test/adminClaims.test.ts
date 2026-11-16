import { describe, expect, it } from 'vitest';
import {
  adminMutationLockHeld,
  bootstrapDenial,
  bootstrapLockDecision,
  countAdminsInPage,
  demotionLeavesZeroAdmins,
  grantTargetDenial,
  mergeAdminClaim,
  ownAdminChangeMessage,
  pageHasAdmin,
  parseBootstrapAllowlist,
} from '../src/adminClaims';

describe('mergeAdminClaim', () => {
  it('sets admin without dropping vendor', () => {
    expect(mergeAdminClaim({ vendor: true }, true)).toEqual({
      vendor: true,
      admin: true,
    });
  });

  it('removes admin and keeps vendor', () => {
    expect(mergeAdminClaim({ vendor: true, admin: true }, false)).toEqual({
      vendor: true,
    });
  });

  it('treats a missing claim map as empty', () => {
    expect(mergeAdminClaim(null, true)).toEqual({ admin: true });
  });
});

describe('pageHasAdmin', () => {
  it('is false when this page has no admin', () => {
    expect(pageHasAdmin([
      { customClaims: { vendor: true } },
      { customClaims: null },
    ])).toBe(false);
  });

  it('is true when any user on the page is admin', () => {
    expect(pageHasAdmin([
      { customClaims: { vendor: true } },
      { customClaims: { admin: true } },
    ])).toBe(true);
  });
});

describe('bootstrap allowlist', () => {
  const allowlist = ['owner@example.com'];

  it('parses a comma-separated list and ignores blanks', () => {
    expect(parseBootstrapAllowlist(' Owner@Example.com, ops@example.com ,')).toEqual([
      'owner@example.com',
      'ops@example.com',
    ]);
    expect(parseBootstrapAllowlist('')).toEqual([]);
    expect(parseBootstrapAllowlist(undefined)).toEqual([]);
  });

  it('rejects anonymous, unverified, empty, and non-allowlisted callers', () => {
    expect(bootstrapDenial({ uid: null }, allowlist)).toBe('unauthenticated');
    expect(bootstrapDenial({
      uid: 'anon',
      signInProvider: 'anonymous',
      email: 'owner@example.com',
      emailVerified: true,
    }, allowlist)).toBe('anonymous');
    expect(bootstrapDenial({
      uid: 'u1',
      email: 'owner@example.com',
      emailVerified: false,
      signInProvider: 'password',
    }, allowlist)).toBe('unverified-email');
    expect(bootstrapDenial({
      uid: 'u1',
      email: 'owner@example.com',
      emailVerified: true,
      signInProvider: 'password',
    }, [])).toBe('allowlist-empty');
    expect(bootstrapDenial({
      uid: 'u1',
      email: 'other@example.com',
      emailVerified: true,
      signInProvider: 'password',
    }, allowlist)).toBe('not-allowlisted');
  });

  it('accepts a verified allowlisted email', () => {
    expect(bootstrapDenial({
      uid: 'u1',
      email: 'Owner@Example.com',
      emailVerified: true,
      signInProvider: 'password',
    }, allowlist)).toBeNull();
  });
});

describe('bootstrap lock', () => {
  it('lets the first caller claim and blocks a concurrent second caller', () => {
    expect(bootstrapLockDecision(null, 'a', 1_000)).toBe('claim');
    expect(bootstrapLockDecision(
      { uid: 'a', status: 'pending', heldAtMs: 1_000 },
      'b',
      1_500,
    )).toBe('taken');
  });

  it('lets the same caller finish a pending attempt and treats complete as terminal', () => {
    expect(bootstrapLockDecision(
      { uid: 'a', status: 'pending', heldAtMs: 1_000 },
      'a',
      2_000,
    )).toBe('same-caller');
    expect(bootstrapLockDecision(
      { uid: 'a', status: 'complete', heldAtMs: 1_000 },
      'a',
      9_999_999,
    )).toBe('taken');
  });
});

describe('last-admin guard', () => {
  it('counts admins on a page', () => {
    expect(countAdminsInPage([
      { customClaims: { admin: true } },
      { customClaims: { admin: true } },
      { customClaims: null },
    ])).toBe(2);
  });

  it('blocks demoting the sole admin and allows demoting one of two', () => {
    expect(demotionLeavesZeroAdmins({
      adminCount: 1,
      targetIsAdmin: true,
      settingAdmin: false,
    })).toBe(true);
    expect(demotionLeavesZeroAdmins({
      adminCount: 2,
      targetIsAdmin: true,
      settingAdmin: false,
    })).toBe(false);
    expect(demotionLeavesZeroAdmins({
      adminCount: 1,
      targetIsAdmin: true,
      settingAdmin: true,
    })).toBe(false);
  });

  it('names selfPromoteAdmin instead of the phantom setMyAdminSelf helper', () => {
    expect(ownAdminChangeMessage(false)).toContain('selfPromoteAdmin');
    expect(ownAdminChangeMessage(false)).not.toContain('setMyAdminSelf');
    expect(ownAdminChangeMessage(true)).toContain('another admin');
  });

  it('refuses to promote an anonymous or unverified account', () => {
    expect(grantTargetDenial({
      email: null,
      emailVerified: false,
      providerIds: ['anonymous'],
    }, true)).toBe('anonymous');
    expect(grantTargetDenial({
      email: 'person@example.com',
      emailVerified: false,
      providerIds: ['password'],
    }, true)).toBe('unverified-email');
    expect(grantTargetDenial({
      email: 'person@example.com',
      emailVerified: true,
      providerIds: ['password'],
    }, true)).toBeNull();
    expect(grantTargetDenial({
      email: null,
      emailVerified: false,
      providerIds: ['anonymous'],
    }, false)).toBeNull();
  });

  it('treats a fresh mutation lock as held and a stale one as free', () => {
    expect(adminMutationLockHeld({ heldAtMs: 1_000 }, 1_500, 120_000)).toBe(true);
    expect(adminMutationLockHeld({ heldAtMs: 1_000 }, 200_000, 120_000)).toBe(false);
    expect(adminMutationLockHeld(null, 1_000)).toBe(false);
  });
});
