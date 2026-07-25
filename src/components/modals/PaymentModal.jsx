import { useState, useEffect } from 'react';
import { CreditCard, X, QrCode, Copy, Check, AlertCircle } from 'lucide-react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../../lib/firebase';
import { RedPacketGuestView } from '../../screens/RedPacketManager';

const SUGGESTED_AMOUNTS = [800, 1000, 1500];

// 2026-07-24 — PaymentModal for the guest-side 電子人情 flow.
//
// Renders the owner's uploaded QR codes (loaded live from Firestore)
// plus a few suggested amounts the guest can tap to acknowledge
// they've sent that figure (writes to the guest's hasGifted flag).
//
// Live subscription: we listen to /artifacts/{appId}/users/{ownerUid}/
// redPackets for the current owner. The owner's QR uploads show up
// here in real-time so a guest can refresh and see the latest one.
export function PaymentModal({ isOpen, onClose, onSend, ownerUid, onCopyQrLink }) {
  const [redPackets, setRedPackets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!isOpen || !ownerUid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const colRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      ownerUid,
      'redPackets',
    );
    const q = query(colRef);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        setRedPackets(list);
        setLoading(false);
      },
      (err) => {
        console.error('redPackets subscription failed:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [isOpen, ownerUid]);

  if (!isOpen) return null;

  // Pick the first suggested amount across all QRs (most couples set
  // the same value on all their QRs, but we honour whatever the
  // owner uploaded first).
  const firstSuggested = redPackets.find((r) => r.suggested)?.suggested;

  async function handleCopy(rp) {
    if (!rp?.qrUrl) return;
    try {
      await navigator.clipboard.writeText(rp.qrUrl);
      setCopiedId(rp.id);
      setTimeout(() => setCopiedId(null), 2000);
      onCopyQrLink?.(rp);
    } catch (e) {
      console.warn('clipboard write failed:', e);
      onCopyQrLink?.(rp);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[2rem] p-6 max-w-md w-full shadow-2xl relative my-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 rounded-full p-1.5 z-10"
          aria-label="關閉"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="bg-rose-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
          <CreditCard className="w-8 h-8 text-rose-500" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-1 text-center">電子人情</h2>
        <p className="text-slate-500 text-sm mb-4 text-center">
          請使用以下 QR Code 轉帳。多謝您的祝福 🧧
        </p>

        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">載入中…</div>
        ) : redPackets.length === 0 ? (
          <div className="text-center py-6 px-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-4">
            <AlertCircle className="w-5 h-5 mx-auto mb-1" />
            新人尚未上載 QR Code。請於現場以傳統方式（現金 / 簽賬）送上祝福。
          </div>
        ) : (
          <RedPacketGuestView
            redPackets={redPackets}
            suggestedAmount={firstSuggested}
            onCopyQrLink={handleCopy}
          />
        )}

        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-500 text-center mb-2">
            轉帳後請選擇以下金額，新人會收到通知：
          </p>
          <div className="grid grid-cols-3 gap-2">
            {SUGGESTED_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => onSend(amount)}
                className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300"
              >
                ${amount}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
