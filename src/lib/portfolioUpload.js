// portfolioUpload.js — uploads vendor portfolio images.
//
// 2026-07-14 — switched from NAS upload to Firebase Storage. The NAS
// endpoint (cdn.savetheday.io) was returning HTTP 530 (Cloudflare
// origin-unreachable), making file uploads impossible. Firebase Storage
// has its own CDN and works as long as the user has a Firebase Auth
// session and the storage rules allow the write.
//
// Path scheme: /vendors/{vendorId}/portfolio/{ts}-{filename}
// Storage rules require: request.auth.uid == vendorId
//
// The returned URLs are public download URLs (signed, time-limited but
// effectively perpetual for our use case) that work anywhere — they're
// stored in Firestore and rendered by the vendor directory, admin
// review screen, and the vendor's own profile.

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import { storage } from './firebase';

// Client-side guard: 8 MB matches the server-side rule.
const MAX = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Upload one image to Firebase Storage under /vendors/{vendorId}/portfolio/.
 * @param {string} vendorId  Firebase Auth UID of the vendor (the wizard
 *                           routes this from useAuth().user.uid). The
 *                           storage rule requires the auth UID to match
 *                           this path segment.
 * @param {File}   file      browser File from <input type="file">
 * @param {Function} onProgress  optional (pct: number) => void
 * @returns {Promise<string>}  public URL of the uploaded file
 */
export async function uploadPortfolioImage(vendorId, file, onProgress) {
  if (!vendorId) {
    throw new Error('缺少 vendor ID');
  }
  if (!file) {
    throw new Error('未選擇檔案');
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`不支援嘅格式：${file.type || '未知'}（只接受 JPG/PNG/WebP）`);
  }
  if (file.size > MAX) {
    throw new Error(`檔案太大：${(file.size / 1024 / 1024).toFixed(1)} MB（上限 8 MB）`);
  }

  // Path: /vendors/{vendorId}/portfolio/{ts}-{filename}
  // The timestamp prefix prevents name collisions and gives a stable
  // sort order when the directory is later listed in admin tools.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `vendors/${vendorId}/portfolio/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);

  return new Promise((resolve, reject) => {
    try {
      const task = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000',
      });

      task.on(
        'state_changed',
        (snapshot) => {
          if (typeof onProgress === 'function') {
            const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            onProgress(pct);
          }
        },
        (err) => {
          // Storage-layer failure: permission denied, offline, quota.
          // The SDK gives us a code (storage/unauthorized, storage/canceled,
          // storage/retry-limit-exceeded, etc.) but the user doesn't care —
          // we surface a friendly message and the original error for the
          // admin console.
          let hint = '';
          if (err?.code?.includes('unauthorized') || err?.code?.includes('permission')) {
            hint = '（權限被拒，請確認已登入）';
          } else if (err?.code?.includes('canceled')) {
            hint = '（上傳已取消）';
          } else if (err?.code?.includes('retry-limit-exceeded')) {
            hint = '（網絡不穩，請稍後再試）';
          } else {
            hint = '（網絡錯誤、權限問題、或者配額已滿）';
          }
          reject(new Error(`上傳失敗：${err?.message || err}${hint}`));
        },
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve(url);
          } catch (err) {
            reject(new Error(`上傳成功但無法取得連結：${err?.message || err}`));
          }
        },
      );
    } catch (err) {
      reject(new Error(`上傳初始化失敗：${err?.message || err}`));
    }
  });
}

/**
 * Upload several files sequentially (so progress events are easier to
 * reason about and we don't hammer Storage with N parallel requests
 * confusing its per-vendor directory ordering). Returns the URLs in
 * input order. Failures stop the batch and the error is thrown.
 */
export async function uploadPortfolioImages(vendorId, files, onProgress) {
  const urls = [];
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    // eslint-disable-next-line no-await-in-loop
    const u = await uploadPortfolioImage(vendorId, f, (pct) => {
      if (typeof onProgress === 'function') {
        // Report overall progress: each file is one slice of the total.
        const base = (i / files.length) * 100;
        const slice = (pct / 100) * (100 / files.length);
        onProgress(base + slice);
      }
    });
    urls.push(u);
  }
  if (typeof onProgress === 'function') onProgress(100);
  return urls;
}

// Kept for back-compat — Step4Portfolio.jsx calls this to decide whether
// to show the upload UI. With Firebase Storage the only requirement is
// an auth session, which we always have on the wizard route. So this
// is always true now, but kept as a function so the call site doesn't
// need to change.
export function portfolioUploadConfigured() {
  return Boolean(storage);
}