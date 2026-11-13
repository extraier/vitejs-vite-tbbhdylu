import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginScreen } from './LoginScreen';

describe('LoginScreen invite-link prompt', () => {
  it('asks for the invited email when the magic link did not carry one', async () => {
    const onCompleteEmailLink = vi.fn(() => Promise.resolve());
    render(
      <LoginScreen
        onGoogleLogin={() => Promise.resolve()}
        onEmailLogin={() => Promise.resolve()}
        onEmailRegister={() => Promise.resolve()}
        emailLinkPending
        onCompleteEmailLink={onCompleteEmailLink}
      />,
    );
    expect(screen.getByText('請輸入收到邀請嘅電郵，以完成登入。')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '邀請連結' }), {
      target: { value: 'helper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成邀請登入' }));
    await waitFor(() => {
      expect(onCompleteEmailLink).toHaveBeenCalledWith('helper@example.com');
    });
  });

  it('does not show the invite prompt on a normal sign-in', () => {
    render(
      <LoginScreen
        onGoogleLogin={() => Promise.resolve()}
        onEmailLogin={() => Promise.resolve()}
        onEmailRegister={() => Promise.resolve()}
      />,
    );
    expect(screen.queryByText('請輸入收到邀請嘅電郵，以完成登入。')).toBeNull();
  });
});
