import { describe, expect, it } from 'vitest';
import { resolveHelperInviteAcceptance } from '../src/helperInvitePure';

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
