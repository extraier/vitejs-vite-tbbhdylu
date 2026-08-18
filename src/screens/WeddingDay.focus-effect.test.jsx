// 2026-08-17 — Manus A8 regression guard: bell-click deep-link focus.
//
// When App.jsx sets `focusedParentKind` ∈ {rundown, resources} and
// `focusedParentId`, <WeddingDay> must:
//   1. Switch its subtab to whichever kind was requested
//   2. Locate the matching row by its [data-row-id="<id>"] attribute
//   3. Call scrollIntoView + briefly apply a ring highlight
//
// These tests mount <WeddingDay> with realistic fixtures and a
// single rundown / resources row, fire the focusedParent* props,
// and assert the DOM after the focus effect's setTimeout(0/80)
// ticks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { WeddingDay } from './WeddingDay';

// 2026-08-17 — Stub document.querySelector + scrollIntoView so we
// can assert which row was selected without depending on jsdom's
// layout engine (jsdom doesn't actually scroll).
let queriedIds = [];
const originalQuerySelector = document.querySelector.bind(document);
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  queriedIds = [];
  document.querySelector = vi.fn((selector) => {
    queriedIds.push(selector);
    const match = selector.match(/^\[data-row-id="(.+)"\]$/);
    if (!match) return originalQuerySelector(selector);
    const id = match[1];
    // Return a fake element the WeddingDay effect can attach
    // classList.add / remove to.
    const fakeEl = {
      id,
      scrollIntoView: vi.fn(),
      classList: {
        _classes: new Set(),
        add(...cls) { cls.forEach((c) => this._classes.add(c)); },
        remove(...cls) { cls.forEach((c) => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); },
      },
    };
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

const baseProps = () => ({
  rundown: [],
  resources: [],
  teaCeremony: [],
  playlist: [],
  onUpsertRundown: vi.fn(),
  onDeleteRundown: vi.fn(),
  onReorderRundown: vi.fn(),
  onSetRundownPositions: vi.fn(),
  onUpsertResource: vi.fn(),
  onDeleteResource: vi.fn(),
  onToggleResource: vi.fn(),
  onReorderResource: vi.fn(),
  onSetResourcePositions: vi.fn(),
  onUpsertTeaCeremony: vi.fn(),
  onDeleteTeaCeremony: vi.fn(),
  onSetTeaCeremonyOrders: vi.fn(),
  onUpsertPlaylist: vi.fn(),
  onDeletePlaylist: vi.fn(),
  onReorderPlaylist: vi.fn(),
  onSetPlaylistPositions: vi.fn(),
  currentUser: { uid: 'u-owner' },
  helpers: [],
  showToast: vi.fn(),
  ownerNames: { boyName: '志明', girlName: '春嬌' },
  vendors: [],
  ownerUid: 'owner-1',
  eventId: 'e-1',
  rundownCommentPathFor: () => null,
  resourceCommentPathFor: () => null,
});

describe('A8 bell-click deep-link focus', () => {
  it('does nothing when focusedParentId / focusedParentKind are not provided', () => {
    render(<WeddingDay {...baseProps()} />);
    expect(queriedIds.filter((s) => s.startsWith('[data-row-id='))).toEqual([]);
  });

  it('switches to the resources subtab when focusedParentKind="resources"', async () => {
    render(
      <WeddingDay
        {...baseProps()}
        resources={[{ id: 'r1', title: '紅燒籠' }]}
        focusedParentId="r1"
        focusedParentKind="resources"
      />,
    );
    // The effect's setTimeout(80) gives the tab switch time to commit.
    await waitFor(() => {
      const resourceLookups = queriedIds.filter(
        (s) => s === '[data-row-id="r1"]',
      );
      expect(resourceLookups.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('queries the DOM for the matching row by data-row-id', async () => {
    render(
      <WeddingDay
        {...baseProps()}
        resources={[{ id: 'r42', title: '紅燒籠' }]}
        focusedParentId="r42"
        focusedParentKind="resources"
      />,
    );
    await waitFor(() => {
      const ids = queriedIds.filter((s) => s.startsWith('[data-row-id='));
      expect(ids).toContain('[data-row-id="r42"]');
    });
  });

  it('calls scrollIntoView on the matched element', async () => {
    // Render with the focus prop; capture the fake element the test
    // stub returned for the querySelector call.
    let capturedEl = null;
    document.querySelector = vi.fn((selector) => {
      const match = selector.match(/^\[data-row-id="(.+)"\]$/);
      if (!match) return originalQuerySelector(selector);
      const fakeEl = {
        id: match[1],
        scrollIntoView: vi.fn(),
        classList: {
          _classes: new Set(),
          add(...cls) { cls.forEach((c) => this._classes.add(c)); },
          remove(...cls) { cls.forEach((c) => this._classes.delete(c)); },
          contains(c) { return this._classes.has(c); },
        },
      };
      capturedEl = fakeEl;
      return fakeEl;
    });

    render(
      <WeddingDay
        {...baseProps()}
        rundown={[{ id: 'run-99', title: '行禮', startTime: '12:00', durationMin: 30 }]}
        focusedParentId="run-99"
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

  it('applies a temporary ring highlight to the focused row', async () => {
    let capturedEl = null;
    document.querySelector = vi.fn((selector) => {
      const match = selector.match(/^\[data-row-id="(.+)"\]$/);
      if (!match) return originalQuerySelector(selector);
      const fakeEl = {
        id: match[1],
        scrollIntoView: vi.fn(),
        classList: {
          _classes: new Set(),
          add(...cls) { cls.forEach((c) => this._classes.add(c)); },
          remove(...cls) { cls.forEach((c) => this._classes.delete(c)); },
          contains(c) { return this._classes.has(c); },
        },
      };
      capturedEl = fakeEl;
      return fakeEl;
    });

    render(
      <WeddingDay
        {...baseProps()}
        rundown={[{ id: 'run-1', title: '行禮', startTime: '12:00', durationMin: 30 }]}
        focusedParentId="run-1"
        focusedParentKind="rundown"
      />,
    );

    // After the effect runs and before the 2400ms highlight
    // timeout fires, the row should have the ring classes.
    await waitFor(() => {
      expect(capturedEl).not.toBeNull();
      expect(capturedEl.classList.contains('ring-rose-400')).toBe(true);
    });
  });

  it('ignores unknown focusedParentKind values (no crash)', async () => {
    // This is the defensive branch in App.jsx's onOpenCommentAlert:
    // we set null in App.jsx, but if a future caller passes a bad
    // kind directly, WeddingDay should silently no-op.
    expect(() =>
      render(
        <WeddingDay
          {...baseProps()}
          focusedParentId="r1"
          focusedParentKind="bogus"
        />,
      ),
    ).not.toThrow();
  });
});