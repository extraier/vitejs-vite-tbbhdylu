// 2026-08-09 — Smoke tests for the new VendorPicker + ItemComments
// components. Mirrors the WeddingDay.owner-picker.test.jsx pattern:
// small, focused, regression guards. NOT exhaustive — full E2E
// coverage for the rule/UI integration belongs in a future
// investment. These tests guard the few specific behaviours that
// have caused regressions in similar pickers before:
//
//   1. VendorPicker renders vendor options sourced from `vendors`
//      prop (not from a global master list).
//   2. Selecting a vendor calls onChange with a {uid, name} object.
//   3. The "Clear" button emits `null` so the parent can store
//      `null` in Firestore cleanly.
//   4. ItemComments renders the "未有留言" empty state when path
//      is set but no comments exist.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { VendorPicker } from './VendorPicker';
import { ItemComments } from './ItemComments';

// Mock the firebase firestore module so ItemComments doesn't try to
// actually open a socket during the test. We capture the onSnapshot
// callback and replay it manually with a fake comments array.
//
// 2026-08-13 — M-03 audit fix. Switched from a total mock to
// `importOriginal` partial mocking. The previous full mock didn't
// export `getFirestore` (which src/lib/firebase.ts imports
// transitively via src/lib/firebaseFn.js), so the test file
// failed to load before any test ran. Partial mocking forwards
// the real exports for everything we don't override, so the
// bootstrap path stays functional.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onSnapshot: (q, onNext) => {
      // Expose the most recent onNext for the test to invoke.
      globalThis.__lastCommentsCb = onNext;
      return () => {}; // unsubscribe stub
    },
    addDoc: vi.fn(async () => ({ id: 'fake-comment-id' })),
    deleteDoc: vi.fn(async () => {}),
    collection: vi.fn((db, ...segments) => ({ __segments: segments })),
  };
});

beforeEach(() => {
  cleanup();
  globalThis.__lastCommentsCb = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const sampleVendors = [
  { uid: 'v-001', name: '靚相攝影' },
  { uid: 'v-002', name: '夢之花藝' },
];

describe('VendorPicker', () => {
  it('renders options for every vendor in the prop list', () => {
    render(<VendorPicker vendors={sampleVendors} value={null} onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /靚相攝影/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /夢之花藝/ })).toBeTruthy();
  });

  it('selects a vendor and emits {uid, name} on change', () => {
    const onChange = vi.fn();
    render(<VendorPicker vendors={sampleVendors} value={null} onChange={onChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'v-001' } });
    expect(onChange).toHaveBeenCalledWith({ uid: 'v-001', name: '靚相攝影' });
  });

  it('emits null when the ✕ remove button is clicked on the vendor pill', () => {
    const onChange = vi.fn();
    render(
      <VendorPicker
        vendors={sampleVendors}
        value={{ uid: 'v-001', name: '靚相攝影' }}
        onChange={onChange}
      />,
    );
    // The ✕ button is the only way to clear the selection.
    // The dropdown's empty value is a no-op (intentional — see
    // VendorPicker.handleSelect: `if (!uid) return;`).
    fireEvent.click(screen.getByRole('button', { name: /移除商戶/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows the custom-name button even when no vendors are available', () => {
    render(<VendorPicker vendors={[]} value={null} onChange={() => {}} />);
    // The fallback button lets couples type a custom name even
    // without any inquiries. Exact wording can change — match
    // loosely so the test survives UI tweaks.
    expect(screen.getByText(/自訂商戶名|商戶名稱/)).toBeTruthy();
  });
});

describe('ItemComments — empty state', () => {
  it('renders the "未有留言" empty-state hint when path is set but no comments exist', () => {
    render(
      <ItemComments
        path={{ __segments: ['fake'] }}
        currentUser={{ uid: 'u-1' }}
        currentRole="owner"
      />,
    );
    // Fire the captured onSnapshot callback with an empty docs array.
    // The hook's useEffect runs AFTER render() returns, so we wrap
    // in act() to flush the subscription callback + the resulting
    // state update.
    act(() => {
      globalThis.__lastCommentsCb({ docs: [] });
    });
    // The component should show the default empty hint.
    expect(screen.getByText('未有留言')).toBeTruthy();
  });
});
