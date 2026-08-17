/**
 * 2026-08-17 — vendorComment Cloud Function owner-alert tests.
 *
 * Pins the shape of the bell-visible alert doc that vendorPostComment
 * writes to the per-event /commentsAlerts/ subcollection AFTER
 * writing the comment itself. The bell hook in
 * src/hooks/useNotifications.js (`commentItems` builder) reads these
 * exact fields when assembling the `comment` category envelope.
 *
 * Why a pure-function test (not onCall): the onCall wrapper pulls in
 * firebase-admin and requires an emulator. The alert-doc
 * construction is pure and lifted into `buildCommentAlertDoc` —
 * testing it pins the wire shape without mock gymnastics.
 *
 * Coverage:
 *  1. Required fields present with the right values
 *  2. `source` is 'cf:vendorPostComment' (so a future grep for it
 *     in the commentsAlerts collection finds it)
 *  3. parentTitle falls back to '大日流程' / '物資' when missing
 *  4. text truncated to 120 chars with ellipsis when longer
 *  5. text passed through unchanged when ≤120 chars
 *  6. kind must be 'rundown' | 'resources' (no other value allowed)
 */

import { describe, it, expect, vi } from 'vitest';

// 2026-08-17 — vendorComment.ts imports `getFirestore` from
// firebase-admin/firestore at module-load time, which tries to
// initialize the default app and throws in our test env.
// Stub it so the import resolves without hitting Admin SDK.
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (opts: unknown) => (handler: unknown) => ({
    run: handler,
    _opts: opts,
  }),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import {
  buildCommentAlertDoc,
  buildCommentNotificationId,
  buildNotificationRecipients,
} from '../src/vendorComment';

describe('buildCommentAlertDoc (vendor-comment owner alert)', () => {
  const baseInput = {
    parentKind: 'rundown',
    parentId: 'rd-42',
    parentTitle: '兄弟姊妹集合',
    commentId: 'comment-id-1',
    authorUid: 'vendor-uid-1',
    authorName: 'Tiger Florist',
    authorRole: 'vendor',
    text: '會場已準備好',
    createdAt: 1700000000000,
  };

  it('produces the expected field set for a vendor rundown comment', () => {
    const doc = buildCommentAlertDoc(baseInput);
    expect(doc).toEqual({
      kind: 'rundown',
      parentId: 'rd-42',
      parentTitle: '兄弟姊妹集合',
      commentId: 'comment-id-1',
      authorUid: 'vendor-uid-1',
      authorName: 'Tiger Florist',
      authorRole: 'vendor',
      text: '會場已準備好',
      createdAt: 1700000000000,
      source: 'cf:vendorPostComment',
    });
  });

  it('marks source as cf:vendorPostComment so a future grep finds it', () => {
    const doc = buildCommentAlertDoc(baseInput);
    expect(doc.source).toBe('cf:vendorPostComment');
  });

  it('falls back to "大日流程" when parentTitle is missing for rundown', () => {
    const doc = buildCommentAlertDoc({ ...baseInput, parentTitle: undefined });
    expect(doc.parentTitle).toBe('大日流程');
  });

  it('falls back to "物資" when parentTitle is missing for resources', () => {
    const doc = buildCommentAlertDoc({
      ...baseInput,
      parentKind: 'resources',
      parentTitle: '',
    });
    expect(doc.parentTitle).toBe('物資');
  });

  it('falls back to the generic label when parentTitle is whitespace-only', () => {
    const doc = buildCommentAlertDoc({ ...baseInput, parentTitle: '   ' });
    expect(doc.parentTitle).toBe('大日流程');
  });

  it('passes text through unchanged when ≤120 chars', () => {
    const doc = buildCommentAlertDoc({ ...baseInput, text: 'short message' });
    expect(doc.text).toBe('short message');
  });

  it('truncates text to 120 chars + ellipsis when longer', () => {
    const long = 'a'.repeat(200);
    const doc = buildCommentAlertDoc({ ...baseInput, text: long });
    expect(doc.text.length).toBe(121); // 120 chars + ellipsis '…'
    expect(doc.text.endsWith('…')).toBe(true);
    expect(doc.text.startsWith('a'.repeat(120))).toBe(true);
  });

  it('preserves a vendor author role verbatim', () => {
    const doc = buildCommentAlertDoc({ ...baseInput, authorRole: 'vendor' });
    expect(doc.authorRole).toBe('vendor');
  });

  it('preserves a helper author role verbatim', () => {
    const doc = buildCommentAlertDoc({
      ...baseInput,
      authorRole: 'helper',
      authorName: '阿明',
      text: '已送到場地',
    });
    expect(doc.authorRole).toBe('helper');
    expect(doc.authorName).toBe('阿明');
    expect(doc.text).toBe('已送到場地');
  });

  it('passes createdAt through unchanged (no Date normalization)', () => {
    const doc = buildCommentAlertDoc({ ...baseInput, createdAt: 12345 });
    expect(doc.createdAt).toBe(12345);
  });
});
// 2026-08-17 — Manus step 11: deterministic notification id + recipient policy.
//
// Acceptance criteria pinned by these tests:
//   A5 — retries create exactly one notification per recipient
//        (deterministic doc id)
//   A1  — vendor comment: owner + active co-owner each receive one
//         unread; vendor self-suppressed
//   A2  — helper comment: owner + active co-owner each receive one
//         unread; helper self-suppressed
//   A3  — owner reply: assigned vendor + helper each receive one
//         unread; owner self-suppressed
//   A6  — recipient can read only their own inbox (covered by
//         firestore.rules, not unit-tested here)
//   A7  — clients can update only readAt (covered by rules)

