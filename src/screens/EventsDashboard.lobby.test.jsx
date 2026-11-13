import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventsDashboard } from './EventsDashboard';

vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: () => ({ tier: null, unlocks: [], loading: false }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'test-app',
  auth: {},
  functions: {},
  storage: {},
}));

const base = {
  events: [],
  newEventName: '',
  onNewEventNameChange: () => {},
  onCreate: (e) => e.preventDefault(),
  onSelectEvent: () => {},
};

describe('EventsDashboard lobby', () => {
  it('does not say “another wedding” when there are no projects', () => {
    render(<EventsDashboard {...base} />);
    expect(screen.getByText('➕ 建立你的婚禮')).toBeTruthy();
    expect(screen.queryByText('➕ 再建立一個婚禮')).toBeNull();
  });

  it('says “another” only after a project exists', () => {
    render(<EventsDashboard {...base} events={[{ id: 'ev-1', name: 'Our day', date: '' }]} />);
    expect(screen.getByText('➕ 再建立一個婚禮')).toBeTruthy();
    expect(screen.getByText('預定日期: 未設定')).toBeTruthy();
  });

  it('does not show the empty lobby while the event list is still loading', () => {
    render(<EventsDashboard {...base} eventsLoading />);
    expect(screen.getByText('載入婚禮專案中…')).toBeTruthy();
    expect(screen.queryByText(/你仲未有婚禮專案/)).toBeNull();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.queryByText('➕ 建立你的婚禮')).toBeNull();
  });

  it('offers sign-out from the lobby user menu', () => {
    render(
      <EventsDashboard
        {...base}
        user={{ uid: 'u1', email: 'a@example.com' }}
        onOpenProfile={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '用戶選單' }));
    expect(screen.getByRole('menuitem', { name: '登出' })).toBeTruthy();
  });
});
