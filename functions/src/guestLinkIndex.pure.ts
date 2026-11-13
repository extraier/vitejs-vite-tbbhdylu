/** Path index so redeem/revoke can address one guestLinks doc without a collection-group scan. */

export function guestLinkIndexDocPath(appId: string, linkId: string): string {
  return `artifacts/${appId}/guestLinkIndex/${linkId}`;
}

export function guestLinkDocPath(appId: string, ownerUid: string, linkId: string): string {
  return `artifacts/${appId}/users/${ownerUid}/guestLinks/${linkId}`;
}

export function readGuestLinkIndexPath(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const path = data?.path;
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith('artifacts/')) return null;
  if (!trimmed.includes('/guestLinks/')) return null;
  return trimmed;
}
