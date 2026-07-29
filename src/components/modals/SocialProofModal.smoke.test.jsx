// Smoke test for SocialProofModal.
//
// Covers:
//   1. Modal renders nothing when isOpen=false
//   2. Two tabs (提交 / 進度) present
//   3. Submit form has unlock-type radios + URL + caption
//   4. Submitting calls submitSocialProof and shows success message
//   5. Submission error surfaces friendly message
//   6. History tab lists existing proofs with status badges
//   7. Empty history shows empty-state copy

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockSubmit = vi.fn(async ({ postUrl }) => ({
  data: {
    proofId: `custom-template-${Date.now()}`,
    estimatedReviewTime: '管理員會喺 24 小時內人手核實',
  },
}));

const mockList = vi.fn(async () => ({
  data: {
    ok: true,
    rows: [
      {
        id: 'p1',
        unlockType: 'custom-template',
        postUrl: 'https://instagram.com/p/abc',
        status: 'pending',
        createdAt: Date.now() - 3600_000,
        verifiedAt: null,
        rejectionReason: null,
      },
      {
        id: 'p2',
        unlockType: 'permanent-archive',
        postUrl: 'https://instagram.com/reel/xyz',
        status: 'approved',
        createdAt: Date.now() - 86400_000,
        verifiedAt: Date.now() - 80000_000,
        rejectionReason: null,
      },
      {
        id: 'p3',
        unlockType: 'custom-template',
        postUrl: 'https://facebook.com/p/def',
        status: 'rejected',
        createdAt: Date.now() - 172800_000,
        verifiedAt: Date.now() - 170000_000,
        rejectionReason: '睇唔到 @savetheday.hk 標記',
      },
    ],
  },
}));

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn((_functions, name) => {
      if (name === 'submitSocialProof') return mockSubmit;
      if (name === 'listSocialProofs') return mockList;
      throw new Error(`No mock for ${name}`);
    }),
  };
});

import { SocialProofModal } from './SocialProofModal';

beforeEach(() => {
  mockSubmit.mockClear();
  mockList.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('SocialProofModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SocialProofModal isOpen={false} onClose={() => {}} ownerUid="u1" />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders two tabs and the submit form by default', () => {
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    expect(screen.getByText('提交')).toBeTruthy();
    expect(screen.getByText('進度')).toBeTruthy();
    expect(screen.getByText('社交分享解鎖')).toBeTruthy();
    // Unlock type radios
    expect(screen.getByLabelText(/自訂電子喜帖設計/)).toBeTruthy();
    expect(screen.getByLabelText(/永久保存婚禮檔案/)).toBeTruthy();
    // URL + caption
    expect(screen.getByPlaceholderText(/instagram\.com\/p/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/標記咗/)).toBeTruthy();
    // Submit button
    expect(screen.getByText(/提交社交證明/)).toBeTruthy();
  });

  it('submits form and shows success message', async () => {
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    const urlInput = screen.getByPlaceholderText(/instagram\.com\/p/);
    fireEvent.change(urlInput, {
      target: { value: 'https://www.instagram.com/p/Cxyz' },
    });
    fireEvent.click(screen.getByText(/提交社交證明/));
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        unlockType: 'custom-template',
        postUrl: 'https://www.instagram.com/p/Cxyz',
        caption: undefined,
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/已提交！等待管理員核實/)).toBeTruthy();
    });
  });

  it('switches unlock type and submits with that type', async () => {
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    fireEvent.click(screen.getByLabelText(/永久保存婚禮檔案/));
    fireEvent.change(screen.getByPlaceholderText(/instagram\.com\/p/), {
      target: { value: 'https://www.instagram.com/reel/abc' },
    });
    fireEvent.click(screen.getByText(/提交社交證明/));
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ unlockType: 'permanent-archive' }),
      );
    });
  });

  it('shows error message when submitSocialProof fails', async () => {
    mockSubmit.mockRejectedValueOnce({
      code: 'functions/invalid-argument',
      message: 'URL must be Instagram or Facebook.',
    });
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/instagram\.com\/p/), {
      target: { value: 'https://example.com/post' },
    });
    fireEvent.click(screen.getByText(/提交社交證明/));
    await waitFor(() => {
      expect(screen.getByText(/必須係 Instagram 或 Facebook 連結/)).toBeTruthy();
    });
  });

  it('loads and displays history with status badges', async () => {
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    fireEvent.click(screen.getByText('進度'));
    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });
    // Three rows render
    await waitFor(() => {
      expect(screen.getByText(/@savetheday\.hk 標記/)).toBeTruthy();
    });
    expect(screen.getByText('核實中')).toBeTruthy();
    expect(screen.getByText('已通過')).toBeTruthy();
    expect(screen.getByText('已拒絕')).toBeTruthy();
  });

  it('shows empty state when history is empty', async () => {
    mockList.mockResolvedValueOnce({ data: { ok: true, rows: [] } });
    render(<SocialProofModal isOpen={true} onClose={() => {}} ownerUid="u1" />);
    fireEvent.click(screen.getByText('進度'));
    await waitFor(() => {
      expect(screen.getByText(/尚未提交任何社交證明/)).toBeTruthy();
    });
  });
});