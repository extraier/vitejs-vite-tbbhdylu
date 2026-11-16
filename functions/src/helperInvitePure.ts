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

const HELPER_ASSIGNMENT_PATH =
  /^artifacts\/([^/]+)\/users\/([^/]+)\/helpers\/([^/]+)$/;

const HELPER_ASSIGNMENT_STATUSES = new Set(['invited', 'active', 'revoked']);

export type HelperAssignmentSource = 'pendingInvites' | 'helpers';

export type HelperAssignmentView = {
  id: string;
  ownerUid: string;
  email: string;
  displayName: string;
  phone: string | null;
  status: 'invited' | 'active' | 'revoked';
  perms: Record<string, boolean>;
  eventId: string | null;
  eventName: string | null;
  helperUid: string | null;
  source: HelperAssignmentSource;
};

export type ExistingHelperInvite =
  | {
      ok: true;
      ownerUid: string;
      eventId: string;
      email: string;
      perms: Record<string, unknown>;
    }
  | {
      ok: false;
      reason:
        | 'not-helper-path'
        | 'foreign-app'
        | 'empty'
        | 'uid'
        | 'status'
        | 'email'
        | 'event'
        | 'kind'
        | 'perms';
    };

/**
 * A registered invitee already has helpers/{authUid} with status
 * 'invited'. Accept must flip that doc; it is not a pendingInvites
 * row. The document id and helperUid both have to be the caller.
 * Active and revoked docs are not re-opened here — a revoked helper
 * stays revoked until the owner invites them again.
 */
export function classifyExistingHelperInvite(opts: {
  path: string;
  data: Record<string, unknown> | null | undefined;
  authUid: string;
  authEmail: string;
  expectedAppId?: string;
}): ExistingHelperInvite {
  const expectedApp = opts.expectedAppId ?? HELPER_INVITE_APP_ID;
  const match = HELPER_ASSIGNMENT_PATH.exec(opts.path);
  if (!match) return { ok: false, reason: 'not-helper-path' };

  const pathAppId = match[1];
  const pathOwnerUid = match[2];
  const pathHelperUid = match[3];
  if (pathAppId !== expectedApp) return { ok: false, reason: 'foreign-app' };
  if (pathHelperUid !== opts.authUid) return { ok: false, reason: 'uid' };

  const data = opts.data;
  if (!data) return { ok: false, reason: 'empty' };
  if (data.helperUid !== opts.authUid) return { ok: false, reason: 'uid' };
  if (data.status !== 'invited') return { ok: false, reason: 'status' };
  if (data.kind !== undefined && data.kind !== 'helper') {
    return { ok: false, reason: 'kind' };
  }

  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const authEmail = opts.authEmail.trim().toLowerCase();
  if (!email || email !== authEmail) return { ok: false, reason: 'email' };

  if (typeof data.eventId !== 'string' || data.eventId.trim().length === 0) {
    return { ok: false, reason: 'event' };
  }
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

function booleanPerms(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'boolean') out[key] = entry;
  }
  return out;
}

/**
 * One row the signed-in helper is allowed to see. Pending invites are
 * accepted only through the path-bound helper invite check. Helper
 * docs must be the caller's own helpers/{uid} row. Vendor
 * pendingInvites never match either path.
 */
export function projectHelperAssignmentForCaller(opts: {
  id: string;
  path: string;
  data: Record<string, unknown> | null | undefined;
  authUid: string;
  authEmail: string;
  expectedAppId?: string;
}): HelperAssignmentView | null {
  const data = opts.data;
  if (!data) return null;

  const pending = resolveHelperInviteAcceptance({
    path: opts.path,
    data,
    authEmail: opts.authEmail,
    expectedAppId: opts.expectedAppId,
  });
  if (pending.ok) {
    const status = data.status;
    return {
      id: opts.id,
      ownerUid: pending.ownerUid,
      email: pending.email,
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
      phone: typeof data.phone === 'string' ? data.phone : null,
      status: status === 'active' || status === 'revoked' || status === 'invited'
        ? status
        : 'invited',
      perms: booleanPerms(data.perms),
      eventId: pending.eventId,
      eventName: typeof data.eventName === 'string' ? data.eventName : null,
      helperUid: typeof data.helperUid === 'string' ? data.helperUid : null,
      source: 'pendingInvites',
    };
  }

  const expectedApp = opts.expectedAppId ?? HELPER_INVITE_APP_ID;
  const match = HELPER_ASSIGNMENT_PATH.exec(opts.path);
  if (!match || match[1] !== expectedApp || match[3] !== opts.authUid) return null;
  if (data.helperUid !== opts.authUid) return null;
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const authEmail = opts.authEmail.trim().toLowerCase();
  if (!email || email !== authEmail) return null;
  if (typeof data.status !== 'string' || !HELPER_ASSIGNMENT_STATUSES.has(data.status)) {
    return null;
  }

  return {
    id: opts.id,
    ownerUid: match[2],
    email,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    phone: typeof data.phone === 'string' ? data.phone : null,
    status: data.status as HelperAssignmentView['status'],
    perms: booleanPerms(data.perms),
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    eventName: typeof data.eventName === 'string' ? data.eventName : null,
    helperUid: opts.authUid,
    source: 'helpers',
  };
}

/**
 * A helpers/{uid} row is the live assignment. A leftover pending
 * invite for the same owner must not shadow it.
 */
export function dedupeHelperAssignments<T extends { ownerUid: string; source: HelperAssignmentSource }>(
  views: readonly T[],
): T[] {
  const byOwner = new Map<string, T>();
  for (const view of views) {
    const prev = byOwner.get(view.ownerUid);
    if (!prev || (prev.source === 'pendingInvites' && view.source === 'helpers')) {
      byOwner.set(view.ownerUid, view);
    }
  }
  return [...byOwner.values()];
}

/**
 * Re-invite writes a full helper doc. An already-active helper keeps
 * status, acceptedAt, and helperUid. Invited and revoked rows take
 * the new invited payload (a revoked helper can be invited again).
 */
export function buildHelperReinviteDoc(opts: {
  existing: Record<string, unknown> | null | undefined;
  next: Record<string, unknown>;
}): { doc: Record<string, unknown>; preservedActive: boolean } {
  const existing = opts.existing;
  if (existing && existing.status === 'active') {
    const helperUid =
      typeof existing.helperUid === 'string' && existing.helperUid
        ? existing.helperUid
        : opts.next.helperUid ?? null;
    return {
      preservedActive: true,
      doc: {
        ...opts.next,
        status: 'active',
        acceptedAt: Object.prototype.hasOwnProperty.call(existing, 'acceptedAt')
          ? existing.acceptedAt
          : null,
        revokedAt: Object.prototype.hasOwnProperty.call(existing, 'revokedAt')
          ? existing.revokedAt
          : null,
        helperUid,
      },
    };
  }
  return { preservedActive: false, doc: { ...opts.next } };
}
