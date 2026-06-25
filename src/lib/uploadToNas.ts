// Upload a photo to the NAS via Tailscale Funnel.
//
// Replaces Firebase Storage for guest photo uploads. The URL is read from
// VITE_NAS_UPLOAD_URL at build time (see .env.example). When unset, this
// throws a clear error — the caller (App.jsx) catches it and shows a toast.
//
// Returns the public URL of the uploaded photo (e.g. https://<funnel>/photos/<event>/<guest>/<file>.jpg)
// which is then stored in Firestore's photos collection so the new owner's
// PhotoDrop gallery can display it.

const NAS_UPLOAD_URL = import.meta.env.VITE_NAS_UPLOAD_URL || '';

type UploadArgs = {
  file: File;
  eventId: string;
  guestId: string;
  uploaderName?: string;
  onProgress?: (pct: number) => void;
};

type UploadResult = { url: string; bytes: number };

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
  if (!file) return Promise.reject(new Error('未揀選相片'));
  if (!eventId) return Promise.reject(new Error('缺少 eventId'));
  if (!guestId) return Promise.reject(new Error('缺少 guestId'));

  const form = new FormData();
  form.append('file', file);
  form.append('eventId', eventId);
  form.append('guestId', guestId);
  form.append('uploaderName', uploaderName || 'Anonymous');

  // Use XHR instead of fetch so we can report upload progress (fetch can't
  // until the Streams API stabilizes for upload bodies).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', NAS_UPLOAD_URL, true);

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
}

export const NAS_UPLOAD_CONFIGURED = Boolean(NAS_UPLOAD_URL);
export const NAS_UPLOAD_URL_VALUE = NAS_UPLOAD_URL;
