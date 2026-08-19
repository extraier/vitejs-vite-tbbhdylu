// 2026-08-17 — Manus A8 regression guard: helper-side bell-click
// deep-link focus.
//
// When App.jsx sets `focusedParentKind` ∈ {rundown, resources} and
// `focusedParentId`, <HelperDashboard> must:
//   1. Switch the active tab to 'bigday' (if not already there)
//   2. Pass focusedParent* down to <HelperBigDayTab>
//   3. <HelperBigDayTab> queries the DOM for [data-row-id="<id>"],
//      calls scrollIntoView + briefly applies a rose-400 ring
//   4. Invokes onFocusedParentHandled so App.jsx can clear state
//
// Mocking strategy:
//   * Stub useFirestoreCollection to return canned rundown /
//     resources / tasks lists (no real Firestore socket).
//   * Stub the heavy child screens (ReceptionScanner, PhotoDrop)
//     so they don't pull in their own deps.
//   * Stub document.querySelector + scrollIntoView so we can
//     capture which row was targeted.
//
// Mirrors the existing WeddingDay focus-effect test pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { HelperDashboard } from './HelperDashboard';

// 2026-08-17 — Stub Firestore collection hook with canned data.
// The dashboard reads /rundown + /resources + /tasks + /budget
// + /photos + /guests from Firestore; we return empty arrays for
// the ones not under test, and explicit lists for rundown /
// resources so the focus effect can locate a target.
const cannedData = {
  rundown: [
    {
      id: 'rd-99',
      title: '攝影師到場',
      startTime: '15:30',
      durationMin: 30,
      location: '尖沙咀美麗華',
      assignedHelpers: [{ uid: 'helper-1' }],
    },
  ],
  resources: [
    {
      id: 'rs-42',
      label: '場地平面圖',
      category: '佈置',
      qty: 1,
      notes: '提早一日送到',
      assignedHelpers: [{ uid: 'helper-1' }],
    },
  ],
  tasks: [],
  budgetTasks: [],
  photos: [],
  guests: [],
};
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: vi.fn((ref, deps) => {
    if (!ref) return { data: [], loading: false, error: null };
    // The collectionRef points at one of the event-scoped
    // subcollections; pick by the last path segment.
    const segments = ref._segments || (ref.__segments || []);
    const last = segments[segments.length - 1] || '';
    if (last === 'rundown') return { data: cannedData.rundown, loading: false, error: null };
    if (last === 'resources') return { data: cannedData.resources, loading: false, error: null };
    if (last === 'tasks') return { data: cannedData.tasks, loading: false, error: null };
    if (last === 'budgetTasks') return { data: cannedData.budgetTasks, loading: false, error: null };
    if (last === 'photos') return { data: cannedData.photos, loading: false, error: null };
    if (last === 'guests') return { data: cannedData.guests, loading: false, error: null };
    return { data: [], loading: false, error: null };
  }),
}));

// 2026-08-17 — The actual firestore `collection()` call returns an
// object with a `_segments` array. Patch the firebase import so
// the dashboard gets a recognisable ref shape.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((db, ...segments) => ({
      _segments: segments,
      __segments: segments,
      type: 'collection',
    })),
    doc: vi.fn(() => ({
      _segments: [],
      type: 'doc',
    })),
    query: vi.fn((ref) => ref),
    where: vi.fn(() => ({ _where: true })),
    updateDoc: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'app-1',
}));

vi.mock('../components/TaskActivityTimeline', () => ({
  TaskActivityTimeline: () => null,
}));

vi.mock('./ReceptionScanner', () => ({
  ReceptionScanner: () => null,
}));

vi.mock('./PhotoDrop', () => ({
  PhotoDrop: () => null,
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn(), ToastRoot: () => null }),
}));

