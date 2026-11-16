import { describe, expect, it } from 'vitest';
import {
  buildHelperReinviteDoc,
  classifyExistingHelperInvite,
  dedupeHelperAssignments,
  projectHelperAssignmentForCaller,
  resolveHelperInviteAcceptance,
} from '../src/helperInvitePure';

const APP = 'savetheday-production';
const owner = 'owner-real';
const attacker = 'attacker-uid';
const helperEmail = 'helper@example.com';

function pathFor(userId: string, inviteId = helperEmail) {
  return `artifacts/${APP}/users/${userId}/pendingInvites/${inviteId}`;
}

const realInvite = {
  kind: 'helper',
  ownerUid: owner,
  eventId: 'event-1',
  email: helperEmail,
  displayName: '幫手',
  perms: { canViewGuestList: true, canEditGuests: false },
  status: 'invited',
};

describe('resolveHelperInviteAcceptance', () => {
  it('accepts a real invite whose body owner matches the path owner', () => {
    const decision = resolveHelperInviteAcceptance({
      path: pathFor(owner),
      data: realInvite,
      authEmail: 'Helper@Example.com',
    });
    expect(decision).toEqual({
      ok: true,
      ownerUid: owner,
      eventId: 'event-1',
      email: helperEmail,
      perms: realInvite.perms,
    });
  });

  it('rejects a forge that points ownerUid at another wedding', () => {
    const decision = resolveHelperInviteAcceptance({
      path: pathFor(attacker),
      data: {
        ...realInvite,
        ownerUid: owner,
        perms: { canEditGuests: true, canViewGiftAmount: true },
      },
      authEmail: helperEmail,
    });
    expect(decision).toEqual({ ok: false, reason: 'owner-mismatch' });
  });

  it('rejects a vendor pendingInvites doc even if kind is helper', () => {
    const decision = resolveHelperInviteAcceptance({
      path: 'vendors/some-slug/pendingInvites/invite-1',
      data: { ...realInvite, ownerUid: attacker },
      authEmail: helperEmail,
    });
    expect(decision).toEqual({ ok: false, reason: 'not-helper-path' });
  });

  it('rejects invites that are not kind helper', () => {
    expect(
      resolveHelperInviteAcceptance({
        path: pathFor(owner),
        data: { ...realInvite, kind: 'vendor' },
        authEmail: helperEmail,
      }),
    ).toEqual({ ok: false, reason: 'kind' });

    const { kind: _kind, ...legacy } = realInvite;
    expect(
      resolveHelperInviteAcceptance({
        path: pathFor(owner),
        data: legacy,
        authEmail: helperEmail,
      }),
    ).toEqual({ ok: false, reason: 'kind' });
  });

  it('rejects an invite addressed to a different email', () => {
    expect(
      resolveHelperInviteAcceptance({
        path: pathFor(owner),
        data: realInvite,
        authEmail: 'someone-else@example.com',
      }),
    ).toEqual({ ok: false, reason: 'email' });
  });
});

describe('classifyExistingHelperInvite', () => {
  const helperUid = 'helper-uid';
  const helperPath = `artifacts/${APP}/users/${owner}/helpers/${helperUid}`;
  const invited = {
    ...realInvite,
    helperUid,
    status: 'invited',
  };

  it('accepts the caller\'s own invited helper doc', () => {
    expect(classifyExistingHelperInvite({
      path: helperPath,
      data: invited,
      authUid: helperUid,
      authEmail: 'Helper@Example.com',
    })).toEqual({
      ok: true,
      ownerUid: owner,
      eventId: 'event-1',
      email: helperEmail,
      perms: realInvite.perms,
    });
  });

  it('does not reactivate an active or revoked helper', () => {
    expect(classifyExistingHelperInvite({
      path: helperPath,
      data: { ...invited, status: 'active' },
      authUid: helperUid,
      authEmail: helperEmail,
    })).toEqual({ ok: false, reason: 'status' });
    expect(classifyExistingHelperInvite({
      path: helperPath,
      data: { ...invited, status: 'revoked' },
      authUid: helperUid,
      authEmail: helperEmail,
    })).toEqual({ ok: false, reason: 'status' });
  });

  it('rejects a helper doc filed under someone else\'s uid', () => {
    expect(classifyExistingHelperInvite({
      path: `artifacts/${APP}/users/${owner}/helpers/other-uid`,
      data: { ...invited, helperUid: 'other-uid' },
      authUid: helperUid,
      authEmail: helperEmail,
    })).toEqual({ ok: false, reason: 'uid' });
  });
});

