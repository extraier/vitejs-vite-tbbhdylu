// Smoke test: render <GuestList> exactly as App.jsx does at line 860
// and confirm it produces DOM content. Catches runtime errors that the
// linter misses (e.g. undefined methods on real Firebase objects,
// brittle destructuring, etc.).
//
// 2026-07-23 — The GuestList now renders the same data twice: once
// as a card stack (mobile, md:hidden) and once as a table
// (desktop, hidden md:block). JSDOM doesn't respect Tailwind's
// responsive breakpoints so both layouts appear in the DOM
// during tests, so the assertions must use getAllByText.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestList } from './GuestList';

const baseProps = {
  guests: [
    {
      id: 'g1', guestId: 'ABC001', name: '陳大文',
      group: '新郎朋友', tableNumber: 'T1',
      hasGifted: true, giftAmount: 1000,
      hasAttended: false, isHouseholdParent: false,
    },
    {
      id: 'g2', guestId: 'ABC002', name: '李小花',
      group: '新娘朋友', tableNumber: 'T2',
      hasGifted: false, giftAmount: 0,
      hasAttended: true, isHouseholdParent: true,
      householdId: 'ABC002',
    },
  ],
  userRole: 'owner',
  helperPerms: null,
  searchQuery: '',
  onSearchChange: () => {},
  newGuestForm: { name: '', group: '' },
  onNewGuestFormChange: () => {},
  onAddGuest: () => {},
  familyForm: { name: '', memberCount: 0 },
  onFamilyFormChange: () => {},
  onAddFamily: () => {},
  onPreviewAsGuest: () => {},
  onShowQr: () => {},
  onCheckIn: () => {},
  onOpenInvitationEditor: () => {},
  onEditGuest: () => {},
};

describe('GuestList smoke — App.jsx line 860 render', () => {
  it('renders title and guests for owner', () => {
    render(<GuestList {...baseProps} />);
    expect(screen.getByText(/嘉賓名單與座位表/)).toBeTruthy();
    // Responsive dual-render means names appear in both the card
    // stack and the table — assert presence with getAllByText.
    expect(screen.getAllByText('陳大文').length).toBeGreaterThan(0);
    expect(screen.getAllByText('李小花').length).toBeGreaterThan(0);
  });

  it('renders empty state for guests=[]', () => {
    render(<GuestList {...baseProps} guests={[]} />);
    // Empty state also shows in both layouts — use getAllByText.
    expect(screen.getAllByText(/尚未加入任何嘉賓/).length).toBeGreaterThan(0);
  });

  it('renders identically for owner userRole', () => {
    const { container: a } = render(<GuestList {...baseProps} />);
    // Count both table rows AND cards (since both render in JSDOM)
    const tableRows = a.querySelectorAll('tbody tr').length;
    const cards = a.querySelectorAll('[aria-label*="展開"], [aria-label*="收埋"]').length;
    expect(tableRows + cards).toBeGreaterThan(0);
  });
});
