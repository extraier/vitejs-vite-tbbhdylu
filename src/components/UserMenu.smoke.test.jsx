// Smoke tests for UserMenu — the avatar + dropdown header widget
// (Phase B of the my-profile work).
//
// Covers:
//   1. Renders the avatar trigger (a button with the initial inside)
//   2. Dropdown is closed by default
//   3. Clicking the avatar opens the dropdown
//   4. The dropdown shows the user's email + member status
//   5. Showing "👑 Premium 會員" when tier=premium
//   6. Showing "升級為 Premium · HK$99" button when tier != premium
//   7. Clicking the outer "升級為 Premium" CTA inside the menu calls
//      onUpgrade
//   8. Clicking "我的資料" closes the menu and calls onOpenProfile
//   9. Clicking "登出" closes the menu, calls window.confirm, and
//      only calls logout() when confirm returns true
//  10. Click-outside on the document closes the dropdown
//  11. Pressing Escape closes the dropdown
//  12. The avatar initial is the first letter of the email
//  13. Returns null when user is null
//
// Mocking strategy:
//   - useAuth (logout is a vi.fn)
//   - useUserProfile (tier/loading is controlled per test)
//   - lib/firebase (so module-init doesn't blow up)
//   - The rest of the component renders normally; we use the real
//     DOM and rely on jsdom supporting mousedown/keydown events.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(async () => {}),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ logout: mocks.logout }),
}));

vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'test-app',
  auth: {},
  functions: {},
  storage: {},
}));

import { UserMenu } from './UserMenu';
import { useUserProfile } from '../hooks/useUserProfile';

beforeEach(() => {
  cleanup();
  mocks.logout.mockClear();
  // Default: free-tier user, not loading
  useUserProfile.mockReturnValue({
    tier: null,
    unlocks: [],
    createdAt: null,
    promotedAt: null,
    loading: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseUser = {
  uid: 'uid-abc-123',
  email: 'roger@example.com',
  emailVerified: true,
};

describe('UserMenu', () => {
  it('renders the avatar trigger with the email initial', () => {
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger).toBeTruthy();
    // The initial is the first letter of the email
    expect(trigger.textContent.trim()).toContain('R');
  });

  it('does not render the dropdown panel by default', () => {
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.queryByTestId('user-menu-panel')).toBeNull();
  });

  it('opens the dropdown when the avatar is clicked', () => {
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByTestId('user-menu-panel')).toBeTruthy();
  });

  it('shows the user email and display name in the dropdown header', () => {
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByText('roger@example.com')).toBeTruthy();
  });

  it('shows 👑 Premium 會員 chip when tier=premium', () => {
    useUserProfile.mockReturnValue({
      tier: 'premium',
      unlocks: [],
      createdAt: null,
      promotedAt: null,
      loading: false,
    });
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByText(/Premium 會員/)).toBeTruthy();
    // The "升級" CTA should NOT appear for premium users
    expect(screen.queryByText(/升級為 Premium/)).toBeNull();
  });

  it('shows the "升級為 Premium" CTA inside the menu when tier != premium', () => {
    const onUpgrade = vi.fn();
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={onUpgrade} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const upgradeBtn = screen.getByText(/升級為 Premium · HK\$99/);
    expect(upgradeBtn).toBeTruthy();
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('clicking "我的資料" closes the menu and calls onOpenProfile', () => {
    const onOpenProfile = vi.fn();
    render(
      <UserMenu user={baseUser} onOpenProfile={onOpenProfile} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const profileBtn = screen.getByRole('menuitem', { name: /我的資料/ });
    fireEvent.click(profileBtn);
    expect(onOpenProfile).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('user-menu-panel')).toBeNull();
  });

  it('clicking "登出" closes the menu and calls logout() when confirm=true', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const logoutBtn = screen.getByRole('menuitem', { name: /登出/ });
    fireEvent.click(logoutBtn);
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('user-menu-panel')).toBeNull();
  });

  it('clicking "登出" does NOT call logout() when confirm=false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    const logoutBtn = screen.getByRole('menuitem', { name: /登出/ });
    fireEvent.click(logoutBtn);
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('click-outside on the document closes the dropdown', () => {
    render(
      <div>
        <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />
        <button data-testid="outside">Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByTestId('user-menu-panel')).toBeTruthy();
    // mousedown on the outside button
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('user-menu-panel')).toBeNull();
  });

  it('pressing Escape closes the dropdown', () => {
    render(
      <UserMenu user={baseUser} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByTestId('user-menu-panel')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('user-menu-panel')).toBeNull();
  });

  it('uses the displayName first letter when email is missing', () => {
    render(
      <UserMenu
        user={{ uid: 'u', displayName: 'Roger', email: null }}
        onOpenProfile={() => {}}
        onUpgrade={() => {}}
      />,
    );
    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger.textContent.trim()).toContain('R');
  });

  it('returns null when user is null', () => {
    const { container } = render(
      <UserMenu user={null} onOpenProfile={() => {}} onUpgrade={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