// 2026-08-17 — Stub querySelector so we can capture which row the
// focus effect targeted. We deliberately return a fake element
// for the [data-row-id="..."] selector and pass everything else
// through to the real document (so React's internal lookups
// continue to work).
let queriedIds = [];
let capturedEl = null;
const originalQuerySelector = document.querySelector.bind(document);
const originalScrollIntoView = Element.prototype.scrollIntoView;
const fakeClassList = () => {
  const set = new Set();
  return {
    add: vi.fn((...cls) => cls.forEach((c) => set.add(c))),
    remove: vi.fn((...cls) => cls.forEach((c) => set.delete(c))),
    contains: (c) => set.has(c),
    _set: set,
  };
};
beforeEach(() => {
  queriedIds = [];
  capturedEl = null;
  document.querySelector = vi.fn((selector) => {
    queriedIds.push(selector);
    const match = selector.match(/^\[data-row-id="(.+)"\]$/);
    if (!match) return originalQuerySelector(selector);
    const fakeEl = {
      id: match[1],
      scrollIntoView: vi.fn(),
      classList: fakeClassList(),
    };
    capturedEl = fakeEl;
    return fakeEl;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.querySelector = originalQuerySelector;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  cleanup();
  vi.restoreAllMocks();
});

const baseAssignment = {
  ownerUid: 'couple-1',
  eventId: 'event-1',
  eventName: 'Roger & Joy',
  perms: {
    canViewChecklist: true,
    canViewGuestList: true,
    canScan: false,
    canViewBudget: false,
    canUploadPhotos: false,
    canViewPhotos: false,
  },
};
const baseCurrentUser = { uid: 'helper-1', displayName: '阿明' };

describe('HelperDashboard — A8 bell-click deep-link focus', () => {
  it('does nothing when focusedParentId is null', () => {
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
      />,
    );
    expect(queriedIds.filter((s) => s.startsWith('[data-row-id='))).toEqual(
      [],
    );
  });

  it('switches to the Big Day tab when focusedParentId is set', async () => {
    const { container } = render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      // The Big Day tab heading uses 大日流程 as section title.
      // Look for it in the rendered output.
      const headings = container.querySelectorAll('h3');
      const bigDayHeading = Array.from(headings).find((h) =>
        h.textContent.includes('大日流程'),
      );
      expect(bigDayHeading).toBeTruthy();
    });
  });

  it('queries the DOM for the matching rundown row by data-row-id', async () => {
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      const ids = queriedIds.filter((s) => s.startsWith('[data-row-id='));
      expect(ids).toContain('[data-row-id="rd-99"]');
    });
  });

  it('queries the DOM for the matching resource row by data-row-id', async () => {
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rs-42"
        focusedParentKind="resources"
      />,
    );
    await waitFor(() => {
      const ids = queriedIds.filter((s) => s.startsWith('[data-row-id='));
      expect(ids).toContain('[data-row-id="rs-42"]');
    });
  });

  it('calls scrollIntoView on the matched element with smooth + center', async () => {
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      expect(capturedEl).not.toBeNull();
      expect(capturedEl.scrollIntoView).toHaveBeenCalled();
      expect(capturedEl.scrollIntoView.mock.calls[0][0]).toMatchObject({
        behavior: 'smooth',
        block: 'center',
      });
    });
  });

  it('applies a temporary rose-400 ring highlight to the focused row', async () => {
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      expect(capturedEl).not.toBeNull();
      expect(capturedEl.classList.add).toHaveBeenCalled();
      const firstCallArgs = capturedEl.classList.add.mock.calls[0];
      const flat = firstCallArgs.flat();
      expect(flat).toContain('ring-rose-400');
      expect(flat).toContain('ring-2');
    });
  });

  it('invokes onFocusedParentHandled once the focus effect lands', async () => {
    const handled = vi.fn();
    render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rs-42"
        focusedParentKind="resources"
        onFocusedParentHandled={handled}
      />,
    );
    await waitFor(() => {
      expect(handled).toHaveBeenCalledTimes(1);
    });
  });

  it('renders rundown + resources <li> elements with data-row-id', async () => {
    const { container } = render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    // The Big Day tab is rendered after the tab switch; wait
    // for the focus effect to fire, then assert the DOM.
    await waitFor(() => {
      const ids = queriedIds.filter((s) => s.startsWith('[data-row-id='));
      expect(ids.length).toBeGreaterThan(0);
    });
    const rows = container.querySelectorAll('[data-row-id]');
    const ids = Array.from(rows).map((el) => el.getAttribute('data-row-id'));
    expect(ids).toContain('rd-99');
    expect(ids).toContain('rs-42');
  });

  it('renders the rundown <li> with data-row-kind="rundown"', async () => {
    const { container } = render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      const rows = container.querySelectorAll('[data-row-id="rd-99"]');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].getAttribute('data-row-kind')).toBe('rundown');
    });
  });

  it('renders the resources <li> with data-row-kind="resources"', async () => {
    const { container } = render(
      <HelperDashboard
        helperAssignment={baseAssignment}
        currentUser={baseCurrentUser}
        focusedParentId="rs-42"
        focusedParentKind="resources"
      />,
    );
    await waitFor(() => {
      const rows = container.querySelectorAll('[data-row-id="rs-42"]');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].getAttribute('data-row-kind')).toBe('resources');
    });
  });
});