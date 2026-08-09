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
import { render, screen } from '@testing-library/react';

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

import { BellNotifications } from './BellNotifications';

describe('BellNotifications — TDZ regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
