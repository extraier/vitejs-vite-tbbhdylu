// Smoke test for ReferralModal.
//
// 2026-08-15 — Rewritten to match the auto-qualify flow:
//   - Two tabs (share / track). The email-claim tab is gone.
//   - Track tab surfaces qualifiedReferralCount, with a celebration
//     banner when the count is > 0.
//   - The modal subscribes to the user's own Firestore doc via
//     onSnapshot so a fresh auto-qualify unlock is detected in
//     real time; we verify onQualifiedIncrease fires when the
//     snapshot reports a higher count.
//
// We mock firebase/functions and firebase/firestore so the smoke
// test stays in-process. The actual Cloud Functions trigger
// (referralCodes.ts:onEventCreated) is verified separately in
// production via the Firestore REST round-trip pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// Mock the Firebase Functions callable surface.
const mockCallableMap = {
  getMyReferralInfo: vi.fn(async () => ({
    data: {
      code: 'STD-7K9M2',
      shareUrl: 'https://savetheday.io/?ref=STD-7K9M2',
      referredCount: 2,
      qualifiedReferralCount: 1,
      claimedCount: 1,
    },
  })),
};

// Track onSnapshot subscribers so tests can simulate firestore
// updates to the user doc (qualifiedReferralCount bump).
const userDocSubscribers = [];
let currentUserData = {
  qualifiedReferralCount: 1,
  tier: 'free',
};

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn((_functions, name) => {
      const fn = mockCallableMap[name];
      if (!fn) throw new Error(`No mock for ${name}`);
      return fn;
    }),
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: vi.fn(() => ({ __path: 'userDoc' })),
    onSnapshot: vi.fn((_ref, onNext) => {
      const sub = (_data) => {
        // jsdom-ish: synchronously deliver current snapshot.
        onNext({ data: () => currentUserData });
      };
      userDocSubscribers.push(sub);
      // Deliver initial snapshot so lastQualified gets seeded.
      sub(currentUserData);
      return () => {
        const idx = userDocSubscribers.indexOf(sub);
        if (idx >= 0) userDocSubscribers.splice(idx, 1);
      };
    }),
  };
});

// Mock the firebase lib so we don't pull in the real auth/db.
vi.mock('../../lib/firebase', () => ({
  functions: {},
  db: {},
  auth: { currentUser: { uid: 'owner-uid' } },
  appId: 'savetheday-production',
}));

import { ReferralModal } from './ReferralModal';

beforeEach(() => {
  Object.values(mockCallableMap).forEach((fn) => fn.mockClear());
  userDocSubscribers.length = 0;
  currentUserData = { qualifiedReferralCount: 1, tier: 'free' };
});

afterEach(() => {
  cleanup();
});

