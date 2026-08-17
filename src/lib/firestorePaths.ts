// src/lib/firestorePaths.ts
//
// 2026-08-13 — LOW audit refactor. Extracted from repeated
// `d.ref.path.split('/')` patterns scattered across App.jsx,
// AdminQueue.tsx, ItemComments.jsx, ReceptionScanner.jsx.
//
// All helpers operate on string paths (not DocumentReference
// objects) so they are unit-testable without firebase mock and
// work equally for refs coming from Firestore snapshots, Cloud
// Function responses (where only the .path string is sent), or
// raw reconstructed paths.
//
// Path conventions used throughout the codebase:
//
//   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}
//   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}/comments/{commentId}
//   artifacts/{appId}/users/{ownerUid}/{any}...   ← generic owner namespace
//
// Modular SDK v10 .ref.parent chain is unreliable because the chain
// alternates between DocumentReference (whose `.id` returns the doc
// id) and CollectionReference (whose `.id` returns the literal
// collection-name segment like 'events' or 'users'). Always parse
// the path string instead. See class-30-or-chain-throws-on-write-or-list-validation.

export interface EventScopedPath {
  ownerUid: string;
  eventId: string;
}

/**
 * Parse a Firestore path like `artifacts/{appId}/users/{ownerUid}/events/{eventId}/...`
 * into {ownerUid, eventId}. Returns null if the path doesn't match
 * the event-scoped convention.
 *
 * Robust against trailing segments, trailing slash, and missing appId —
 * finds the segment labeled 'users' or 'events' and takes the next one.
 */
export function parseEventScopedRef(path: string): EventScopedPath | null {
  if (!path || typeof path !== 'string') return null;
  const segs = path.split('/').filter(Boolean);
  const eventsIdx = segs.indexOf('events');
  if (eventsIdx < 0) return null;
  const ownerUid = segs[eventsIdx - 1] || null;
  const eventId = segs[eventsIdx + 1] || null;
  if (!ownerUid || !eventId) return null;
  return { ownerUid, eventId };
}

/**
 * Parse a comment collection or document path like
 *   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}/comments
 * or a comment document below that collection into
 * {ownerUid, eventId, kind, itemId, commentId}.
 *
 * `kind` is one of 'rundown' or 'resources' (per the comment-rule paths in
 * firestore.rules). Returns null if the path doesn't match.
 */
export interface CommentPath {
  ownerUid: string;
  eventId: string;
  kind: string;
  itemId: string;
  commentId: string | null;
}

export function parseCommentPath(path: string): CommentPath | null {
  if (!path || typeof path !== 'string') return null;
  const segs = path.split('/').filter(Boolean);
  const commentsIdx = segs.indexOf('comments');
  if (commentsIdx < 0) return null;
  // A CollectionReference ends at `/comments`; a comment document appends an
  // ID. Cloud Function writes need the parent components and accept either.
  const commentId = segs[commentsIdx + 1] || null;
  const itemId = segs[commentsIdx - 1] || null;
  const kind = segs[commentsIdx - 2] || null;
  const eventScoped = parseEventScopedRef(path);
  if (!eventScoped || !kind || !itemId) return null;
  return { ...eventScoped, kind, itemId, commentId };
}

/**
 * Build the canonical comments-subcollection path for a given event-scoped item.
 * Output: `artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}/comments`
 *
 * Use this when constructing a CollectionReference for the comments subcollection,
 * OR when building the path string to pass to a Cloud Function.
 */
export function commentsCollectionPath(
  appId: string,
  ctx: EventScopedPath & { kind: string; itemId: string },
): string {
  return `artifacts/${appId}/users/${ctx.ownerUid}/events/${ctx.eventId}/${ctx.kind}/${ctx.itemId}/comments`;
}

/**
 * Build the path for a specific comment doc:
 *   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}/comments/{commentId}
 */
export function commentDocPath(
  appId: string,
  ctx: EventScopedPath & { kind: string; itemId: string; commentId: string },
): string {
  return `${commentsCollectionPath(appId, ctx)}/${ctx.commentId}`;
}

/**
 * Build the canonical event-scoped item path:
 *   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{kind}/{itemId}
 */
export function eventItemPath(
  appId: string,
  ctx: EventScopedPath & { kind: string; itemId: string },
): string {
  return `artifacts/${appId}/users/${ctx.ownerUid}/events/${ctx.eventId}/${ctx.kind}/${ctx.itemId}`;
}

/**
 * Parse a collectionGroup-style owner-scoped path (e.g. from
 * `collectionGroup('socialProofs').get()` where the doc sits at
 * `/users/{uid}/socialProofs/{proofId}` or similar two-level-deep nested).
 *
 * Returns the owner's uid (the segment immediately after 'users') if found.
 */
export function parseOwnerUid(path: string): string | null {
  if (!path || typeof path !== 'string') return null;
  const segs = path.split('/').filter(Boolean);
  const usersIdx = segs.indexOf('users');
  if (usersIdx < 0) return null;
  return segs[usersIdx + 1] || null;
}

/**
 * Parse a QR-token-shaped string used in ReceptionScanner.
 *
 * Accepts:
 *   - "{eventId}/{guestId}" raw
 *   - "https://savetheday.io/?q={eventId}/{guestId}"
 *   - "?q={eventId}/{guestId}"
 *
 * Returns { eventId, guestId } or { eventId: null, guestId } if only guestId
 * is provided, or null if the string can't be parsed.
 */
export function parseGuestQrToken(raw: string): { eventId: string | null; guestId: string | null } | null {
  if (!raw || typeof raw !== 'string') return null;
  let body = raw;
  // Strip URL prefix — anything before and including '?q='
  const qMatch = body.match(/[?&]q=([^&]+)/);
  if (qMatch) {
    body = decodeURIComponent(qMatch[1]);
  }
  const parts = body.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return { eventId: null, guestId: parts[0] };
  }
  return { eventId: parts[0], guestId: parts[1] };
}

/**
 * Throws if the context object is missing required event-scoped fields.
 * Used before Cloud Function calls to give a fast, clear error instead of
 * the cryptic "permission-denied" from Firestore rules.
 */
export function assertAssignedTaskContext(
  ctx: Partial<EventScopedPath & { kind: string; itemId: string }>,
): asserts ctx is EventScopedPath & { kind: string; itemId: string } {
  const missing: string[] = [];
  if (!ctx.ownerUid) missing.push('ownerUid');
  if (!ctx.eventId) missing.push('eventId');
  if (!ctx.kind) missing.push('kind');
  if (!ctx.itemId) missing.push('itemId');
  if (missing.length > 0) {
    throw new Error(
      `assertAssignedTaskContext: missing required field(s): ${missing.join(', ')}`,
    );
  }
}
