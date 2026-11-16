import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
const updateDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: (...args) => ({ path: args }),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(),
  setDoc: (...args) => setDoc(...args),
  updateDoc: (...args) => updateDoc(...args),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  increment: (n) => ({ __increment: n }),
  getDocs: vi.fn(),
  deleteField: () => ({ __delete: true }),
}));

vi.mock('./firebase', () => ({
  db: {},
  appId: 'test-app',
}));

const { openInquiry } = await import('./chat');

describe('openInquiry', () => {
  beforeEach(() => {
    setDoc.mockReset();
    updateDoc.mockReset();
  });

  it('creates a thread with party uids and createdAt', async () => {
    setDoc.mockResolvedValue(undefined);
    const id = await openInquiry({
      vendorUid: 'vendor-1',
      coupleUid: 'couple-1',
      vendorName: 'Vendor',
      coupleName: 'Couple',
      eventId: 'event-1',
    });
    expect(id).toBe('couple-1__vendor-1');
    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDoc.mock.calls[0][1];
    expect(payload.vendorUid).toBe('vendor-1');
    expect(payload.coupleUid).toBe('couple-1');
    expect(payload.createdAt).toEqual({ __serverTimestamp: true });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('refreshes an existing thread without rewriting party uids or createdAt', async () => {
    setDoc.mockRejectedValue({ code: 'permission-denied' });
    updateDoc.mockResolvedValue(undefined);
    await openInquiry({
      vendorUid: 'vendor-1',
      coupleUid: 'couple-1',
      vendorName: 'Vendor',
      coupleName: 'Couple',
      eventId: 'event-1',
    });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = updateDoc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('vendorUid');
    expect(payload).not.toHaveProperty('coupleUid');
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload.vendorName).toBe('Vendor');
    expect(payload.lastMessagePreview).toBe('');
  });
});
