// 2026-08-25 — Manus P10. QrCodeModal component-level tests.
//
// We mock firebase/firestore and the project's firebase module
// just enough to mount the modal and assert on the rendered
// controls. The URL construction is covered exhaustively in
// invitationQr.test.js (pure helper); here we prove the modal
// surfaces the right canonical-owner display, disables the
// copy/email/regen controls when context is incomplete, and
// shows the rose-colored alert.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// 2026-08-25 — P10 component tests run in jsdom with
// @testing-library/react. Mocks must be registered before the
// component module is imported.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...parts) => ({ __doc: parts })),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
  updateDoc: vi.fn(async () => undefined),
}));

vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'co-owner-uid' } },
  db: { __db: true },
}));

vi.mock('../../lib/firebaseFn', () => ({
  callFirebaseFn: vi.fn(async () => ({ data: { sent: [] } })),
}));

import { QrCodeModal } from './QrCodeModal';

const CANONICAL_OWNER = 'owner-canonical-uid';
const EVENT = 'event-123';
const GUEST = {
  id: 'guest-1',
  guestId: 'guest-1',
  name: '王小明',
  email: '[email protected]',
};

beforeEach(() => {
  // jsdom does not provide window.location.hostname with the
  // current origin out of the box; this mirrors the production
  // behaviour where the host is the canonical domain.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      host: 'savetheday.io',
      hostname: 'savetheday.io',
      href: 'https://savetheday.io/',
    },
  });
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();
});

describe('QrCodeModal — canonical context wiring (P10)', () => {
  it('shows the canonical owner label and Owner/Event IDs in the verification panel', () => {
    render(
      <QrCodeModal
        guest={GUEST}
        ownerUid={CANONICAL_OWNER}
        eventId={EVENT}
        eventName="Wedding of A & B"
        ownerLabel="A & B"
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    const panel = screen.getByText(/接待處驗證資料/i).closest('div');
    expect(panel).not.toBeNull();
    const panelQueries = within(panel);
    expect(panelQueries.getByText(/婚禮：Wedding of A & B/i)).toBeTruthy();
    expect(panelQueries.getByText(/資料擁有人：A & B/i)).toBeTruthy();
    expect(panelQueries.getByText(new RegExp(`Owner ID: ${CANONICAL_OWNER}`))).toBeTruthy();
    expect(panelQueries.getByText(new RegExp(`Event ID: ${EVENT}`))).toBeTruthy();
  });

  it('renders the QR image when canonical context is complete', () => {
    render(
      <QrCodeModal
        guest={GUEST}
        ownerUid={CANONICAL_OWNER}
        eventId={EVENT}
        eventName="Wedding of A & B"
        ownerLabel="A & B"
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );
    const img = screen.getByAltText(/王小明.*QR Code/);
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('api.qrserver.com/v1/create-qr-code/');
    expect(img.getAttribute('src')).toContain(encodeURIComponent(CANONICAL_OWNER));
    expect(img.getAttribute('src')).toContain(encodeURIComponent(EVENT));
    expect(img.getAttribute('src')).toContain(encodeURIComponent(GUEST.guestId));
  });

  it('disables copy / email / regenerate and shows the rose alert when ownerUid is missing', () => {
    render(
      <QrCodeModal
        guest={GUEST}
        ownerUid={null}
        eventId={EVENT}
        eventName="Wedding of A & B"
        ownerLabel="A & B"
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByAltText(/王小明.*QR Code/)).toBeNull();

    const copyButton = screen.getByRole('button', {
      name: /複製專屬連結 \(WhatsApp 發送\)/,
    });
    expect(copyButton.disabled).toBe(true);

    const emailButton = screen.getByRole('button', {
      name: /寄出電子喜帖/,
    });
    expect(emailButton.disabled).toBe(true);

    const regenButton = screen.getByRole('button', {
      name: /重新產生並重新分享 QR Code/,
    });
    expect(regenButton.disabled).toBe(true);
  });

  it('disables copy / email / regenerate and shows the rose alert when eventId is missing', () => {
    render(
      <QrCodeModal
        guest={GUEST}
        ownerUid={CANONICAL_OWNER}
        eventId={null}
        eventName="Wedding of A & B"
        ownerLabel="A & B"
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByAltText(/王小明.*QR Code/)).toBeNull();

    expect(
      screen.getByRole('button', { name: /複製專屬連結/ }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: /寄出電子喜帖/ }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: /重新產生並重新分享 QR Code/ }).disabled,
    ).toBe(true);
  });

  it('does NOT use window.__ownerUid (the modal now ignores the legacy global)', () => {
    // A co-owner who accidentally still had a stale window global
    // pointing at their own UID must NOT influence the QR. The
    // explicit ownerUid prop is the single source of truth.
    window.__ownerUid = 'co-owner-stale-uid';
    window.__currentEventId = 'some-other-event';

    render(
      <QrCodeModal
        guest={GUEST}
        ownerUid={CANONICAL_OWNER}
        eventId={EVENT}
        eventName="Wedding of A & B"
        ownerLabel="A & B"
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    const img = screen.getByAltText(/王小明.*QR Code/);
    expect(img.getAttribute('src')).toContain(encodeURIComponent(CANONICAL_OWNER));
    expect(img.getAttribute('src')).not.toContain('co-owner-stale-uid');
    expect(img.getAttribute('src')).toContain(encodeURIComponent(EVENT));
    expect(img.getAttribute('src')).not.toContain('some-other-event');
  });
});