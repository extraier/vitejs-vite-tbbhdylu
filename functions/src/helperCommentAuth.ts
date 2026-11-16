/**
 * Who may post a vendor/helper comment.
 *
 * The callable used to require a `helper` custom claim. Nothing in
 * the repo ever set that claim, so every helper comment was
 * permission-denied — including helpers who had already accepted.
 * A claim is also a poor fit here: it is global, it is missing from
 * the caller's current ID token until they sign in again, and
 * revokeRefreshTokens (which the other claim writers use) drops the
 * session instead of granting the permission.
 *
 * Authorization is the assignment on the parent item plus an active
 * helper doc for that owner. Vendors still need the vendor claim and
 * a matching assignedVendorUid. Rundown and resources store helpers
 * on `assignedHelpers: [{ uid }]`; tasks store `assignedHelperUid`.
 * Either shape counts.
 */

export type CommentAuthorDecision =
  | { ok: true; role: 'vendor' | 'helper' }
  | { ok: false; reason: 'unassigned' | 'helper-inactive' };

export function assignedHelperUidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const uids: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const uid = (entry as { uid?: unknown }).uid;
    if (typeof uid === 'string' && uid.trim()) uids.push(uid);
  }
  return uids;
}

export function resolveCommentAuthor(opts: {
  callerUid: string;
  vendorClaim: boolean;
  assignedVendorUid: string | null;
  assignedHelperUid: string | null;
  assignedHelpers?: unknown;
  helperStatus: string | null;
}): CommentAuthorDecision {
  if (opts.vendorClaim && opts.assignedVendorUid === opts.callerUid) {
    return { ok: true, role: 'vendor' };
  }
  const assigned =
    opts.assignedHelperUid === opts.callerUid ||
    assignedHelperUidList(opts.assignedHelpers).includes(opts.callerUid);
  if (!assigned) return { ok: false, reason: 'unassigned' };
  if (opts.helperStatus !== 'active') return { ok: false, reason: 'helper-inactive' };
  return { ok: true, role: 'helper' };
}
