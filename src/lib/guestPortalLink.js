/**
 * Why the guest portal has nothing to render.
 * `redeem-failed` is verifyShareToken / guest-link redemption.
 * `bootstrap-failed` is a redeemed session whose guest record
 * could not be loaded. Both used to leave the portal on the
 * loading spinner forever.
 *
 * @param {{
 *   isGuestMode: boolean,
 *   redeemStatus: string,
 *   bootstrapFailed: boolean,
 *   hasGuest: boolean,
 * }} input
 * @returns {'redeem-failed' | 'bootstrap-failed' | null}
 */
export function guestPortalLinkProblem(input) {
  if (!input.isGuestMode) return null;
  if (input.redeemStatus === 'error') return 'redeem-failed';
  if (input.redeemStatus === 'ok' && input.bootstrapFailed && !input.hasGuest) {
    return 'bootstrap-failed';
  }
  return null;
}

export const GUEST_LINK_ERROR_MESSAGE =
  '這條嘉賓連結無法使用（可能已失效、過期或被撤銷）。請向新人索取新連結，或按下面再試一次。';
