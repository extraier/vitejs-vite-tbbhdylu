import { X } from 'lucide-react';

export function QrCodeModal({ guest, eventName, onClose, onCopy }) {
  if (!guest) return null;

  const hostUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}${window.location.pathname}`
      : '';
  // The uid (Firebase Auth UID) may not be available yet on this screen;
  // production builds should pass it down explicitly. We fall back to a
  // placeholder so the modal still renders in development.
  const ownerUid = window.__ownerUid || 'pending-uid';
  const eventId = window.__currentEventId || 'pending-event';
  const shareUrl = `${hostUrl}?o=${ownerUid}&e=${eventId}&g=${guest.guestId}`;
  const qrCodeImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(shareUrl)}&color=312e81`;

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"
        >
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-rose-600 font-black tracking-widest text-sm mb-1">
          ELECTRONIC INVITATION
        </h3>
        <h2 className="text-2xl font-bold text-slate-800">{eventName}</h2>
        <div className="bg-indigo-50 p-6 rounded-3xl border-2 border-indigo-100 my-6 inline-block">
          <img src={qrCodeImgUrl} className="w-48 h-48 mx-auto rounded-xl" alt="qr" />
        </div>
        <p className="text-slate-500 mb-3">
          親愛的 <strong>{guest.name}</strong>，憑此 QR Code 入場。
        </p>
        <p className="text-[10px] text-slate-400 break-all mb-6 bg-slate-50 p-2 rounded">
          {shareUrl}
        </p>
        <button
          onClick={() => onCopy(shareUrl)}
          className="w-full bg-indigo-500 text-white font-bold py-3 rounded-xl hover:bg-indigo-600 shadow-sm flex items-center justify-center gap-2"
        >
          複製專屬連結 (WhatsApp 發送)
        </button>
      </div>
    </div>
  );
}
