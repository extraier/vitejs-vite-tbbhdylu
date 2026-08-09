// 2026-08-09 — Smoke test for the new vendor-assigned rundown +
// resources surface in <VendorDashboard/>. Regression guard: a vendor
// who has been assigned rundown entries / resources from a couple
// must see them in their dashboard, and the expand-to-comment
// button must render.
//
// Mirrors the existing VendorPicker / BellNotifications pattern:
// small focused tests that catch the specific regressions a future
// refactor would introduce.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VendorDashboard } from './VendorDashboard';

// Stub the heavy comment thread so the smoke test doesn't try to
// open a real Firestore socket. We still assert that the
// "expand comments" affordance is rendered when there's a path.
vi.mock('../components/ItemComments', () => ({
  ItemComments: () => <div data-testid="item-comments-stub" />,
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

const baseProps = {
  user: { uid: 'vendor-1', displayName: '靚相攝影' },
  vendor: { uid: 'vendor-1', name: '靚相攝影' },
  jobRequests: [],
  loading: false,
  onSubmitProposal: () => {},
  onManageProfile: () => {},
  onLogout: () => {},
  assignedTasks: [],
  assignedRundown: [],
  assignedResources: [],
  onUpdateTaskStatus: () => {},
  onOpenInquiry: () => {},
};

const sampleRundown = [
  {
    id: 'rd-1',
    ownerUid: 'couple-1',
    eventId: 'event-1',
    title: '攝影師到場',
    startTime: '15:30',
    description: '請於典禮開始前 30 分鐘到場',
    eventName: 'Roger & Joy',
    commentPath: { __segments: ['fake', 'rundown', 'rd-1', 'comments'] },
  },
];

const sampleResources = [
  {
    id: 'rs-1',
    ownerUid: 'couple-1',
    eventId: 'event-1',
    title: '場地平面圖',
    location: '尖沙咀美麗華',
    commentPath: { __segments: ['fake', 'resources', 'rs-1', 'comments'] },
  },
];

describe('VendorDashboard — assigned rundown + resources', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('renders the rundown section when the vendor has assigned rundown entries', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={sampleRundown}
      />,
    );
    expect(screen.getByText('🕒 大日流程 (1)')).toBeTruthy();
    expect(screen.getByText('攝影師到場')).toBeTruthy();
    expect(screen.getByText(/15:30/)).toBeTruthy();
  });

  it('renders the resources section when the vendor has assigned resource items', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedResources={sampleResources}
      />,
    );
    expect(screen.getByText('📦 物資 (1)')).toBeTruthy();
    expect(screen.getByText('場地平面圖')).toBeTruthy();
  });

  it('shows an empty-state hint when nothing is assigned (regression: silent empty)', () => {
    render(<VendorDashboard {...baseProps} />);
    expect(screen.getByText(/暫時未有指派工作/)).toBeTruthy();
  });

  it('expands the comment thread when the message button is clicked', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={sampleRundown}
      />,
    );
    const commentBtn = screen.getAllByLabelText('留言溝通')[0];
    fireEvent.click(commentBtn);
    expect(screen.getByTestId('item-comments-stub')).toBeTruthy();
  });

  it('renders a clear error when commentPath is missing (no silent bails)', () => {
    const broken = [{ ...sampleRundown[0], commentPath: null }];
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={broken}
      />,
    );
    const commentBtn = screen.getByLabelText('留言溝通');
    fireEvent.click(commentBtn);
    expect(screen.getByText(/留言路徑未準備好/)).toBeTruthy();
  });
});
