import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelperWaitingScreen } from './HelperWaitingScreen';

const base = {
  loading: false,
  onAccept: () => {},
  onLogout: () => {},
  accepting: false,
};

describe('HelperWaitingScreen', () => {
  it('shows a load error instead of the empty-invite state', () => {
    const onRetry = vi.fn();
    render(
      <HelperWaitingScreen
        {...base}
        assignments={[]}
        error="Missing or insufficient permissions."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('無法檢查邀請')).toBeTruthy();
    expect(screen.getByText('Missing or insufficient permissions.')).toBeTruthy();
    expect(screen.queryByText('尚未收到邀請')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a pending invite and calls accept', () => {
    const onAccept = vi.fn();
    render(
      <HelperWaitingScreen
        {...base}
        onAccept={onAccept}
        assignments={[{
          id: 'invite-1',
          status: 'invited',
          email: 'helper@example.com',
          eventName: '大婚',
        }]}
      />,
    );
    expect(screen.getByText('大婚')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /接受邀請並加入/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
