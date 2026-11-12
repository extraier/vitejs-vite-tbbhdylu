import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginScreen } from './LoginScreen';
import { VendorSignupCard } from '../components/VendorSignupCard';

const noop = () => Promise.resolve();

function renderLogin(extra = {}) {
  const onVendorSignup = vi.fn();
  render(
    <LoginScreen
      onGoogleLogin={noop}
      onEmailLogin={noop}
      onEmailRegister={noop}
      onVendorSignup={onVendorSignup}
      {...extra}
    />,
  );
  return { onVendorSignup };
}

describe('LoginScreen entry points', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('sends the footer vendor CTA to vendor sign-up, not couple sign-up', () => {
    const { onVendorSignup } = renderLogin();
    const footer = screen.getByRole('link', { name: '建立商戶帳號 →' });
    expect(footer.getAttribute('href')).toBe('#signup-as-vendor');
    expect(screen.getByText('已有商戶帳號? 請用上面 email + 密碼 直接登入。')).toBeTruthy();
    fireEvent.click(footer);
    expect(onVendorSignup).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-page vendor link on #signup-as-vendor and lets the hash update', () => {
    const { onVendorSignup } = renderLogin();
    const link = screen.getByRole('link', { name: /我是商戶 — 申請加入/ });
    expect(link.getAttribute('href')).toBe('#signup-as-vendor');
    fireEvent.click(link);
    expect(onVendorSignup).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#signup-as-vendor');
  });

  it('uses sign-up wording on the Google button in couple sign-up mode', () => {
    renderLogin({ defaultMode: 'signup' });
    expect(screen.getByRole('button', { name: '使用 Google 帳號註冊' })).toBeTruthy();
  });

  it('keeps sign-in wording on the Google button in sign-in mode', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: '使用 Google 帳號登入' })).toBeTruthy();
  });

  it('shows a network message and leaves the pending state when sign-in fails', async () => {
    const onEmailLogin = vi.fn(() => Promise.reject({
      code: 'auth/network-request-failed',
      message: 'Firebase: Error (auth/network-request-failed).',
    }));
    render(
      <LoginScreen
        onGoogleLogin={noop}
        onEmailLogin={onEmailLogin}
        onEmailRegister={noop}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('電郵地址'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密碼'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '📧 電郵登入' }));
    expect(await screen.findByText('網絡連線失敗，請檢查網絡後再試')).toBeTruthy();
    expect(screen.queryByText(/Firebase:/)).toBeNull();
    expect(screen.getByRole('button', { name: '📧 電郵登入' })).toBeTruthy();
  });

  it('persists English when moving from the landing card to vendor sign-up', () => {
    const { unmount } = render(
      <LoginScreen onGoogleLogin={noop} onEmailLogin={noop} onEmailRegister={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('Save The Day · All-in-one wedding management')).toBeTruthy();
    unmount();
    render(<VendorSignupCard onGoogleLogin={noop} onEmailRegister={noop} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeTruthy();
  });
});
