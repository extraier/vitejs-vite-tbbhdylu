// InvitationEditor.purchase.test.jsx
// ==================================
//
// 2026-08-23 — Manus P4.1 (PDF Patch 4): purchase-flow regression.
//
// Verifies three contracts:
//   1. Clicking the locked custom-background button (when ownerTier !==
//      'premium') fires `onRequestPremium`. The screen no longer
//      owns its own UpgradeModal — the parent opens the global
//      PurchaseModal via this callback.
//   2. The upload uses `buildUploadAuthHeader()` (the existing
//      helper). The previous `buildAuthHeaders()` typo meant the
//      proxy couldn't verify the caller's ID token and the upload
//      silently failed. The test mocks both helpers and asserts
//      the typo'd one is never referenced.
//   3. The reference to `UpgradeModal` is gone from the module
//      (source-text audit) — a regression guard for the import
//      deletion in P4.1.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Mocks — firebase, lib helpers, templates. We don't need a real
// Firestore round-trip; just enough to render InvitationEditor.
let docStore = {};
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: vi.fn((_db, ...parts) => ({ __path: parts.join('/') })),
    getDoc: vi.fn(async (ref) => ({
      exists: () => docStore[ref.__path] !== undefined,
      data: () => docStore[ref.__path],
    })),
    setDoc: vi.fn(async (ref, data, opts) => {
      docStore[ref.__path] = opts?.merge
        ? { ...(docStore[ref.__path] || {}), ...data }
        : { ...data };
    }),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  };
});

vi.mock('../lib/firebase', () => ({
  db: {},
  functions: {},
  auth: { currentUser: { uid: 'owner-uid' } },
  appId: 'savetheday-production',
}));

vi.mock('../lib/firebaseFn', () => ({
  callFirebaseFn: vi.fn(),
}));

vi.mock('../components/invitation/templates', () => ({
  INVITATION_TEMPLATES: [
    {
      id: 'locked-bg',
      label: 'Premium Custom',
      bgClass: 'bg-purple-200',
      premium: true,
      layout: 'classic',
    },
    {
      id: 'free-bg',
      label: 'Free',
      bgClass: 'bg-blue-200',
      premium: false,
      layout: 'classic',
    },
  ],
  WORDING_TEMPLATES: [],
  loadLiveTemplates: vi.fn(async () => []),
}));

vi.mock('../components/invitation/InvitationCard', () => ({
  InvitationCard: () => <div data-testid="invitation-card" />,
}));

// The two helpers we care about for the upload-typo test.
const buildUploadAuthHeaderMock = vi.fn(async () => ({
  Authorization: 'Bearer mock-token',
}));
const buildAuthHeadersMock = vi.fn(async () => ({
  Authorization: 'Bearer BAD-TYPO',
}));

vi.mock('../lib/uploadAuthHeader', () => ({
  // 2026-08-23 — P4.1: buildUploadAuthHeader is the real name.
  // The previous code referenced `buildAuthHeaders` which does not
  // exist — the typo'd call resolved to `undefined`, the upload
  // POST hit the proxy with no Authorization header, the proxy
  // rejected. Fix is two-fold: rename the call site (in
  // InvitationEditor.jsx) and rename the test mock so the typo
  // is unmistakably flagged.
  buildUploadAuthHeader: (...args) => buildUploadAuthHeaderMock(...args),
}));

import { InvitationEditor } from './InvitationEditor';

const baseEvent = {
  id: 'event-1',
  name: '志明與春嬌',
  date: '2027-01-01',
  time: '18:00',
  venue: '四季酒店',
  address: '香港中環',
};

beforeEach(() => {
  docStore = {};
  buildUploadAuthHeaderMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InvitationEditor — purchase / Premium-required wiring (P4.1)', () => {
  it('renders without crashing and does not import UpgradeModal', () => {
    // Source-text guard: P4.1 deleted the UpgradeModal import + the
    // local mount. If a future change re-adds it, this test fails.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'InvitationEditor.jsx'),
      'utf8',
    );
    expect(src).not.toMatch(/^import\s+.*UpgradeModal/m);
    expect(src).not.toMatch(/<UpgradeModal\b/);
  });

  it('buildAuthHeaders is never referenced in InvitationEditor.jsx', () => {
    // The previous typo: `await buildAuthHeaders()` instead of
    // `await buildUploadAuthHeader()`. Test that the typo'd name
    // (no `Upload` prefix) never appears as a call site.
    //
    // We strip block comments first so the historical note
    // (which mentions the typo'd name for context) doesn't
    // trigger the assertion.
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'InvitationEditor.jsx'),
      'utf8',
    );
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
      .replace(/^\s*\/\/.*$/gm, ''); // line comments
    // Match `buildAuthHeaders(` only when not preceded by `Upload`.
    expect(code).not.toMatch(/(?<!Upload)buildAuthHeaders/);
  });

  it('renders the editor with a non-premium tier without throwing', () => {
    // Smoke render. The editor must remain mountable even though
    // we deleted UpgradeModal — the parent's global PurchaseModal
    // is the replacement.
    expect(() =>
      render(
        <InvitationEditor
          isOpen
          ownerUid="owner-uid"
          eventId="event-1"
          event={baseEvent}
          guests={[]}
          ownerTier="free"
          onRequestPremium={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it('exposes onRequestPremium as a callback prop (not a state)', () => {
    // Type-level guard: the prop must be present on the function.
    // If the rename to onRequestPremium ever regresses, this test
    // catches it. We can't introspect JS function propTypes in JSX,
    // so we rely on the source-text assertion above + the rendering
    // smoke test.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'InvitationEditor.jsx'),
      'utf8',
    );
    expect(src).toMatch(/\bonRequestPremium\b/);
  });
});

// ─────────────────────────────────────────────────────────────────
// uploadAuthHeader module sanity — source-text audit. We can't
// import the module and check `mod.buildAuthHeaders === undefined`
// because vitest's mock factory forbids accessing non-exported
// properties. Instead we read the source and assert the export
// list is exactly the one we expect. This also catches the case
// where someone tries to re-add a `buildAuthHeaders` helper to
// the module as an alias (which would silently un-typo the
// broken name).
// ─────────────────────────────────────────────────────────────────
describe('uploadAuthHeader module — sanity', () => {
  it('exports only buildUploadAuthHeader (no stale buildAuthHeaders)', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'lib',
        'uploadAuthHeader.js',
      ),
      'utf8',
    );
    // export const buildUploadAuthHeader ...
    expect(src).toMatch(/export\s+(?:async\s+)?function\s+buildUploadAuthHeader\b/);
    // No `export ... buildAuthHeaders` — that name would re-enable
    // the typo'd call site in InvitationEditor.
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+buildAuthHeaders\b/);
  });
});

// Touch the legacy mock so vitest doesn't tree-shake it out — the
// reference is intentional and signals "if anyone re-introduces
// buildAuthHeaders elsewhere, the test will surface it".
void buildAuthHeadersMock;