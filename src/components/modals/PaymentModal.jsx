import { CreditCard, X } from 'lucide-react';

const SUGGESTED_AMOUNTS = [800, 1000, 1500];

export function PaymentModal({ isOpen, onClose, onSend }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl relative text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="bg-rose-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <CreditCard className="w-8 h-8 text-rose-500" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-1">電子人情</h2>
        <p className="text-slate-500 text-sm mb-6">
          請使用 FPS 或 PayMe 掃描下方 QR Code 轉帳。
        </p>
        <div className="grid grid-cols-3 gap-2 mb-4">
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
  );
}
