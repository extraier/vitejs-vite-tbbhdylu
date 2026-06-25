import { Crown, X } from 'lucide-react';

export function UpgradeModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl relative text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"
        >
          <X className="w-5 h-5" />
        </button>
        <Crown className="w-16 h-16 text-amber-400 mx-auto mb-4" />
        <h2 className="text-2xl font-black text-slate-800 mb-2">升級至 Premium</h2>
        <p className="text-slate-500 text-sm mb-6">解鎖無限相片上載、高清影片支援及永久保存。</p>
        <button
          onClick={onConfirm}
          className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 shadow-lg"
        >
          立即付款 $499 解鎖
        </button>
      </div>
    </div>
  );
}
