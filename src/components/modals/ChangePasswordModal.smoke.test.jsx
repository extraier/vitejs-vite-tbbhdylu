// Smoke tests for ChangePasswordModal.
//
// Covers:
//   1. mode='change' shows three input fields (current, new, confirm)
//   2. mode='set' shows two input fields (new, confirm)
//   3. Submit button is disabled when new password is invalid
//   4. Submit button enables when all gates pass
//   5. Live complexity checklist shows ✓ for met rules
//   6. Confirm field shows "✓ 一致" when match, "✗ 唔一致" when not
//   7. ChangePasswordModal calls useAuth().changePassword on submit
//   8. LinkPasswordModal calls useAuth().linkPassword on submit
//   9. Wrong-password error message is shown for auth/wrong-password
//
// We don't test the actual Firebase SDK calls — those are mocked at
// the useAuth hook. The hook itself is mock-returned here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  return {
    changePassword: vi.fn(async () => {}),
    linkPassword: vi.fn(async () => {}),
  };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    changePassword: mocks.changePassword,
    linkPassword: mocks.linkPassword,
  }),
}));

import { ChangePasswordModal } from './ChangePasswordModal';

beforeEach(() => {
  cleanup();
  mocks.changePassword.mockClear();
  mocks.linkPassword.mockClear();
  mocks.changePassword.mockResolvedValue(undefined);
  mocks.linkPassword.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const onClose = vi.fn();
const onSuccess = vi.fn();

describe('ChangePasswordModal', () => {
  describe('mode="change"', () => {
    it('renders three input fields and the right title', () => {
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      expect(screen.getByText('更換密碼')).toBeTruthy();
      // 3 password inputs: current, new, confirm
      const inputs = screen.getAllByDisplayValue('');
      expect(inputs.length).toBe(3);
    });

    it('renders the complexity checklist when new password is typed', () => {
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      // New password is the 2nd input (index 1).
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } });
      // 4 rules render
      expect(screen.getByText('至少 8 個字元')).toBeTruthy();
      expect(screen.getByText(/包含以下 3 種/)).toBeTruthy();
    });

    it('disables submit when new password is invalid', () => {
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      // Submit button is "更新密碼"
      const submit = screen.getByText('更新密碼').closest('button');
      expect(submit.disabled).toBe(true);
    });

    it('enables submit when all fields are valid and match', () => {
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'OldPass1!xx' } }); // current
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } }); // new
      fireEvent.change(inputs[2], { target: { value: 'Pa55word!' } }); // confirm
      const submit = screen.getByText('更新密碼').closest('button');
      expect(submit.disabled).toBe(false);
    });

    it('calls changePassword with currentPassword and newPassword on submit', async () => {
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'OldPass1!xx' } });
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } });
      fireEvent.change(inputs[2], { target: { value: 'Pa55word!' } });
      const submit = screen.getByText('更新密碼').closest('button');
      fireEvent.click(submit);
      await waitFor(() => {
        expect(mocks.changePassword).toHaveBeenCalledWith('OldPass1!xx', 'Pa55word!');
      });
    });

    it('shows wrong-password error when changePassword rejects with auth/wrong-password', async () => {
      mocks.changePassword.mockRejectedValue({
        code: 'auth/wrong-password',
        message: 'wrong',
      });
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'BadPwd' } });
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } });
      fireEvent.change(inputs[2], { target: { value: 'Pa55word!' } });
      fireEvent.click(screen.getByText('更新密碼').closest('button'));
      await waitFor(() => {
        expect(screen.getByText('現時密碼錯誤，請重新輸入')).toBeTruthy();
      });
    });
  });

  describe('mode="set"', () => {
    it('renders two input fields and the "set password" title', () => {
      render(
        <ChangePasswordModal mode="set" onClose={onClose} onSuccess={onSuccess} />,
      );
      expect(screen.getByText('設定登入密碼')).toBeTruthy();
      const inputs = screen.getAllByDisplayValue('');
      expect(inputs.length).toBe(2);
    });

    it('calls linkPassword (not changePassword) with newPassword on submit', async () => {
      render(
        <ChangePasswordModal mode="set" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'Pa55word!' } });
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } });
      fireEvent.click(screen.getByText('設定密碼').closest('button'));
      await waitFor(() => {
        expect(mocks.linkPassword).toHaveBeenCalledWith('Pa55word!');
      });
      expect(mocks.changePassword).not.toHaveBeenCalled();
    });
  });

  describe('match indicator', () => {
    it('shows ✓ 一致 when confirm matches new', () => {
      render(
        <ChangePasswordModal mode="set" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'Pa55word!' } });
      fireEvent.change(inputs[1], { target: { value: 'Pa55word!' } });
      expect(screen.getByText('✓ 一致')).toBeTruthy();
    });

    it('shows ✗ 唔一致 when confirm does not match new', () => {
      render(
        <ChangePasswordModal mode="set" onClose={onClose} onSuccess={onSuccess} />,
      );
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'Pa55word!' } });
      fireEvent.change(inputs[1], { target: { value: 'Hello!987' } });
      expect(screen.getByText('✗ 唔一致')).toBeTruthy();
    });
  });

  describe('close', () => {
    it('calls onClose when cancel button clicked', () => {
      onClose.mockClear();
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      fireEvent.click(screen.getByText('取消'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when X button clicked', () => {
      onClose.mockClear();
      render(
        <ChangePasswordModal mode="change" onClose={onClose} onSuccess={onSuccess} />,
      );
      // X has aria-label="關閉"
      fireEvent.click(screen.getByLabelText('關閉'));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});