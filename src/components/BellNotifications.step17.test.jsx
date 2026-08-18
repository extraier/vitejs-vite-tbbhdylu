// 2026-08-17 — Manus step 17: bell badge animation integration.
//
// Verifies the badge:
//   1. Renders nothing when totalNew is 0.
//   2. Renders the displayed (animated) total, NOT the raw totalNew,
//      when totalNew is > 0.
//   3. Caps at '9+' for counts >= 10.
//   4. Updates `pulseKey` (which retriggers CSS animation) on
//      count-UP transitions.
//   5. Does NOT pulse on count-DOWN transitions.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Module-scope rAF + performance.now shims (same approach as
// useCountUp.test.js — defined at module load so they exist before
// the bell ever renders).
let rafCallbacks = [];
let nextRafId = 0;
let nowValue = 0;

const realRequestAnimationFrame = globalThis.requestAnimationFrame;
const realCancelAnimationFrame = globalThis.cancelAnimationFrame;
const realPerformance = globalThis.performance;

globalThis.requestAnimationFrame = vi.fn((cb) => {
  const id = ++nextRafId;
  rafCallbacks.push({ id, cb });
  return id;
});
globalThis.cancelAnimationFrame = vi.fn((id) => {
  rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
});
globalThis.performance = {
  ...(realPerformance || {}),
  now: vi.fn(() => nowValue),
};

afterAll(() => {
  if (realRequestAnimationFrame) globalThis.requestAnimationFrame = realRequestAnimationFrame;
  else delete globalThis.requestAnimationFrame;
  if (realCancelAnimationFrame) globalThis.cancelAnimationFrame = realCancelAnimationFrame;
  else delete globalThis.cancelAnimationFrame;
  if (realPerformance) globalThis.performance = realPerformance;
});

function flushFrames(steps, dt = 50) {
  for (let i = 0; i < steps; i++) {
    nowValue += dt;
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const entry of callbacks) {
      act(() => entry.cb(nowValue));
    }
  }
}

// Mock firebase/firestore (BellNotifications calls useNotifications).
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
    markCommentAlertsRead: vi.fn(() => Promise.resolve(1)),
  };
});

import { BellNotifications } from './BellNotifications';
import { useNotifications } from '../hooks/useNotifications';

describe('BellNotifications — step 17 animated badge', () => {
  beforeEach(() => {
    rafCallbacks = [];
    nextRafId = 0;
    nowValue = 0;
    vi.clearAllMocks();
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
  });

  it('renders no badge when totalNew is 0', () => {
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
    expect(screen.queryByTestId('bell-badge')).toBeNull();
  });

  it('renders the badge with the numeric total when 1-9', () => {
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 5 },
      totalNew: 5,
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
    // Flush rAF to settle the count animation.
    flushFrames(15, 30);
    const badge = screen.getByTestId('bell-badge');
    expect(badge.textContent).toBe('5');
  });

  it('caps the badge at "9+" when total is 10+', () => {
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 12 },
      totalNew: 12,
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
    flushFrames(15, 30);
    expect(screen.getByTestId('bell-badge').textContent).toBe('9+');
  });

  it('pulses on count-UP (new alert arrived)', () => {
    // Initial render: totalNew=0 (no badge).
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 0 },
      totalNew: 0,
      loading: false,
      errors: {},
    });
    const { rerender } = render(
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
    expect(screen.queryByTestId('bell-badge')).toBeNull();
    // Now: totalNew=3 (badge appears with count-UP → pulse).
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 3 },
      totalNew: 3,
      loading: false,
      errors: {},
    });
    act(() => {
      rerender(
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
    });
    flushFrames(15, 30);
    const badge = screen.getByTestId('bell-badge');
    expect(badge.textContent).toBe('3');
    // The count went UP (0 → 3), so pulseKey was bumped and the
    // animate-bell-pulse class is applied.
    expect(badge.className).toContain('animate-bell-pulse');
  });

  it('does NOT pulse on count-DOWN (mark-read)', () => {
    // Start with totalNew=3 — the initial mount already triggers
    // an UP pulse (0 → 3). To test the DOWN pulse suppression in
    // isolation we need to wait for the badge to settle, then drop
    // to 1 and verify the pulse class is NOT re-applied.
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 3 },
      totalNew: 3,
      loading: false,
      errors: {},
    });
    const { rerender } = render(
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
    // Flush past duration to let the count settle on 3.
    flushFrames(15, 30);
    // Capture the data-testid attribute to detect if React remounts
    // the badge (which would re-fire the CSS animation).
    const badgeBefore = screen.getByTestId('bell-badge');
    // Now: totalNew=1 (count goes DOWN). The pulseKey effect only
    // bumps when displayedTotal > prev. With 3 → 1, prev=3 and
    // displayed=1, so no bump. The badge should re-render with
    // the SAME pulseKey (because useRef doesn't trigger re-render,
    // but the React state `pulseKey` doesn't get bumped either).
    useNotifications.mockReturnValue({
      items: [],
      badges: { proposal: 0, task: 0, invite: 0, comment: 1 },
      totalNew: 1,
      loading: false,
      errors: {},
    });
    act(() => {
      rerender(
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
    });
    // Push the down-tween to completion. With easeInCubic slow-start
    // we need ~600ms total to see the value reach 1 from 3.
    flushFrames(30, 30); // 900ms
    const badge = screen.getByTestId('bell-badge');
    expect(badge.textContent).toBe('1');
    // The badge's data-testid is the same because React didn't
    // remount it (pulseKey didn't change). The CSS animation only
    // re-fires when the element is remounted, which it wasn't.
    expect(badge).toBe(badgeBefore);
  });
});