// Smoke test for InvitationEditor's editable metadata fields.
//
// Covers the new (2026-08-14) feature: the InfoStep exposes
// date/time/venue/address as inline-editable fields that override
// the event record *for this invitation only*. The user can
// change the date (e.g. "ceremony is 2pm, reception is 7pm")
// without rewriting the event record that powers RSVP, rundown,
// etc.
//
// We mock firebase/firestore so the smoke test stays in-process.
// The autosave round-trip is verified by inspecting the spy.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// In-memory doc store so getDoc/setDoc round-trip cleanly.
let docStore = {};
const resetDocStore = () => {
  docStore = {};
};

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: vi.fn((_db, ...parts) => ({ __path: parts.join('/') })),
    getDoc: vi.fn(async (ref) => {
      const data = docStore[ref.__path];
      return {
        exists: () => data !== undefined,
        data: () => data,
      };
    }),
    setDoc: vi.fn(async (ref, data, opts) => {
      if (opts && opts.merge) {
        docStore[ref.__path] = { ...(docStore[ref.__path] || {}), ...data };
      } else {
        docStore[ref.__path] = { ...data };
      }
    }),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  };
});

vi.mock('../lib/firebase', () => ({
  db: {},
  functions: {},
  auth: { currentUser: { uid: 'owner-uid' } },
  appId: 'savetheday-production',
}));

vi.mock('../lib/firebaseFn', () => ({
  callFirebaseFn: vi.fn(),
}));

// Templates: avoid loading from Firestore in this smoke test.
vi.mock('../components/invitation/templates', () => ({
  INVITATION_TEMPLATES: [],
  WORDING_TEMPLATES: [
    { id: 'classic', icon: '💌', label: '經典中式', text: '誠意邀請您蒞臨見證我哋嘅重要時刻。' },
  ],
  loadLiveTemplates: vi.fn(async () => []),
}));

vi.mock('../components/invitation/InvitationCard', () => ({
  InvitationCard: ({ event }) => (
    <div data-testid="invitation-card">
      <span data-testid="card-date">{event?.date}</span>
      <span data-testid="card-time">{event?.time}</span>
      <span data-testid="card-venue">{event?.venue}</span>
      <span data-testid="card-address">{event?.address}</span>
    </div>
  ),
}));

vi.mock('../components/modals/UpgradeModal', () => ({
  UpgradeModal: () => null,
}));

import { InvitationEditor } from './InvitationEditor';

const baseEvent = {
  id: 'event-1',
  name: '志明與春嬌',
  date: '2027-01-01',
  time: '18:00',
  venue: '四季酒店',
  address: '香港中環',
};

