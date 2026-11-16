import { describe, expect, it } from 'vitest';
import { guestPortalLinkProblem } from './guestPortalLink';

describe('guestPortalLinkProblem', () => {
  it('is quiet outside guest mode and while redemption is in flight', () => {
    expect(guestPortalLinkProblem({
      isGuestMode: false,
      redeemStatus: 'error',
      bootstrapFailed: true,
      hasGuest: false,
    })).toBeNull();
    expect(guestPortalLinkProblem({
      isGuestMode: true,
      redeemStatus: 'pending',
      bootstrapFailed: false,
      hasGuest: false,
    })).toBeNull();
  });

  it('surfaces a failed share-token redemption', () => {
    expect(guestPortalLinkProblem({
      isGuestMode: true,
      redeemStatus: 'error',
      bootstrapFailed: false,
      hasGuest: false,
    })).toBe('redeem-failed');
  });

  it('surfaces a bootstrap failure once redemption succeeded and no guest loaded', () => {
    expect(guestPortalLinkProblem({
      isGuestMode: true,
      redeemStatus: 'ok',
      bootstrapFailed: true,
      hasGuest: false,
    })).toBe('bootstrap-failed');
    expect(guestPortalLinkProblem({
      isGuestMode: true,
      redeemStatus: 'ok',
      bootstrapFailed: true,
      hasGuest: true,
    })).toBeNull();
  });
});
