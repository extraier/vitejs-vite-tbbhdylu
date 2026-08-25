// P8 (2026-08-25) — Reception QR resolution regression tests.
//
// These tests exercise the pure resolveScan() helper extracted
// from ReceptionScanner.jsx. They prove all five scenarios from
// the handoff §Completion Checklist:
//
//  - Canonical QR owner/event match active scanner context and
//    guest exists → onCheckIn receives the matching guest row
//  - QR owner differs from activeOwnerUid → no check-in,
//    other-wedding warning
//  - QR event differs from activeEventId → no check-in,
//    other-event warning
//  - Guest list temporarily empty → no check-in, loading message
//  - QR guest ID unknown within the correct owner/event → no
//    check-in, "無此賓客"
//
// We do not mount ReceptionScanner itself because that pulls in
// the qr-scanner library which requires camera permissions in
// jsdom. resolveScan is the pure decision tree the component
// wraps; if it returns the right object, the component produces
// the right onCheckIn call and feedback message.

import { describe, expect, it } from 'vitest';
import { resolveScan } from './ReceptionScanner.jsx';

const ACTIVE_OWNER = 'owner-active';
const ACTIVE_EVENT = 'event-active';
const ACTIVE_GUEST = 'guest-active';

const guests = [
  { id: ACTIVE_GUEST, guestId: ACTIVE_GUEST, name: '王小明', table: 'T1', hasAttended: false },
  { id: 'guest-done', guestId: 'guest-done', name: '陳大文', table: 'T2', hasAttended: true },
];

describe('resolveScan', () => {
  it('canonical invitation matches active owner/event and check-ins the guest', () => {
    const result = resolveScan({
      raw: `https://savetheday.io/?o=${ACTIVE_OWNER}&e=${ACTIVE_EVENT}&g=${ACTIVE_GUEST}`,
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('checkin');
    expect(result.guest).toBe(guests[0]);
  });

  it('rejects QR from a different wedding', () => {
    const result = resolveScan({
      raw: 'https://savetheday.io/?o=other-owner&e=event-active&g=guest-active',
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('其他婚禮的 QR Code');
  });

  it('rejects QR from a different event in the same wedding', () => {
    const result = resolveScan({
      raw: 'https://savetheday.io/?o=owner-active&e=other-event&g=guest-active',
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('其他活動的 QR Code');
  });

  it('does not flag a missing owner/event on the QR when the desk context is also missing', () => {
    // A legacy QR that omits owner/event — the desk has no context,
    // so the binding guard should not block. Lookup proceeds.
    const result = resolveScan({
      raw: `${ACTIVE_EVENT}/${ACTIVE_GUEST}`,
      activeOwnerUid: null,
      activeEventId: null,
      eventGuests: guests,
    });
    expect(result.kind).toBe('checkin');
    expect(result.guest).toBe(guests[0]);
  });

  it('shows the loading message when the guest list is empty', () => {
    const result = resolveScan({
      raw: `https://savetheday.io/?o=${ACTIVE_OWNER}&e=${ACTIVE_EVENT}&g=${ACTIVE_GUEST}`,
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: [],
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('賓客名單載入中');
  });

  it('shows "無此賓客" when the QR guestId is unknown in the active owner/event', () => {
    const result = resolveScan({
      raw: `https://savetheday.io/?o=${ACTIVE_OWNER}&e=${ACTIVE_EVENT}&g=guest-unknown`,
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('無此賓客');
    expect(result.detail).toBe('guest-unknown');
  });

  it('shows "已報到過" when the guest has already attended', () => {
    const result = resolveScan({
      raw: `https://savetheday.io/?o=${ACTIVE_OWNER}&e=${ACTIVE_EVENT}&g=guest-done`,
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('陳大文');
    expect(result.detail).toBe('已報到過 · 桌號 T2');
  });

  it('rejects an empty payload with the generic "無效 QR Code" warning', () => {
    const result = resolveScan({
      raw: '',
      activeOwnerUid: ACTIVE_OWNER,
      activeEventId: ACTIVE_EVENT,
      eventGuests: guests,
    });
    expect(result.kind).toBe('warn');
    expect(result.name).toBe('無效 QR Code');
  });
});