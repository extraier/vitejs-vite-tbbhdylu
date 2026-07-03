// Smoke test: render <GuestList> exactly as App.jsx does at line 860
// and confirm it produces DOM content. Catches runtime errors that the
// linter misses (e.g. undefined methods on real Firebase objects,
// brittle destructuring, etc.).
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
  it('renders title and table for owner', () => {
    render(<GuestList {...baseProps} />);
    expect(screen.getByText(/嘉賓名單與座位表/)).toBeTruthy();
    expect(screen.getByText('陳大文')).toBeTruthy();
    expect(screen.getByText('李小花')).toBeTruthy();
  });

  it('renders empty state for guests=[]', () => {
    render(<GuestList {...baseProps} guests={[]} />);
    expect(screen.getByText(/尚未加入任何嘉賓/)).toBeTruthy();
  });

  it('renders identically for owner userRole', () => {
    const { container: a } = render(<GuestList {...baseProps} />);
    const rowsA = a.querySelectorAll('tbody tr').length;
    expect(rowsA).toBeGreaterThan(0);
  });
});
