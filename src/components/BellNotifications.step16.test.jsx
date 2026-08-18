// 2026-08-17 — Manus step 16 regression guard: per-item mark-as-read.
//
// Verifies:
//   1. Clicking an unread `comment` bell item calls markCommentAlertsRead
//      with the alert's underlying doc id (not the bell-prefixed id).
//   2. The X dismiss button on the row calls markCommentAlertsRead
//      WITHOUT firing the row's onClick (no navigation).
//   3. Already-read `comment` items do NOT call markCommentAlertsRead
//      on click (idempotency guard).
//   4. The X button is hidden on read `comment` items + non-comment items.
//   5. The unread dot renders for unread `comment` items only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock firebase/firestore — same shape as BellNotifications.smoke.test.jsx
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    onSnapshot: vi.fn((q, onNext) => {
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

vi.mock('../hooks/useNotifications', async () => {
  const actual = await vi.importActual('../hooks/useNotifications');
  return {
    ...actual,
    useNotifications: vi.fn(),
    markAllNotificationsSeen: vi.fn(),
    // The markCommentAlertsRead is the function the click + dismiss
    // paths call. Capture calls so we can assert on them.
    markCommentAlertsRead: vi.fn(() => Promise.resolve(1)),
  };
});

import { BellNotifications } from './BellNotifications';
import { useNotifications, markCommentAlertsRead } from '../hooks/useNotifications';

const baseCommentItem = (overrides = {}) => ({
  id: 'comment:alert-1',
  category: 'comment',
  actorRole: 'vendor',
  actorName: 'Tiger Florist',
  actorInitial: 'T',
  title: 'Tiger Florist 喺大日流程留言',
  preview: '會場已準備好',
  meta: {
    alertId: 'alert-1',
    commentId: 'c-1',
    parentId: 'rd-42',
    parentTitle: '兄弟姊妹集合',
    kind: 'rundown',
    eventId: 'e-1',
  },
  createdAt: Date.now(),
  sourceKey: 'comment',
  alertDocId: 'alert-1', // 2026-08-17 — step 16 surface
  readAt: null,          // 2026-08-17 — step 16 unread flag
  ...overrides,
});

describe('BellNotifications — step 16 per-item mark-as-read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: one unread comment alert.
    useNotifications.mockReturnValue({
      items: [baseCommentItem()],
      badges: { proposal: 0, task: 0, invite: 0, comment: 1 },
      totalNew: 1,
      loading: false,
      errors: {},
    });
  });

  it('clicking an unread comment item calls markCommentAlertsRead with the alert doc id', () => {
    const onOpenCommentAlert = vi.fn();
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={onOpenCommentAlert}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /Tiger Florist 喺大日流程留言/ }),
    );
    // The click handler must call markCommentAlertsRead with the
    // underlying doc id ('alert-1'), NOT the bell-prefixed
    // id ('comment:alert-1') — otherwise writeBatch would target
    // a non-existent doc.
    expect(markCommentAlertsRead).toHaveBeenCalledTimes(1);
    expect(markCommentAlertsRead).toHaveBeenCalledWith(
      'couple-1',
      [{ id: 'alert-1' }],
      'e-1',
    );
    // And the row's primary action still fires (navigation).
    expect(onOpenCommentAlert).toHaveBeenCalledTimes(1);
  });

  it('clicking an already-read comment item does NOT call markCommentAlertsRead', () => {
    useNotifications.mockReturnValue({
      items: [baseCommentItem({ readAt: Date.now() })],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
    const onOpenCommentAlert = vi.fn();
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={onOpenCommentAlert}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /Tiger Florist 喺大日流程留言/ }),
    );
    expect(markCommentAlertsRead).not.toHaveBeenCalled();
    // Navigation still fires on read items.
    expect(onOpenCommentAlert).toHaveBeenCalledTimes(1);
  });

  it('clicking the X dismiss button marks read WITHOUT triggering navigation', () => {
    const onOpenCommentAlert = vi.fn();
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={onOpenCommentAlert}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    const dismissBtn = screen.getByTestId('bell-dismiss-comment:alert-1');
    fireEvent.click(dismissBtn);
    expect(markCommentAlertsRead).toHaveBeenCalledTimes(1);
    expect(markCommentAlertsRead).toHaveBeenCalledWith(
      'couple-1',
      [{ id: 'alert-1' }],
      'e-1',
    );
    // CRITICAL: dismiss must NOT navigate.
    expect(onOpenCommentAlert).not.toHaveBeenCalled();
  });

  it('hides the X button on already-read comment items', () => {
    useNotifications.mockReturnValue({
      items: [baseCommentItem({ readAt: Date.now() })],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    expect(
      screen.queryByTestId('bell-dismiss-comment:alert-1'),
    ).toBeNull();
  });

  it('hides the X button on non-comment items (proposal / task / invite)', () => {
    useNotifications.mockReturnValue({
      items: [
        {
          id: 'proposal:prop-1',
          category: 'proposal',
          actorName: 'Some Vendor',
          actorInitial: 'S',
          title: '商戶報價',
          preview: '報價 $5,000',
          meta: { price: '$5,000', jobId: 'job-1' },
          createdAt: Date.now(),
          sourceKey: 'proposal',
        },
      ],
      badges: { proposal: 1, task: 0, invite: 0, comment: 0 },
      totalNew: 1,
      loading: false,
      errors: {},
    });
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    expect(screen.queryByTestId('bell-dismiss-proposal:prop-1')).toBeNull();
  });

  it('renders an unread dot for unread comment items', () => {
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    expect(screen.getByLabelText('未讀')).toBeTruthy();
  });

  it('does NOT render an unread dot for already-read comment items', () => {
    useNotifications.mockReturnValue({
      items: [baseCommentItem({ readAt: Date.now() })],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    expect(screen.queryByLabelText('未讀')).toBeNull();
  });

  it('does NOT render an unread dot for non-comment items even when unread', () => {
    useNotifications.mockReturnValue({
      items: [
        {
          id: 'proposal:prop-1',
          category: 'proposal',
          actorName: 'Some Vendor',
          actorInitial: 'S',
          title: '商戶報價',
          preview: '報價 $5,000',
          meta: { price: '$5,000', jobId: 'job-1' },
          createdAt: Date.now(),
          sourceKey: 'proposal',
        },
      ],
      badges: { proposal: 1, task: 0, invite: 0, comment: 0 },
      totalNew: 1,
      loading: false,
      errors: {},
    });
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid="couple-1"
        selfUid="couple-1"
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    expect(screen.queryByLabelText('未讀')).toBeNull();
  });

  it('does NOT call markCommentAlertsRead when selfUid is missing', () => {
    render(
      <BellNotifications
        ownerUid="owner-1"
        coupleUid={null}
        selfUid={null}
        eventId="e-1"
        onOpenProposal={vi.fn()}
        onOpenComment={vi.fn()}
        onOpenCommentAlert={vi.fn()}
        onOpenStatus={vi.fn()}
        onOpenInvite={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /通知/ }));
    // The dismiss button may not render without selfUid because the
    // hook short-circuits — but the row's onClick path is also
    // guarded. Verify by directly clicking the row.
    const row = screen.queryByRole('button', {
      name: /Tiger Florist 喺大日流程留言/,
    });
    if (row) {
      fireEvent.click(row);
    }
    expect(markCommentAlertsRead).not.toHaveBeenCalled();
  });
});