describe('ReferralModal — auto-qualify shape (2026-08-15)', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ReferralModal isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the two tabs and fetches referral info on open', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    // Two tab buttons (claim tab is gone)
    expect(screen.getByText('分享')).toBeTruthy();
    expect(screen.queryByText('領取')).toBeNull();
    expect(screen.getByText('追蹤')).toBeTruthy();
    // Header
    expect(screen.getByText(/推薦朋友 · 解鎖 Premium/)).toBeTruthy();
    // Wait for getMyReferralInfo to populate the share tab
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('https://savetheday.io/?ref=STD-7K9M2')).toBeTruthy();
  });

  it('share tab copy reflects automatic qualification (no manual claim step)', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    // The hint text under the share URL should mention "automatic"
    // rather than telling the user to go to a claim tab.
    expect(screen.getByText(/自動收到/)).toBeTruthy();
    expect(screen.queryByText(/「領取」tab/)).toBeNull();
  });

  it('switches to track tab and shows qualifiedReferralCount', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('追蹤'));
    // Numbers — referredCount=2, qualifiedReferralCount=1
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('已註冊朋友')).toBeTruthy();
    expect(screen.getByText('已解鎖推薦')).toBeTruthy();
    // Old label "已建立婚禮" should be gone.
    expect(screen.queryByText('已建立婚禮')).toBeNull();
  });

  it('shows celebration banner when qualifiedReferralCount > 0', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('追蹤'));
    expect(screen.getByText(/你已經係 Premium 用戶/)).toBeTruthy();
    expect(screen.getByText(/自動解鎖/)).toBeTruthy();
  });

  it('hides celebration banner when qualifiedReferralCount === 0', async () => {
    // Override the mock to return 0 qualified referrals.
    mockCallableMap.getMyReferralInfo.mockResolvedValueOnce({
      data: {
        code: 'STD-7K9M2',
        shareUrl: 'https://savetheday.io/?ref=STD-7K9M2',
        referredCount: 0,
        qualifiedReferralCount: 0,
        claimedCount: 0,
      },
    });
    // And the user doc snapshot starts at 0.
    currentUserData = { qualifiedReferralCount: 0, tier: 'free' };

    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('追蹤'));
    expect(screen.queryByText(/你已經係 Premium 用戶/)).toBeNull();
  });

  it('fires onQualifiedIncrease when the user doc snapshot reports a higher count', async () => {
    const onIncrease = vi.fn();
    // Start at 0 (no referrals yet)
    currentUserData = { qualifiedReferralCount: 0, tier: 'free' };
    mockCallableMap.getMyReferralInfo.mockResolvedValueOnce({
      data: {
        code: 'STD-7K9M2',
        shareUrl: 'https://savetheday.io/?ref=STD-7K9M2',
        referredCount: 1,
        qualifiedReferralCount: 0,
        claimedCount: 0,
      },
    });

    render(
      <ReferralModal
        isOpen={true}
        onClose={() => {}}
        onQualifiedIncrease={onIncrease}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    expect(onIncrease).not.toHaveBeenCalled();

    // Simulate the auto-qualify trigger firing — the user doc now
    // shows qualifiedReferralCount: 1. Deliver via the snapshot
    // subscribers the mock captured.
    act(() => {
      currentUserData = { qualifiedReferralCount: 1, tier: 'premium' };
      userDocSubscribers.forEach((s) => s(currentUserData));
    });

    await waitFor(() => {
      expect(onIncrease).toHaveBeenCalledWith(1);
    });
  });

  it('does not fire onQualifiedIncrease when the count is unchanged', async () => {
    const onIncrease = vi.fn();
    currentUserData = { qualifiedReferralCount: 2, tier: 'premium' };
    mockCallableMap.getMyReferralInfo.mockResolvedValueOnce({
      data: {
        code: 'STD-7K9M2',
        shareUrl: 'https://savetheday.io/?ref=STD-7K9M2',
        referredCount: 2,
        qualifiedReferralCount: 2,
        claimedCount: 2,
      },
    });

    render(
      <ReferralModal
        isOpen={true}
        onClose={() => {}}
        onQualifiedIncrease={onIncrease}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });

    // Re-deliver the same snapshot — count didn't go up.
    act(() => {
      userDocSubscribers.forEach((s) => s(currentUserData));
    });

    // Give React a tick to potentially fire the callback.
    await new Promise((r) => setTimeout(r, 50));
    expect(onIncrease).not.toHaveBeenCalled();
  });

  it('track tab is empty-state friendly when both counts are 0', async () => {
    mockCallableMap.getMyReferralInfo.mockResolvedValueOnce({
      data: {
        code: 'STD-NEWUS',
        shareUrl: 'https://savetheday.io/?ref=STD-NEWUS',
        referredCount: 0,
        qualifiedReferralCount: 0,
        claimedCount: 0,
      },
    });
    currentUserData = { qualifiedReferralCount: 0, tier: 'free' };

    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-NEWUS')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('追蹤'));
    // Both counts render as 0, no celebration banner.
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/你已經係 Premium 用戶/)).toBeNull();
  });
});