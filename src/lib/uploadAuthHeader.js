// Shared helper for any browser caller that needs to attach a
// Firebase ID token as Authorization: Bearer to a same-origin
// upload/auth call.
//
// 2026-08-13 — H-01 (HIGH) audit fix. The /api/photo-upload proxy
// now verifyIdToken's this header before minting a NAS HMAC token.
// Pre-fix, the endpoint accepted any multipart with eventId+guestId
// and minted a token — that let attackers with any event/guest
// pair mint upload grants for someone else's wedding photos.
//
// We resolve the header lazily: if the user isn't signed in (e.g.
// stale session), we return `{}` and the server returns 401, which
// the caller treats as "re-auth required" rather than a silent
// success. No silent fallback to anonymous uploads.
//
// Returns a Promise<Record<string, string>> so callers can `await`
// in a fetch options builder.

export async function buildUploadAuthHeader() {
  try {
    // Lazy import — keeps this module side-effect-free for unit
    // tests that don't bootstrap firebase/auth.
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) return {};
    const idToken = await u.getIdToken(/* forceRefresh */ false);
    return { Authorization: `Bearer ${idToken}` };
  } catch (err) {
    // firebase/auth failed to load (test env, etc.) — fall through
    // with no header. Server returns 401.
    return {};
  }
}
