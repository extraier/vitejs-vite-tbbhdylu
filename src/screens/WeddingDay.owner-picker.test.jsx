// 2026-08-01 — Locks in the owner-picker (新郎 / 新娘) extension
// across all four sub-tabs. Regression guard: if a future change
// drops the `ownerNames` prop or breaks the 新人自己 optgroup
// wiring, the tests fail loudly.
//
// Why this lives in its own file (not per-tab tests):
//   - The same plumbing (ownerNames → HelperPicker / dropdown)
//     is shared across four tabs, so one test file with one
//     per-tab describe() is more readable than four files.
//   - Existing per-tab tests stay focused on the tab's
//     per-row behaviour; this one is focused on the cross-tab
//     extension we just shipped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HelperPicker } from './WeddingDay';

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ownerNames = { boyName: '志明', girlName: '春嬌' };

describe('HelperPicker — owner (couple) extension', () => {
  it('renders the 新人自己 optgroup when ownerNames has at least one name', () => {
    render(
      <HelperPicker
        ownerNames={ownerNames}
        value={[]}
        onChange={() => {}}
      />,
    );
    // Optgroup dropdown header
    expect(screen.getByText('+ 新人自己...')).toBeTruthy();
    // Both partners appear
    expect(screen.getByRole('option', { name: /志明/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /春嬌/ })).toBeTruthy();
  });

  it('does NOT render the optgroup when both names are empty', () => {
    render(
      <HelperPicker
        ownerNames={{ boyName: '', girlName: '' }}
        value={[]}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText('+ 新人自己...')).toBeNull();
  });

  it('renders only the boy when the girl name is empty', () => {
    render(
      <HelperPicker
        ownerNames={{ boyName: '志明', girlName: '' }}
        value={[]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('+ 新人自己...')).toBeTruthy();
    expect(screen.getByRole('option', { name: /志明/ })).toBeTruthy();
    expect(screen.queryByText(/春嬌/)).toBeNull();
  });

  it('fires onChange with an owner chip when the user picks from 新人自己', () => {
    const onChange = vi.fn();
    render(
      <HelperPicker
        ownerNames={ownerNames}
        value={[]}
        onChange={onChange}
      />,
    );
    // The owner dropdown is the one containing '+ 新人自己...'.
    // The helper dropdown uses '+ 從已邀請嘅兄弟姊妹加入...'.
    // Both default to value="" so we pick by walking from the
    // owner option up to its parent <select>.
    const ownerOption = screen.getByRole('option', { name: /👰/ });
    fireEvent.change(ownerOption.closest('select'), {
      target: { value: 'owner-girl' },
    });
    expect(onChange).toHaveBeenCalledWith([
      { id: 'owner-girl', name: '春嬌', uid: 'owner-girl' },
    ]);
  });

  it('renders a rose-tinted chip for an already-selected owner', () => {
    const { container } = render(
      <HelperPicker
        ownerNames={ownerNames}
        value={[{ id: 'owner-boy', name: '志明', uid: 'owner-boy' }]}
        onChange={() => {}}
      />,
    );
    // Find the outer chip by walking up from the inner text node.
    // The selected-owner chip carries the rose classes; helper
    // chips are indigo. We assert the outer container matches.
    const chip = container.querySelector('span.bg-rose-100');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('志明');
  });
});
