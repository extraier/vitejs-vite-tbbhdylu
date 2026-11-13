/**
 * Bytes that count against the upload quota. The photo-upload proxy
 * stores this on the deny-all privateUsage/storage doc (usedBytes +
 * reservedBytes). The owner-writable event.storageUsageBytes field
 * is not a source of truth.
 */
export function enforcedStorageUsageBytes(
  data: { usedBytes?: unknown; reservedBytes?: unknown } | null | undefined,
): number {
  const used = typeof data?.usedBytes === 'number' && Number.isFinite(data.usedBytes)
    ? Math.max(data.usedBytes, 0)
    : 0;
  const reserved = typeof data?.reservedBytes === 'number' && Number.isFinite(data.reservedBytes)
    ? Math.max(data.reservedBytes, 0)
    : 0;
  return used + reserved;
}
