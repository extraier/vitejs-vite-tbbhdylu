/**
 * PurchaseModal — couple pays for an unlock via Stripe, PayMe, or FPS.
 *
 * For MVP we show the three options with brief instructions and a
 * "I paid" confirmation. The Stripe path needs Stripe Checkout
 * integration (TODO), PayMe/FPS paths use screenshot upload for
 * admin verification.
 *
 * 2026-07-21 — initial release.
 */

import { useState } from 'react';
import { X, CreditCard, Upload, Smartphone, Building2, Check, AlertCircle } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { storage, functions } from '../lib/firebase';
import type { UnlockType } from '../screens/EventsDashboard';

const UNLOCK_LABELS: Record<UnlockType, string> = {
  'custom-template': '上傳自訂電子喜帖設計',
  'storage-500mb': '+500MB 相簿 + 移除浮水印',
  'permanent-archive': '永久保存婚禮檔案',
};

const UNLOCK_PRICING: Record<UnlockType, number> = {
  'custom-template': 49,
  'storage-500mb': 29,
  'permanent-archive': 39,
};

const BUNDLE_PRICE = 99;

type PaymentMethod = 'stripe' | 'payme' | 'fps' | null;
type UnlockChoice = UnlockType | 'bundle';

interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerUid: string;
  onSuccess: () => void;
  lockedTypes: UnlockType[];
}

