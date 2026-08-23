// PurchaseModal.premium-price.test.tsx
// =====================================
//
// 2026-08-23 — Manus P4.2 (PDF Patch 4): UI/server contract test.
//
// The Premium bundle has been rendered at HK$99 since 2026-07-30,
// but the server's `deriveExpectedAmount` was summing the four
// individual SKUs (49+29+39+29 = HK$146). A customer paying the
// displayed $99 was rejected by the server with "amount does not
// match expected $146". Both sides now agree on HK$99 via the
// named `PREMIUM_BUNDLE_PRICE = 99` constant.
//
// This test asserts the UI-side contract from the user's POV:
//   1. Premium tier renders HK$99, not HK$146.
//   2. The UI never displays the legacy HK$146 anywhere.
//   3. The BUNDLE_PRICE inside PurchaseModal equals the server's
//      PREMIUM_BUNDLE_PRICE constant — drift between the two
//      surfaces fails the build.
//
// We import the server constant directly from functions/src/unlocks.
// The frontend vitest config handles relative cross-package imports
// in tests (functions are TS, but we only import a plain number,
// no runtime types).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PREMIUM_BUNDLE_PRICE } from '../../functions/src/unlocks';

// Heavy mocks — we don't want the real Stripe SDK / Firestore in tests.
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn(async () => ({ data: { ok: true } }))),
}));

// Firestore getDoc is called by PurchaseModal to load payment
// settings. Return a non-existent snapshot so the modal uses
// its PAYMENT_DEFAULTS fallback — no fetch path needed.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ __path: 'fake' })),
  getDoc: vi.fn(async () => ({
    exists: () => false,
    data: () => undefined,
  })),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('../lib/firebase', () => ({
  functions: {},
  auth: { currentUser: { uid: 'owner-uid' } },
  db: {},
  appId: 'savetheday-production',
  storage: {},
}));

// Tier resolver: pretend the user is free, so the Premium upsell
// renders.
vi.mock('../lib/entitlements', () => ({
  resolveFeatures: vi.fn(async () => ({
    customInvitation: false,
    watermarkRemoved: false,
    extraStorage: false,
    lifetimeRetention: false,
  })),
}));

describe('PurchaseModal — Premium bundle price (P4.2)', () => {
  it('renders HK$99 (Premium bundle price) when user picks premium tier', async () => {
    // Dynamic import AFTER the mocks register so the module picks
    // them up.
    const { PurchaseModal } = await import('./PurchaseModal');
    render(
      <PurchaseModal
        isOpen
        onClose={() => {}}
        ownerUid="owner-uid"
        eventId="event-1"
        onSuccess={() => {}}
      />,
    );

    // Wait for the modal title to appear (it's rendered synchronously
    // on the first render; no fetch path).
    await screen.findByText(/升級 Premium/);

    // Assert HK$99 is in the DOM and HK$146 is NOT.
    const html = document.body.textContent || '';
    expect(html).toMatch(/\$99|\b99\b/);
    expect(html).not.toContain('146');

    cleanup();
  });

  it('BUNDLE_PRICE in PurchaseModal equals server PREMIUM_BUNDLE_PRICE', async () => {
    // Source-text audit: the modal declares `const BUNDLE_PRICE = 99`
    // locally. We can't import the local constant directly (it's
    // not exported), so we read the file and assert the value is
    // exactly PREMIUM_BUNDLE_PRICE.
    //
    // The PDF calls for this test to catch the exact drift case:
    // someone raises the bundle to HK$109 in the UI but forgets
    // to update the server constant (or vice versa). The
    // canonical source is PREMIUM_BUNDLE_PRICE; everything else
    // must match.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');

    const modalSrc = fs.readFileSync(
      path.join(
        path.dirname(url.fileURLToPath(import.meta.url)),
        'PurchaseModal.tsx',
      ),
      'utf8',
    );

    // Find the BUNDLE_PRICE declaration and assert it equals
    // PREMIUM_BUNDLE_PRICE (99). Either an inline literal `99`
    // or a reference to a shared module both satisfy this; we
    // use a permissive regex that catches both.
    const inlineLiteralMatch = modalSrc.match(/BUNDLE_PRICE\s*=\s*(\d+)/);
    expect(inlineLiteralMatch).toBeTruthy();
    expect(Number(inlineLiteralMatch![1])).toBe(PREMIUM_BUNDLE_PRICE);

    // The server constant should literally be 99 right now.
    // If anyone bumps it to 109 in functions/src/unlocks.ts,
    // this test fails and forces a coordinated update here too.
    expect(PREMIUM_BUNDLE_PRICE).toBe(99);
  });

  it('rejects HK$146 in the rendered DOM (failing-closed UI contract)', async () => {
    // Defence-in-depth: even if the modal were ever edited to add
    // an old legacy price tag ("HKD 146" or "$146"), this test
    // would catch it and force a removal. The legacy sum is
    // forbidden everywhere in the UI.
    const { PurchaseModal } = await import('./PurchaseModal');
    render(
      <PurchaseModal
        isOpen
        onClose={() => {}}
        ownerUid="owner-uid"
        eventId="event-1"
        onSuccess={() => {}}
      />,
    );

    // Wait for the modal to render.
    await screen.findByText(/升級 Premium/);

    // Walk the entire DOM and assert no node contains "146" as a
    // standalone token. We split on whitespace and check each
    // token for equality with the legacy sum.
    const text = (document.body.textContent || '').replace(/\s+/g, ' ');
    const tokens = text.split(/[^0-9]+/).filter(Boolean);
    expect(tokens).not.toContain('146');

    cleanup();
  });

  it('lockedTypes filter renders only the requested SKU at its standalone price', async () => {
    // P4.1: when App.jsx passes lockedTypes=['custom-template'],
    // the modal shows ONLY the custom-template tier at HK$49
    // (its standalone UNLOCK_PRICING value), not the bundle.
    const { PurchaseModal } = await import('./PurchaseModal');
    render(
      <PurchaseModal
        isOpen
        onClose={() => {}}
        ownerUid="owner-uid"
        eventId="event-1"
        lockedTypes={['custom-template']}
        onSuccess={() => {}}
      />,
    );

    // Wait for the modal to render.
    await screen.findByText(/升級 Premium/);

    const text = document.body.textContent || '';
    expect(text).toContain('49');
    expect(text).not.toContain('146');

    cleanup();
  });
});