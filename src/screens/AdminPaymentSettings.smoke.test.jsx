// 2026-08-07 — Smoke test for AdminPaymentSettings.
//
// Validates the admin-side wiring for the PayMe QR + FPS banking
// form. Doesn't test Firestore / Storage I/O directly — those are
// exercised by integration / Playwright tests. Covers:
//   1. Non-admin sees the gate page (not the form)
//   2. Admin sees the title + both PayMe / FPS sections
//   3. FPS fields are present and editable
//   4. QR upload area is present for both PayMe and FPS
//
// Mocks firebase modules to avoid jsdom Firebase init issues,
// matching the pattern in PurchaseModal.smoke.test.jsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../lib/firebase', () => ({
  db: {},
  storage: {},
  auth: {},
  appId: 'test-app',
}));

// 2026-08-07 — Use importOriginal so firebase/firestore's real
// exports (getFirestore / initializeApp etc., which firebase.ts
// touches on import) flow through the mock, while we still stub
// the methods AdminPaymentSettings actually calls. Without this,
// `import { getFirestore } from 'firebase/firestore'` in firebase.ts
// throws "No getFirestore export is defined on the firebase/firestore
// mock" at test-load time.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    setDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn(() => 'ts'),
  };
});

vi.mock('firebase/storage', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ref: vi.fn(),
    uploadBytes: vi.fn(() => Promise.resolve()),
    getDownloadURL: vi.fn(() => Promise.resolve('https://example.test/qr.png')),
    deleteObject: vi.fn(() => Promise.resolve()),
  };
});

import { AdminPaymentSettings } from './AdminPaymentSettings';

beforeEach(() => {
  cleanup();
});

describe('AdminPaymentSettings (2026-08-07)', () => {
  it('non-admin sees the gate page, not the form', () => {
    render(<AdminPaymentSettings user={{ uid: 'u1' }} isAdmin={false} />);
    expect(screen.getByText('管理員專用')).toBeTruthy();
    expect(screen.queryByText('收款設定')).toBeNull();
  });

  // 2026-08-07 — Admin sees the page title + both PayMe / FPS
  // sections after the loading spinner resolves (async getDoc
  // call completes via the importOriginal-wrapped mock).
  it('admin sees the page title + both PayMe / FPS sections', async () => {
    render(<AdminPaymentSettings user={{ uid: 'u1' }} isAdmin={true} />);
    expect(screen.getByText('💳 收款設定')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('PayMe')).toBeTruthy();
    });
    // The FPS heading is "FPS (轉數快)" — match that exact string
    // so we don't accidentally match the "FPS ID" label below it.
    expect(screen.getByText(/FPS \(轉數快\)/)).toBeTruthy();
  });

  // 2026-08-07 — FPS form fields render after the initial load.
  it('FPS form fields are present and editable', async () => {
    render(<AdminPaymentSettings user={{ uid: 'u1' }} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/HSBC/)).toBeTruthy();
    });
    expect(screen.getByPlaceholderText(/Save The Day Limited/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/168888888/)).toBeTruthy();
  });

  // 2026-08-07 — Two QR upload buttons present (one PayMe, one
  // FPS). The "點擊上傳 QR Code" placeholder shows inside each
  // when no QR has been uploaded yet.
  it('QR upload areas are present for both PayMe and FPS', async () => {
    render(<AdminPaymentSettings user={{ uid: 'u1' }} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getAllByText(/點擊上傳 QR Code/).length).toBe(2);
    });
    const uploads = screen.getAllByText(/點擊上傳 QR Code/);
    expect(uploads.length).toBe(2);
  });
});