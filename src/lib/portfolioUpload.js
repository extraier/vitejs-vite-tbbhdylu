// portfolioUpload.js — uploads vendor portfolio images to NAS via public CDN.
//
// Why a separate helper: keeps AdminVendors.jsx focused on UI. Same shape is
// reusable for guest photo uploads later (same endpoint, same secret).
//
// Production endpoint: VITE_NAS_UPLOAD_URL (set in .env.local + Vercel)
// Production token:    VITE_NAS_UPLOAD_SECRET (same).
//
// Receiver protocol (matches /volume2/wedding/receiver/portfolio_upload.py):
//   POST {url}            X-Upload-Token: <secret>
//   Form fields:          vendorId, file
//   Response (JSON):      { url: "https://cdn.savetheday.io/v/<vendor>/<file>" }
//
// Errors throw with the server message so the caller's error UI shows it.

const UPLOAD_URL = import.meta.env.VITE_NAS_UPLOAD_URL;
const UPLOAD_SECRET = import.meta.env.VITE_NAS_UPLOAD_SECRET;

export function portfolioUploadConfigured() {
  return Boolean(UPLOAD_URL && UPLOAD_SECRET);
}

/**
 * Upload one image to the NAS portfolio CDN.
 * @param {string} vendorId  sanitized vendor id (alphanum + dash only on receiver side)
 * @param {File}   file      browser File from <input type="file">
 * @returns {Promise<string>}  public URL of the uploaded file
 */
export async function uploadPortfolioImage(vendorId, file) {
  if (!portfolioUploadConfigured()) {
    throw new Error('上傳功能未設定（缺少 VITE_NAS_UPLOAD_URL/SECRET）');
  }
  // Client-side guard: 8 MB matches the server cap.
  const MAX = 8 * 1024 * 1024;
  if (file.size > MAX) {
    throw new Error(`檔案太大：${(file.size / 1024 / 1024).toFixed(1)} MB（上限 8 MB）`);
  }
  const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!okTypes.includes(file.type)) {
    throw new Error(`不支援嘅格式：${file.type || '未知'}（只接受 JPG/PNG/WebP）`);
  }

  const fd = new FormData();
  fd.append('vendorId', vendorId);
  fd.append('file', file);

  let res;
  try {
    res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'X-Upload-Token': UPLOAD_SECRET },
      body: fd,
    });
  } catch (e) {
    // Network-layer failure: CORS rejection, offline, DNS, etc. The browser
    // collapses all of these to "Failed to fetch" / "NetworkError". Translate
    // to something an admin can act on.
    const hint = location.protocol === 'https:'
      ? '（可能係 CORS、防火牆、或者無網絡）'
      : '';
    throw new Error(`上傳請求未能送達伺服器：${e?.message || e}${hint}`);
  }

  if (!res.ok) {
    // Try to surface the server's JSON error; fall back to status text.
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error || j.detail || JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`上傳失敗 (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  if (!json.url) throw new Error('伺服器回應缺少 url');
  return json.url;
}

/**
 * Upload several files sequentially (so we don't hammer the receiver with N
 * parallel requests and confuse its per-vendor directory ordering). Returns
 * the URLs in input order. Failures stop the batch and the error is thrown.
 */
export async function uploadPortfolioImages(vendorId, files) {
  const urls = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    const u = await uploadPortfolioImage(vendorId, f);
    urls.push(u);
  }
  return urls;
}