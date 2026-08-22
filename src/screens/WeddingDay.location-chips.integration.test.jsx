// WeddingDay.location-chips.integration.test.jsx
//
// 2026-08-21 — Integration smoke for the 大日流程 location-filter
// chip row. Mounts the full <WeddingDay> surface (the existing
// focus-effect test established that pattern for A8), feeds it a
// representative rundown with mixed locations, forces the
// rundown subtab, and asserts the chip-row behavior:
//
//   1. The chip row DOES render when at least one entry has a
//      location.
//   2. The chip row has one chip per unique location with the
//      correct count.
//   3. Clicking a chip filters the visible rundown to that
//      location (combined with the existing category filter).
//   4. Clicking "全部地點" resets the location filter.
//   5. The chip row does NOT render when no entry has a location.
//
// The helper buildRundownLocationChips already has 8
// unit tests guarding its dedup / sort / count logic
// (WeddingDay.location-chips.test.ts). This file is the
// integration layer: HTML / DOM / event wiring.

import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { WeddingDay } from './WeddingDay';

// 2026-08-21 — Assert visible rundown rows by their title text.
// RundownCard renders the entry.title prominently in both
// time-sort + manual-sort modes, so counting rendered
// titles is the cross-mode visibility hook (data-row-id is
// only set by SortableRow in manual mode — see line 2156).
function visibleTitles(container) {
  return Array.from(container.querySelectorAll('[data-rundown-title]'))
    .map((el) => el.getAttribute('data-rundown-title'))
    .filter(Boolean);
}

afterEach(() => cleanup());

const baseProps = () => ({
  rundown: [],
  resources: [],
  teaCeremony: [],
  playlist: [],
  onUpsertRundown: () => {},
  onDeleteRundown: () => {},
  onReorderRundown: () => {},
  onSetRundownPositions: () => {},
  onUpsertResource: () => {},
  onDeleteResource: () => {},
  onToggleResource: () => {},
  onReorderResource: () => {},
  onSetResourcePositions: () => {},
  onUpsertTeaCeremony: () => {},
  onDeleteTeaCeremony: () => {},
  onSetTeaCeremonyOrders: () => {},
  onUpsertPlaylist: () => {},
  onDeletePlaylist: () => {},
  onReorderPlaylist: () => {},
  onSetPlaylistPositions: () => {},
  currentUser: { uid: 'u-owner' },
  helpers: [],
  showToast: () => {},
  ownerNames: { boyName: '志明', girlName: '春嬌' },
  vendors: [],
  ownerUid: 'owner-1',
  eventId: 'e-1',
  rundownCommentPathFor: () => null,
  resourceCommentPathFor: () => null,
});

