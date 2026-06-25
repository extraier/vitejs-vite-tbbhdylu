import { useRef } from 'react';
import { Heart, Camera, Upload, AlertCircle, CreditCard, QrCode } from 'lucide-react';

export function PersonalGuestPortal({
  guest,
  eventName,
  isUploading,
  uploadProgress,
  isStorageFull,
  onUpload,
  onRequestRedPacket,
  onCopyQrLink,
}) {
  const fileInputRef = useRef(null);

  if (!guest) {
    return (
      <div className="text-center mt-20 text-slate-500">正在載入您的專屬電子喜帖...</div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-4 pb-12 animate-in fade-in zoom-in duration-300">
      <div className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-center text-white py-10 px-6 relative">
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30"></div>
          <Heart className="w-8 h-8 mx-auto mb-2 text-rose-500 fill-rose-500 relative z-10" />
          <h2 className="text-xl font-black tracking-widest mb-1 relative z-10">
            {eventName || '婚禮晚宴'}
          </h2>
          <p className="text-white/60 text-xs font-mono relative z-10">Save The Day 囍程</p>
        </div>

        <div className="p-6 -mt-6 relative z-20">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 text-center mb-6">
            <h3 className="text-sm text-slate-500 mb-1">親愛的嘉賓</h3>
            <h2 className="text-2xl font-black text-slate-800 mb-4">{guest.name}</h2>
            <div className="inline-block bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3">
              <p className="text-xs text-indigo-500 font-bold mb-1">您的專屬座位</p>
              <p className="text-3xl font-black text-indigo-700">{guest.tableNumber}</p>
            </div>
          </div>

          <div className="space-y-4">
            <PhotoUploadCard
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              isStorageFull={isStorageFull}
              fileInputRef={fileInputRef}
              onUpload={onUpload}
            />

            <RedPacketCard guest={guest} onRequestRedPacket={onRequestRedPacket} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoUploadCard({ isUploading, uploadProgress, isStorageFull, fileInputRef, onUpload }) {
  return (
    <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50">
      <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
        <Camera className="w-5 h-5 text-slate-600" /> 現場相片分享
      </h4>
      <p className="text-xs text-slate-500 mb-3">
        分享您剛才拍攝的美照，相片會即時投射至大螢幕！
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onUpload}
        disabled={isUploading || isStorageFull}
      />

      <label
        htmlFor="real-photo-upload"
        onClick={() => fileInputRef.current?.click()}
        className={`w-full py-3 rounded-xl shadow-sm flex items-center justify-center gap-2 font-bold transition-colors ${
          isUploading
            ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
            : isStorageFull
              ? 'bg-red-100 text-red-600 cursor-not-allowed'
              : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'
        }`}
      >
        {isUploading ? (
          <span className="animate-pulse">上載中 {uploadProgress}%...</span>
        ) : isStorageFull ? (
          <>
            <AlertCircle className="w-4 h-4" /> 空間已滿
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" /> 從手機選擇相片
          </>
        )}
      </label>
    </div>
  );
}

function RedPacketCard({ guest, onRequestRedPacket }) {
  return (
    <div
      className={`p-5 rounded-2xl border-2 transition-all ${
        guest.hasGifted ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-bold text-slate-800 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-rose-500" /> 電子人情 (Red Packet)
        </h4>
      </div>
      {guest.hasGifted ? (
        <p className="text-sm text-green-700 font-medium">
          感謝您的祝福！已紀錄禮金：${guest.giftAmount}
        </p>
      ) : (
        <button
          onClick={onRequestRedPacket}
          className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl hover:bg-rose-700 shadow-sm flex items-center justify-center gap-2"
        >
          <QrCode className="w-4 h-4" /> 使用 PayMe / FPS
        </button>
      )}
    </div>
  );
}
