// 2026-09-11 — Hermes P12.3 projection listener tests.
//
// Mounts a tiny harness that:
//   1. Triggers <VendorRundownProjection/> via React state
//   2. Verifies onSnapshot is NOT subscribed until ownerUid +
//      eventId + vendorUid are all known (the component
//      short-circuits the effect otherwise).
//   3. Verifies a successful snapshot fires onSnapshot(rows, meta)
//      with sanitized plain objects (NOT raw DocumentSnapshot).
//   4. Verifies an error from the underlying onSnapshot fires
//      onError(err, meta) and does NOT crash the parent.
//
// We mock the firebase/firestore collection + onSnapshot so no
// real Firestore socket is opened. This avoids the
// "firebase-tools" / network overhead that real-firestore tests
// would require.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React, { useState } from 'react';

// In-memory recorder for onSnapshot invocations. Each entry
// holds the (collection ref descriptor, successCb, errorCb)
// triplet, so individual tests can fire either callback to
// simulate Firestore behaviour.
const subscribers = [];
const fakeOnSnapshot = vi.fn((ref, successCb, errorCb) => {
  subscribers.push({ ref, successCb, errorCb });
  return () => {
    const idx = subscribers.indexOf(ref);
    // ref is opaque — match by reference
    const realIdx = subscribers.findIndex((s) => s.ref === ref);
    if (realIdx >= 0) subscribers.splice(realIdx, 1);
  };
});
const fakeCollection = vi.fn((...args) => ({
  __segments: args,
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => fakeCollection(...args),
  onSnapshot: (ref, successCb, errorCb) =>
    fakeOnSnapshot(ref, successCb, errorCb),
}));

// firebase module side-effect: provide a fake db + appId so the
// component's path-building import doesn't blow up.
vi.mock('../lib/firebase', () => ({
  db: { __mock: true },
  appId: 'savetheday-production',
}));

import { VendorRundownProjection } from './VendorRundownProjection';

function Harness({ ownerUid, eventId, vendorUid, onSnapshot, onError }) {
  return (
    <VendorRundownProjection
      ownerUid={ownerUid}
      eventId={eventId}
      vendorUid={vendorUid}
      onSnapshot={onSnapshot}
      onError={onError}
    />
  );
}

describe('VendorRundownProjection — listener lifecycle', () => {
  beforeEach(() => {
    subscribers.length = 0;
    fakeOnSnapshot.mockClear();
    fakeCollection.mockClear();
  });
  afterEach(() => cleanup());

  it('does NOT subscribe until {ownerUid, eventId, vendorUid} are all known', () => {
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    // Mount with empty props — effect short-circuits.
    const { rerender } = render(
      <Harness
        ownerUid={null}
        eventId={null}
        vendorUid={null}
        onSnapshot={onSnapshot}
        onError={onError}
      />,
    );
    expect(fakeOnSnapshot).not.toHaveBeenCalled();
    expect(fakeCollection).not.toHaveBeenCalled();

    // Now provide the missing fields.
    rerender(
      <Harness
        ownerUid="couple-1"
        eventId="event-1"
        vendorUid="vendor-1"
        onSnapshot={onSnapshot}
        onError={onError}
      />,
    );
    expect(fakeOnSnapshot).toHaveBeenCalledTimes(1);
    // collection() was called with the canonical vendor-scoped
    // path so firestore.rules can gate by parent path.
    expect(fakeCollection).toHaveBeenCalledWith(
      { __mock: true },
      'artifacts',
      'savetheday-production',
      'users',
      'couple-1',
      'events',
      'event-1',
      'vendorViews',
      'vendor-1',
      'rundown',
    );
  });

  it('emits sanitized plain objects on successful snapshot', () => {
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    render(
      <Harness
        ownerUid="couple-1"
        eventId="event-1"
        vendorUid="vendor-1"
        onSnapshot={onSnapshot}
        onError={onError}
      />,
    );
    expect(subscribers).toHaveLength(1);
    const { successCb } = subscribers[0];
    const fakeDocs = [
      {
        id: 'rd-1',
        data: () => ({
          title: '攝影師到場',
          startTime: '10:00',
          isAssignedToViewer: true,
          approvedDelayMinutes: 5,
        }),
      },
      {
        id: 'rd-2',
        data: () => ({
          title: '敬茶',
          isAssignedToViewer: false,
          // no startTime — should be coerced to null
          approvedDelayMinutes: 0,
        }),
      },
    ];
    act(() => {
      successCb({ docs: fakeDocs });
    });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    const [rows, meta] = onSnapshot.mock.calls[0];
    expect(meta).toEqual({ ownerUid: 'couple-1', eventId: 'event-1' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'rd-1',
      title: '攝影師到場',
      startTime: '10:00',
      isAssignedToViewer: true,
      approvedDelayMinutes: 5,
      // No raw firestore reference types leak into the
      // sanitized shape.
    });
    expect(rows[0]).not.toHaveProperty('data');
    expect(rows[1]).toMatchObject({
      id: 'rd-2',
      startTime: null,
      approvedDelayMinutes: 0,
      isAssignedToViewer: false,
    });
  });

  it('forwards onError without crashing the parent', () => {
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    // We deliberately DO NOT throw on the listener callback
    // because React state updates outside act() would warn —
    // but we DO confirm onError fires.
    let parentStillRendered = true;
    function Parent() {
      return (
        <Harness
          ownerUid="couple-1"
          eventId="event-1"
          vendorUid="vendor-1"
          onSnapshot={onSnapshot}
          onError={(err, meta) => {
            parentStillRendered = true;
            onError(err, meta);
          }}
        />
      );
    }
    render(<Parent />);
    expect(subscribers).toHaveLength(1);
    const { errorCb } = subscribers[0];
    act(() => {
      errorCb({ code: 'permission-denied', message: 'Missing or insufficient permissions' });
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const [err, meta] = onError.mock.calls[0];
    expect(err.code).toBe('permission-denied');
    expect(meta).toEqual({ ownerUid: 'couple-1', eventId: 'event-1' });
    expect(parentStillRendered).toBe(true);
    // And onSnapshot was never called (error path bypasses it).
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('cancels the listener on unmount', () => {
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const unsub = vi.fn();
    fakeOnSnapshot.mockImplementationOnce((ref, successCb, errorCb) => {
      // Push the same shape as the production mock so the
      // component's cleanup runs.
      subscribers.push({ ref, successCb, errorCb });
      return unsub;
    });
    const { unmount } = render(
      <Harness
        ownerUid="couple-1"
        eventId="event-1"
        vendorUid="vendor-1"
        onSnapshot={onSnapshot}
        onError={onError}
      />,
    );
    expect(unsub).not.toHaveBeenCalled();
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
