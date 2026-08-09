// 2026-08-09 — Smoke test for the new vendor-assigned rundown +
// resources surface in <VendorDashboard/>. Regression guard: a vendor
// who has been assigned rundown entries / resources from a couple
// must see them in their dashboard, and the expand-to-comment
// button must render.
//
// 2026-08-09 (later) — group-by-event regression guard. A vendor
// who takes more than one wedding at a time must see each event in
// its own section (header: event name + date) so they can tell
// which item belongs to which wedding. The denormalized eventName
// + eventDate fields are surfaced at the section header AND on
// each item card (defense-in-depth in case the section header
// gets truncated on narrow viewports).
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
    eventDate: '2027-01-01',
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
    eventName: 'Roger & Joy',
    eventDate: '2027-01-01',
    commentPath: { __segments: ['fake', 'resources', 'rs-1', 'comments'] },
  },
];

describe('VendorDashboard — assigned rundown + resources', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('renders the rundown under the event-section header with event name + date', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={sampleRundown}
      />,
    );
    // Section header surfaces the event name + date (regression
    // guard for the 2026-08-09 group-by-event change).
    expect(screen.getAllByText('Roger & Joy').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2027-01-01/).length).toBeGreaterThan(0);
    // Per-item type label is now a sub-header (h4) inside the section.
    expect(screen.getByText('🕒 大日流程 (1)')).toBeTruthy();
    expect(screen.getByText('攝影師到場')).toBeTruthy();
    expect(screen.getByText(/15:30/)).toBeTruthy();
  });

  it('renders the resources under the event-section header with event name + date', () => {
    render(
      <VendorDashboard
        {...baseProps}
        assignedResources={sampleResources}
      />,
    );
    expect(screen.getAllByText('Roger & Joy').length).toBeGreaterThan(0);
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

describe('VendorDashboard — multiple events for the same vendor', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('renders a separate section per event, ordered by date asc (soonest first)', () => {
    // Vendor is assigned items across TWO weddings. The two events
    // must each get their own section header so the vendor can tell
    // which items belong to which wedding.
    const rundownA = [
      {
        id: 'rd-A',
        ownerUid: 'couple-A',
        eventId: 'event-A',
        title: '場地確認',
        startTime: '10:00',
        eventName: 'Roger & Joy',
        eventDate: '2027-01-01',
        commentPath: { __segments: ['fake'] },
      },
    ];
    const rundownB = [
      {
        id: 'rd-B',
        ownerUid: 'couple-B',
        eventId: 'event-B',
        title: '攝影師到場',
        startTime: '11:00',
        eventName: 'Winni & Louis',
        eventDate: '2027-04-15',
        commentPath: { __segments: ['fake'] },
      },
    ];
    const { container } = render(
      <VendorDashboard
        {...baseProps}
        assignedRundown={[...rundownB, ...rundownA]}
      />,
    );
    // Both event names render as section headers.
    expect(screen.getAllByText('Roger & Joy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Winni & Louis').length).toBeGreaterThan(0);
    // Both items render.
    expect(screen.getByText('場地確認')).toBeTruthy();
    expect(screen.getByText('攝影師到場')).toBeTruthy();
    // Date ordering: 2027-01-01 should appear before 2027-04-15 in
    // the DOM. Use container.textContent to read in DOM order.
    const text = container.textContent;
    const idxA = text.indexOf('2027-01-01');
    const idxB = text.indexOf('2027-04-15');
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });

  it('falls back gracefully when eventName/eventDate are missing (legacy docs)', () => {
    // Pre-denormalization docs lack eventName / eventDate. The
    // dashboard must still render the item, just without the
    // section header. (Vendor sees a short eventId stub.)
    const legacy = [
      {
        id: 'rd-1',
        ownerUid: 'couple-1',
        eventId: 'eventXYZ',
        title: '場地確認',
        startTime: '10:00',
        commentPath: { __segments: ['fake'] },
      },
    ];
    render(<VendorDashboard {...baseProps} assignedRundown={legacy} />);
    // Item still renders.
    expect(screen.getByText('場地確認')).toBeTruthy();
    // Per-item fallback surfaces a truncated eventId instead of
    // the event name. Asserts the contract: vendor still sees the
    // item, even if the event name is missing.
    // The fallback text is "(event eventX…)" — check via container
    // textContent because the message has multiple child elements
    // (emoji span + inner span).
    const text = screen.getByText('場地確認').closest('li')?.textContent || '';
    expect(text).toMatch(/eventX…/);
  });
});
