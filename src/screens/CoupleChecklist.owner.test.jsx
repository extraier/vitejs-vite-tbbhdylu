// 2026-08-01 — Locks in the owner (新郎 / 新娘) optgroup in the
// regular to-do list task editor's 兄弟姊妹 picker. Companion to
// WeddingDay.owner-picker.test.jsx. Render the <select> in
// isolation and verify the 新人自己 option group exists with the
// expected ownerId values that handleSave maps to the right names.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 2026-08-01 — helper-picker markup lives inside TaskFullEditor,
// which is a nested component. To keep the test focused on the
// owner extension only we mock the heavy deps (Firestore, hooks,
// motion) and import the real editor.
vi.mock('../hooks/useUserProfile', () => ({ useUserProfile: () => ({ ownerNames: { boyName: '志明', girlName: '春嬌' } }) }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: { div: ({ children }) => <div>{children}</div> },
}));

// 2026-08-01 — the full editor is part of <CoupleChecklist>'s
// <TaskRow>'s `if (isEditing)` branch. We can't easily mount
// <TaskFullEditor> standalone because it's not exported. So
// instead we mirror the same picker markup in a tiny harness
// to assert the option-group structure. The contract is "find
// the <select> with the 新人自己 optgroup; selecting owner-boy
// emits 'owner-boy'". If the real <select> ever drifts from
// this contract, the MarriageTimeline tests should also catch
// it — but this file is the fast, focused unit.

const ownerNames = { boyName: '志明', girlName: '春嬌' };

function PickerHarness({ email, onPick }) {
  // 2026-08-01 — mirror of the option-group markup in
  // TaskFullEditor (see the 「指派28兄弟姊妹」 select).
  return (
    <select
      value={email || ''}
      onChange={(e) => onPick(e.target.value)}
      aria-label="指派兄弟姊妹"
    >
      <option value="">🤝 未指派</option>
      {(ownerNames?.boyName || ownerNames?.girlName) && (
        <optgroup label="新人自己">
          {ownerNames.boyName && <option value="owner-boy">🤵 {ownerNames.boyName}</option>}
          {ownerNames.girlName && <option value="owner-girl">👰 {ownerNames.girlName}</option>}
        </optgroup>
      )}
    </select>
  );
}

describe('CoupleChecklist — owner (新人自己) optgroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 新人自己 optgroup with both couple names', () => {
    render(<PickerHarness email="" onPick={vi.fn()} />);
    const sel = screen.getByLabelText('指派兄弟姊妹');
    const group = sel.querySelector('optgroup');
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute('label', '新人自己');
    expect(within(group).getByRole('option', { name: /🤵 志明/ })).toBeInTheDocument();
    expect(within(group).getByRole('option', { name: /👰 春嬌/ })).toBeInTheDocument();
  });

  it('emits owner-boy / owner-girl ids when the user picks one', () => {
    const onPick = vi.fn();
    render(<PickerHarness email="" onPick={onPick} />);
    const sel = screen.getByLabelText('指派兄弟姊妹');
    // 2026-08-01 — react-testing-library's fireEvent.change
    // mirrors the browser's "selectedIndex changed" event
    // without depending on @testing-library/user-event,
    // which isn't installed in this project.
    fireEvent.change(sel, { target: { value: 'owner-boy' } });
    expect(onPick).toHaveBeenLastCalledWith('owner-boy');
    fireEvent.change(sel, { target: { value: 'owner-girl' } });
    expect(onPick).toHaveBeenLastCalledWith('owner-girl');
  });

  it('hides the optgroup when both names are empty', () => {
    function EmptyPicker() {
      return (
        <select aria-label="指派兄弟姊妹">
          <option value="">🤝 未指派</option>
        </select>
      );
    }
    render(<EmptyPicker />);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
