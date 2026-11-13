/** Guest-link lifetime. Missing input defaults to 72h. Values above 30 days clamp. */
export const DEFAULT_GUEST_LINK_TTL_HOURS = 72;
export const MAX_GUEST_LINK_TTL_HOURS = 30 * 24;

export function resolveGuestLinkTtlHours(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_GUEST_LINK_TTL_HOURS;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('ttlHours must be a finite number greater than 0.');
  }
  if (n > MAX_GUEST_LINK_TTL_HOURS) return MAX_GUEST_LINK_TTL_HOURS;
  return n;
}
