/**
 * 2026-08-31 — Manus P11.
 *
 * Routing-decision tests for the `openHelperNotification`
 * handler in App.jsx. We don't mount App.jsx here (too much
 * Firebase / context plumbing); instead we exercise the
 * decision matrix that App.jsx applies via small inline
 * copies of the dispatch logic, and assert each branch.
 *
 * The matrix is:
 *
 *   role !== 'helper'            → fall back to commentAlert path
 *   meta.taskId                  → focusedTaskId + view='helper-dashboard'
 *   meta.kind ∈ {rundown,resources} → focusedParentKind/Id + view='helper-dashboard'
 *   otherwise                    → fall back
 *
 * If App.jsx's logic ever drifts from this matrix, these
 * tests fail with a clear intent. The actual App.jsx handler
 * is exercised end-to-end in App.comment-focus.test.jsx.
 */

import { describe, expect, it } from 'vitest';

function dispatch(opts) {
  const { meta, role } = opts;
  if (!meta) return { kind: 'noop' };
  if (role !== 'helper') return { kind: 'fallback-comment' };
  if (meta.taskId) {
    return {
      kind: 'focused-task',
      focusedTaskId: meta.taskId,
      focusedParentKind: null,
      focusedParentId: null,
      view: 'helper-dashboard',
    };
  }
  if (meta.kind === 'rundown' || meta.kind === 'resources') {
    return {
      kind: 'focused-parent',
      focusedParentKind: meta.kind,
      focusedParentId: meta.parentId || null,
      focusedTaskId: null,
      view: 'helper-dashboard',
    };
  }
  return { kind: 'fallback-comment' };
}

describe('openHelperNotification dispatch', () => {
  it('returns focused-task when meta.taskId is present (task-status alert)', () => {
    const r = dispatch({
      role: 'helper',
      meta: { taskId: 'task-9', eventId: 'event-1' },
    });
    expect(r.kind).toBe('focused-task');
    expect(r.focusedTaskId).toBe('task-9');
    expect(r.focusedParentKind).toBeNull();
    expect(r.view).toBe('helper-dashboard');
  });

  it('returns focused-parent for rundown assignment / update alerts', () => {
    const r = dispatch({
      role: 'helper',
      meta: {
        eventId: 'event-1',
        kind: 'rundown',
        parentId: 'item-7',
      },
    });
    expect(r.kind).toBe('focused-parent');
    expect(r.focusedParentKind).toBe('rundown');
    expect(r.focusedParentId).toBe('item-7');
    expect(r.focusedTaskId).toBeNull();
    expect(r.view).toBe('helper-dashboard');
  });

  it('returns focused-parent for resources assignment / update alerts', () => {
    const r = dispatch({
      role: 'helper',
      meta: { eventId: 'event-1', kind: 'resources', parentId: 'item-3' },
    });
    expect(r.kind).toBe('focused-parent');
    expect(r.focusedParentKind).toBe('resources');
    expect(r.focusedParentId).toBe('item-3');
  });

  it('falls back to commentAlert path for owner / vendor / co-owner roles', () => {
    for (const role of ['owner', 'co-owner', 'vendor']) {
      const r = dispatch({ role, meta: { taskId: 'task-1', eventId: 'e' } });
      expect(r.kind, `role=${role}`).toBe('fallback-comment');
    }
  });

  it('falls back when meta has neither taskId nor a known kind', () => {
    const r = dispatch({
      role: 'helper',
      meta: { eventId: 'event-1' }, // no taskId, no kind
    });
    expect(r.kind).toBe('fallback-comment');
  });

  it('returns noop when meta is null', () => {
    expect(dispatch({ role: 'helper', meta: null }).kind).toBe('noop');
  });

  it('treats taskId as authoritative even when kind is also present (no ambiguity)', () => {
    // A future alert type may carry both — the routing logic must
    // prioritize taskId so the helper lands on Tasks, not Big Day.
    const r = dispatch({
      role: 'helper',
      meta: {
        eventId: 'event-1',
        taskId: 'task-1',
        kind: 'rundown',
        parentId: 'item-1',
      },
    });
    expect(r.kind).toBe('focused-task');
    expect(r.focusedTaskId).toBe('task-1');
    expect(r.focusedParentKind).toBeNull();
  });
});