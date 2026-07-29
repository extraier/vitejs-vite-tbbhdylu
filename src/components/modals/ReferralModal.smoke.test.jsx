// Smoke test for ReferralModal.
//
// Covers:
//   1. Modal renders the three tabs (share / claim / track)
//   2. Share tab shows referral code + shareUrl from getMyReferralInfo
//   3. Claim tab accepts email input + submit calls requestReferralClaim
//   4. Track tab shows referredCount + claimedCount
//   5. Network errors surface a friendly message
//   6. Modal is hidden when isOpen=false
//
// We mock firebase/functions so the smoke test stays in-process —
// the actual Cloud Functions are verified separately in production
// via the Firestore REST round-trip pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockCallableMap = {
  getMyReferralInfo: vi.fn(async () => ({
    data: {
      code: 'STD-7K9M2',
      shareUrl: 'https://savetheday.io/?ref=STD-7K9M2',
      referredCount: 2,
      claimedCount: 1,
    },
  })),
  requestReferralClaim: vi.fn(async ({ friendEmail }) => ({
    data: {
      ok: true,
      unlockId: 'storage-500mb-12345',
      alreadyGranted: false,
      friendName: friendEmail.split('@')[0],
    },
  })),
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

import { ReferralModal } from './ReferralModal';

beforeEach(() => {
  Object.values(mockCallableMap).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  cleanup();
});

describe('ReferralModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ReferralModal isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the three tabs and fetches referral info on open', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    // Three tab buttons
    expect(screen.getByText('分享')).toBeTruthy();
    expect(screen.getByText('領取')).toBeTruthy();
    expect(screen.getByText('追蹤')).toBeTruthy();
    // Header
    expect(screen.getByText(/推薦朋友 · 解鎖 Premium/)).toBeTruthy();
    // Wait for getMyReferralInfo to populate the share tab
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('https://savetheday.io/?ref=STD-7K9M2')).toBeTruthy();
  });

  it('switches to claim tab when clicked', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('領取'));
    expect(screen.getByPlaceholderText('friend@example.com')).toBeTruthy();
    expect(screen.getByText(/領取 \+500MB 解鎖/)).toBeTruthy();
  });

  it('submits the claim form and calls requestReferralClaim', async () => {
    const onSuccess = vi.fn();
    render(<ReferralModal isOpen={true} onClose={() => {}} onClaimSuccess={onSuccess} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('領取'));
    const input = screen.getByPlaceholderText('friend@example.com');
    fireEvent.change(input, { target: { value: 'alice@example.com' } });
    fireEvent.click(screen.getByText(/領取 \+500MB 解鎖/));
    await waitFor(() => {
      expect(mockCallableMap.requestReferralClaim).toHaveBeenCalledWith({
        friendEmail: 'alice@example.com',
      });
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('alice');
    });
  });

  it('shows success message after a claim', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('領取'));
    fireEvent.change(screen.getByPlaceholderText('friend@example.com'), {
      target: { value: 'bob@example.com' },
    });
    fireEvent.click(screen.getByText(/領取 \+500MB 解鎖/));
    await waitFor(() => {
      expect(screen.getByText(/解鎖成功/)).toBeTruthy();
    });
  });

  it('shows error message when claim fails', async () => {
    mockCallableMap.requestReferralClaim.mockRejectedValueOnce({
      code: 'functions/failed-precondition',
      message: '你嘅朋友仲未建立任何婚禮',
    });
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('領取'));
    fireEvent.change(screen.getByPlaceholderText('friend@example.com'), {
      target: { value: 'carol@example.com' },
    });
    fireEvent.click(screen.getByText(/領取 \+500MB 解鎖/));
    await waitFor(() => {
      expect(screen.getByText(/仲未建立任何婚禮/)).toBeTruthy();
    });
  });

  it('switches to track tab and shows counts', async () => {
    render(<ReferralModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('STD-7K9M2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('追蹤'));
    // Numbers
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('已註冊朋友')).toBeTruthy();
    expect(screen.getByText('已建立婚禮')).toBeTruthy();
  });
});