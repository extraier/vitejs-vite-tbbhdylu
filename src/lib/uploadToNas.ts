// Upload a photo via the Vercel /api/photo-upload proxy.
//
// Why proxy through Vercel instead of going direct to the NAS?
// The NAS upload endpoint (cdn.savetheday.io/upload) doesn't return CORS
// headers for savetheday.io, so the browser preflight (OPTIONS) is
// blocked and the actual POST never fires. Routing through Vercel
// sidesteps CORS entirely (same-origin from the browser's POV),
// and the proxy streams to the NAS server-to-server where CORS
// doesn't apply.
//
// 2026-07-23 — switched from direct NAS POST to /api/photo-upload.
// The HMAC token is no longer minted client-side: the proxy mints
// it with the server-only HMAC secret after reading the multipart
// body. The browser only ever knows the *destination URL* (/api/
// photo-upload, same-origin) and never touches the HMAC secret.
// The receiver (deploy/photo_upload_server.py) verifies the
// server-minted token with constant-time HMAC compare.
//
// 2026-08-13 — H-01 (HIGH) fix. The proxy used to mint an HMAC
// for ANY caller that knew a valid eventId+guestId pair — no auth,
// no event-membership check, no rate limit. Now:
//   • Signed-in callers (owner / co-owner / vendor with account)
//     attach `Authorization: Bearer <Firebase ID token>` so the
//     proxy can verifyIdToken via firebase-admin and look up the
//     event doc to confirm membership.
//   • Guests in PersonalGuestPortal flow anonymously sign in via
//     the existing share-token redeem path, so their auth.currentUser
//     is set by the time they upload — they also send Authorization.
//   • Legacy call sites that don't pass an Authorization header
//     get rejected with 401. (Catches the audit's "anyone who can
//     reach the endpoint can mint upload grants" finding.)

const NAS_UPLOAD_URL = import.meta.env.VITE_NAS_UPLOAD_URL || '';
// Token TTL is now server-controlled. Client sets the EXPIRES
// value at request time but the server mints the actual signature,
// so this number is informational on the wire (still forwarded
// to the receiver in the X-Upload-Expires header for its TTL
// check). The server rejects requests where the X-Upload-Expires
// value is already in the past.
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — server enforces this

// 2026-07-27 — VITE_NAS_UPLOAD_SECRET removed from the public
// bundle. The secret now lives only in the Vercel /api/photo-upload
// proxy env and is mirrored at /home/openclaw/.config/photo-upload/
// server_secret on the NAS itself. The browser can't extract it
// via DevTools anymore.

type UploadArgs = {
  file: File;
  eventId: string;
  guestId: string;
  // 2026-08-13 — REQUIRED. The event's ownerUid (the couple's
  // Firebase Auth UID) so the server can look up the event doc
  // and verify the caller is ownerUid / coOwners[] / assignedVendorUid
  // / or a guestLinks holder for this event. Owner-side uploads
  // pass user.uid; vendor-bg uploads pass the vendor's ownerUid
  // (same value); guest uploads pass currentEvent._ownerUid.
  ownerUid: string;
  // 2026-08-13 — Optional share token for guest uploads. The guest
  // share-token redeem path (verifyShareToken CF) already creates
  // a guestLinks/{auth.uid} doc keyed by the anonymous auth UID;
  // the proxy cross-checks the Authorization Bearer token's UID
  // against that doc, so re-sending the share token isn't strictly
  // required for guests. Kept as a fallback for any future
  // short-link flows that bypass the redeem.
  shareToken?: string | null;
  uploaderName?: string;
  onProgress?: (pct: number) => void;
  // 2026-08-02 — Owner upload-preferences token. Minted by the
  // getUploadPreferencesToken CF when the owner has the
  // `watermark-removed` unlock. The Vercel proxy verifies the
  // HMAC signature and forwards `X-Watermark-Disabled: true`
  // to the NAS, which skips the Pillow watermark step. When
  // null/absent (owner has no unlock, or guest via PersonalGuestPortal
  // without the owner's token), the proxy falls through to
  // default-on watermark.
  //
  // Optional. Old call sites without it still work — they just
  // get watermarked photos.
  prefsToken?: string | null;
};

type UploadResult = { url: string; thumbnailUrl: string; bytes: number };

/**
 * @throws {Error} with a user-friendly message on any failure
 */
