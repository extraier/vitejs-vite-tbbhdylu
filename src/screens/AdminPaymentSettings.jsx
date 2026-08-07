// AdminPaymentSettings — admin-only form for the platform PayMe /
// FPS details that <PurchaseModal> renders to couples when they
// pay for Premium.
//
// 2026-08-07 — first version. Replaces the hard-coded values that
// used to live in PurchaseModal:
//   - PayMe: `[PayMe QR]` placeholder + "HK${price} · Save The Day"
//   - FPS  : "HSBC 香港上海匯豐銀行" + "Save The Day Limited" +
//            "FPS ID：168888888"
//
// Storage layout:
//   - QR images → Firebase Storage at
//     /platform/payment-settings/{payme|fps}.{ext}
//     (public-read, admin-only-write — see storage.rules).
//   - Banking metadata → Firestore doc at
//     /artifacts/{appId}/platform/paymentSettings
//     fields: paymeQrUrl, fpsQrUrl, fpsBankName, fpsAccountName,
//             fpsId, updatedAt, updatedBy.
//     (signed-in read, admin-only-write — see firestore.rules).
//
// Admin uploads a QR, the client SDK stores it in Storage, then
// saves the public download URL into the Firestore doc alongside
// the banking text fields. <PurchaseModal> reads the doc on mount
// and renders the values — no rebuild required to change QR.

import { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Lock, Save, Upload, CheckCircle2, AlertCircle, Loader2, Image as ImageIcon, Trash2, ExternalLink } from 'lucide-react';
import { db, storage, appId } from '../lib/firebase';

// Validation regexes — keep on the client to catch typos before
// we hit Firestore. The server doesn't re-validate these fields
// because firestore.rules for /platform/paymentSettings is a
// simple isAdmin() gate (no shape check).
const FPS_ID_RE = /^\d{6,12}$/; // FPS IDs in HK are typically 6-12 digits

// Firestore doc path — uses the production appId (matches
// /Users/roger/code/vitejs-vite-tbbhdylu/src/lib/firebase.ts
// resolveAppId: 'savetheday-production' default).
const PAYMENT_SETTINGS_DOC = `artifacts/${appId}/platform/paymentSettings`;

// Storage path helpers — keep in sync with the regex in
// storage.rules: `fileName.matches('(payme|fps)\\.(png|jpg|jpeg|webp|svg)')`
function storagePathFor(kind) {
  // Default extension is png; storage rules allow png/jpg/jpeg/webp/svg.
  return `platform/payment-settings/${kind}.png`;
}

