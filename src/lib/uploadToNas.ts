// Upload a photo to the NAS via Tailscale Funnel.
//
// Replaces Firebase Storage for guest photo uploads. The URL is read from
// VITE_NAS_UPLOAD_URL at build time (see .env.example). When unset, this
// throws a clear error — the caller (App.jsx) catches it and shows a toast.
//
// Security (Hermes 2026-06-25): every upload is signed with HMAC-SHA256
// over (eventId|guestId|expiresAt). The server rejects expired or tampered
// tokens with 401, and rejects files whose magic bytes don't match the
// declared content type. The shared secret is bundled into the public JS —
// acceptable for a wedding app with 5-minute TTL, like a Stripe publishable key.
//
// Returns the public URL of the uploaded photo (e.g. https://<funnel>/photos/<event>/<guest>/<file>.jpg)
// which is then stored in Firestore's photos collection so the new owner's
// PhotoDrop gallery can display it.

const NAS_UPLOAD_URL = import.meta.env.VITE_NAS_UPLOAD_URL || '';
const NAS_UPLOAD_SECRET = import.meta.env.VITE_NAS_UPLOAD_SECRET || '';
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — server enforces this

type UploadArgs = {
  file: File;
  eventId: string;
  guestId: string;
  uploaderName?: string;
  onProgress?: (pct: number) => void;
};

type UploadResult = { url: string; bytes: number };

/**
 * Mint an HMAC token for an upload. Mirrors the algorithm in
 * /home/openclaw/bin/photo_upload_server.py on the NAS.
 *
 * Uses the Web Crypto API (SubtleCrypto) which is available in all
 * modern browsers and Node 16+. No third-party crypto needed.
 */
async function mintUploadToken(
  secret: string,
  eventId: string,
  guestId: string,
  expiresMs: number,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = enc.encode(`${eventId}|${guestId}|${expiresMs}`);
  const sig = await crypto.subtle.sign('HMAC', key, msg);
  // Hex-encode the digest
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @throws {Error} with a user-friendly message on any failure
 */
export function uploadPhotoToNas({
  file,
  eventId,
  guestId,
  uploaderName,
  onProgress,
}: UploadArgs): Promise<UploadResult> {
  if (!NAS_UPLOAD_URL) {
    return Promise.reject(
      new Error('VITE_NAS_UPLOAD_URL 未設定，請聯絡管理員'),
    );
  }
  if (!NAS_UPLOAD_SECRET) {
    return Promise.reject(
      new Error('VITE_NAS_UPLOAD_SECRET 未設定，請聯絡管理員'),
    );
  }
  if (!file) return Promise.reject(new Error('未揀選相片'));
  if (!eventId) return Promise.reject(new Error('缺少 eventId'));
  if (!guestId) return Promise.reject(new Error('缺少 guestId'));

  const expiresMs = Date.now() + TOKEN_TTL_MS;

  // Mint the token BEFORE building FormData (async step)
  return mintUploadToken(NAS_UPLOAD_SECRET, eventId, guestId, expiresMs).then(
    (token) => {
      const form = new FormData();
      form.append('file', file);
      form.append('eventId', eventId);
      form.append('guestId', guestId);
      form.append('uploaderName', uploaderName || 'Anonymous');

      // Use XHR instead of fetch so we can report upload progress (fetch can't
      // until the Streams API stabilizes for upload bodies).
      return new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', NAS_UPLOAD_URL, true);
        xhr.setRequestHeader('X-Upload-Token', token);
        xhr.setRequestHeader('X-Upload-Expires', String(expiresMs));

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
              resolve({ url: body.url, bytes: body.bytes || 0 });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              reject(new Error(`NAS server 回應解析失敗: ${msg}`));
            }
          } else if (xhr.status === 401) {
            reject(new Error('上載授權失敗 (token 已過期或無效)，請重試'));
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

        xhr.onerror = () => reject(new Error('網絡錯誤，請檢查連線'));
        xhr.ontimeout = () => reject(new Error('上載逾時，請重試'));
        xhr.timeout = 60_000; // 60s for slow phone uploads

        xhr.send(form);
      });
    },
  );
}

export const NAS_UPLOAD_CONFIGURED = Boolean(NAS_UPLOAD_URL && NAS_UPLOAD_SECRET);
export const NAS_UPLOAD_URL_VALUE = NAS_UPLOAD_URL;
