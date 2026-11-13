import { describe, expect, it } from 'vitest';
import { enforcedStorageUsageBytes } from '../src/storageUsage';

describe('enforcedStorageUsageBytes', () => {
  it('sums the server-only used and reserved counters', () => {
    expect(enforcedStorageUsageBytes({ usedBytes: 100, reservedBytes: 40 })).toBe(140);
    expect(enforcedStorageUsageBytes(null)).toBe(0);
    expect(enforcedStorageUsageBytes({ usedBytes: -5, reservedBytes: Number.NaN })).toBe(0);
  });

  it('ignores an owner-writable storageUsageBytes field if it is present', () => {
    expect(enforcedStorageUsageBytes({
      usedBytes: 10,
      reservedBytes: 0,
      storageUsageBytes: 0,
    } as { usedBytes: number; reservedBytes: number })).toBe(10);
  });
});
