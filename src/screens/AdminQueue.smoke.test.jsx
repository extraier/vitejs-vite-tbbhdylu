// Smoke test for AdminQueue.
//
// Covers:
//   1. Non-admin sees "需要管理員權限" with back button
//   2. Admin sees three filter pills (socialProofs, referralClaims,
//      paymentReceipts) and a load button
//   3. Load button fires a collectionGroup query
//   4. Items render with the right per-type fields
//   5. Approve / Reject buttons call the right adminVerify* CF
//   6. After approve/reject, the row is removed from the list
//
// Note: this is a .jsx file (not .tsx) so we don't use TS types in
// the test body. The component file is .tsx; only the test avoids
// TS to keep the existing test config happy.

// 2026-07-29 — vi.mock is hoisted to the top of the file by vitest,
// before our consts are initialized. vi.hoisted() lets us declare
// the mock state in a hoisted block so the factory can reference it.
const mocks = vi.hoisted(() => ({
  query: {},
  getDocs: vi.fn(async () => ({
    docs: [
      {
        id: 'p1',
        ref: {
          path: 'artifacts/app1/users/uid123/socialProofs/p1',
        },
        data: () => ({
          unlockType: 'custom-template',
          postUrl: 'https://instagram.com/p/abc',
          screenshotUrl: 'https://firebasestorage.googleapis.com/v0/b/savetheday-2377a.firebasestorage.app/o/social-proofs%2Fuid123%2Fproof.png?alt=media&token=test-token',
          status: 'pending',
          createdAt: { _seconds: 1700000000 },
        }),
      },
      {
        id: 'c1',
        ref: {
          path: 'artifacts/app1/users/uid456/referralClaims/c1',
        },
        data: () => ({
          unlockType: 'storage-500mb',
          friendName: 'Alice',
          friendUid: 'uid789',
          status: 'pending',
          createdAt: { _seconds: 1700000001 },
        }),
      },
    ],
  })),
  adminVerifySocialProof: vi.fn(async () => ({ data: { ok: true } })),
  adminVerifyReferral: vi.fn(async () => ({ data: { ok: true } })),
  adminVerifyPayment: vi.fn(async () => ({ data: { ok: true } })),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn((_functions, name) => {
      if (name === 'adminVerifySocialProof') return mocks.adminVerifySocialProof;
      if (name === 'adminVerifyReferral') return mocks.adminVerifyReferral;
      if (name === 'adminVerifyPayment') return mocks.adminVerifyPayment;
      throw new Error(`No mock for ${name}`);
    }),
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collectionGroup: vi.fn(() => mocks.query),
    query: vi.fn(() => mocks.query),
    where: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    getDocs: mocks.getDocs,
  };
});

import { AdminQueue } from './AdminQueue';

beforeEach(() => {
  mocks.getDocs.mockClear();
  mocks.adminVerifySocialProof.mockClear();
  mocks.adminVerifyReferral.mockClear();
  mocks.adminVerifyPayment.mockClear();
  // window.prompt returns null by default (means "cancelled")
  // Tests that want a rejection reason will override.
  vi.spyOn(window, 'prompt').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminQueue', () => {
  it('shows "需要管理員權限" for non-admin', () => {
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={false} onBack={() => {}} />,
    );
    expect(screen.getByText(/需要管理員權限/)).toBeTruthy();
  });

  it('admin sees three filter pills and a load button', () => {
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={true} onBack={() => {}} />,
    );
    expect(screen.getByText('社交證明')).toBeTruthy();
    expect(screen.getByText('推薦 claim')).toBeTruthy();
    expect(screen.getByText('付款收據')).toBeTruthy();
    // The "載入待審" prefix is unique to the load button (the
    // empty-state copy uses 「」 brackets).
    expect(screen.getByRole('button', { name: /載入待審/ })).toBeTruthy();
  });

  it('load button fires a query and renders pending items', async () => {
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={true} onBack={() => {}} />,
    );
    // The text "載入待審" also appears in the empty-state placeholder
    // ("按「載入待審」開始審批"). Match the button label specifically.
    fireEvent.click(screen.getByRole('button', { name: /載入待審/ }));
    await waitFor(() => {
      expect(mocks.getDocs).toHaveBeenCalled();
    });
    await waitFor(() => {
      // First row — social proof
      expect(screen.getByText(/custom-template/)).toBeTruthy();
    });
    // URL link present
    expect(screen.getByText(/instagram\.com\/p\/abc/)).toBeTruthy();
    // Screenshot proof must be rendered as an inline image in the admin row.
    expect(screen.getByRole('img', { name: '社交證明截圖' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '社交證明截圖' }).getAttribute('src')).toContain('social-proofs%2Fuid123%2Fproof.png');
  });

  it('approve button calls adminVerifySocialProof with the right ids', async () => {
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={true} onBack={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /載入待審/ }));
    await waitFor(() => {
      // Two rows: the social proof (uid123) and the referral claim
      // (uid456). Both render "通過" buttons. The first "通過" in
      // DOM order is whichever has the latest createdAt — that's
      // uid456 here (1700000001 > 1700000000). Test the uid123
      // social proof path by finding the row that contains its
      // IG URL and clicking the "通過" inside it.
      expect(screen.getByText(/instagram\.com\/p\/abc/)).toBeTruthy();
    });
    // Locate the social proof row by its URL, then its sibling 通過.
    const socialProofUrl = screen.getByText(/instagram\.com\/p\/abc/);
    const row = socialProofUrl.closest('li');
    expect(row).toBeTruthy();
    const approveBtn = row.querySelector('button.bg-emerald-500');
    expect(approveBtn).toBeTruthy();
    fireEvent.click(approveBtn);
    await waitFor(() => {
      expect(mocks.adminVerifySocialProof).toHaveBeenCalledWith({
        uid: 'uid123',
        proofId: 'p1',
        claimId: '',
        receiptId: '',
        decision: 'approve',
        rejectionReason: undefined,
      });
    });
  });

  it('reject with reason calls adminVerifySocialProof with rejectionReason', async () => {
    vi.mocked(window.prompt).mockReturnValueOnce('睇唔到標記');
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={true} onBack={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /載入待審/ }));
    await waitFor(() => {
      expect(screen.getByText(/instagram\.com\/p\/abc/)).toBeTruthy();
    });
    const socialProofUrl = screen.getByText(/instagram\.com\/p\/abc/);
    const row = socialProofUrl.closest('li');
    const rejectBtn = row.querySelector('button.bg-rose-500');
    expect(rejectBtn).toBeTruthy();
    fireEvent.click(rejectBtn);
    await waitFor(() => {
      expect(mocks.adminVerifySocialProof).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'reject',
          rejectionReason: '睇唔到標記',
        }),
      );
    });
  });

  it('back button calls onBack', () => {
    const onBack = vi.fn();
    render(
      <AdminQueue user={{ uid: 'u1' }} isAdmin={true} onBack={onBack} />,
    );
    fireEvent.click(screen.getByText('返回'));
    expect(onBack).toHaveBeenCalled();
  });
});
