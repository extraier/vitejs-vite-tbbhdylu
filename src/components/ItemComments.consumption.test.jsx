// 2026-08-20 — Manus P0 regression guards. These tests exercise
// the REAL focus lifecycle, not source strings:
//   1. Comment-level focus survives across the row-scroll +
//      panel-open sequence
//   2. <ItemComments> is the consumption authority — it fires
//      onFocusedCommentHandled only on successful scrollIntoView
//   3. The callback's commentId is the source of truth for App.jsx's
//      id-match clear (so stale late callbacks can't clobber
//      newer focus)
//   4. A failed retry does NOT ack — focus stays alive for the
//      next snapshot
//
// These are the behaviors Manus flagged as missing in the
// 2026-08-20 handoff: the existing source-grep tests confirmed
// prop wiring but not lifecycle behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { ItemComments } from './ItemComments';

// Mock useFirestoreCollection so we can drive the comments array
// synchronously. The production hook is exercised by the existing
// integration tests; here we only need to control when the
// snapshot arrives (i.e. when data-comment-id divs appear in the DOM).
//
// ItemComments constructs a Firestore `query()` for the vendor
// role to add a parentAssignedVendorUid filter — calling query()
// with a fake object path in jsdom throws a Firestore internal
// error. We sidestep that by passing currentRole='owner' (the
// subscription is just `path` then, no `query()` call), so the
// fake path works. The consumption authority itself is
// role-agnostic — the focus effect doesn't read currentRole —
// so this is a safe simplification.
let mockComments = [];
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: mockComments, loading: false }),
}));

// Stub scrollIntoView so jsdom doesn't complain (it has no layout).
const scrollIntoViewCalls = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrollIntoViewCalls.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function () {
    scrollIntoViewCalls.push({ id: this.getAttribute('data-comment-id') });
  });
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  cleanup();
  mockComments = [];
  vi.useRealTimers();
});

const baseProps = {
  path: {
    __segments: ['artifacts', 'app-1', 'users', 'owner-1', 'events', 'event-1', 'rundown', 'rd-99', 'comments'],
  },
  currentUser: { uid: 'owner-1', displayName: 'Roger', email: 'r@example.com' },
  currentRole: 'owner', // see mock-useFirestoreCollection note above
  label: '留言溝通',
  emptyHint: '未有留言，可以留低第一句。',
};

describe('ItemComments — Manus P0 consumption authority', () => {
  it('fires onFocusedCommentHandled with commentId + parentId + kind after snapshot arrives', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = []; // No snapshot yet — comment not in DOM.

    const { rerender } = render(
      <ItemComments
        {...baseProps}
        focusedCommentId="cmt-alert-1"
        onFocusedCommentHandled={handler}
      />,
    );

    // Tick once for the 80ms initial delay of the effect.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // Snapshot still empty — retries should keep firing (640ms budget).
    expect(handler).not.toHaveBeenCalled();

    // Now deliver the snapshot with the target comment.
    mockComments = [
      { id: 'cmt-other', authorName: '新人', text: 'first', createdAt: 1 },
      { id: 'cmt-alert-1', authorName: '商戶', text: 'the alert', createdAt: 2 },
    ];
    rerender(
      <ItemComments
        {...baseProps}
        focusedCommentId="cmt-alert-1"
        onFocusedCommentHandled={handler}
      />,
    );

    // Effect re-fires on sorted.length change. Tick once more.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(scrollIntoViewCalls).toContainEqual(
      expect.objectContaining({ id: 'cmt-alert-1' }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      commentId: 'cmt-alert-1',
      // parentId = segments[-2] = 'rd-99'; kind = segments[-3] = 'rundown'
      parentId: 'rd-99',
      kind: 'rundown',
    });
  });

  it('does NOT fire onFocusedCommentHandled when the comment never arrives (focus stays alive)', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = []; // Snapshot never delivers the matching comment.

    render(
      <ItemComments
        {...baseProps}
        focusedCommentId="cmt-missing"
        onFocusedCommentHandled={handler}
      />,
    );

    // Run past the full retry budget (8 × 80ms = 640ms).
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(handler).not.toHaveBeenCalled();
    expect(scrollIntoViewCalls).toHaveLength(0);
    // The focus prop is still set — App.jsx keeps it until the
    // consumption ack fires (or the navigate-away effect clears it).
  });

  it('fires the callback only once even if multiple snapshot rerenders occur', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = [
      { id: 'cmt-alert-1', authorName: '商戶', text: 'the alert', createdAt: 1 },
    ];

    const { rerender } = render(
      <ItemComments
        {...baseProps}
        focusedCommentId="cmt-alert-1"
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(handler).toHaveBeenCalledTimes(1);

    // Re-render with same props — the effect should NOT re-fire
    // (the acknowledged flag prevents double-ack).
    rerender(
      <ItemComments
        {...baseProps}
        focusedCommentId="cmt-alert-1"
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('extracts parentId and kind from object-form path (Firestore-style segments)', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = [
      { id: 'cmt-res-1', authorName: '商戶', text: 'resources item', createdAt: 1 },
    ];
    render(
      <ItemComments
        {...baseProps}
        path={{
          __segments: [
            'artifacts', 'app-1', 'users', 'owner-1', 'events', 'event-1',
            'resources', 'rs-42', 'comments',
          ],
        }}
        focusedCommentId="cmt-res-1"
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(handler).toHaveBeenCalledWith({
      commentId: 'cmt-res-1',
      parentId: 'rs-42',
      kind: 'resources',
    });
  });

  it('tolerates string-form path (legacy/canonical string comments paths)', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = [
      { id: 'cmt-str', authorName: '商戶', text: 'string path', createdAt: 1 },
    ];
    render(
      <ItemComments
        {...baseProps}
        path="artifacts/app-1/users/owner-1/events/event-1/rundown/rd-string/comments"
        focusedCommentId="cmt-str"
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(handler).toHaveBeenCalledWith({
      commentId: 'cmt-str',
      parentId: 'rd-string',
      kind: 'rundown',
    });
  });

  it('falls back to null parentId/kind on malformed path (still acks the commentId)', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = [
      { id: 'cmt-x', authorName: '商戶', text: 'malformed', createdAt: 1 },
    ];
    render(
      <ItemComments
        {...baseProps}
        path={{ __segments: ['short'] }}
        focusedCommentId="cmt-x"
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // CommentId must still come through so App.jsx can guard the
    // clear; parentId/kind null is acceptable here because the
    // caller probably didn't have a valid deep-link anyway.
    expect(handler).toHaveBeenCalledWith({
      commentId: 'cmt-x',
      parentId: null,
      kind: null,
    });
  });

  it('does NOT fire when focusedCommentId is null (backwards-compat with legacy parent-only links)', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    mockComments = [
      { id: 'cmt-1', authorName: '商戶', text: 'plain', createdAt: 1 },
    ];
    render(
      <ItemComments
        {...baseProps}
        focusedCommentId={null}
        onFocusedCommentHandled={handler}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(handler).not.toHaveBeenCalled();
  });
});