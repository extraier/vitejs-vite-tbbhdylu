// 2026-08-15 — Vendor Onboarding & Assignment Audit (Fix 4).
// Smoke tests for the vendorRelink.ts client wrapper. Validates
// the contract surface (request shape, response shape) without
// hitting the actual cloud function — the wire format is what
// matters for the UI; the cloud function is unit-tested by
// integration tests.
//
// We stub httpsCallable to capture the function name + args, and
// return a canned response. This guards against:
//   1. Wrapper passing the wrong args (e.g. forgetting dryRun on
//      preview or dropping vendorUid on confirm)
//   2. Wrapper reading the wrong field on the response (e.g.
//      `data.hits` vs `data.vendors`)
//   3. Wrapper swallowing errors silently

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 2026-08-15 — vi.hoisted: vi.mock is hoisted to the top of the
// file BEFORE any other top-level code, so the mock factory can't
// capture variables defined later. vi.hoisted evaluates its
// callback at hoist-time, making the mock targets available to
// the factory without timing issues.
const { callables, httpsCallableMock } = vi.hoisted(() => {
  const callables = new Map();
  const httpsCallableMock = vi.fn((_fns, name) => {
    if (!callables.has(name)) {
      throw new Error(`Unexpected callable in test: ${name}`);
    }
    return callables.get(name);
  });
  return { callables, httpsCallableMock };
});

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: httpsCallableMock,
}));

import {
  searchVendorsByName,
  previewLinkVendorContact,
  linkVendorContact,
  vendorRelinkApi,
} from './vendorRelink';

beforeEach(() => {
  callables.clear();
  httpsCallableMock.mockClear();
});

describe('searchVendorsByName', () => {
  it('passes the right function name + request shape', async () => {
    const fn = vi.fn(async (args) => {
      void args; // captured by toHaveBeenCalledWith below
      return {
        data: { ok: true, hits: [{ uid: 'v1', name: 'A', category: 'venue', serviceAreaCity: 'HK' }] },
      };
    });
    callables.set('searchVendorsByName', fn);

    const result = await searchVendorsByName({ name: 'A', category: 'venue', limit: 20 });

    expect(fn).toHaveBeenCalledWith({ name: 'A', category: 'venue', limit: 20 });
    expect(result).toEqual([
      { uid: 'v1', name: 'A', category: 'venue', serviceAreaCity: 'HK' },
    ]);
  });

  it('handles missing hits (empty array, not throw)', async () => {
    const fn = vi.fn(async (requestArgs) => {
      // Verify the wrapper passed the search name through.
      expect(requestArgs.name).toBe('zzz-no-match');
      return { data: { ok: true, hits: undefined } };
    });
    callables.set('searchVendorsByName', fn);

    const result = await searchVendorsByName({ name: 'zzz-no-match' });
    expect(result).toEqual([]);
  });

  it('propagates server errors (does not swallow)', async () => {
    const fn = vi.fn(async (args) => {
      void args;
      throw new Error('permission-denied');
    });
    callables.set('searchVendorsByName', fn);

    await expect(searchVendorsByName({ name: 'x' })).rejects.toThrow('permission-denied');
  });
});

describe('previewLinkVendorContact', () => {
  it('forces dryRun: true (never writes from preview path)', async () => {
    const fn = vi.fn(async (args) => ({
      data: {
        ok: true,
        dryRun: true,
        wouldLink: {
          contactId: 'c1',
          vendorUid: 'v1',
          vendorName: 'A',
          vendorCategory: 'venue',
          currentLinkedVendorUid: null,
        },
      },
    }));
    callables.set('linkVendorContact', fn);

    const result = await previewLinkVendorContact({ contactId: 'c1', vendorUid: 'v1' });

    expect(fn).toHaveBeenCalledWith({ contactId: 'c1', vendorUid: 'v1', dryRun: true });
    expect(result.contactId).toBe('c1');
    expect(result.vendorName).toBe('A');
    expect(result.currentLinkedVendorUid).toBeNull();
  });
});

describe('linkVendorContact', () => {
  it('does NOT pass dryRun (real write path)', async () => {
    const fn = vi.fn(async (args) => ({
      data: {
        ok: true,
        linked: {
          contactId: 'c1',
          vendorUid: 'v1',
          vendorName: 'A',
          vendorCategory: 'venue',
        },
      },
    }));
    callables.set('linkVendorContact', fn);

    const result = await linkVendorContact({ contactId: 'c1', vendorUid: 'v1' });

    const callArgs = fn.mock.calls[0][0];
    expect(callArgs).toEqual({ contactId: 'c1', vendorUid: 'v1' });
    // Explicitly assert NO dryRun flag in the real write path.
    expect(callArgs.dryRun).toBeUndefined();

    expect(result.vendorUid).toBe('v1');
    expect(result.vendorName).toBe('A');
  });
});

describe('vendorRelinkApi', () => {
  it('exposes all three functions', () => {
    expect(typeof vendorRelinkApi.searchVendorsByName).toBe('function');
    expect(typeof vendorRelinkApi.previewLinkVendorContact).toBe('function');
    expect(typeof vendorRelinkApi.linkVendorContact).toBe('function');
  });
});