/**
 * 2026-09-11 — Hermes P12.4. Snapshot UI tests.
 *
 * Asserts that VendorRundownSnapshotSection:
 *   - renders "📅 全日流程 (只讀)" heading
 *   - surfaces "你的工作" badge ONLY on rows where
 *     isAssignedToViewer === true
 *   - surfaces "已延遲 N 分鐘" marker ONLY on rows where
 *     approvedDelayMinutes > 0
 *   - "只看我的工作" toggle hides non-assigned rows
 *   - "今日全日流程未有完整截圖" caption appears for empty rows
 *
 * Mounts the section in isolation to avoid the full
 * VendorDashboard state machine.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { VendorRundownSnapshotSection } from './VendorDashboard';

describe('VendorRundownSnapshotSection — P12 (read-only Big Day snapshot)', () => {
  it('renders the heading + helper caption', () => {
    render(
      <VendorRundownSnapshotSection
        rows={[
          { id: 'e1', ownerUid: 'o', eventId: 'e', title: '流程', startTime: '09:00', isAssignedToViewer: false },
        ]}
      />,
    );
    expect(screen.getByText(/全日流程/)).toBeTruthy();
    expect(screen.getByText(/只看我的工作/)).toBeTruthy();
  });

  it('surfaces "你的工作" badge ONLY on isAssignedToViewer=true rows', () => {
    const { container } = render(
      <VendorRundownSnapshotSection
        rows={[
          { id: 'mine', ownerUid: 'o', eventId: 'e', title: '我的環節', isAssignedToViewer: true },
          { id: 'others-a', ownerUid: 'o', eventId: 'e', title: '其他人 a', isAssignedToViewer: false },
          { id: 'others-b', ownerUid: 'o', eventId: 'e', title: '其他人 b', isAssignedToViewer: false },
        ]}
      />,
    );
    const badges = container.querySelectorAll('[data-testid="vendor-rundown-mine-badge"]');
    expect(badges).toHaveLength(1);
    const rows = container.querySelectorAll('[data-testid="vendor-rundown-row"]');
    expect(rows).toHaveLength(3);
    // Mine row has data-assigned-to-viewer=true; the others have false.
    expect(rows[0].getAttribute('data-assigned-to-viewer')).toBe('true');
    expect(rows[1].getAttribute('data-assigned-to-viewer')).toBe('false');
    expect(rows[2].getAttribute('data-assigned-to-viewer')).toBe('false');
  });

  it('surfaces "已延遲 N 分鐘" marker ONLY on rows with approvedDelayMinutes > 0', () => {
    const { container } = render(
      <VendorRundownSnapshotSection
        rows={[
          { id: 'delayed', ownerUid: 'o', eventId: 'e', title: '延遲流程', isAssignedToViewer: false, approvedDelayMinutes: 30 },
          { id: 'no-delay', ownerUid: 'o', eventId: 'e', title: '準時', isAssignedToViewer: false, approvedDelayMinutes: 0 },
          { id: 'pending', ownerUid: 'o', eventId: 'e', title: '待批', isAssignedToViewer: false, approvedDelayMinutes: null },
        ]}
      />,
    );
    const markers = container.querySelectorAll('[data-testid="vendor-rundown-approved-delay"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toContain('已延遲 30 分鐘');
  });

  it('"只看我的工作" toggle hides non-assigned rows', () => {
    const { container } = render(
      <VendorRundownSnapshotSection
        rows={[
          { id: 'mine', ownerUid: 'o', eventId: 'e', title: '我的', isAssignedToViewer: true },
          { id: 'a', ownerUid: 'o', eventId: 'e', title: '其他人', isAssignedToViewer: false },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-testid="vendor-rundown-row"]')).toHaveLength(2);
    const checkbox = container.querySelector('[data-testid="vendor-rundown-only-mine"]');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox);
    expect(container.querySelectorAll('[data-testid="vendor-rundown-row"]')).toHaveLength(1);
    const remainingRow = container.querySelector('[data-testid="vendor-rundown-row"]');
    expect(remainingRow?.getAttribute('data-assigned-to-viewer')).toBe('true');
  });

  it('shows the empty-state caption when rows is []', () => {
    render(<VendorRundownSnapshotSection rows={[]} />);
    expect(screen.getByText(/今日全日流程未有完整截圖/)).toBeTruthy();
  });

  it('"報告延誤" button only appears on assigned rows, and it forwards a payload to onReportDelay', () => {
    const onReportDelay = vi.fn();
    const { container } = render(
      <VendorRundownSnapshotSection
        rows={[
          {
            id: 'mine',
            ownerUid: 'owner-1',
            eventId: 'event-1',
            title: '敬茶',
            isAssignedToViewer: true,
            approvedDelayMinutes: 0,
          },
          {
            id: 'theirs',
            ownerUid: 'owner-1',
            eventId: 'event-1',
            title: '其他人',
            isAssignedToViewer: false,
          },
        ]}
        onReportDelay={onReportDelay}
      />,
    );
    const rows = container.querySelectorAll('[data-testid="vendor-rundown-row"]');
    const buttonsMine = within(rows[0]).queryAllByRole('button', { name: /報告延誤/ });
    const buttonsTheirs = within(rows[1]).queryAllByRole('button', { name: /報告延誤/ });
    expect(buttonsMine).toHaveLength(1);
    expect(buttonsTheirs).toHaveLength(0);
    fireEvent.click(buttonsMine[0]);
    expect(onReportDelay).toHaveBeenCalledTimes(1);
    const arg = onReportDelay.mock.calls[0][0];
    expect(arg).toMatchObject({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      entryId: 'mine',
    });
  });
});
