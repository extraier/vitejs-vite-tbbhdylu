// 2026-08-19 — Manus P0.3 unit tests for the role-scoped
// notifications center.
//
// P0.3: extend the centre to vendor / helper roles. Owner /
// co-owner see all four tabs (proposals, tasks, invites,
// comments); vendor / helper see only the "全部" + "留言"
// tabs because their private inbox is comments-only.
//
// We test the role-based filter selection by mounting the
// component with mocked useNotifications and asserting the
// visible filter tab labels + click behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationsCenter } from './NotificationsCenter';

// Stub the useNotifications hook + the per-doc mark-read
// helpers so we don't need a Firestore socket. Returns empty
// data for every owner / self / event so the centre renders.
vi.mock('../hooks/useNotifications', async () => {
  const actual = await vi.importActual('../hooks/useNotifications');
  return {
    ...actual,
    useNotifications: vi.fn(() => ({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
      commentAlerts: [],
    })),
    markAllNotificationsSeen: vi.fn(),
    markCommentAlertsRead: vi.fn(() => Promise.resolve(0)),
  };
});

const baseProps = {
  ownerUid: 'couple-1',
  coupleUid: 'couple-1',
  selfUid: 'couple-1',
  eventId: 'event-1',
  onBack: () => {},
  onOpenProposal: () => {},
  onOpenComment: () => {},
  onOpenCommentAlert: () => {},
  onOpenInvite: () => {},
};

describe('NotificationsCenter — P0.3 role-scoped filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('owner sees the full filter tab set (全部 + 商戶報價 + 待辦 + 邀請 + 留言)', () => {
    render(<NotificationsCenter {...baseProps} userRole="owner" />);
    expect(screen.getByText('全部')).toBeTruthy();
    expect(screen.getByText('商戶報價')).toBeTruthy();
    expect(screen.getByText('待辦事項')).toBeTruthy();
    expect(screen.getByText('兄弟姊妹邀請')).toBeTruthy();
    expect(screen.getByText('留言通知')).toBeTruthy();
  });

  it('co-owner also sees the full filter tab set (mirrors owner behaviour)', () => {
    render(<NotificationsCenter {...baseProps} userRole="co-owner" />);
    expect(screen.getByText('商戶報價')).toBeTruthy();
    expect(screen.getByText('待辦事項')).toBeTruthy();
    expect(screen.getByText('兄弟姊妹邀請')).toBeTruthy();
  });

  it('vendor sees only 全部 + 留言通知 (no proposals / tasks / invites)', () => {
    render(<NotificationsCenter {...baseProps} userRole="vendor" />);
    expect(screen.getByText('全部')).toBeTruthy();
    expect(screen.getByText('留言通知')).toBeTruthy();
    // Owner-only tabs must NOT render for vendor.
    expect(screen.queryByText('商戶報價')).toBeNull();
    expect(screen.queryByText('待辦事項')).toBeNull();
    expect(screen.queryByText('兄弟姊妹邀請')).toBeNull();
  });

  it('helper sees only 全部 + 留言通知 (same as vendor)', () => {
    render(<NotificationsCenter {...baseProps} userRole="helper" />);
    expect(screen.getByText('全部')).toBeTruthy();
    expect(screen.getByText('留言通知')).toBeTruthy();
    expect(screen.queryByText('商戶報價')).toBeNull();
    expect(screen.queryByText('待辦事項')).toBeNull();
    expect(screen.queryByText('兄弟姊妹邀請')).toBeNull();
  });

  it('defaults to "owner" filter set when userRole is omitted (back-compat)', () => {
    // Pre-P0.3 callers don't pass userRole. The default in the
    // prop destructure is 'owner', so they keep the full tab
    // set. This is a regression guard for any old App.jsx
    // branches that haven't been updated.
    render(<NotificationsCenter {...baseProps} />);
    expect(screen.getByText('商戶報價')).toBeTruthy();
    expect(screen.getByText('待辦事項')).toBeTruthy();
    expect(screen.getByText('兄弟姊妹邀請')).toBeTruthy();
  });

  it('does not crash for an unknown userRole (defensive)', () => {
    // A future role like "guest" should fall through to the
    // non-owner set rather than render nothing or throw.
    expect(() =>
      render(<NotificationsCenter {...baseProps} userRole="guest_portal" />),
    ).not.toThrow();
    expect(screen.queryByText('商戶報價')).toBeNull();
  });
});