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
//   7. (2026-07-30) Security section: shows "更換密碼" tile for users
//      with a password provider, click invokes onChangePassword('change')
//   8. (2026-07-30) 推薦碼 row shows the real referralCode (STD-XXXXX),
//      not the UID, and the copy button reads "複製邀請碼"
//
// What we DON'T test here (covered elsewhere):
//   - useUserProfile hook behaviour is smoke-tested at the parent
//     component level (EventsDashboard already uses it)
//   - PurchaseModal opening is smoke-tested in the modal's own tests
//   - ChangePasswordModal is tested in its own file
//   - Clipboard copy fallback (jsdom has no clipboard API; we don't
//     stub it because the fallback uses document.execCommand which
//     also fails in jsdom — the test just verifies the click handler
//     doesn't throw)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  return {
    logout: vi.fn(async () => {}),
    hasPasswordProvider: vi.fn(() => true),
    onChangePassword: vi.fn(),
    sendEmailVerification: vi.fn(async () => {}),
    showToast: vi.fn(),
  };
});

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    logout: mocks.logout,
    hasPasswordProvider: mocks.hasPasswordProvider,
    sendEmailVerification: mocks.sendEmailVerification,
  }),
}));

// Mock useUserProfile so we control tier/unlocks/createdAt/promotedAt/
// referralCode per test. The real hook is smoke-tested at the parent
// level.
vi.mock('../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

// 2026-08-01 (pivot) — useEventOwnerNames backs the OwnerNamesEditor
// inside MyProfile (until Commit 1's Task 1.4 removes that section).
// Mocked here so the inner subscription + save don't fire against
// the unmocked firestore singletons in jsdom.
vi.mock('../hooks/useEventOwnerNames', () => ({
  useEventOwnerNames: vi.fn(() => ({
    ownerNames: { boyName: '', girlName: '' },
    saveOwnerNames: vi.fn().mockResolvedValue(undefined),
    loading: false,
  })),
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
  mocks.hasPasswordProvider.mockClear();
  mocks.onChangePassword.mockClear();
  mocks.sendEmailVerification.mockClear();
  mocks.showToast.mockClear();
  mocks.hasPasswordProvider.mockReturnValue(true);
  // Default to a loaded, free-tier user with a referral code set.
  // Individual tests override.
  useUserProfile.mockReturnValue({
    tier: null,
    unlocks: [],
    createdAt: { toDate: () => new Date('2026-07-22') },
    promotedAt: null,
    referralCode: 'STD-A4X7K',
    ownerNames: { boyName: '', girlName: '' },
    saveOwnerNames: vi.fn().mockResolvedValue(undefined),
    referral: {
      referred: 0,
      claimed: 0,
      storageMbBonus: 0,
      loading: false,
      error: null,
    },
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
    // 2026-07-31 — badge is now a button. aria-label is the most
    // stable string to assert against (won't change across i18n).
    expect(screen.getByRole('button', { name: '重新發送驗證電郵' })).toBeTruthy();
  });

  it('clicking the 未驗證電郵 badge sends a verification email and shows 已發送 ✓', async () => {
    mocks.sendEmailVerification.mockResolvedValueOnce(undefined);
    render(
      <MyProfile
        currentUser={{ ...baseUser, emailVerified: false }}
        onBack={() => {}}
        onUpgrade={() => {}}
        showToast={mocks.showToast}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重新發送驗證電郵' }));

    // 2026-07-31 — waitFor() is the React Testing Library idiom for
    // asserting on async-settled state. fireEvent.click is sync, but
    // sendEmailVerification() is async, and the handler's setTimeout
    // for the 3-second "已發送 ✓" flip requires the React commit
    // queue to drain.
    await waitFor(() => {
      expect(mocks.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
    expect(mocks.showToast).toHaveBeenCalledWith(
      '已發送驗證信，請檢查收件箱及垃圾郵件夾',
    );
    expect(await screen.findByText('已發送 ✓')).toBeTruthy();
  });

  it('keeps the button disabled during in-flight request (no double-send)', async () => {
    // Slow resolve so we can observe the disabled state.
    let resolveSlowSend;
    mocks.sendEmailVerification.mockReturnValueOnce(
      new Promise((resolve) => { resolveSlowSend = resolve; }),
    );
    render(
      <MyProfile
        currentUser={{ ...baseUser, emailVerified: false }}
        onBack={() => {}}
        onUpgrade={() => {}}
        showToast={mocks.showToast}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重新發送驗證電郵' }));

    // While in-flight the button text is 發送中…, and it must be
    // disabled to prevent double-clicks from hammering the API.
    const inFlight = screen.getByRole('button', { name: /發送/ });
    expect(inFlight.disabled).toBe(true);

    // Resolve the in-flight call and let React commit.
    resolveSlowSend(undefined);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('surfaces auth/too-many-requests as a Chinese toast message', async () => {
    // 2026-07-31 — Cloud Function wrappers prefix errors with
    // `functions/<code>`. Either prefix should map to the same
    // user-friendly Chinese message.
    for (const code of ['auth/too-many-requests', 'functions/resource-exhausted']) {
      const err = Object.assign(new Error('rate-limit'), { code });
      mocks.sendEmailVerification.mockRejectedValueOnce(err);
      render(
        <MyProfile
          currentUser={{ ...baseUser, emailVerified: false }}
          onBack={() => {}}
          onUpgrade={() => {}}
          showToast={mocks.showToast}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '重新發送驗證電郵' }));
      expect(
        await screen.findByText('未驗證電郵 · 重發驗證信'),
      ).toBeTruthy();
      expect(mocks.showToast).toHaveBeenCalledWith('嘗試次數太多，請稍後再試');
      cleanup();
      mocks.showToast.mockClear();
    }
  });

  it('shows 👑 Premium 會員 card when tier=premium', () => {
    useUserProfile.mockReturnValue({
      tier: 'premium',
      unlocks: ['custom-template', 'storage-500mb', 'permanent-archive'],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: { toDate: () => new Date('2026-07-29') },
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '志明', girlName: '春嬌' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 5, claimed: 3, storageMbBonus: 1500, loading: false, error: null },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('👑 Premium 會員')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(3);
    const checks = items.map((li) => li.textContent.includes('✓'));
    expect(checks.every(Boolean)).toBe(true);
  });

  it('shows Free card + upgrade CTA when tier!=premium', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '', girlName: '' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 0, claimed: 0, storageMbBonus: 0, loading: false, error: null },
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

  // 2026-07-30 — Security section: change-password tile.

  it('shows "更換密碼" tile when user has password provider, calls onChangePassword("change") on click', () => {
    // Default mock has hasPasswordProvider -> true.
    render(
      <MyProfile
        currentUser={baseUser}
        onBack={() => {}}
        onUpgrade={() => {}}
        onChangePassword={mocks.onChangePassword}
      />,
    );
    const tile = screen.getByText(/^更換密碼$/);
    expect(tile).toBeTruthy();
    fireEvent.click(tile.closest('button'));
    expect(mocks.onChangePassword).toHaveBeenCalledWith('change');
  });

  it('shows "設定登入密碼" tile for Google-only user, calls onChangePassword("set") on click', () => {
    mocks.hasPasswordProvider.mockReturnValue(false);
    render(
      <MyProfile
        currentUser={baseUser}
        onBack={() => {}}
        onUpgrade={() => {}}
        onChangePassword={mocks.onChangePassword}
      />,
    );
    const tile = screen.getByText(/^設定登入密碼$/);
    expect(tile).toBeTruthy();
    fireEvent.click(tile.closest('button'));
    expect(mocks.onChangePassword).toHaveBeenCalledWith('set');
  });

  // 2026-07-30 — 推薦碼 row shows real referralCode, not UID.

  it('shows the real referralCode (STD-XXXXX), not the UID', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '', girlName: '' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 0, claimed: 0, storageMbBonus: 0, loading: false, error: null },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('STD-A4X7K')).toBeTruthy();
    expect(screen.getByText('複製邀請碼')).toBeTruthy();
    expect(screen.queryByText('複製 UID')).toBeNull();
  });

  it('falls back to "(載入中)" when referralCode is null', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: null,
      ownerNames: { boyName: '', girlName: '' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 0, claimed: 0, storageMbBonus: 0, loading: false, error: null },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('（載入中）')).toBeTruthy();
    // No copy button when there's no code to copy.
    expect(screen.queryByText('複製邀請碼')).toBeNull();
    expect(screen.queryByText('複製 UID')).toBeNull();
  });

  it('renders referral KPIs with the right values', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: ['storage-500mb', 'storage-500mb'],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '志明', girlName: '春嬌' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 4, claimed: 2, storageMbBonus: 1000, loading: false, error: null },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    // 已推薦 (referred=4)
    expect(screen.getByText('已推薦')).toBeTruthy();
    // 已領取 (claimed=2)
    expect(screen.getByText('已領取')).toBeTruthy();
    // 額外儲存 (storageMbBonus=1000)
    expect(screen.getByText('額外儲存')).toBeTruthy();
    // The numeric values
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1000MB')).toBeTruthy();
  });

  it('shows the loading dots while the referral fetch is in flight', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '', girlName: '' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 0, claimed: 0, storageMbBonus: 0, loading: true, error: null },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    // Three "…" placeholders (one per KPI tile)
    const dots = screen.getAllByText('…');
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it('shows the unauth hint when the referral fetch fails with unauth', () => {
    useUserProfile.mockReturnValue({
      tier: null,
      unlocks: [],
      createdAt: { toDate: () => new Date('2026-07-22') },
      promotedAt: null,
      referralCode: 'STD-A4X7K',
      ownerNames: { boyName: '', girlName: '' },
      saveOwnerNames: vi.fn().mockResolvedValue(undefined),
      referral: { referred: 0, claimed: 0, storageMbBonus: 0, loading: false, error: 'unauth' },
      loading: false,
    });
    render(
      <MyProfile currentUser={baseUser} onBack={() => {}} onUpgrade={() => {}} />,
    );
    expect(screen.getByText('請登入後查看推薦資料。')).toBeTruthy();
  });

  // 2026-08-01 (pivot) — The two OwnerNamesEditor assertions
  // ('renders the OwnerNamesEditor with pre-filled names' + 'saves
  // new owner names via the hook') were removed because the
  // owner-names editor no longer lives inside MyProfile. It moved
  // to EventSettingsModal (per-event). The 10 OwnerNamesEditor
  // smoke-test assertions in src/components/OwnerNamesEditor.smoke.test.jsx
  // still cover the editor's behavior end-to-end.

  it('shows deleted projects in trash and restores them', () => {
    const onRestoreEvent = vi.fn();
    render(
      <MyProfile
        currentUser={baseUser}
        onBack={() => {}}
        onUpgrade={() => {}}
        deletedEvents={[{ id: 'ev-deleted', name: '已刪除婚禮', date: '2027-01-01' }]}
        onRestoreEvent={onRestoreEvent}
      />,
    );

    expect(screen.getByText('已刪除婚禮')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '還原 已刪除婚禮' }));
    expect(onRestoreEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'ev-deleted' }));
  });
});