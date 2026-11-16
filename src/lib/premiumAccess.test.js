import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entitlementIsPremium, invitationOwnerTier } from './premiumAccess';

const freeFeatures = {
  customInvitation: false,
  watermarkRemoved: false,
  extraStorage: false,
  lifetimeRetention: false,
};

describe('entitlementIsPremium', () => {
  it('is false for the free feature set', () => {
    expect(entitlementIsPremium(freeFeatures)).toBe(false);
    expect(entitlementIsPremium(null)).toBe(false);
    expect(entitlementIsPremium(undefined)).toBe(false);
  });

  it('is true when any resolver feature is on', () => {
    for (const key of Object.keys(freeFeatures)) {
      expect(entitlementIsPremium({ ...freeFeatures, [key]: true })).toBe(true);
    }
  });

  it('does not read an event tier flag', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/premiumAccess.js'), 'utf8');
    expect(src).not.toMatch(/\.tier/);
  });
});

describe('invitationOwnerTier', () => {
  it('follows customInvitation only', () => {
    expect(invitationOwnerTier({ customInvitation: true })).toBe('premium');
    expect(invitationOwnerTier({
      ...freeFeatures,
      watermarkRemoved: true,
      extraStorage: true,
    })).toBe('free');
  });
});

describe('premium UI call sites', () => {
  it('does not grant premium from an event tier flag', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
    const dashboard = readFileSync(join(process.cwd(), 'src/screens/EventsDashboard.tsx'), 'utf8');
    expect(app).not.toMatch(/currentEvent\??\.tier/);
    expect(app).not.toMatch(/legacyTierIsPremium/);
    expect(dashboard).not.toMatch(/event\.tier/);
  });
});