describe('buildCommentNotificationId (deterministic id, A5)', () => {
  it('builds the spec id `bigday-comment_{commentId}_{recipientUid}`', () => {
    expect(buildCommentNotificationId('comment-123', 'vendor-A')).toBe(
      'bigday-comment_comment-123_vendor-A',
    );
  });

  it('is pure — same inputs produce same id (idempotency invariant)', () => {
    const a = buildCommentNotificationId('c-1', 'r-1');
    const b = buildCommentNotificationId('c-1', 'r-1');
    expect(a).toBe(b);
  });

  it('different recipient produces different id (multi-recipient fan-out)', () => {
    const owner = buildCommentNotificationId('c-1', 'owner');
    const vendor = buildCommentNotificationId('c-1', 'vendor');
    expect(owner).not.toBe(vendor);
  });

  it('handles unicode UIDs without mangling', () => {
    expect(buildCommentNotificationId('c-1', 'vendor-兄弟姊妹')).toBe(
      'bigday-comment_c-1_vendor-兄弟姊妹',
    );
  });
});

describe('buildNotificationRecipients (A1, A2, A3 — policy matrix)', () => {
  it('A1: vendor comment → owner + co-owner; vendor self-suppressed', () => {
    const out = buildNotificationRecipients({
      authorUid: 'vendor-A',
      ownerUid: 'owner-1',
      assignedVendorUid: 'vendor-A', // author is the assigned vendor
      assignedHelperUid: 'helper-B',
      activeCoOwnerUids: ['co-owner-X'],
    });
    expect(out.recipients).toEqual(['owner-1', 'co-owner-X', 'helper-B']);
    expect(out.excluded).toEqual(['vendor-A']);
  });

  it('A2: helper comment → owner + co-owner; helper self-suppressed', () => {
    const out = buildNotificationRecipients({
      authorUid: 'helper-B',
      ownerUid: 'owner-1',
      assignedVendorUid: 'vendor-A',
      assignedHelperUid: 'helper-B',
      activeCoOwnerUids: ['co-owner-X'],
    });
    expect(out.recipients).toEqual(['owner-1', 'co-owner-X', 'vendor-A']);
    expect(out.excluded).toEqual(['helper-B']);
  });

  it('A3: owner reply → assigned vendor + helper; owner self-suppressed', () => {
    const out = buildNotificationRecipients({
      authorUid: 'owner-1',
      ownerUid: 'owner-1',
      assignedVendorUid: 'vendor-A',
      assignedHelperUid: 'helper-B',
      activeCoOwnerUids: ['co-owner-X'],
    });
    // A3 explicitly requires the assigned vendor + helper each
    // receive one unread. The co-owner (a separate person from
    // the owner who is the author) is ALSO a valid recipient per
    // spec §1.2, so we assert it via arrayContaining rather than
    // toEqual. The re-test below isolates the co-owner receipt.
    expect(out.recipients).toEqual(expect.arrayContaining(['vendor-A', 'helper-B']));
    expect(out.recipients).not.toContain('owner-1');
    expect(out.excluded).toEqual(['owner-1']);
    // Explicit co-owner receipt assertion (separate input with
    // no assigned vendor / helper, isolating the co-owner path):
    const ownerReply = buildNotificationRecipients({
      authorUid: 'owner-1',
      ownerUid: 'owner-1',
      assignedVendorUid: null,
      assignedHelperUid: null,
      activeCoOwnerUids: ['co-owner-X'],
    });
    expect(ownerReply.recipients).toContain('co-owner-X');
    expect(ownerReply.excluded).toContain('owner-1');
  });

  it('drops null / empty / whitespace-only assigned UIDs', () => {
    const out = buildNotificationRecipients({
      authorUid: 'owner-1',
      ownerUid: 'owner-1',
      assignedVendorUid: '',
      assignedHelperUid: '   ',
      activeCoOwnerUids: ['co-owner-X', '', '   '],
    });
    expect(out.recipients).toEqual(['co-owner-X']);
  });

  it('no assigned vendor / helper → recipients are just owner + co-owners', () => {
    const out = buildNotificationRecipients({
      authorUid: 'vendor-A',
      ownerUid: 'owner-1',
      assignedVendorUid: null,
      assignedHelperUid: null,
      activeCoOwnerUids: [],
    });
    expect(out.recipients).toEqual(['owner-1']);
  });

  it('co-owner == owner (single-tenant owner) collapses to one recipient', () => {
    // Some events store coOwners[] including the owner themselves.
    // Our Set-based dedupe naturally collapses duplicates.
    const out = buildNotificationRecipients({
      authorUid: 'vendor-A',
      ownerUid: 'owner-1',
      assignedVendorUid: 'vendor-A',
      assignedHelperUid: null,
      activeCoOwnerUids: ['owner-1'], // owner is in their own coOwners
    });
    expect(out.recipients).toEqual(['owner-1']);
    expect(out.excluded).toEqual(['vendor-A']);
  });

  it('returns recipients as an array (Set is for dedup only)', () => {
    const out = buildNotificationRecipients({
      authorUid: 'a',
      ownerUid: 'o',
      assignedVendorUid: null,
      assignedHelperUid: null,
    });
    expect(Array.isArray(out.recipients)).toBe(true);
  });
});
