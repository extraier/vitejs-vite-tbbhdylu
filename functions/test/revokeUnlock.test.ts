import { describe, expect, it } from 'vitest';
import { anyActivePremiumUnlock, computeEntitlement } from '../src/entitlementResolver';
import { buildUnlockRevocation } from '../src/unlocks';

describe('revokeUnlock patch', () => {
  it('marks the unlock revoked and already expired so entitlement stops', () => {
    const now = 1_700_000_000_000;
    const patch = buildUnlockRevocation(now, 'admin-1');
    expect(patch).toEqual({
      revoked: true,
      revokedBy: 'admin-1',
      expiresAt: now,
    });

    const unlock = {
      type: 'custom-template' as const,
      source: 'paid' as const,
      paymentId: 'rcpt-1',
      ...patch,
    };
    const entitlement = computeEntitlement('owner-1', 'event-1', [unlock], now);
    expect(entitlement.features.customInvitation).toBe(false);
    expect(entitlement.features.watermarkRemoved).toBe(false);
    expect(entitlement.features.extraStorage).toBe(false);
    expect(entitlement.features.lifetimeRetention).toBe(false);
    expect(anyActivePremiumUnlock([unlock], now)).toBe(false);
  });

  it('keeps tier-worthy premium when a different unlock is still active', () => {
    const now = 1_700_000_000_000;
    const revoked = {
      type: 'custom-template',
      source: 'paid',
      ...buildUnlockRevocation(now, 'admin-1'),
    };
    const still = { type: 'watermark-removed', source: 'referral', expiresAt: null };
    expect(anyActivePremiumUnlock([revoked, still], now)).toBe(true);
    const entitlement = computeEntitlement('owner-1', 'event-1', [revoked, still], now);
    expect(entitlement.features.customInvitation).toBe(false);
    expect(entitlement.features.watermarkRemoved).toBe(true);
  });
});
