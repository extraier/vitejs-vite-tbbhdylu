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

export function countAdminsInPage(users: Array<{ customClaims?: Record<string, unknown> | null }>): number {
  return users.reduce((count, user) => count + (user.customClaims?.admin === true ? 1 : 0), 0);
}

/**
 * ADMIN_BOOTSTRAP_EMAILS is a comma-separated list of verified
 * emails. Empty, unset, and unparsable values yield an empty
 * allowlist, and an empty allowlist rejects every caller.
 */
export function parseBootstrapAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (!email || !email.includes('@') || email.includes(' ')) continue;
    seen.add(email);
  }
  return [...seen];
}

export interface BootstrapCaller {
  uid?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  signInProvider?: string | null;
}

export type BootstrapDenial =
  | 'unauthenticated'
  | 'anonymous'
  | 'unverified-email'
  | 'allowlist-empty'
  | 'not-allowlisted';

/**
 * Fail closed. Anonymous sessions and unverified emails never
 * pass, even if the allowlist is later populated. An empty
 * allowlist rejects everyone.
 */
export function bootstrapDenial(
  caller: BootstrapCaller,
  allowlist: readonly string[],
): BootstrapDenial | null {
  if (!caller.uid) return 'unauthenticated';
  const email = (caller.email || '').trim().toLowerCase();
  if (caller.signInProvider === 'anonymous' || !email) return 'anonymous';
  if (caller.emailVerified !== true) return 'unverified-email';
  if (allowlist.length === 0) return 'allowlist-empty';
  if (!allowlist.includes(email)) return 'not-allowlisted';
  return null;
}

export interface BootstrapLockDoc {
  uid?: unknown;
  status?: unknown;
  heldAtMs?: unknown;
}

/**
 * One-time bootstrap lock. `complete` is terminal. A pending lock
 * belongs to its holder until pendingTtlMs, then another allowlisted
 * caller may take over a crashed attempt. Two concurrent callers
 * cannot both observe `claim`.
 */
export function bootstrapLockDecision(
  existing: BootstrapLockDoc | null,
  callerUid: string,
  nowMs: number,
  pendingTtlMs = 60_000,
): 'claim' | 'same-caller' | 'taken' {
  if (!existing) return 'claim';
  if (existing.status === 'complete') return 'taken';
  const holder = typeof existing.uid === 'string' ? existing.uid : '';
  if (holder && holder === callerUid) return 'same-caller';
  const heldAt = typeof existing.heldAtMs === 'number' ? existing.heldAtMs : 0;
  if (holder && nowMs - heldAt < pendingTtlMs) return 'taken';
  return 'claim';
}

export function demotionLeavesZeroAdmins(input: {
  adminCount: number;
  targetIsAdmin: boolean;
  settingAdmin: boolean;
}): boolean {
  return input.settingAdmin === false && input.targetIsAdmin && input.adminCount <= 1;
}

/** Replaces the phantom setMyAdminSelf hint. That function does not exist. */
export function ownAdminChangeMessage(callerIsAdmin: boolean): string {
  if (callerIsAdmin) {
    return 'You cannot change your own admin status. Ask another admin.';
  }
  return 'You cannot change your own admin status here. Use selfPromoteAdmin to bootstrap the first admin.';
}

export type GrantTargetDenial = 'anonymous' | 'unverified-email';

/**
 * Promoting someone to admin requires a non-anonymous account
 * with a verified email. Demotion is not gated here (the
 * last-admin check is separate).
 */
export function grantTargetDenial(
  user: {
    email?: string | null;
    emailVerified?: boolean;
    providerIds?: readonly string[] | null;
  },
  settingAdmin: boolean,
): GrantTargetDenial | null {
  if (!settingAdmin) return null;
  const providers = user.providerIds || [];
  const email = (user.email || '').trim();
  if (providers.includes('anonymous') || !email) return 'anonymous';
  if (user.emailVerified !== true) return 'unverified-email';
  return null;
}

export function adminMutationLockHeld(
  existing: { heldAtMs?: unknown } | null,
  nowMs: number,
  ttlMs = 120_000,
): boolean {
  if (!existing || typeof existing.heldAtMs !== 'number') return false;
  return nowMs - existing.heldAtMs < ttlMs;
}
