// 2026-08-17 — Manus A8 regression guard: vendor-side bell-click
// deep-link focus.
//
// When App.jsx sets `focusedParentKind` ∈ {rundown, resources} and
// `focusedParentId`, <VendorDashboard> must:
//   1. Auto-expand the matching <VendorAssignedItem> by passing
//      forceExpanded=true on the row whose id matches
//   2. Call scrollIntoView on that row
//   3. Briefly apply a rose-400 ring highlight
//   4. Invoke onFocusedParentHandled so App.jsx can clear state
//
// Mirrors the existing WeddingDay focus-effect test pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { VendorDashboard } from './VendorDashboard';

// Stub the heavy comment thread + analytics panels so the focus
// effect can mount without dragging in Firestore / Recharts.
// Capture the ItemComments props so the comment-level deep-link
// tests (2026-08-20) can assert what was forwarded.
const itemCommentsProps = { current: [] };
vi.mock('../components/ItemComments', () => ({
  ItemComments: (props) => {
    itemCommentsProps.current.push(props);
    return <div data-testid="item-comments-stub" />;
  },
}));
vi.mock('../components/VendorPortfolioAnalytics', () => ({
  VendorPortfolioAnalytics: () => null,
}));
vi.mock('../components/VendorInquiriesPanel', () => ({
  VendorInquiriesPanel: () => null,
}));
vi.mock('../components/TaskActivityTimeline', () => ({
  TaskActivityTimeline: () => null,
}));

// Stub querySelector so we can capture which row the focus effect
// targeted, and stub scrollIntoView so we don't depend on jsdom's
// layout engine (it doesn't actually scroll).
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
  // requestAnimationFrame resolves synchronously here so we don't
  // need to flush timers manually — the effect's rAF callback
  // runs in the same act() tick that scheduled it.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb) => {
      cb(0);
      return 0;
    },
  );
});
afterEach(() => {
  document.querySelector = originalQuerySelector;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  cleanup();
  vi.restoreAllMocks();
});

const baseProps = {
  user: { uid: 'vendor-1', displayName: '靚相攝影' },
  vendor: { uid: 'vendor-1', name: '靚相攝影' },
  jobRequests: [],
  loading: false,
  onSubmitProposal: () => {},
  onManageProfile: () => {},
  onLogout: () => {},
  assignedTasks: [],
  onUpdateTaskStatus: () => {},
  onOpenInquiry: () => {},
};

const rundownFixture = [
  {
    id: 'rd-99',
    ownerUid: 'couple-1',
    eventId: 'event-1',
    title: '攝影師到場',
    startTime: '15:30',
    description: '請於典禮開始前 30 分鐘到場',
    eventName: 'Roger & Joy',
    eventDate: '2027-01-01',
    // Object form — matches what App.jsx actually passes (the
    // ItemComments contract uses __segments). The VendorAssignedItem
    // focus-effect must NOT crash on this.
    commentPath: { __segments: ['artifacts', 'rundown', 'rd-99', 'comments'] },
  },
  {
    id: 'rd-other',
    ownerUid: 'couple-1',
    eventId: 'event-1',
    title: '新娘行禮',
    startTime: '16:00',
    description: '',
    eventName: 'Roger & Joy',
    eventDate: '2027-01-01',
    commentPath: { __segments: ['artifacts', 'rundown', 'rd-other', 'comments'] },
  },
];

const resourceFixture = [
  {
    id: 'rs-42',
    ownerUid: 'couple-1',
    eventId: 'event-1',
    title: '場地平面圖',
    location: '尖沙咀美麗華',
    eventName: 'Roger & Joy',
    eventDate: '2027-01-01',
    commentPath: { __segments: ['artifacts', 'resources', 'rs-42', 'comments'] },
  },
];