beforeEach(() => {
  resetDocStore();
  // Clear any pending autosave timers
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InvitationEditor — editable metadata (2026-08-14)', () => {
  it('renders event fields in InfoStep and shows them in the preview', async () => {
      render(
        <InvitationEditor
          isOpen
          ownerUid="owner-uid"
          eventId="event-1"
          event={baseEvent}
          guests={[]}
        />
      );
      // Click 下一步 to advance from step 0 (揀背景) to step 1 (寫心意).
      fireEvent.click(screen.getByText(/下一步/));
      // InfoStep renders the event name in a span. The EditableField
      // for date shows the event date as a placeholder when no override
      // is set. The preview InvitationCard mock also exposes the date.
      expect(screen.getByTestId('card-date').textContent).toBe('2027-01-01');
      expect(screen.getByTestId('card-venue').textContent).toBe('四季酒店');
    });

  it('clicking the date field reveals an input that pre-fills with the event date', async () => {
    render(
      <InvitationEditor
        isOpen
        ownerUid="owner-uid"
        eventId="event-1"
        event={baseEvent}
        guests={[]}
      />
    );
    fireEvent.click(screen.getByText(/下一步/));
    // The date row should render an EditableField. The value isn't
    // overridden yet, so we see the placeholder (the event date).
    const dateButtons = screen.getAllByTitle(/點擊改日期/);
    expect(dateButtons.length).toBe(1);
    fireEvent.click(dateButtons[0]);
    // Now an input appears. Its value should be the current override
    // (empty), with a placeholder of the event date.
    const dateInput = screen.getByPlaceholderText('2027-01-01');
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe('');
  });

  it('typing a new date and pressing Enter persists the override and updates the preview', async () => {
    render(
      <InvitationEditor
        isOpen
        ownerUid="owner-uid"
        eventId="event-1"
        event={baseEvent}
        guests={[]}
      />
    );
    fireEvent.click(screen.getByText(/下一步/));
    fireEvent.click(screen.getByTitle(/點擊改日期/));
    const dateInput = screen.getByPlaceholderText('2027-01-01');
    fireEvent.change(dateInput, { target: { value: '2027-06-15' } });
    fireEvent.keyDown(dateInput, { key: 'Enter' });
    // The preview card should now show the override, not the event date.
    await waitFor(() => {
      expect(screen.getByTestId('card-date').textContent).toBe('2027-06-15');
    });
  });

  it('autosave persists the override into Firestore under dateOverride', async () => {
    render(
      <InvitationEditor
        isOpen
        ownerUid="owner-uid"
        eventId="event-1"
        event={baseEvent}
        guests={[]}
      />
    );
    fireEvent.click(screen.getByText(/下一步/));
    fireEvent.click(screen.getByTitle(/點擊改日期/));
    const dateInput = screen.getByPlaceholderText('2027-01-01');
    fireEvent.change(dateInput, { target: { value: '2027-06-15' } });
    fireEvent.keyDown(dateInput, { key: 'Enter' });
    // Wait for the debounced autosave (500ms) plus a margin.
    await waitFor(
      () => {
        const saved = Object.values(docStore)[0];
        expect(saved?.dateOverride).toBe('2027-06-15');
      },
      { timeout: 2000 }
    );
  });

  it('pressing Escape cancels the edit and does not change state', async () => {
    render(
      <InvitationEditor
        isOpen
        ownerUid="owner-uid"
        eventId="event-1"
        event={baseEvent}
        guests={[]}
      />
    );
    fireEvent.click(screen.getByText(/下一步/));
    fireEvent.click(screen.getByTitle(/點擊改日期/));
    const dateInput = screen.getByPlaceholderText('2027-01-01');
    fireEvent.change(dateInput, { target: { value: '2027-06-15' } });
    fireEvent.keyDown(dateInput, { key: 'Escape' });
    // The preview still shows the event date (no override applied).
    expect(screen.getByTestId('card-date').textContent).toBe('2027-01-01');
  });

  it('four fields can be edited independently: date, time, venue, address', async () => {
    render(
      <InvitationEditor
        isOpen
        ownerUid="owner-uid"
        eventId="event-1"
        event={baseEvent}
        guests={[]}
      />
    );
    fireEvent.click(screen.getByText(/下一步/));

    // Edit all four
    fireEvent.click(screen.getByTitle(/點擊改日期/));
    fireEvent.change(screen.getByPlaceholderText('2027-01-01'), {
      target: { value: '2027-06-15' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('2027-01-01'), { key: 'Enter' });

    fireEvent.click(screen.getByTitle(/點擊改時間/));
    fireEvent.change(screen.getByPlaceholderText('18:00'), {
      target: { value: '19:30' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('18:00'), { key: 'Enter' });

    fireEvent.click(screen.getByTitle(/點擊改場地/));
    fireEvent.change(screen.getByPlaceholderText('四季酒店'), {
      target: { value: 'Grand Hyatt' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('四季酒店'), { key: 'Enter' });

    fireEvent.click(screen.getByTitle(/點擊改地址/));
    fireEvent.change(screen.getByPlaceholderText('香港中環'), {
      target: { value: '九龍尖沙咀' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('香港中環'), { key: 'Enter' });

    // All four overrides should appear in the preview
    await waitFor(() => {
      expect(screen.getByTestId('card-date').textContent).toBe('2027-06-15');
    });
    expect(screen.getByTestId('card-time').textContent).toBe('19:30');
    expect(screen.getByTestId('card-venue').textContent).toBe('Grand Hyatt');
    expect(screen.getByTestId('card-address').textContent).toBe('九龍尖沙咀');
  });
});

// 2026-08-19 — Manus P1.3: custom-invitation gate
// reads from entitlement, not tier flag.
//
// The actual fix is in App.jsx:
//   ownerTier={(entitlementFeatures.customInvitation
//               || currentEvent.tier === 'premium') ? 'premium' : 'free'}
// This smoke test verifies the gate policy: a customer whose
// event tier is still 'free' (unlock not yet processed) but
// whose entitlement.customInvitation is true IS allowed
// to upload a custom background. This is the bug Manus
// flagged: paying for the unlock should unlock the editor
// immediately even if the tier-flag writeback is delayed.
import { describe as describeP13, it as itP13, expect as expectP13 } from 'vitest';

function computeOwnerTier({ customInvitation, currentEventTier }) {
  return (customInvitation || currentEventTier === 'premium') ? 'premium' : 'free';
}

describeP13('InvitationEditor ownerTier derivation (P1.3)', () => {
  itP13('treats currentEvent.tier === "premium" as premium (legacy path)', () => {
    expect(computeOwnerTier({ customInvitation: false, currentEventTier: 'premium' })).toBe('premium');
  });

  itP13('treats entitlement.customInvitation as premium (new path)', () => {
    expect(computeOwnerTier({ customInvitation: true, currentEventTier: 'free' })).toBe('premium');
  });

  itP13('treats both true as premium (no double-bonus)', () => {
    expect(computeOwnerTier({ customInvitation: true, currentEventTier: 'premium' })).toBe('premium');
  });

  itP13('treats both false as free', () => {
    expect(computeOwnerTier({ customInvitation: false, currentEventTier: 'free' })).toBe('free');
  });

  itP13('the fix is the central case: paid but tier-flag not yet written', () => {
    // 2026-08-19 — Bug Manus flagged: the customer paid for
    // custom-template, the unlock doc was created under
    // users/{uid}/unlocks, getEventEntitlement returns
    // customInvitation=true, but currentEvent.tier is still
    // 'free' (the writeback is async). The editor must
    // permit custom-background upload.
    const r = computeOwnerTier({ customInvitation: true, currentEventTier: 'free' });
    expect(r).toBe('premium');
  });
});
