// BellNotifications.role.test.jsx
// ================================
//
// 2026-08-23 — Manus P3 (PDF Patch 3): role-forwarding test.
//
// Before P3: BellNotifications forwarded {ownerUid, coupleUid, selfUid,
// eventId} to useNotifications and silently used the hook's default
// 'owner' userRole — even when the caller (vendor / helper bell) was
// a different role. The hook then opened owner-only listeners
// (proposals, tasks, helper-invites) for everyone.
//
// After P3: BellNotifications accepts a userRole prop and forwards
// it. This test asserts:
//   1. vendor / helper bells pass their userRole to the hook
//   2. owner bells still get 'owner' (default + explicit both work)
//   3. the owner-only sources are NOT requested for non-owner roles
//      (we don't need to inspect Firestore calls — just the hook
//      arguments — to keep the test fast and free of emulator)
//
// We mock useNotifications entirely (it's the boundary we're testing)
// and assert what it received.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// Capture every hook call. The impl below is a no-op that records
// args into the mocked module so the test can assert against them.
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
  // BellNotifications imports MAX_BELL_DROPDOWN_ITEMS from the hook
  // module; pass it through so the bell renders without an
  // undefined-export error.
  MAX_BELL_DROPDOWN_ITEMS: 5,
}));

// BellNotifications imports lib/firebase for db; provide a stub.
vi.mock('../lib/firebase', () => ({ db: {} }));

// Stub the lucide icons so we don't pull in the SVG set in tests.
vi.mock('lucide-react', () => ({
  Bell: (p) => React.createElement('svg', { 'data-testid': 'bell-icon', ...p }),
  Check: (p) => React.createElement('svg', { 'data-testid': 'check-icon', ...p }),
  Circle: (p) => React.createElement('svg', { 'data-testid': 'circle-icon', ...p }),
  Mail: (p) => React.createElement('svg', { 'data-testid': 'mail-icon', ...p }),
  Loader2: (p) => React.createElement('svg', { 'data-testid': 'loader-icon', ...p }),
  X: (p) => React.createElement('svg', { 'data-testid': 'x-icon', ...p }),
}));

// Stub CATEGORY_META — bell imports it for icon mapping; we don't need
// real values.
vi.mock('../lib/notificationCategories', () => ({
  CATEGORY_META: {
    proposal: { bgClass: 'bg-blue-100', icon: () => null, label: 'proposal' },
    task: { bgClass: 'bg-green-100', icon: () => null, label: 'task' },
    invite: { bgClass: 'bg-purple-100', icon: () => null, label: 'invite' },
    comment: { bgClass: 'bg-rose-100', icon: () => null, label: 'comment' },
  },
  formatRelative: () => '',
}));

import { BellNotifications } from './BellNotifications';

const BASE_PROPS = {
  ownerUid: 'owner-A',
  coupleUid: 'owner-A',
  selfUid: 'self-1',
  eventId: 'event-1',
};

describe('BellNotifications — role forwarding (P3 / PDF Patch 3)', () => {
  beforeEach(() => {
    useNotificationsMock.mockClear();
  });

  it('forwards userRole="vendor" to the hook', () => {
    render(
      <BellNotifications {...BASE_PROPS} userRole="vendor" enabled={true} />,
    );
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall.userRole).toBe('vendor');
  });

  it('forwards userRole="helper" to the hook', () => {
    render(
      <BellNotifications {...BASE_PROPS} userRole="helper" enabled={true} />,
    );
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('helper');
  });

  it('defaults userRole to "owner" when not passed', () => {
    render(<BellNotifications {...BASE_PROPS} enabled={true} />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('owner');
  });

  it('forwards "co-owner" explicitly', () => {
    render(
      <BellNotifications
        {...BASE_PROPS}
        userRole="co-owner"
        enabled={true}
      />,
    );
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.userRole).toBe('co-owner');
  });

  it('still forwards the other props unchanged', () => {
    render(<BellNotifications {...BASE_PROPS} userRole="vendor" />);
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.ownerUid).toBe('owner-A');
    expect(lastCall.coupleUid).toBe('owner-A');
    expect(lastCall.selfUid).toBe('self-1');
    expect(lastCall.eventId).toBe('event-1');
  });

  it('honours the caller-supplied enabled flag (A9 gate)', () => {
    render(
      <BellNotifications {...BASE_PROPS} userRole="vendor" enabled={false} />,
    );
    const lastCall = useNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.enabled).toBe(false);
  });
});