describe('VendorDashboard — A8 bell-click deep-link focus', () => {
  it('does nothing when focusedParentId is null', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
      />,
    );
    expect(queriedIds.filter((s) => s.startsWith('[data-row-id='))).toEqual(
      [],
    );
  });

  it('queries the DOM for the matching rundown row by data-row-id', async () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
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
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
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
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
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
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
      />,
    );
    await waitFor(() => {
      expect(capturedEl).not.toBeNull();
      // The effect calls el.classList.add('ring-2', 'ring-rose-400', 'rounded-xl')
      // as three separate spread args (not an array). Inspect the
      // first add() call's flat argument list.
      expect(capturedEl.classList.add).toHaveBeenCalled();
      const firstCallArgs = capturedEl.classList.add.mock.calls[0];
      // The call is recorded as add(arg1, arg2, arg3, ...) — flatten.
      const flat = firstCallArgs.flat();
      expect(flat).toContain('ring-rose-400');
      expect(flat).toContain('ring-2');
    });
  });

  it('invokes onFocusedParentHandled once the focus effect lands', async () => {
    const handled = vi.fn();
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
        focusedParentId="rs-42"
        focusedParentKind="resources"
        onFocusedParentHandled={handled}
      />,
    );
    await waitFor(() => {
      expect(handled).toHaveBeenCalledTimes(1);
    });
  });

  // 2026-08-20 — Manus P0 #4: vendor row callback race. When
  // focusedCommentId is set, this is a COMMENT-level deep-link,
  // not a row-only legacy link. In that case the row-scroll's
  // onFocusedRef ack would clobber focusedCommentId before
  // <ItemComments> had a chance to read it. VendorAssignedItem
  // must skip the parent ack for comment-level focus; only the
  // <ItemComments> consumption callback should clear state.
  it('does NOT invoke onFocusedParentHandled when focusedCommentId is set (Manus P0 race fix)', async () => {
    const handled = vi.fn();
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
        focusedCommentId="cmt-alert-1"
        onFocusedParentHandled={handled}
      />,
    );
    // Run for a generous window — the row-scroll effect uses
    // requestAnimationFrame. Without the guard, handled would
    // fire within ~50ms.
    await new Promise((r) => setTimeout(r, 100));
    expect(handled).not.toHaveBeenCalled();
  });

  // 2026-08-20 — Manus P0 parity check: the legacy parent-only
  // path still works (focusedCommentId null → handled fires).
  // This is the regression guard for the parent-only deep-link
  // case so we don't break the row scroll when only the parent
  // is targeted (no specific comment).
  it('STILL invokes onFocusedParentHandled when focusedCommentId is null (legacy parent-only path)', async () => {
    const handled = vi.fn();
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        focusedParentId="rd-99"
        focusedParentKind="rundown"
        focusedCommentId={null}
        onFocusedParentHandled={handled}
      />,
    );
    await waitFor(() => {
      expect(handled).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire when focusedParentId matches a row in the OTHER section', async () => {
    // The rundown list should only auto-expand for kind=rundown.
    // A kind=resources focus on a rundown id should be a no-op.
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
        focusedParentId="rd-99"
        focusedParentKind="resources"
      />,
    );
    // Let any pending rAF + scroll run.
    await new Promise((r) => setTimeout(r, 50));
    // No DOM lookup should have happened for the focus target —
    // capturedEl stays null because the VendorAssignedItem for
    // rd-99 received forceExpanded=false (kind mismatch).
    expect(capturedEl).toBeNull();
    expect(
      queriedIds.filter((s) => s === '[data-row-id="rd-99"]'),
    ).toEqual([]);
  });

  it('renders the assigned item with the row-id data attribute', () => {
    // Static shape guard: every assigned row must carry
    // data-row-id so the focus effect can find it.
    const { container } = render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
      />,
    );
    const rows = container.querySelectorAll('[data-row-id]');
    const ids = Array.from(rows).map((el) => el.getAttribute('data-row-id'));
    expect(ids).toContain('rd-99');
    expect(ids).toContain('rd-other');
    expect(ids).toContain('rs-42');
  });

  it('renders the assigned item with the row-kind data attribute', () => {
    // Defensive guard: the VendorAssignedItem focus effect uses
    // data-row-kind as a fallback filter. The fixture uses object
    // commentPath with __segments; the row-kind derivation must
    // still produce 'rundown' / 'resources' from the segments.
    const { container } = render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={rundownFixture}
        assignedResources={resourceFixture}
      />,
    );
    const rows = container.querySelectorAll('[data-row-id]');
    const rd99 = Array.from(rows).find(
      (el) => el.getAttribute('data-row-id') === 'rd-99',
    );
    const rs42 = Array.from(rows).find(
      (el) => el.getAttribute('data-row-id') === 'rs-42',
    );
    expect(rd99.getAttribute('data-row-kind')).toBe('rundown');
    expect(rs42.getAttribute('data-row-kind')).toBe('resources');
  });

  it('renders the assigned item with the row-kind "rundown" when commentPath is a string path', () => {
    // String commentPath branch — covers the path-string fallback
    // in the data-row-kind derivation.
    const stringPathFixture = [
      {
        ...rundownFixture[0],
        id: 'rd-string',
        commentPath:
          'artifacts/app-1/users/couple-1/events/event-1/rundown/rd-string/comments',
      },
    ];
    const { container } = render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={stringPathFixture}
      />,
    );
    const rows = container.querySelectorAll('[data-row-id]');
    const rdString = Array.from(rows).find(
      (el) => el.getAttribute('data-row-id') === 'rd-string',
    );
    expect(rdString.getAttribute('data-row-kind')).toBe('rundown');
  });

  it('renders the assigned item with empty row-kind when commentPath is missing', () => {
    // Legacy docs may not have commentPath yet — the dashboard
    // must still render the row, just without a kind label.
    const legacyFixture = [
      { ...rundownFixture[0], id: 'rd-legacy', commentPath: null },
    ];
    const { container } = render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={legacyFixture}
      />,
    );
    const rows = container.querySelectorAll('[data-row-id="rd-legacy"]');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-row-kind')).toBe('');
  });

  // 2026-08-20 — Manus: comment-level deep-link tests. The bell-
    // alert handler in App.jsx captures meta.commentId and passes it
    // down as focusedCommentId. The vendor's <ItemComments> panel
    // (mounted inside the expanded row) must receive this prop so
    // it can scrollIntoView the matching comment.
    //
    // Test fixtures use object-form commentPath ({ __segments: [...] })
    // rather than Firestore CollectionReferences, so we match by the
    // __segments content rather than by .path.
    const findICForItemId = (id) =>
      itemCommentsProps.current.find((p) => {
        const segs = p.path?.__segments || [];
        return segs.includes(id);
      });

    it('forwards focusedCommentId to <ItemComments> on the matching row', async () => {
      itemCommentsProps.current.length = 0;
      render(
        <VendorDashboard
          {...baseProps}
          assignedRundown={rundownFixture}
          focusedParentId="rd-99"
          focusedParentKind="rundown"
          focusedCommentId="cmt-alert-1"
        />,
      );
      await waitFor(() => {
        expect(itemCommentsProps.current.length).toBeGreaterThan(0);
      });
      const icForRd99 = findICForItemId('rd-99');
      expect(icForRd99).toBeDefined();
      expect(icForRd99.focusedCommentId).toBe('cmt-alert-1');
    });

    it('does NOT pass focusedCommentId to non-matching rows', async () => {
      itemCommentsProps.current.length = 0;
      // Render with focusedParentId=rd-99 — only that row mounts
      // <ItemComments> (because forceExpanded is true only for the
      // match), so the assertion is straightforward: confirm the
      // matching row got the prop, then re-render with a different
      // match and confirm the previous match's panel gets null on
      // re-render.
      const { rerender } = render(
        <VendorDashboard
          {...baseProps}
          assignedRundown={rundownFixture}
          focusedParentId="rd-99"
          focusedParentKind="rundown"
          focusedCommentId="cmt-alert-1"
        />,
      );
      await waitFor(() => {
        expect(itemCommentsProps.current.length).toBeGreaterThan(0);
      });
      const icForRd99 = findICForItemId('rd-99');
      expect(icForRd99?.focusedCommentId).toBe('cmt-alert-1');
      // Other mounted panels (from non-matching rows) get null.
      for (const p of itemCommentsProps.current) {
        if (p === icForRd99) continue;
        expect(p.focusedCommentId).toBeNull();
      }
      // Re-render with a resources match — rd-99 panel should
      // remount with focusedCommentId=null on its next render.
      itemCommentsProps.current.length = 0;
      rerender(
        <VendorDashboard
          {...baseProps}
          assignedRundown={rundownFixture}
          focusedParentId="rd-other"
          focusedParentKind="rundown"
          focusedCommentId="cmt-alert-2"
        />,
      );
      await waitFor(() => {
        expect(itemCommentsProps.current.length).toBeGreaterThan(0);
      });
      const icForRdOther = findICForItemId('rd-other');
      expect(icForRdOther?.focusedCommentId).toBe('cmt-alert-2');
      // The previously-mounted rd-99 panel also re-rendered; it
      // should now have focusedCommentId=null because rd-99 is no
      // longer the matching id.
      const icForRd99Again = findICForItemId('rd-99');
      expect(icForRd99Again?.focusedCommentId).toBeNull();
    });

    it('passes null focusedCommentId by default (backwards-compat)', async () => {
      itemCommentsProps.current.length = 0;
      render(
        <VendorDashboard
          {...baseProps}
          assignedRundown={rundownFixture}
          focusedParentId="rd-99"
          focusedParentKind="rundown"
        />,
      );
      await waitFor(() => {
        expect(itemCommentsProps.current.length).toBeGreaterThan(0);
      });
      const ic = findICForItemId('rd-99');
      expect(ic?.focusedCommentId).toBeNull();
    });
});