async function uploadPaymentReceiptHelper(
  ownerUid: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const path = `payment-receipts/${ownerUid}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return await getDownloadURL(storageRef);
}

export function PurchaseModal({ isOpen, onClose, ownerUid, onSuccess, lockedTypes }: PurchaseModalProps) {
  const [choice, setChoice] = useState<UnlockChoice>(
    lockedTypes.length === 3 ? 'bundle' : (lockedTypes[0] ?? 'bundle'),
  );
  const [method, setMethod] = useState<PaymentMethod>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<null | { estimatedTime: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState('');

  if (!isOpen) return null;

  const price = choice === 'bundle' ? BUNDLE_PRICE : UNLOCK_PRICING[choice];

  const handleStripeCheckout = () => {
    alert('Stripe 付款準備中... 請用 PayMe 或 FPS 暫時付款。');
  };

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setError('截圖不能超過 5MB');
      return;
    }
    if (!f.type.startsWith('image/')) {
      setError('請上傳圖片檔案');
      return;
    }
    setError(null);
    setScreenshot(f);
  };

  const handleSubmitReceipt = async () => {
    if (!method || method === 'stripe') return;
    if (!screenshot) {
      setError('請上傳付款截圖');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const screenshotUrl = await uploadPaymentReceiptHelper(ownerUid, screenshot);
      const fn = httpsCallable(functions, 'submitPaymentReceipt');
      const result = await fn({
        unlockType: choice,
        amount: price,
        paymentMethod: method,
        screenshotUrl,
        reference: reference || undefined,
      });
      const data = result.data as any;
      setSuccess({ estimatedTime: data.estimatedReviewTime });
      setTimeout(() => onSuccess(), 1500);
    } catch (e: any) {
      setError(`提交失敗：${e?.message || '請稍後再試'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setMethod(null);
    setScreenshot(null);
    setSuccess(null);
    setError(null);
    setReference('');
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl">
        <div className="sticky top-0 bg-gradient-to-r from-amber-50 to-rose-50 border-b border-rose-100 px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-rose-600" />
            <h2 className="text-lg font-black text-slate-800">解鎖功能</h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="bg-white/80 hover:bg-white rounded-full p-1.5 disabled:opacity-30"
          >
            <X className="w-4 h-4 text-slate-700" />
          </button>
        </div>

        <div className="p-5">
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-black text-slate-800 mb-2">提交成功！</h3>
              <p className="text-sm text-slate-600">{success.estimatedTime}</p>
              <p className="text-xs text-slate-400 mt-2">
                管理員會透過電郵通知你確認結果
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  想解鎖邊個？
                </label>
                <div className="space-y-2">
                  {lockedTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setChoice(t)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-colors flex items-center justify-between ${
                        choice === t ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-sm font-bold text-slate-800">{UNLOCK_LABELS[t]}</span>
                      <span className="text-base font-black text-rose-600">${UNLOCK_PRICING[t]}</span>
                    </button>
                  ))}
                  {lockedTypes.length === 3 && (
                    <button
                      type="button"
                      onClick={() => setChoice('bundle')}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-colors flex items-center justify-between ${
                        choice === 'bundle' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <span className="text-sm font-bold text-slate-800">🎁 三個全套</span>
                        <span className="block text-xs text-emerald-600 font-bold">慳 $18</span>
                      </div>
                      <span className="text-base font-black text-rose-600">${BUNDLE_PRICE}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  揀付款方法
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setMethod('stripe'); reset(); }}
                    className={`px-3 py-3 rounded-lg border-2 transition-colors flex flex-col items-center gap-1 ${
                      method === 'stripe' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 text-slate-700" />
                    <span className="text-xs font-bold">Stripe</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMethod('payme'); setScreenshot(null); }}
                    className={`px-3 py-3 rounded-lg border-2 transition-colors flex flex-col items-center gap-1 ${
                      method === 'payme' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Smartphone className="w-5 h-5 text-slate-700" />
                    <span className="text-xs font-bold">PayMe</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMethod('fps'); setScreenshot(null); }}
                    className={`px-3 py-3 rounded-lg border-2 transition-colors flex flex-col items-center gap-1 ${
                      method === 'fps' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Building2 className="w-5 h-5 text-slate-700" />
                    <span className="text-xs font-bold">FPS</span>
                  </button>
                </div>
              </div>

              {method === 'stripe' && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <p className="text-sm text-slate-700 mb-3">
                    用信用卡 / Apple Pay / Google Pay 即時付款，付款成功自動解鎖。
                  </p>
                  <button
                    type="button"
                    onClick={handleStripeCheckout}
                    className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-lg hover:bg-rose-700"
                  >
                    以 ${price} 付款
                  </button>
                </div>
              )}

              {method === 'payme' && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <p className="text-sm font-bold text-slate-700 mb-2">PayMe 付款步驟：</p>
                  <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside mb-3">
                    <li>用 PayMe App 掃以下 QR code 或搵「Save The Day」</li>
                    <li>過數 <strong>HK${price}</strong> 到我們嘅 PayMe</li>
                    <li>上傳付款截圖畀我哋確認</li>
                  </ol>
                  <div className="bg-white rounded-lg p-3 mb-3 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-32 h-32 bg-slate-100 border-2 border-slate-300 rounded-lg flex items-center justify-center mx-auto mb-1">
                        <span className="text-xs text-slate-500">[PayMe QR]</span>
                      </div>
                      <p className="text-xs text-slate-500">HK${price} · Save The Day</p>
                    </div>
                  </div>
                  <ReceiptUpload
                    onFile={handleScreenshotUpload}
                    screenshot={screenshot}
                    reference={reference}
                    onReference={setReference}
                  />
                </div>
              )}

              {method === 'fps' && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <p className="text-sm font-bold text-slate-700 mb-2">FPS 銀行轉帳：</p>
                  <div className="bg-white rounded-lg p-3 mb-3 text-sm space-y-1">
                    <p><strong>銀行：</strong> HSBC 香港上海匯豐銀行</p>
                    <p><strong>戶口名稱：</strong> Save The Day Limited</p>
                    <p><strong>FPS ID：</strong> 168888888</p>
                    <p><strong>金額：</strong> HK${price}</p>
                  </div>
                  <p className="text-xs text-slate-600 mb-3">
                    ⚠️ 過數完成後請上傳收據截圖
                  </p>
                  <ReceiptUpload
                    onFile={handleScreenshotUpload}
                    screenshot={screenshot}
                    reference={reference}
                    onReference={setReference}
                  />
                </div>
              )}

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2 mb-3">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-700">{error}</p>
                </div>
              )}

              {(method === 'payme' || method === 'fps') && (
                <button
                  type="button"
                  onClick={handleSubmitReceipt}
                  disabled={submitting || !screenshot}
                  className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-lg hover:bg-rose-700 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      提交中...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      提交付款證明
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptUpload({
  onFile,
  screenshot,
  reference,
  onReference,
}: {
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  screenshot: File | null;
  reference: string;
  onReference: (v: string) => void;
}) {
  return (
    <>
      <label className="block text-xs font-bold text-slate-700 mb-1 mt-3">
        付款截圖 *
      </label>
      <div className="relative">
        <input
          type="file"
          accept="image/*"
          onChange={onFile}
          className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
        />
        {screenshot && (
          <p className="text-xs text-emerald-600 mt-1">
            ✓ 已選擇：{screenshot.name} ({(screenshot.size / 1024).toFixed(0)} KB)
          </p>
        )}
      </div>
      <label className="block text-xs font-bold text-slate-700 mb-1 mt-3">
        交易參考編號（選填）
      </label>
      <input
        type="text"
        value={reference}
        onChange={(e) => onReference(e.target.value.slice(0, 50))}
        placeholder="例：FPS20260721-001"
        maxLength={50}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none focus:border-rose-400 text-sm"
      />
      <p className="text-[10px] text-slate-500 mt-1">
        提交後管理員會喺 24 小時內確認，確認後自動解鎖功能
      </p>
    </>
  );
}