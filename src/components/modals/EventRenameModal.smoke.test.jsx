// Smoke test for EventRenameModal — focused on:
//   1. Submit button is disabled when the input is empty or
//      unchanged from the original name
//   2. setDoc is called with { merge: true } and the new name
//      + updatedAt
//   3. onSaved fires with the trimmed new name after a
//      successful write
//   4. Error mapping: a permission-denied error from Firestore
//      surfaces as '沒有權限改名呢個專案。'
//
// 2026-07-31 — initial release alongside the lobby rename feature.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { setDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
    doc: vi.fn(() => 'REF'),
  };
});

import { EventRenameModal } from './EventRenameModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const event = {
  id: 'ev-123',
  name: '志明 & 春嬌',
  _ownerUid: 'owner-uid-1',
};

const baseProps = {
  event,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

describe('EventRenameModal', () => {
  it('renders the current event name as the initial value', () => {
    render(<EventRenameModal {...baseProps} />);
    const input = screen.getByLabelText('新名稱');
    expect(input.value).toBe('志明 & 春嬌');
  });

  it('keeps the submit button disabled when the name is unchanged', () => {
    render(<EventRenameModal {...baseProps} />);
    const submit = screen.getByRole('button', { name: '儲存' });
    expect(submit.disabled).toBe(true);
  });

  it('keeps the submit button disabled when the trimmed name is empty', () => {
    render(<EventRenameModal {...baseProps} />);
    const input = screen.getByLabelText('新名稱');
    fireEvent.change(input, { target: { value: '   ' } });
    const submit = screen.getByRole('button', { name: '儲存' });
    expect(submit.disabled).toBe(true);
  });

  it('enables the submit button when the name changes', () => {
    render(<EventRenameModal {...baseProps} />);
    const input = screen.getByLabelText('新名稱');
    fireEvent.change(input, { target: { value: '志明 & 春嬌 大婚' } });
    const submit = screen.getByRole('button', { name: '儲存' });
    expect(submit.disabled).toBe(false);
  });

  it('calls setDoc with merge:true and the trimmed new name on submit', async () => {
    render(<EventRenameModal {...baseProps} />);
    const input = screen.getByLabelText('新名稱');
    fireEvent.change(input, { target: { value: '  新名稱  ' } });
    const submit = screen.getByRole('button', { name: '儲存' });
    fireEvent.click(submit);

    // Wait one tick for the async handler to fire.
    await Promise.resolve();
    expect(setDoc).toHaveBeenCalledTimes(1);
    // The first arg is the doc ref, the second is the data,
    // the third is the options bag.
    const args = (setDoc).mock.calls[0];
    expect(args[2]).toEqual({ merge: true });
    expect(args[1].name).toBe('新名稱');
    expect(typeof args[1].updatedAt).toBe('number');
  });

  it('fires onSaved with the trimmed name and calls onClose after success', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<EventRenameModal {...baseProps} onSaved={onSaved} onClose={onClose} />);
    const input = screen.getByLabelText('新名稱');
    fireEvent.change(input, { target: { value: '新名稱' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await Promise.resolve();
    expect(onSaved).toHaveBeenCalledWith('新名稱');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a permission-denied error in Chinese', async () => {
    (setDoc).mockRejectedValueOnce({ code: 'permission-denied' });
    render(<EventRenameModal {...baseProps} />);
    const input = screen.getByLabelText('新名稱');
    fireEvent.change(input, { target: { value: '新名稱' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    // Wait for the catch handler to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('沒有權限改名呢個專案。')).toBeTruthy();
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it('closes when the cancel button is clicked', () => {
    render(<EventRenameModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });
});