/**
 * Merge the admin custom claim without dropping vendor or any
 * other claim already on the user.
 */
export function mergeAdminClaim(
  existingClaims: Record<string, unknown> | null | undefined,
  admin: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existingClaims || {}) };
  if (admin) next.admin = true;
  else delete next.admin;
  return next;
}

export function pageHasAdmin(users: Array<{ customClaims?: Record<string, unknown> | null }>): boolean {
  return users.some((user) => user.customClaims?.admin === true);
}