describe('rundown location-filter chip row (integration)', () => {
  it('renders the location chip row when at least one entry has a location', () => {
    const rundown = [
      { id: 'r1', title: '新娘梳洗', startTime: '05:00', durationMin: 75, group: 'prep', location: '女家' },
      { id: 'r2', title: '敬茶', startTime: '09:00', durationMin: 30, group: 'ceremony', location: '男家' },
    ];
    render(<WeddingDay {...baseProps()} rundown={rundown} />);
    // Subtab defaults to 大日流程, so the chip rows are visible.
    expect(screen.getByTestId('rundown-location-row')).toBeInTheDocument();
    // Each location appears as a chip with the count.
    expect(screen.getByTestId('rundown-location-chip-女家')).toBeInTheDocument();
    expect(screen.getByTestId('rundown-location-chip-男家')).toBeInTheDocument();
    // The "全部地點" reset chip is present.
    expect(screen.getByTestId('rundown-location-chip-all')).toBeInTheDocument();
  });

  it('does NOT render the location chip row when no entry has a location', () => {
    const rundown = [
      { id: 'r1', title: '新娘梳洗', startTime: '05:00', durationMin: 75, group: 'prep' },
      { id: 'r2', title: '敬茶', startTime: '09:00', durationMin: 30, group: 'ceremony' },
    ];
    render(<WeddingDay {...baseProps()} rundown={rundown} />);
    // No location row at all (not even an empty chip row).
    expect(screen.queryByTestId('rundown-location-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rundown-location-chip-all')).not.toBeInTheDocument();
  });

  it('combines the location filter with the category filter (AND)', () => {
    // 3 prep entries, 2 at 女家, 1 at 男家; 1 ceremony entry
    // at 男家. Click category=準備/化妝 → 3 entries visible.
    // Then click location=男家 → drops to 1 (only r3).
    const rundown = [
      { id: 'r1', title: '新娘梳洗', startTime: '05:00', durationMin: 75, group: 'prep', location: '女家' },
      { id: 'r2', title: '化妝', startTime: '05:30', durationMin: 60, group: 'prep', location: '女家' },
      { id: 'r3', title: '新郎準備', startTime: '06:00', durationMin: 60, group: 'prep', location: '男家' },
      { id: 'r4', title: '男家敬茶', startTime: '09:00', durationMin: 30, group: 'ceremony', location: '男家' },
    ];
    const { container } = render(<WeddingDay {...baseProps()} rundown={rundown} />);
    // Initial render: 4 entries visible (sorted by startTime asc).
    expect(visibleTitles(container)).toEqual(['新娘梳洗', '化妝', '新郎準備', '男家敬茶']);
    // Click 準備/化妝 category chip — 3 entries remain (ceremony dropped).
    fireEvent.click(screen.getByRole('button', { name: /準備 \/ 化妝/ }));
    expect(visibleTitles(container)).toEqual(['新娘梳洗', '化妝', '新郎準備']);
    // Click 男家 location chip — now 1 entry (only 新郎準備).
    fireEvent.click(screen.getByTestId('rundown-location-chip-男家'));
    expect(visibleTitles(container)).toEqual(['新郎準備']);
    // Reset location — back to 3 prep entries.
    fireEvent.click(screen.getByTestId('rundown-location-chip-all'));
    expect(visibleTitles(container)).toEqual(['新娘梳洗', '化妝', '新郎準備']);
  });

  it('dedups case-insensitively (only ONE chip for 女家 / 女家 / 女家)', () => {
    const rundown = [
      { id: 'r1', title: 'a', startTime: '05:00', group: 'prep', location: '女家' },
      { id: 'r2', title: 'b', startTime: '06:00', group: 'prep', location: '女家 ' },
      { id: 'r3', title: 'c', startTime: '07:00', group: 'prep', location: '女家' },
    ];
    render(<WeddingDay {...baseProps()} rundown={rundown} />);
    // Only the first form wins the chip label.
    expect(screen.getByTestId('rundown-location-chip-女家')).toBeInTheDocument();
    // The trailing-space variant is NOT a separate chip.
    expect(screen.queryByTestId('rundown-location-chip-女家 ')).not.toBeInTheDocument();
    // The count includes all three entries.
    const chip = screen.getByTestId('rundown-location-chip-女家');
    expect(chip.textContent).toMatch(/女家 \(3\)/);
  });

  it('ignores empty / whitespace-only locations (entry still visible)', () => {
    const rundown = [
      { id: 'r1', title: 'a', startTime: '05:00', group: 'prep', location: '' },
      { id: 'r2', title: 'b', startTime: '06:00', group: 'prep', location: '   ' },
      { id: 'r3', title: 'c', startTime: '07:00', group: 'prep', location: '女家' },
    ];
    const { container } = render(<WeddingDay {...baseProps()} rundown={rundown} />);
    // No chip for empty.
    expect(screen.queryByTestId('rundown-location-chip-')).not.toBeInTheDocument();
    // Only the 女家 chip exists.
    expect(screen.getByTestId('rundown-location-chip-女家')).toBeInTheDocument();
    // All 3 entries still visible (location filter is 'all'), sorted by startTime.
    expect(visibleTitles(container)).toEqual(['a', 'b', 'c']);
    // Click 女家 → 1 entry (only 'c').
    fireEvent.click(screen.getByTestId('rundown-location-chip-女家'));
    expect(visibleTitles(container)).toEqual(['c']);
  });
});
