// NotificationsCenter.role.test.jsx
// ==================================
//
// 2026-08-23 — Manus P3 (PDF Patch 3): role-forwarding test for the
// full-page notification centre. Mirror of BellNotifications.role.test
// but for the modal view.
//
// Before P3: NotificationsCenter received a userRole prop but used
// it ONLY to pick the visible filter tabs — the hook itself was called
// without userRole and silently defaulted to 'owner', opening owner-
// only sources (proposals / tasks / helper-invites) for vendor /
// helper centres even though they'd never see items from those
// sources.
//
// After P3: the userRole prop is forwarded to useNotifications, so
// the gate at P0.4 kicks in and vendor / helper centres get only the
// comment inbox (matching what they actually have).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

const useNotificationsMock = vi.fn(() => ({
  items: [],
  badges: {},
  totalNew: 0,
  loading: false,
  errors: {},
  commentAlerts: [],
}));

vi.mock('../hooks/useNotifications', () => ({
  useNotifications: (...args) => useNotificationsMock(...args),
  CATEGORY_META: {
    proposal: { bgClass: 'bg-blue-100', icon: () => null, label: '報價' },
    task: { bgClass: 'bg-green-100', icon: () => null, label: '待辦' },
    invite: { bgClass: 'bg-purple-100', icon: () => null, label: '邀請' },
    comment: { bgClass: 'bg-rose-100', icon: () => null, label: '留言' },
    system: { bgClass: 'bg-slate-100', icon: () => null, label: '系統' },
  },
  formatRelative: () => '',
}));

vi.mock('../lib/firebase', () => ({ db: {} }));

// Stub the lucide icons so we don't pull in the SVG set.
vi.mock('lucide-react', () => {
  const stub = (name) => (p) => React.createElement('svg', { 'data-testid': `icon-${name}`, ...p });
  return {
    Bell: stub('Bell'),
    Check: stub('Check'),
    CheckCircle2: stub('CheckCircle2'),
    ArrowLeft: stub('ArrowLeft'),
    Mail: stub('Mail'),
    X: stub('X'),
  };
});

import { NotificationsCenter } from './NotificationsCenter';

const BASE_PROPS = {
  ownerUid: 'owner-A',
  coupleUid: 'owner-A',
  selfUid: 'self-1',
  eventId: 'event-1',
  onBack: () => {},
  onOpenProposal: () => {},
  onOpenComment: () => {},
  onOpenCommentAlert: () => {},
  onOpenInvite: () => {},
};

describe('NotificationsCenter — role forwarding (P3 / PDF Patch 3)', () => {
  beforeEach(() => {
    useNotificationsMock.mockClear();
  });

  it('forwards userRole="vendor" to the hook', () => {
    render(<NotificationsCenter {...BASE_PROPS} userRole="vendor" />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall.userRole).toBe('vendor');
  });

  it('forwards userRole="helper" to the hook', () => {
    render(<NotificationsCenter {...BASE_PROPS} userRole="helper" />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('helper');
  });

  it('defaults userRole to "owner" when not passed', () => {
    render(<NotificationsCenter {...BASE_PROPS} />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('owner');
  });

  it('forwards "co-owner" explicitly', () => {
    render(<NotificationsCenter {...BASE_PROPS} userRole="co-owner" />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('co-owner');
  });

  it('vendor / helper still pass other props through unchanged', () => {
    render(<NotificationsCenter {...BASE_PROPS} userRole="helper" />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.ownerUid).toBe('owner-A');
    expect(lastCall.coupleUid).toBe('owner-A');
    expect(lastCall.selfUid).toBe('self-1');
    expect(lastCall.eventId).toBe('event-1');
  });
});