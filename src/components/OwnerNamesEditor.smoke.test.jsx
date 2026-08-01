// Smoke tests for the owner-name editor inside EventSettingsModal.
//
// Covers:
//   1. Renders the 新郎 / 新娘 labels and a free-text input for each
//   2. Pre-fills the inputs from useEventOwnerNames(ownerNames)
//   3. Disables the save button when both inputs are empty
//   4. Disables the save button when nothing has changed
//   5. Calls saveOwnerNames with the trimmed names on save
//   6. Surfaces save failures via the toast and re-enables the button
//   7. Clears each input via a dedicated "清除" affordance
//
// 2026-08-01 — Initial release. Owner names are USER-scoped (one
// pair per user) and propagate to the 大日流程 HelperPicker so the
// couple can be assigned to rundown entries.
//
// 2026-08-01 (pivot) — Switched from ownerNames/onSave props to
// {currentUser, eventId, onToast}. The component now owns its own
// subscription + write via useEventOwnerNames(eventId, uid). Mock
// that hook to control the save response in tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerNamesEditor } from './OwnerNamesEditor';

// Mock useEventOwnerNames so tests can control the ownerNames value
// + the saveOwnerNames function. The real hook is smoke-tested in
// src/hooks/useEventOwnerNames.smoke.test.jsx.
const mockOwnerNames = { boyName: '志明', girlName: '春嬌' };
const mockSaveOwnerNames = vi.fn().mockResolvedValue({ ok: true });
const mockUseEventOwnerNames = vi.fn(() => ({
  ownerNames: mockOwnerNames,
  saveOwnerNames: mockSaveOwnerNames,
  loading: false,
}));

vi.mock('../hooks/useEventOwnerNames', () => ({
  useEventOwnerNames: (...args) => mockUseEventOwnerNames(...args),
}));

beforeEach(() => {
  cleanup();
  mockOwnerNames.boyName = '志明';
  mockOwnerNames.girlName = '春嬌';
  mockSaveOwnerNames.mockClear();
  mockSaveOwnerNames.mockResolvedValue({ ok: true });
  mockUseEventOwnerNames.mockClear();
  mockUseEventOwnerNames.mockImplementation(() => ({
    ownerNames: mockOwnerNames,
    saveOwnerNames: mockSaveOwnerNames,
    loading: false,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const baseProps = {
  currentUser: { uid: 'test-uid' },
  eventId: 'test-event',
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
    mockOwnerNames.boyName = '';
    mockOwnerNames.girlName = '';
    render(<OwnerNamesEditor {...baseProps} />);
    expect(screen.getByLabelText('新郎').placeholder).toContain('未設定');
    expect(screen.getByLabelText('新娘').placeholder).toContain('未設定');
  });

  it('disables the save button when both inputs are empty', () => {
    mockOwnerNames.boyName = '';
    mockOwnerNames.girlName = '';
    render(<OwnerNamesEditor {...baseProps} />);
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

  it('calls saveOwnerNames with the trimmed names on save and shows a success toast', async () => {
    const onToast = baseProps.onToast;
    render(<OwnerNamesEditor {...baseProps} />);
    fireEvent.change(screen.getByLabelText('新郎'), { target: { value: '  大志明  ' } });
    fireEvent.change(screen.getByLabelText('新娘'), { target: { value: '  小春嬌  ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(mockSaveOwnerNames).toHaveBeenCalledWith({ boyName: '大志明', girlName: '小春嬌' });
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('已儲存'));
  });

  it('surfaces save failures via the toast and re-enables the button', async () => {
    mockSaveOwnerNames.mockRejectedValue(new Error('rules-denied'));
    const onToast = vi.fn();
    render(
      <OwnerNamesEditor
        currentUser={baseProps.currentUser}
        eventId={baseProps.eventId}
        onToast={onToast}
      />,
    );
    fireEvent.change(screen.getByLabelText('新郎'), { target: { value: '大志明' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(mockSaveOwnerNames).toHaveBeenCalled();
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