describe('projectHelperAssignmentForCaller', () => {
  const helperUid = 'helper-uid';

  it('shows a pending helper invite and hides a vendor pending invite', () => {
    const pending = projectHelperAssignmentForCaller({
      id: helperEmail,
      path: pathFor(owner),
      data: realInvite,
      authUid: helperUid,
      authEmail: helperEmail,
    });
    expect(pending?.source).toBe('pendingInvites');
    expect(pending?.status).toBe('invited');
    expect(pending?.ownerUid).toBe(owner);

    const vendor = projectHelperAssignmentForCaller({
      id: 'req-1',
      path: 'vendors/some-slug/pendingInvites/req-1',
      data: { ...realInvite, kind: 'helper', ownerUid: helperUid },
      authUid: helperUid,
      authEmail: helperEmail,
    });
    expect(vendor).toBeNull();
  });

  it('shows invited, active, and revoked helper docs for the caller', () => {
    for (const status of ['invited', 'active', 'revoked'] as const) {
      const view = projectHelperAssignmentForCaller({
        id: helperUid,
        path: `artifacts/${APP}/users/${owner}/helpers/${helperUid}`,
        data: { ...realInvite, helperUid, status },
        authUid: helperUid,
        authEmail: helperEmail,
      });
      expect(view?.status).toBe(status);
      expect(view?.source).toBe('helpers');
    }
  });
});

describe('dedupeHelperAssignments', () => {
  it('prefers the helpers row over a pending invite for the same owner', () => {
    const rows = dedupeHelperAssignments([
      { ownerUid: owner, source: 'pendingInvites' as const, status: 'invited' },
      { ownerUid: owner, source: 'helpers' as const, status: 'active' },
      { ownerUid: 'other', source: 'pendingInvites' as const, status: 'invited' },
    ]);
    expect(rows).toEqual([
      { ownerUid: owner, source: 'helpers', status: 'active' },
      { ownerUid: 'other', source: 'pendingInvites', status: 'invited' },
    ]);
  });
});

describe('buildHelperReinviteDoc', () => {
  const next = {
    ...realInvite,
    status: 'invited',
    helperUid: 'helper-uid',
    acceptedAt: null,
    revokedAt: null,
    perms: { canScan: true },
  };

  it('does not demote an active helper', () => {
    const planned = buildHelperReinviteDoc({
      existing: {
        status: 'active',
        acceptedAt: 111,
        revokedAt: null,
        helperUid: 'helper-uid',
        perms: { canViewGuestList: true },
      },
      next,
    });
    expect(planned.preservedActive).toBe(true);
    expect(planned.doc.status).toBe('active');
    expect(planned.doc.acceptedAt).toBe(111);
    expect(planned.doc.helperUid).toBe('helper-uid');
    expect(planned.doc.perms).toEqual({ canScan: true });
  });

  it('re-invites a revoked helper', () => {
    const planned = buildHelperReinviteDoc({
      existing: { status: 'revoked', acceptedAt: 111, revokedAt: 222, helperUid: 'helper-uid' },
      next,
    });
    expect(planned.preservedActive).toBe(false);
    expect(planned.doc.status).toBe('invited');
    expect(planned.doc.acceptedAt).toBeNull();
  });

  it('writes the invited payload when there is no existing doc', () => {
    const planned = buildHelperReinviteDoc({ existing: null, next });
    expect(planned.preservedActive).toBe(false);
    expect(planned.doc).toEqual(next);
  });
});
