// Smoke tests for MyProfile — the user's profile screen.
//
// Covers:
//   1. Renders email from currentUser
//   2. Shows ✓ 已驗證電郵 when emailVerified=true
//   3. Shows ⚠️ 未驗證電郵 when emailVerified=false
//   4. Shows 👑 Premium 會員 card when tier=premium
//   5. Shows Free card + upgrade CTA when tier!=premium
//   6. Logout button calls useAuth().logout after confirm=true;
//      does NOT call it when confirm=false
//
// What we DON'T test here (covered elsewhere):
//   - useUserProfile hook behaviour is smoke-tested at the parent
//     component level (EventsDashboard already uses it)
//   - PurchaseModal opening is smoke-tested in the modal's own tests
//   - Clipboard copy fallback (jsdom has no clipboard API; we don't
//     stub it because the fallback uses document.execCommand which
//     also fails in jsdom — the test just verifies the click handler
//     doesn't throw)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// 2026-07-30 — vi.mock is hoisted to the top of the file by vitest.
// We declare the mock state in vi.hoisted() so the factory can
// reference it.
const mocks = vi.hoisted(() => {
  return {
    logout: vi.fn(async () => {}),
    subscribeUnlocks: vi.fn(),
    subscribeUser: vi.fn(),
  };
});

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ logout: mocks.logout }),
}));

// Mock useUserProfile so we control tier/unlocks/createdAt/promotedAt
// per test. The real hook is smoke-tested at the parent level.
vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

// Stub the firebase singletons so module-init doesn't blow up
// in jsdom. The hook itself is mocked above so these singletons
// are never actually used in this test.
vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'test-app',
  auth: {},
  functions: {},
  storage: {},
}));

import { MyProfile } from './MyProfile';
import { useUserProfile } from '../hooks/useUserProfile';

beforeEach(() => {
  cleanup();
  mocks.logout.mockClear();
  // Default to a loaded, free-tier user. Individual tests override.
  useUserProfile.mockReturnValue({
    tier: null,
    unlocks: [],
    createdAt: { toDate: () => new Date('2026-07-22') },
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

describe('MyProfile', () => {
  it('renders email from currentUser', () => {
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('roger@example.com')).toBeTruthy();
  });

  it('shows ✓ 已驗證電郵 when emailVerified=true', () => {
    render(
      <MyProfile
        currentUser={{ ...baseUser, emailVerified: true }}
        onBack={() => {}}
        onUpgrade={() => {}}
      />,
    );
    expect(screen.getByText('已驗證電郵')).toBeTruthy();
  });

  it('shows ⚠️ 未驗證電郵 when emailVerified=false', () => {
    render(
      <MyProfile
        currentUser={{ ...baseUser, emailVerified: false }}
        onBack={() => {}}
        onUpgrade={() => {}}
      />,
    );
    expect(screen.getByText('未驗證電郵')).toBeTruthy();
  });

  it('shows 👑 Premium 會員 card when tier=premium', () => {
    useUserProfile.mockReturnValue({
      tier: 'premium',
      unlocks: ['custom-template', 'storage-500mb', 'permanent-archive'],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: { toDate: () => new Date('2026-07-29') },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('👑 Premium 會員')).toBeTruthy();
    // All 3 unlocks should be checked
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(3);
    // All three should have the ✓ check (not the ○ empty)
    const checks = items.map((li) => li.textContent.includes('✓'));
    expect(checks.every(Boolean)).toBe(true);
  });

  it('shows Free card + upgrade CTA when tier!=premium', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      loading: false,
    });
    const onUpgrade = vi.fn();
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={onUpgrade} />,
    );
    expect(screen.getByText('Free 會員')).toBeTruthy();
    const upgradeBtn = screen.getByText(/升級為 Premium · HK\$99/);
    expect(upgradeBtn).toBeTruthy();
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('logout button calls useAuth().logout after confirm=true', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    const logoutBtn = screen.getByText(/^登出$/);
    fireEvent.click(logoutBtn);
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it('logout button does NOT call logout when confirm=false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    const logoutBtn = screen.getByText(/^登出$/);
    fireEvent.click(logoutBtn);
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
