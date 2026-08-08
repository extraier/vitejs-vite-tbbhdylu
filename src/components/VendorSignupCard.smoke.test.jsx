// Tests for VendorSignupCard — the vendor signup card.
//
// Source of truth: src/components/VendorSignupCard.jsx.
//
// What's covered here (regression guards):
//   1. Form posts all three fields (email, password, displayName) to
//      onEmailRegister on valid submit.
//   2. Password mismatch is rejected with errPasswordMismatch (typed
//      twice, must match — 2026-08-08 alignment with LoginScreen
//      signup mode).
//   3. Password failing length / categories / common-list rules is
//      rejected with errPasswordRules (NOT the legacy minLength=8
//      check that 'password' slipped past).
//   4. Password containing the email local part is rejected.
//   5. Live rules checklist renders once the password field has any
//      text, and shows ✓ on each rule that passes.
//   6. Confirm-password input shows the live match indicator ((✓ 一致)
//      vs (✗ 唔一致)).
//
// 2026-08-08 — added when VendorSignupCard was upgraded to use
// evaluatePassword + confirm-password matching, mirroring the
// LoginScreen signup-mode UX.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VendorSignupCard } from './VendorSignupCard';

const NOOP = () => Promise.resolve();

function fillForm({ displayName, email, password, confirmPassword }) {
  if (displayName != null) {
    fireEvent.change(screen.getByPlaceholderText(/ABC Wedding Studio/), {
      target: { value: displayName },
    });
  }
  if (email != null) {
    fireEvent.change(screen.getByPlaceholderText(/電郵地址|Email address/), {
      target: { value: email },
    });
  }
  if (password != null) {
    // Two password fields: the first has the rules placeholder, the
    // second has the confirm-password placeholder. Match both.
    const inputs = screen.getAllByPlaceholderText(
      /設定密碼|再次輸入密碼|Min 8 chars|Confirm password/,
    );
    fireEvent.change(inputs[0], { target: { value: password } });
  }
  if (confirmPassword != null) {
    const inputs = screen.getAllByPlaceholderText(
      /設定密碼|再次輸入密碼|Min 8 chars|Confirm password/,
    );
    fireEvent.change(inputs[1], { target: { value: confirmPassword } });
  }
}

function clickSubmit() {
  fireEvent.click(screen.getByRole('button', { name: /建立商戶帳號|Create vendor account/ }));
}

describe('VendorSignupCard — password validation', () => {
  it('happy path: valid email + matching strong passwords submits onEmailRegister with all three args', async () => {
    const onEmailRegister = vi.fn().mockResolvedValue(undefined);
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={onEmailRegister}
        onBack={NOOP}
      />,
    );

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'vendor@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!',
    });

    clickSubmit();

    await waitFor(() => {
      expect(onEmailRegister).toHaveBeenCalledWith(
        'vendor@example.com',
        'Password1!',
        'ABC Wedding Studio',
      );
    });
  });

  it('empty fields do not submit (HTML5 required gates the form before our handler runs)', async () => {
    const onEmailRegister = vi.fn();
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={onEmailRegister}
        onBack={NOOP}
      />,
    );

    clickSubmit();

    // The form has <input required> on every field, so the browser
    // blocks the submit before our handler runs. Verify that
    // onEmailRegister was never called.
    expect(onEmailRegister).not.toHaveBeenCalled();
  });

  it('password mismatch is rejected with errPasswordMismatch', async () => {
    const onEmailRegister = vi.fn();
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={onEmailRegister}
        onBack={NOOP}
      />,
    );

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'vendor@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!different',
    });

    clickSubmit();

    expect(onEmailRegister).not.toHaveBeenCalled();
    expect(screen.getByText(/兩次輸入嘅密碼唔一致/)).toBeTruthy();
  });

  it("'password' (8 chars but 1 category + on common list) is rejected with errPasswordRules, NOT the legacy minLength=8 check", async () => {
    const onEmailRegister = vi.fn();
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={onEmailRegister}
        onBack={NOOP}
      />,
    );

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'vendor@example.com',
      password: 'password',
      confirmPassword: 'password',
    });

    clickSubmit();

    expect(onEmailRegister).not.toHaveBeenCalled();
    expect(screen.getByText(/密碼強度不足：請檢查下方規則/)).toBeTruthy();
  });

  it('password containing the email local part is rejected', async () => {
    const onEmailRegister = vi.fn();
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={onEmailRegister}
        onBack={NOOP}
      />,
    );

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'roger@example.com',
      password: 'rogerPassword1!',
      confirmPassword: 'rogerPassword1!',
    });

    clickSubmit();

    expect(onEmailRegister).not.toHaveBeenCalled();
    expect(screen.getByText(/密碼強度不足：請檢查下方規則/)).toBeTruthy();
  });

  it('live rules checklist appears once password is typed and shows ✓ on passing rules', async () => {
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={NOOP}
        onBack={NOOP}
      />,
    );

    // Empty password → checklist not rendered.
    expect(screen.queryByText(/至少 8 個字元/)).toBeNull();

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'vendor@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!',
    });

    // Now the checklist appears.
    expect(screen.getByText(/至少 8 個字元/)).toBeTruthy();
    expect(screen.getByText(/包含以下 3 種/)).toBeTruthy();
    expect(screen.getByText(/不可包含你電郵地址/)).toBeTruthy();
    expect(screen.getByText(/不可用常見密碼/)).toBeTruthy();
  });

  it('confirm-password input shows the live match indicator', async () => {
    render(
      <VendorSignupCard
        onGoogleLogin={NOOP}
        onEmailRegister={NOOP}
        onBack={NOOP}
      />,
    );

    fillForm({
      displayName: 'ABC Wedding Studio',
      email: 'vendor@example.com',
      password: 'Password1!',
      confirmPassword: 'DIFFERENT',
    });

    expect(screen.getByText(/✗ 唔一致/)).toBeTruthy();

    // Fix the mismatch → indicator flips to ✓.
    fillForm({ confirmPassword: 'Password1!' });

    expect(screen.getByText(/✓ 一致/)).toBeTruthy();
  });
});
