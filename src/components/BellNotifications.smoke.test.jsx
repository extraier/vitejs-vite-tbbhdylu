// 2026-08-09 — BellNotifications.smoke.test.jsx
//
// Regression test for the production TDZ error
// `Cannot access 'p' before initialization` at the header render path.
// The bug: `enabled: open || totalNew > 0` referenced `totalNew` while
// it was being declared on the same destructure, throwing on the first
// render of BellNotifications and unmounting the entire header tree.
//
// This test renders the bell and asserts no exception is thrown.
// If the TDZ sneaks back in, the act/render will throw and the test
// fails loudly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock firebase/firestore so useNotifications doesn't hit a real DB.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    onSnapshot: vi.fn((q, onNext) => {
      // Fire an empty snapshot immediately so loading flips off.
      setTimeout(() => {
        try { onNext({ docs: [] }); } catch { /* ignore */ }
      }, 0);
      return () => {};
    }),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
});

vi.mock('../lib/firebase', () => ({
  db: {},
}));

// 2026-08-17 — Override useNotifications in the second test only so
// we can simulate a vendor-comment alert and verify the bell routes
// it to onOpenCommentAlert (NOT onOpenComment). The vi.mock for
// 'firebase/firestore' is module-level so we still get no real
// subscriptions; we just inject the items/badges the hook would
// have produced.
vi.mock('../hooks/useNotifications', async () => {
  // CATEGORY_META is exported alongside useNotifications and is
  // used by BellNotifications to render category icons. Pass
  // through the real one so the bell renders the vendor-comment
  // row the same way production does.
  const actual = await vi.importActual('../hooks/useNotifications');
  return {
    ...actual,
    useNotifications: vi.fn(),
    markAllNotificationsSeen: vi.fn(),
  };
});

import { BellNotifications } from './BellNotifications';
import { useNotifications } from '../hooks/useNotifications';

describe('BellNotifications — TDZ regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty bell
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
  });

  it('renders without throwing ReferenceError (TDZ regression)', () => {
    // The original bug threw "Cannot access 'p' before initialization"
    // synchronously on first render. With the fix in place, the bell
    // mounts cleanly and exposes the button.
    expect(() =>
      render(
        <BellNotifications
          ownerUid="owner-1"
          coupleUid="couple-1"
          selfUid="couple-1"
          onOpenProposal={vi.fn()}
          onOpenComment={vi.fn()}
          onOpenStatus={vi.fn()}
          onOpenInvite={vi.fn()}
          onOpenDashboard={vi.fn()}
        />,
      ),
    ).not.toThrow();

    // The bell button is the public affordance — its presence confirms
    // the component reached the render->JSX path without erroring.
    expect(screen.getByRole('button', { name: /通知/ })).toBeTruthy();
  });

  it('still renders when ownerUid is missing (no TDZ unrelated to args)', () => {
    expect(() =>
      render(
        <BellNotifications
          ownerUid={null}
          coupleUid={null}
          selfUid={null}
          onOpenProposal={vi.fn()}
          onOpenComment={vi.fn()}
          onOpenStatus={vi.fn()}
          onOpenInvite={vi.fn()}
          onOpenDashboard={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  // 2026-08-17 — vendor / helper comment alert routing.
  //
  // Pin the bell's behavior when a `comment` category item is
  // clicked: it MUST call `onOpenCommentAlert` (not
  // `onOpenComment`). The latter routes to couple-checklist; the
  // former routes to the Big Day view (wedding-day) where 大日流程
  // + 物資 actually live. If this ever regresses, the couple will
  // land on the wrong screen when they tap the bell.
  it('routes comment-category items to onOpenCommentAlert (not onOpenComment)', () => {
    useNotifications.mockReturnValue({
      items: [
        {
          id: 'comment:alert-1',
          category: 'comment',
          actorRole: 'vendor',
          actorName: 'Tiger Florist',
          actorInitial: 'T',
          title: 'Tiger Florist 喺大日流程留言',
          preview: '會場已準備好',
          meta: {
            alertId: 'alert-1',
            parentId: 'rd-42',
            parentTitle: '兄弟姊妹集合',
            kind: 'rundown',
            eventId: 'e-1',
          },
          createdAt: Date.now(),
          sourceKey: 'comment',
        },
      ],
      badges: { proposal: 0, task: 0, invite: 0, comment: 1 },
      totalNew: 1,
      loading: false,
      errors: {},
    });

    const onOpenProposal = vi.fn();
    const onOpenComment = vi.fn();
    const onOpenCommentAlert = vi.fn();
    const onOpenStatus = vi.fn();
    const onOpenInvite = vi.fn();
    const onOpenDashboard = vi.fn();

    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={onOpenProposal}
        onOpenComment={onOpenComment}
        onOpenCommentAlert={onOpenCommentAlert}
        onOpenStatus={onOpenStatus}
        onOpenInvite={onOpenInvite}
        onOpenDashboard={onOpenDashboard}
      />,
    );

    // Open the dropdown and click the comment item.
    const bellBtn = screen.getByRole('button', { name: /通知/ });
    fireEvent.click(bellBtn);
    // The item row is rendered as a <button>; the category is
    // 'comment' so we can target it via the title text inside.
    const item = screen.getByRole('button', { name: /Tiger Florist 喺大日流程留言/ });
    fireEvent.click(item);

    expect(onOpenCommentAlert).toHaveBeenCalledTimes(1);
    expect(onOpenCommentAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rundown',
        parentId: 'rd-42',
        eventId: 'e-1',
      }),
    );
    // CRITICAL: must NOT fall through to onOpenComment (checklist).
    expect(onOpenComment).not.toHaveBeenCalled();
    expect(onOpenProposal).not.toHaveBeenCalled();
    expect(onOpenInvite).not.toHaveBeenCalled();
  });
});