export function uploadPhotoToNas({
  file,
  eventId,
  guestId,
  ownerUid,
  shareToken,
  uploaderName,
  prefsToken,
  onProgress,
}: UploadArgs): Promise<UploadResult> {
  // The proxy (/api/photo-upload) handles auth entirely server-side.
  // If VITE_NAS_UPLOAD_URL is empty (legacy direct-NAS deploy) we
  // still fall back, but the proxy path is the supported one.
  const PROXY_URL = '/api/photo-upload';

  if (!file) return Promise.reject(new Error('未揀選相片'));
  if (!eventId) return Promise.reject(new Error('缺少 eventId'));
  if (!guestId) return Promise.reject(new Error('缺少 guestId'));
  // 2026-08-13 — H-01: ownerUid is now required so the proxy
  // can look up the event doc and verify membership. We fail
  // fast here rather than letting the server return a generic
  // 401 — easier to debug in the client.
  if (!ownerUid) return Promise.reject(new Error('缺少 ownerUid'));

  return new Promise<UploadResult>(async (resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('eventId', eventId);
    form.append('guestId', guestId);
    form.append('ownerUid', ownerUid);
    if (shareToken) form.append('shareToken', shareToken);
    form.append('uploaderName', uploaderName || 'Anonymous');
    // 2026-08-02 — Attach the owner's upload-preferences token
    // (HMAC-signed, short-lived). The Vercel proxy reads it
    // out of the multipart, verifies the signature against the
    // mirrored HMAC_KEY, and forwards `X-Watermark-Disabled: true`
    // to the NAS ONLY when the token verifies AND the embedded
    // `watermarkDisabled === true`. We only append when present
    // — old call sites (no token = no unlock) just don't
    // include the field, which the proxy treats as "no override,
    // default-on watermark applies".
    if (prefsToken) {
      form.append('prefsToken', prefsToken);
    }

    // 2026-08-13 — H-01: Attach the caller's Firebase ID token
    // as Authorization: Bearer. The proxy verifyIdToken's it via
    // firebase-admin, then looks up the event doc to confirm
    // the caller is ownerUid / coOwners[] / assignedVendorUid /
    // or a guestLinks/{auth.uid} holder for this event.
    //
    // We pull the token via the shared uploadAuthHeader helper
    // so the same logic is used everywhere a browser caller hits
    // /api/photo-upload (and any future server-verify endpoints).
    const { buildUploadAuthHeader } = await import('./uploadAuthHeader');
    const authHeaders = await buildUploadAuthHeader();

    // Use XHR instead of fetch so we can report upload progress (fetch can't
    // until the Streams API stabilizes for upload bodies).
    //
    // POST goes to /api/photo-upload (Vercel proxy), not the NAS directly,
    // to bypass the NAS's missing CORS headers. The proxy parses the
    // multipart, verifies the caller, mints the HMAC token server-side,
    // and forwards the body + X-Upload-Token to cdn.savetheday.io/upload.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', PROXY_URL, true);
    // 2026-08-13 — setRequestHeader must come AFTER xhr.open().
    // xhr.setRequestHeader('Authorization', ...) on a multipart
    // body is allowed — the header is independent of the body.
    const authValue = (authHeaders as { Authorization?: string }).Authorization;
    if (authValue) {
      xhr.setRequestHeader('Authorization', authValue);
    }

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && typeof onProgress === 'function') {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const body = JSON.parse(xhr.responseText);
              if (!body.url) {
                reject(new Error('NAS server 回應缺少 url'));
                return;
              }
              resolve({
                url: body.url,
                thumbnailUrl: body.thumbnailUrl || '',
                bytes: body.bytes || 0,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              reject(new Error(`NAS server 回應解析失敗: ${msg}`));
            }
          } else if (xhr.status === 401) {
            // 2026-08-13 — H-01: include the server's error message
            // when present so the user knows whether it's "missing
            // token", "expired", or "not a member of this event".
            let detail = '';
            try {
              const body = JSON.parse(xhr.responseText);
              if (body?.error) detail = `: ${body.error}`;
            } catch { /* ignore */ }
            reject(new Error(`上載授權失敗 (token 已過期或無效)${detail}，請重試`));
          } else if (xhr.status === 403) {
            reject(new Error('上載權限不足：你並非此活動的成員'));
          } else if (xhr.status === 413) {
            reject(new Error('相片太大，請壓縮後再上載'));
          } else if (xhr.status === 415) {
            reject(new Error('相片格式不支援 (只接受 JPEG/PNG/WEBP/HEIC)'));
          } else if (xhr.status === 429) {
            reject(new Error('上載太頻密，請稍後再試'));
          } else if (xhr.status === 507) {
            reject(new Error('活動儲存空間已滿'));
          } else {
            let msg = `上載失敗 (HTTP ${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText);
              if (body.error) msg = body.error;
            } catch {
              // ignore JSON parse errors
            }
            reject(new Error(msg));
          }
        };

        xhr.onerror = () => reject(new Error('網絡錯誤，請檢查連線或稍後再試'));
        xhr.ontimeout = () => reject(new Error('上載逾時，請重試'));
        xhr.timeout = 60_000; // 60s for slow phone uploads

        xhr.send(form);
      });
}

// 2026-07-27 — the client no longer mints the HMAC token, so a
// "configured" check that includes `NAS_UPLOAD_SECRET` is no longer
// meaningful. The proxy either has its server-only secret (works)
// or doesn't (rejects every request with 500). Clients can't tell
// from the bundle. Keeping these exports for any tooling that still
// imports them, but they no longer gate the upload path.
export const NAS_UPLOAD_CONFIGURED = Boolean(NAS_UPLOAD_URL);
export const NAS_UPLOAD_URL_VALUE = NAS_UPLOAD_URL;
