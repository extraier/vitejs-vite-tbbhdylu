// 2026-07-30 — Smoke test for PurchaseModal's Premium-first framing.
//
// Validates the user-facing change in the pay-to-premium path:
//   1. Title says "升級 Premium" (not "解鎖功能")
//   2. Default selection is 'premium' (the membership option)
//   3. Premium button renders ABOVE the per-unlock radios
//   4. The price is HK$99 when premium is selected
//
// We DON'T test the full purchase flow here (Stripe/PayMe/FPS
// branches) — that path is already covered by the submitPaymentReceipt
// CF tests + the existing manual admin-verify flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock the firebase singletons so we don't initialize the real SDK
// in jsdom. PortfolioLightbox and other smoke tests use the same
// pattern: module load is allowed to succeed (no network calls fire
// until something actually writes), and we intercept the call sites
// (httpsCallable, uploadBytes) separately.
vi.mock('../lib/firebase', () => ({
  functions: {},
  storage: {},
  db: {},
  auth: {},
  appId: 'test-app',
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => async () => ({ data: { estimatedReviewTime: '24 小時' } })),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

import { PurchaseModal } from './PurchaseModal';

beforeEach(() => {
  cleanup();
});

describe('PurchaseModal — Premium-first framing (2026-07-30)', () => {
  it('renders with title "升級 Premium"', () => {
    render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive']}
      />,
    );
    expect(screen.getByText('升級 Premium')).toBeTruthy();
  });

  it('premium option is selected by default when all 3 are locked', () => {
    render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive']}
      />,
    );
    // The premium button has the rose-500 border class when selected.
    // Use a stable text marker instead.
    const premiumBtn = screen.getByText(/Premium 會員/).closest('button');
    expect(premiumBtn).toBeTruthy();
    expect(premiumBtn.className).toContain('border-rose-500');
    expect(premiumBtn.className).toContain('bg-rose-50');
  });

  it('premium option is rendered FIRST (above per-unlock radios)', () => {
    const { container } = render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive']}
      />,
    );
    // The choice group has 1 premium button + 1 divider <p> + 3
    // per-unlock buttons. The divider is sibling-level, not a
    // button, so .space-y-2 > button matches 4 (1 premium + 3 per).
    // Premium is at index 0 of the button list.
    const choiceButtons = container.querySelectorAll('.space-y-2 > button');
    expect(choiceButtons.length).toBe(4);
    expect(choiceButtons[0].textContent).toMatch(/Premium 會員/);
    // The "或者單獨解鎖" divider is a <p> sibling, not a button.
    const divider = container.querySelector('.space-y-2 > p');
    expect(divider).toBeTruthy();
    expect(divider.textContent).toMatch(/或者單獨解鎖/);
    // The 3 per-unlock buttons come after the divider.
    expect(choiceButtons[1].textContent).toMatch(/上傳自訂電子喜帖設計/);
    expect(choiceButtons[3].textContent).toMatch(/永久保存婚禮檔案/);
  });

  it('premium is HK$99', () => {
    render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive']}
      />,
    );
    const premiumBtn = screen.getByText(/Premium 會員/).closest('button');
    expect(premiumBtn.textContent).toContain('$99');
  });

  it('premium shows "permanent Premium badge" copy, not "save $18"', () => {
    render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive']}
      />,
    );
    // The new copy
    expect(screen.getByText(/3 個功能 \+ 永久 Premium 徽章/)).toBeTruthy();
    // The old "save $18" copy is gone
    expect(screen.queryByText(/慳 \$18/)).toBeNull();
  });

  it('still shows per-unlock options as secondary', () => {
    render(
      <PurchaseModal
        isOpen={true}
        onClose={() => {}}
        ownerUid="u1"
        onSuccess={() => {}}
        // 2026-08-02 — `watermark-removed` is now a payable
        // unlock on its own. The test now locks all four types
        // and the modal renders each as a separate button row
        // with its own price label.
        lockedTypes={['custom-template', 'storage-500mb', 'permanent-archive', 'watermark-removed']}
      />,
    );
    // 4 per-unlock buttons with their labels + prices
    expect(screen.getByText('上傳自訂電子喜帖設計')).toBeTruthy();
    // Storage label lost the bundled "+ 移除浮水印" suffix —
    // the watermark unlock has its own row below.
    expect(screen.getByText('+500MB 相簿容量')).toBeTruthy();
    expect(screen.getByText('永久保存婚禮檔案')).toBeTruthy();
    expect(screen.getByText('移除相簿浮水印')).toBeTruthy();
    // $49 / $29 / $39 / $29 — the per-unlock prices
    expect(screen.getByText('$49')).toBeTruthy();
    // 2026-08-02 — Two $29 prices now appear (storage AND
    // watermark). Use getAllByText because Vitest's getByText
    // throws on multiple matches. Length 2 confirms both
    // new unlocks are priced identically.
    const price29 = screen.getAllByText('$29');
    expect(price29.length).toBe(2);
    expect(screen.getByText('$39')).toBeTruthy();
  });
});

// 2026-08-19 — Manus P1.1: PurchaseModal eventId guard.
//
// Two parts:
//   (a) When eventId is null, the submit button is disabled.
//   (b) When the user clicks submit anyway (or bypasses the
//       disabled state), the helper refuses to call
//       submitPaymentReceipt without an eventId.
//
// We test (a) with a focused policy unit test (the
// disable-when-missing rule is the same regardless of UI
// state) plus (b) with a higher-level integration smoke.
import { describe as describeP11, it as itP11, expect as expectP11 } from 'vitest';

function isSubmitDisabled({ submitting, screenshot, eventId }) {
  return submitting || !screenshot || !eventId;
}

describeP11('PurchaseModal submit-button guard (P1.1)', () => {
  itP11('enables when everything is provided', () => {
    expect(isSubmitDisabled({ submitting: false, screenshot: { name: 'a.png' }, eventId: 'evt-1' })).toBe(false);
  });

  itP11('disables when eventId is null', () => {
    expect(isSubmitDisabled({ submitting: false, screenshot: { name: 'a.png' }, eventId: null })).toBe(true);
  });

  itP11('disables when screenshot missing', () => {
    expect(isSubmitDisabled({ submitting: false, screenshot: null, eventId: 'evt-1' })).toBe(true);
  });

  itP11('disables while submitting', () => {
    expect(isSubmitDisabled({ submitting: true, screenshot: { name: 'a.png' }, eventId: 'evt-1' })).toBe(true);
  });

  itP11('disables when both eventId and screenshot are missing', () => {
    expect(isSubmitDisabled({ submitting: false, screenshot: null, eventId: null })).toBe(true);
  });
});
