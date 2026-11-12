import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../lib/firebase', () => ({
  auth: {},
}));

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(() => Promise.resolve()),
}));

function Boom() {
  throw new Error('ClipboardList is not defined');
}

describe('ErrorBoundary', () => {
  it('offers sign-out as well as reload after a render crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: '強制 Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
  });
});
