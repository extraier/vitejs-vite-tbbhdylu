// Smoke test for EventDeleteModal — focused on:
//   1. The submit button stays disabled until the user types the
//      exact string 'DELETE' (case-sensitive)
//   2. setDoc fires on submit with a deletedAt server timestamp
//   3. onDeleted fires after a successful write
//   4. Error mapping: a permission-denied error surfaces in
//      Chinese
//   5. The cancel button is wired to onClose
//
// 2026-07-31 — initial release alongside the lobby delete feature.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { setDoc, serverTimestamp } from 'firebase/firestore';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    doc: vi.fn(() => 'REF'),
  };
});

import { EventDeleteModal } from './EventDeleteModal';

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
  onDeleted: vi.fn(),
};

describe('EventDeleteModal', () => {
  it('disables the submit button by default', () => {
    render(<EventDeleteModal {...baseProps} />);
    const submit = screen.getByRole('button', { name: /確認刪除/ });
    expect(submit.disabled).toBe(true);
  });

  it('keeps the submit button disabled for partial or wrong-case input', () => {
    render(<EventDeleteModal {...baseProps} />);
    const input = screen.getByLabelText(/請輸入/);
    fireEvent.change(input, { target: { value: 'delete' } }); // wrong case
    expect((screen.getByRole('button', { name: /確認刪除/ })).disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'DELET' } }); // partial
    expect((screen.getByRole('button', { name: /確認刪除/ })).disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'DELETE!' } }); // trailing punct
    expect((screen.getByRole('button', { name: /確認刪除/ })).disabled).toBe(true);
  });

  it('enables the submit button only when input === "DELETE"', () => {
    render(<EventDeleteModal {...baseProps} />);
    const input = screen.getByLabelText(/請輸入/);
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(screen.getByRole('button', { name: /確認刪除/ }).disabled).toBe(false);
  });

  it('soft-deletes with deletedAt and fires onDeleted on a successful submit', async () => {
    render(<EventDeleteModal {...baseProps} />);
    const input = screen.getByLabelText(/請輸入/);
    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: /確認刪除/ }));

    await Promise.resolve();
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][1]).toMatchObject({ deletedAt: 'SERVER_TIMESTAMP' });
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
    expect(baseProps.onDeleted).toHaveBeenCalledTimes(1);
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a permission-denied error in Chinese', async () => {
    (setDoc).mockRejectedValueOnce({ code: 'permission-denied' });
    render(<EventDeleteModal {...baseProps} />);
    const input = screen.getByLabelText(/請輸入/);
    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: /確認刪除/ }));

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('沒有權限刪除呢個專案。')).toBeTruthy();
    expect(baseProps.onDeleted).not.toHaveBeenCalled();
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it('does NOT soft-delete when the user types the wrong word', () => {
    render(<EventDeleteModal {...baseProps} />);
    const input = screen.getByLabelText(/請輸入/);
    fireEvent.change(input, { target: { value: 'delete' } });
    fireEvent.click(screen.getByRole('button', { name: /確認刪除/ }));
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('closes when the cancel button is clicked', () => {
    render(<EventDeleteModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });
});