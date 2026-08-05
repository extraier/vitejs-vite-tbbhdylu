import { useRef, useState } from 'react';
import {
  Heart,
  Camera,
  Upload,
  AlertCircle,
  CreditCard,
  QrCode,
  Maximize2,
  X,
  Copy,
  Check,
} from 'lucide-react';

export function PersonalGuestPortal({
  guest,
  eventName,
  isUploading,
  uploadProgress,
  isStorageFull,
  onUpload,
  onRequestRedPacket,
  onCopyQrLink,
  // 2026-08-05 — Entry-pass QR wiring. The portal was missing its
  // own 入場 QR (the same token ReceptionScanner reads). The card
  // builds the link from guest.{qOwner,qEvent,guestId} in real
  // guest mode, or falls back to window.__ownerUid/__currentEventId
  // in owner-preview mode (mirrors QrCodeModal's fallback chain).
  entryUrl,
  // 2026-07-18 — When the owner clicks "preview as guest" on a row in
  // the 嘉賓列表, they need a way to come back. In real guest mode
  // (URL ?o=&e=&g=&token=) this prop is undefined and the helper
  // button isn't rendered.
  onExitPreview,
}) {
  const fileInputRef = useRef(null);
  const [enlarged, setEnlarged] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // 2026-08-05 — Compute the 入場 entry-pass URL the same way
  // QrCodeModal does (see src/components/modals/QrCodeModal.jsx:24):
  //   {origin}/?o={ownerUid}&e={eventId}&g={guestId}
  // In real guest mode, every value comes off the guest object.
  // In owner-preview mode (activeGuestPortal set from the
  // 嘉賓列表 "preview as guest" button), currentEvent is the owner's
  // event and the guest's qOwner/qEvent are undefined — fall back
  // to window.__ownerUid / window.__currentEventId, matching
  // QrCodeModal's pattern.
  const computedEntryUrl =
    entryUrl ||
    (() => {
      if (!guest) return '';
      const origin =
        typeof window !== 'undefined'
          ? `${window.location.protocol}//${window.location.host}`
          : '';
      const ownerUid = guest.qOwner || window.__ownerUid || '';
      const eventId = guest.qEvent || window.__currentEventId || '';
      const guestId = guest.guestId || guest.id || '';
      if (!ownerUid || !eventId || !guestId) return '';
      return `${origin}/?o=${ownerUid}&e=${eventId}&g=${guestId}`;
    })();
  const entryQrImgUrl = computedEntryUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(computedEntryUrl)}&color=0f172a`
    : '';

  const handleCopyEntryLink = async () => {
    if (!computedEntryUrl) return;
    try {
      await navigator.clipboard.writeText(computedEntryUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: show the URL in a prompt so the user can copy
      // manually on iOS Safari, where clipboard.writeText can
      // throw NotAllowedError outside a user gesture chain.
      window.prompt('請複製您的入場連結：', computedEntryUrl);
    }
  };

  if (!guest) {
    return (
      <div className="text-center mt-20 text-slate-500">正在載入您的專屬電子喜帖...</div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-4 pb-12 animate-in fade-in zoom-in duration-300">
      {onExitPreview && (
        <div className="flex justify-between items-center mb-2 gap-2">
          {/* 2026-07-24 — secondary "back via browser history" button
              as a fallback. The original onExitPreview is the
              primary path; this back arrow handles cases where the
              primary X is unreachable (e.g. toast overlay, or the
              user is on a screen that lost the primary handler
              state). z-50 puts it above the upload card. */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                // No history — fall through to the primary exit
                onExitPreview();
              }
            }}
            className="px-3 py-2 text-sm font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-xl shadow-sm border border-slate-200 flex items-center gap-1 z-50"
            title="返回上一頁"
          >
            ← 上一頁
          </button>
          <button
            onClick={onExitPreview}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-xl shadow-sm border border-slate-200 flex items-center gap-1.5"
            title="返回嘉賓列表"
          >
            ← 返回嘉賓列表
          </button>
        </div>
      )}
      <div className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-center text-white py-10 px-6 relative">
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30"></div>
          <Heart className="w-8 h-8 mx-auto mb-2 text-rose-500 fill-rose-500 relative z-10" />
          <h2 className="text-xl font-black tracking-widest mb-1 relative z-10">
            {eventName || '婚禮晚宴'}
          </h2>
          <p className="text-white/60 text-xs font-mono relative z-10">Save The Day</p>
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

          {/* 2026-08-05 — Entry-pass QR. Reception scans this
              at the door to mark the guest attended. The same
              token scheme as ReceptionScanner reads
              (src/screens/ReceptionScanner.jsx top comment) and
              QrCodeModal generates (src/components/modals/QrCodeModal.jsx).
              Placed at the top of the action list so guests see
              it immediately and can enlarge it for the venue
              staff. */}
          {entryQrImgUrl && (
            <EntryPassCard
              qrImgUrl={entryQrImgUrl}
              entryUrl={computedEntryUrl}
              alreadyAttended={!!guest.hasAttended}
              enlarged={enlarged}
              onEnlarge={() => setEnlarged(true)}
              onClose={() => setEnlarged(false)}
              linkCopied={linkCopied}
              onCopy={handleCopyEntryLink}
            />
          )}

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

// 2026-08-05 — Entry-pass QR card. Reception scans this at the
// venue door to mark the guest attended (calls
// handleSimulateReceptionScan in App.jsx). Same ?o=&e=&g= token
// that QrCodeModal writes for the owner's send-invite path.
//
// Renders a compact preview inline + a fullscreen enlarged view
// for staff scanning on phone screens (reception desks often use
// the guest's own phone screen as the scanner target).
function EntryPassCard({
  qrImgUrl,
  entryUrl,
  alreadyAttended,
  enlarged,
  onEnlarge,
  onClose,
  linkCopied,
  onCopy,
}) {
  return (
    <>
      <div className="p-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-600" /> 您的入場 QR
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              {alreadyAttended
                ? '✅ 您已報到 — 請向接待處出示此 QR 或直接入座'
                : '到場時請向接待處出示此 QR Code 核對'}
            </p>
          </div>
          {alreadyAttended && (
            <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
              已報到
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Thumbnail — tap to enlarge. The full QR renders at
              400x400 via api.qrserver.com; we downscale here so
              the card stays compact on the welcome screen. */}
          <button
            type="button"
            onClick={onEnlarge}
            className="relative w-24 h-24 bg-white rounded-xl border-2 border-emerald-200 shadow-sm overflow-hidden flex-shrink-0 group hover:border-emerald-400 transition-colors"
            title="點擊放大 QR Code"
            aria-label="放大入場 QR Code"
          >
            <img
              src={qrImgUrl}
              alt="入場 QR Code"
              className="w-full h-full object-contain p-1"
            />
            <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/20 transition-colors flex items-center justify-center">
              <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onEnlarge}
              className="w-full mb-2 bg-emerald-600 text-white font-bold py-2 rounded-xl hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-2 text-sm"
            >
              <Maximize2 className="w-4 h-4" /> 打開 QR 給接待處掃描
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="w-full bg-white border border-slate-200 text-slate-700 text-xs font-bold py-2 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              {linkCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" /> 已複製連結
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> 複製入場連結
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Fullscreen overlay so reception staff can scan the
          guest's phone without the welcome cards crowding the
          view. Tap anywhere outside the card (or the X) to close. */}
      {enlarged && (
        <div
          className="fixed inset-0 bg-slate-900/95 z-[60] flex flex-col items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2"
            title="關閉"
            aria-label="關閉 QR Code"
          >
            <X className="w-6 h-6" />
          </button>
          <div
            className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-rose-600 font-black tracking-widest text-xs mb-1">
              ENTRY PASS
            </h3>
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              入場 QR Code
            </h2>
            <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 inline-block">
              <img
                src={qrImgUrl}
                alt="入場 QR Code 放大版"
                className="w-72 h-72 mx-auto"
              />
            </div>
            <p className="text-slate-600 text-sm mt-4">
              請向接待處出示此畫面
            </p>
            <p className="text-[10px] text-slate-400 break-all mt-2 bg-slate-50 p-2 rounded">
              {entryUrl}
            </p>
            <button
              type="button"
              onClick={onCopy}
              className="mt-4 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 flex items-center justify-center gap-2"
            >
              {linkCopied ? (
                <>
                  <Check className="w-4 h-4" /> 已複製連結
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> 複製入場連結
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