export function AdminPaymentSettings({ user, isAdmin }) {
  // ---- Form state ----
  const [paymeQrUrl, setPaymeQrUrl] = useState(null);
  const [fpsQrUrl, setFpsQrUrl] = useState(null);
  const [fpsBankName, setFpsBankName] = useState('');
  const [fpsAccountName, setFpsAccountName] = useState('');
  const [fpsId, setFpsId] = useState('');

  // ---- UI state ----
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPayme, setUploadingPayme] = useState(false);
  const [uploadingFps, setUploadingFps] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastUpdatedBy, setLastUpdatedBy] = useState(null);

  // Load existing settings on mount.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, PAYMENT_SETTINGS_DOC));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setPaymeQrUrl(data.paymeQrUrl || null);
          setFpsQrUrl(data.fpsQrUrl || null);
          setFpsBankName(data.fpsBankName || '');
          setFpsAccountName(data.fpsAccountName || '');
          setFpsId(data.fpsId || '');
          setLastUpdated(data.updatedAt || null);
          setLastUpdatedBy(data.updatedBy || null);
        }
      } catch (e) {
        if (!cancelled) setError(`載入失敗：${e?.message || '請稍後再試'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Upload a QR file to Firebase Storage.
  // Replaces the existing file at the path (overwrite).
  const handleQrUpload = useCallback(async (kind, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('請上傳圖片檔案 (PNG / JPG / WebP / SVG)');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('QR 圖片不能超過 2MB');
      return;
    }
    setError(null);
    const setUploading = kind === 'payme' ? setUploadingPayme : setUploadingFps;
    setUploading(true);
    try {
      const path = storagePathFor(kind);
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file, { contentType: file.type });
      const url = await getDownloadURL(ref);
      if (kind === 'payme') setPaymeQrUrl(url);
      else setFpsQrUrl(url);
    } catch (e) {
      setError(`上傳 ${kind.toUpperCase()} QR 失敗：${e?.message || '請稍後再試'}`);
    } finally {
      setUploading(false);
    }
  }, []);

  // Delete a QR file (sets URL to null + removes from storage).
  const handleQrDelete = useCallback(async (kind) => {
    setError(null);
    try {
      const ref = storageRef(storage, storagePathFor(kind));
      try {
        await deleteObject(ref);
      } catch (e) {
        // If the file doesn't exist in storage (e.g. never uploaded),
        // deleteObject throws with code 'storage/object-not-found'.
        // That's fine — we still want to clear the URL.
        if (e?.code !== 'storage/object-not-found') throw e;
      }
      if (kind === 'payme') setPaymeQrUrl(null);
      else setFpsQrUrl(null);
    } catch (e) {
      setError(`刪除 ${kind.toUpperCase()} QR 失敗：${e?.message || '請稍後再試'}`);
    }
  }, []);

  // Save banking metadata + (already-uploaded) QR URLs to Firestore.
  const handleSave = useCallback(async () => {
    setError(null);
    if (!user?.uid) {
      setError('請先登入');
      return;
    }
    // FPS-specific validation. PayMe has no metadata — just the QR.
    if (fpsId && !FPS_ID_RE.test(fpsId.trim())) {
      setError('FPS ID 應為 6-12 位數字');
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      await setDoc(doc(db, PAYMENT_SETTINGS_DOC), {
        paymeQrUrl: paymeQrUrl || null,
        fpsQrUrl: fpsQrUrl || null,
        fpsBankName: fpsBankName.trim(),
        fpsAccountName: fpsAccountName.trim(),
        fpsId: fpsId.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
      setSaved(true);
      setLastUpdated(new Date());
      setLastUpdatedBy(user.uid);
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(`儲存失敗：${e?.message || '請稍後再試'}`);
    } finally {
      setSaving(false);
    }
  }, [user?.uid, paymeQrUrl, fpsQrUrl, fpsBankName, fpsAccountName, fpsId]);

  // ---- Admin gate ----
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-100">
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">管理員專用</h2>
          <p className="text-slate-500">此頁面僅供管理員使用。</p>
        </div>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 mb-2">💳 收款設定</h1>
        <p className="text-slate-500">
          設定平台收款方法。新人喺 <strong>升級 Premium</strong> 時會見到呢啲資料。
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">載入中…</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ============ PayMe ============ */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <span className="text-emerald-600">📱</span> PayMe
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              上傳 PayMe 收款 QR code，新人掃描後過數。
            </p>

            <QrField
              label="PayMe QR Code"
              url={paymeQrUrl}
              uploading={uploadingPayme}
              onUpload={(file) => handleQrUpload('payme', file)}
              onDelete={() => handleQrDelete('payme')}
            />
          </div>

          {/* ============ FPS ============ */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <span className="text-blue-600">🏦</span> FPS (轉數快)
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              填寫 FPS ID 及戶口資料，新人透過銀行 App 過數。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  銀行名稱
                </label>
                <input
                  type="text"
                  value={fpsBankName}
                  onChange={(e) => setFpsBankName(e.target.value)}
                  placeholder="例：HSBC 香港上海匯豐銀行"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-400 text-sm"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  戶口名稱
                </label>
                <input
                  type="text"
                  value={fpsAccountName}
                  onChange={(e) => setFpsAccountName(e.target.value)}
                  placeholder="例：Save The Day Limited"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-400 text-sm"
                  maxLength={80}
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                FPS ID
              </label>
              <input
                type="text"
                value={fpsId}
                onChange={(e) => setFpsId(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="例：168888888"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-400 text-sm font-mono"
                inputMode="numeric"
                maxLength={12}
              />
              <p className="text-[10px] text-slate-500 mt-1">
                FPS ID 應為 6-12 位數字（手機號碼 / 電郵 / 銀行帳號）
              </p>
            </div>

            <QrField
              label="FPS QR Code（選填）"
              url={fpsQrUrl}
              uploading={uploadingFps}
              onUpload={(file) => handleQrUpload('fps', file)}
              onDelete={() => handleQrDelete('fps')}
            />
          </div>

          {/* ============ Save bar ============ */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm sticky bottom-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-xs text-slate-500">
                {lastUpdated ? (
                  <>最後更新：{lastUpdated.toLocaleString()} · {lastUpdatedBy?.slice(0, 8)}…</>
                ) : (
                  '尚未設定'
                )}
              </div>
              <div className="flex items-center gap-3">
                {error && (
                  <div className="flex items-center gap-1.5 text-sm text-rose-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {saved && !error && (
                  <div className="flex items-center gap-1.5 text-sm text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>已儲存</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 bg-rose-600 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-rose-700 disabled:opacity-40 transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      儲存中…
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      儲存設定
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Sub-component: QR upload + preview ----
function QrField({ label, url, uploading, onUpload, onDelete }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-2">{label}</label>

      {url ? (
        <div className="flex items-start gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex-shrink-0">
            <img
              src={url}
              alt={label}
              className="w-32 h-32 object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              用新頁開啟
            </a>
            <label className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg cursor-pointer transition-colors w-fit">
              <Upload className="w-3.5 h-3.5" />
              更換 QR
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => onUpload(e.target.files?.[0])}
                disabled={uploading}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-3 py-2 rounded-lg transition-colors w-fit"
            >
              <Trash2 className="w-3.5 h-3.5" />
              刪除 QR
            </button>
          </div>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/30 rounded-xl p-6 cursor-pointer transition-colors">
          {uploading ? (
            <>
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-slate-500">上傳中…</p>
            </>
          ) : (
            <>
              <ImageIcon className="w-8 h-8 text-slate-400" />
              <p className="text-sm text-slate-600 font-bold">點擊上傳 QR Code</p>
              <p className="text-xs text-slate-400">PNG / JPG / WebP / SVG · ≤ 2MB</p>
            </>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => onUpload(e.target.files?.[0])}
            disabled={uploading}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}