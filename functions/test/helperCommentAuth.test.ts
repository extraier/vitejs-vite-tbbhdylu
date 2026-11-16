import { describe, expect, it } from 'vitest';
import { resolveCommentAuthor } from '../src/helperCommentAuth';

const caller = 'helper-uid';

describe('resolveCommentAuthor', () => {
  it('lets an active helper comment when assignedHelperUid matches, with no helper claim', () => {
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: false,
      assignedVendorUid: null,
      assignedHelperUid: caller,
      helperStatus: 'active',
    })).toEqual({ ok: true, role: 'helper' });
  });

  it('lets an active helper comment when they are in assignedHelpers', () => {
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: false,
      assignedVendorUid: 'vendor-1',
      assignedHelperUid: null,
      assignedHelpers: [{ id: 'h1', name: '幫手', uid: caller }],
      helperStatus: 'active',
    })).toEqual({ ok: true, role: 'helper' });
  });

  it('rejects a helper who was invited or revoked, and a uid that is not assigned', () => {
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: false,
      assignedVendorUid: null,
      assignedHelperUid: caller,
      helperStatus: 'invited',
    })).toEqual({ ok: false, reason: 'helper-inactive' });
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: false,
      assignedVendorUid: null,
      assignedHelperUid: caller,
      helperStatus: 'revoked',
    })).toEqual({ ok: false, reason: 'helper-inactive' });
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: false,
      assignedVendorUid: null,
      assignedHelperUid: 'someone-else',
      assignedHelpers: [{ uid: 'someone-else' }],
      helperStatus: 'active',
    })).toEqual({ ok: false, reason: 'unassigned' });
  });

  it('still requires the vendor claim for the vendor branch', () => {
    expect(resolveCommentAuthor({
      callerUid: 'vendor-1',
      vendorClaim: true,
      assignedVendorUid: 'vendor-1',
      assignedHelperUid: null,
      helperStatus: null,
    })).toEqual({ ok: true, role: 'vendor' });
    expect(resolveCommentAuthor({
      callerUid: 'vendor-1',
      vendorClaim: false,
      assignedVendorUid: 'vendor-1',
      assignedHelperUid: null,
      helperStatus: null,
    })).toEqual({ ok: false, reason: 'unassigned' });
    expect(resolveCommentAuthor({
      callerUid: 'vendor-1',
      vendorClaim: true,
      assignedVendorUid: 'other-vendor',
      assignedHelperUid: null,
      helperStatus: null,
    })).toEqual({ ok: false, reason: 'unassigned' });
  });

  it('prefers the vendor role when the same account is the assigned vendor', () => {
    expect(resolveCommentAuthor({
      callerUid: caller,
      vendorClaim: true,
      assignedVendorUid: caller,
      assignedHelperUid: caller,
      helperStatus: 'active',
    })).toEqual({ ok: true, role: 'vendor' });
  });
});
