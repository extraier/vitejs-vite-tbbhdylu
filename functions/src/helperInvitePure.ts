/**
 * Path-bound acceptance for helper pending invites.
 *
 * acceptHelperInvite used to copy ownerUid from the document body.
 * A signed-in user could write a pendingInvites doc under their own
 * user and set ownerUid to a victim, then accept it and land in
 * the victim's helpers collection. The path is the authority:
 *
 *   artifacts/{appId}/users/{ownerUid}/pendingInvites/{inviteId}
 *
 * Vendor outreach docs live at vendors/{slug}/pendingInvites and
 * must never be accepted as helper invites, even if a client
 * stamps kind: 'helper' on them.
 */

export const HELPER_INVITE_APP_ID = 'savetheday-production';

const HELPER_INVITE_PATH =
  /^artifacts\/([^/]+)\/users\/([^/]+)\/pendingInvites\/([^/]+)$/;

export type HelperInviteAcceptance = {
  ok: true;
  ownerUid: string;
  eventId: string;
  email: string;
  perms: Record<string, unknown>;
};

export type HelperInviteRejection = {
  ok: false;
  reason:
    | 'not-helper-path'
    | 'foreign-app'
    | 'empty'
    | 'kind'
    | 'owner-mismatch'
    | 'event'
    | 'email'
    | 'perms';
};

export function resolveHelperInviteAcceptance(opts: {
  path: string;
  data: Record<string, unknown> | null | undefined;
  authEmail: string;
  expectedAppId?: string;
}): HelperInviteAcceptance | HelperInviteRejection {
  const expectedApp = opts.expectedAppId ?? HELPER_INVITE_APP_ID;
  const match = HELPER_INVITE_PATH.exec(opts.path);
  if (!match) return { ok: false, reason: 'not-helper-path' };

  const pathAppId = match[1];
  const pathOwnerUid = match[2];
  if (pathAppId !== expectedApp) return { ok: false, reason: 'foreign-app' };

  const data = opts.data;
  if (!data) return { ok: false, reason: 'empty' };

  // Kind is required. Legacy docs without kind, and vendor invites
  // stamped kind: 'vendor' (or anything else), are not accepted.
  if (data.kind !== 'helper') return { ok: false, reason: 'kind' };

  // Body ownerUid is ignored as the write target. If it is present
  // and disagrees with the path, the doc is a forge and is rejected
  // rather than silently rewritten onto the attacker's own account.
  if (data.ownerUid !== pathOwnerUid) return { ok: false, reason: 'owner-mismatch' };

  if (typeof data.eventId !== 'string' || data.eventId.trim().length === 0) {
    return { ok: false, reason: 'event' };
  }

  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const authEmail = opts.authEmail.trim().toLowerCase();
  if (!email || email !== authEmail) return { ok: false, reason: 'email' };

  if (!data.perms || typeof data.perms !== 'object' || Array.isArray(data.perms)) {
    return { ok: false, reason: 'perms' };
  }

  return {
    ok: true,
    ownerUid: pathOwnerUid,
    eventId: data.eventId,
    email,
    perms: data.perms as Record<string, unknown>,
  };
}
