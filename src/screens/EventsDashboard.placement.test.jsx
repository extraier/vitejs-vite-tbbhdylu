// Lock the position of the per-card action menu. Bug found in
// production 2026-08-01: with `top-3 left-3` the ⋯ button sat
// on top of the first character of every event card title. Moved
// to `top-3 right-3` and the popover's `right-0` so the menu
// opens to the right (no horizontal overflow on mobile).
//
// This test guards against a regression of the position itself,
// not the menu behaviour (which the rest of the suite covers).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventsDashboard } from './EventsDashboard';

vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: () => ({ tier: null, unlocks: [] }),
}));

vi.mock('../lib/firebase', () => ({
  db: {}, appId: 'test-app', auth: {}, functions: {}, storage: {},
}));

const baseProps = {
  events: [
    { id: 'ev-1', name: '志明 & 春嬌', date: '2027-01-01' },
    { id: 'ev-2', name: 'test again and again', date: '2027-01-01' },
  ],
  newEventName: '',
  onNewEventNameChange: () => {},
  onCreate: () => {},
  onSelectEvent: () => {},
  onRename: () => {},
  onDelete: () => {},
};

describe('EventsDashboard — per-card action menu placement', () => {
  it('renders the ⋯ button with the top-right anchor (not top-left)', () => {
    const { container } = render(<EventsDashboard {...baseProps} />);
    // The menu wrapper div carries the anchor class. Find it by
    // its role/aria-label, then walk up to the absolute wrapper.
    const triggers = screen.getAllByLabelText('專案操作');
    expect(triggers.length).toBeGreaterThan(0);
    const wrapper = triggers[0].parentElement;
    expect(wrapper).not.toBeNull();
    const wrapperClass = wrapper && wrapper.className;
    expect(wrapperClass).toMatch(/top-3/);
    expect(wrapperClass).toMatch(/right-3/);
    expect(wrapperClass).not.toMatch(/left-3/);
    // z-index above the optional premium ribbon at top-right
    // (the ribbon uses no z-utility, so a small one is enough)
    expect(wrapperClass).toMatch(/z-20/);
    // Sanity-check that at least one card title still rendered
    expect(screen.getByText('志明 & 春嬌')).toBeTruthy();
    expect(container).toBeTruthy();
  });
});
