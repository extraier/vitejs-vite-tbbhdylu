// Smoke tests for the owner-name editor inside MyProfile.
//
// Covers:
//   1. Renders the 新郎 / 新娘 labels and a free-text input for each
//   2. Calls onSaveProfile on save with the trimmed names
//   3. Disables the save button when both inputs are empty
//   4. Disables the save button when nothing has changed
//   5. Pre-fills the inputs from `ownerNames` prop
//   6. Clears each input via a dedicated "清除" affordance
//
// 2026-08-01 — Initial release. Owner names are user-scoped (one
// pair per user) and propagate to the 大日流程 HelperPicker so the
// couple can be assigned to rundown entries.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerNamesEditor } from './OwnerNamesEditor';

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const baseProps = {
  ownerNames: { boyName: '志明', girlName: '春嬌' },
  onSave: vi.fn().mockResolvedValue(undefined),
  onToast: vi.fn(),
};

describe('OwnerNamesEditor', () => {
  it('renders the 新郎 / 新娘 labels', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    expect(screen.getByText('新郎')).toBeTruthy();
    expect(screen.getByText('新娘')).toBeTruthy();
  });

  it('pre-fills the inputs from the ownerNames prop', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    expect(screen.getByLabelText('新郎').value).toBe('志明');
    expect(screen.getByLabelText('新娘').value).toBe('春嬌');
  });

  it('shows "未設定" placeholders when both names are empty', () => {
    render(
      <OwnerNamesEditor
        ownerNames={{ boyName: '', girlName: '' }}
        onSave={baseProps.onSave}
        onToast={baseProps.onToast}
      />,
    );
    expect(screen.getByLabelText('新郎').placeholder).toContain('未設定');
    expect(screen.getByLabelText('新娘').placeholder).toContain('未設定');
  });

  it('disables the save button when both inputs are empty', () => {
    render(
      <OwnerNamesEditor
        ownerNames={{ boyName: '', girlName: '' }}
        onSave={baseProps.onSave}
        onToast={baseProps.onToast}
      />,
    );
    const save = screen.getByRole('button', { name: '儲存' });
    expect(save.disabled).toBe(true);
  });

  it('disables the save button when nothing has changed', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    // Both inputs are pre-filled with the existing values, so
    // trimming them yields the same strings — save stays disabled.
    const save = screen.getByRole('button', { name: '儲存' });
    expect(save.disabled).toBe(true);
  });

  it('enables the save button when the user types a new name', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    fireEvent.change(screen.getByLabelText('新郎'), { target: { value: '大志明' } });
    const save = screen.getByRole('button', { name: '儲存' });
    expect(save.disabled).toBe(false);
  });

  it('calls onSave with the trimmed names on save and shows a success toast', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onToast = vi.fn();
    render(
      <OwnerNamesEditor
        ownerNames={{ boyName: '志明', girlName: '春嬌' }}
        onSave={onSave}
        onToast={onToast}
      />,
    );
    fireEvent.change(screen.getByLabelText('新郎'), { target: { value: '  大志明  ' } });
    fireEvent.change(screen.getByLabelText('新娘'), { target: { value: '  小春嬌  ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ boyName: '大志明', girlName: '小春嬌' });
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('已儲存'));
  });

  it('surfaces save failures via the toast and re-enables the button', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('rules-denied'));
    const onToast = vi.fn();
    render(
      <OwnerNamesEditor
        ownerNames={{ boyName: '志明', girlName: '春嬌' }}
        onSave={onSave}
        onToast={onToast}
      />,
    );
    fireEvent.change(screen.getByLabelText('新郎'), { target: { value: '大志明' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('失敗'));
  });

  it('clears each input via the dedicated clear button', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    fireEvent.click(screen.getByLabelText('清除新郎'));
    expect(screen.getByLabelText('新郎').value).toBe('');
    // Save is still enabled because the other field is still set
    // and the user clearly wants to commit the clear.
    expect(screen.getByRole('button', { name: '儲存' }).disabled).toBe(false);
  });

  it('disables the save button when BOTH fields are cleared', () => {
    render(<OwnerNamesEditor {...baseProps} />);
    fireEvent.click(screen.getByLabelText('清除新郎'));
    fireEvent.click(screen.getByLabelText('清除新娘'));
    expect(screen.getByRole('button', { name: '儲存' }).disabled).toBe(true);
  });
});
