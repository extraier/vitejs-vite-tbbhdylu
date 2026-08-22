import { useEffect, useRef, useState } from 'react';
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
  Trash2,
  Calendar,
  MapPin,
  MessageCircleHeart,
  ExternalLink,
  Loader2,
} from 'lucide-react';

// 2026-08-22 — Guest portal additive cards. Three small wins that
// don't need the full Guest Hub foundation (guestExperience/public
// doc + publishGuestExperience CF + rules overhaul) but still give
// invited guests immediate value on the portal:
//   1. CountdownCard — days / hours until the ceremony, with
//      three copy states (today / future / past) and live tick.
//   2. VenueMapCard — Google Maps deep-link button built from
//      the event.venue + event.address. No embedded iframe (would
//      blow up Lighthouse + need API key); uses the ?api=1 query
//      redirect that works in iOS Safari, Android Chrome, and
//      desktop browsers without a Maps SDK.
//   3. GuestMessageCard — 280-char 心意 textarea saved to the
//      /guests/{id}.guestMessage field on the existing guest doc.
//      The Firestore rules change in this commit tightens the
//      guest update branch to allow ONLY guestMessage +
//      guestMessageUpdatedAt — see firestore.rules.
//
// None of these touch CFs, the rules tier above the new
// whitelist, or the foundation spec. They're the smallest additive
// win set I could scope given the user's "add more functions to
// the electronic invitation" framing; the full RSVP /
// schedule / calendar features from the guest-hub PDF are
// deferred to phase 2.

export function PersonalGuestPortal({
  guest,
  eventName,
  isUploading,
  uploadProgress,
  isStorageFull,
  // 2026-08-05 — The guest's own uploaded photos, filtered by
  // uploaderId in App.jsx. Empty array until the photos
  // subscription fires. Renders as a 3-column scrollable
  // gallery below the upload card so guests can see what
  // they've shared. Sorted desc by createdAt by App.jsx's
  // eventPhotos useMemo.
  myPhotos = [],
  // 2026-08-05 — Guest self-delete. (photoId) => Promise<void>.
  // Wired from App.jsx; the portal calls it when the guest taps
  // the Trash icon on a thumbnail in MyUploadsGallery. App.jsx
  // uses the same handleDeletePhoto the PhotoDrop screen uses,
  // so the rule tier + CF tier match across owner + guest views.
  onDeletePhoto,
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
  // 2026-08-22 — Additive card wiring (see header comment). The
  // three cards below (countdown / venue map / guest message) are
  // optional — when any of their required props are missing the
  // card hides itself rather than rendering a stub. This keeps
  // owner-preview + legacy test callers working without forcing
  // every caller to wire all six props.
  eventDate = null,
  eventTime = null,
  eventVenue = null,
  eventAddress = null,
  onSaveGuestMessage = null,
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

          {/* 2026-08-22 — Additive guest-facing cards. Each one hides
              itself when its required data is missing (no event
              date → no countdown; no venue → no map; no save
              handler → no message card). See the docstrings on
              each component for the exact hide conditions. The
              countdown + map cards mount BEFORE the entry-pass QR
              so the guest sees the "what's coming up" framing
              before the logistics; the message card sits AFTER the
              QR so it reads as a separate "post-RSVP" affordance. */}
          <CountdownCard eventDate={eventDate} eventTime={eventTime} />
          <VenueMapCard eventVenue={eventVenue} eventAddress={eventAddress} />

          {/* 2026-08-05 — Entry-pass QR. Reception scans this
              at the door to mark the guest attended. The same
              token scheme as ReceptionScanner reads
              (src/screens/ReceptionScanner.jsx top comment) and
              QrCodeModal generates (src/components/modals/QrCodeModal.jsx).
              Placed at the top of the action list so guests see
              it immediately and can enlarge it for the venue
              staff. Always renders (even if URL is empty) so the
              section is visible; shows a debug hint if any of
              the three params are missing. */}
          <EntryPassCard
            qrImgUrl={entryQrImgUrl}
            entryUrl={computedEntryUrl}
            debugReason={(() => {
              if (entryQrImgUrl) return null;
              if (!guest.qOwner) return 'missing qOwner';
              if (!guest.qEvent) return 'missing qEvent';
              if (!guest.guestId && !guest.id) return 'missing guestId';
              return 'unknown';
            })()}
            alreadyAttended={!!guest.hasAttended}
            enlarged={enlarged}
            onEnlarge={() => setEnlarged(true)}
            onClose={() => setEnlarged(false)}
            linkCopied={linkCopied}
            onCopy={handleCopyEntryLink}
          />

          {/* 2026-08-22 — 心意 message card. Sits right after the
              entry-pass QR (post-logistics framing) and before the
              photo upload (which is the last action). Hides when
              onSaveGuestMessage is not wired (owner-preview mode
              before the prop was added) OR when the guest doc
              hasn't loaded yet (guest.name is the only thing
              required for the title). The message is rendered as
              a one-line preview when already saved — guests don't
              need to re-edit every time they open the portal. */}
          {onSaveGuestMessage && guest?.guestId && (
            <GuestMessageCard
              guest={guest}
              onSave={onSaveGuestMessage}
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

            {/* 2026-08-05 — Show the guest their own uploaded
                photos so they get immediate visual confirmation
                that the share worked. Hidden when empty so the
                portal doesn't grow a stub card before the first
                upload lands. */}
            {myPhotos.length > 0 && (
              <MyUploadsGallery
                photos={myPhotos}
                onDeletePhoto={onDeletePhoto}
              />
            )}

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
  debugReason,
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
            onClick={qrImgUrl ? onEnlarge : undefined}
            disabled={!qrImgUrl}
            className={`relative w-24 h-24 rounded-xl border-2 shadow-sm overflow-hidden flex-shrink-0 group transition-colors ${
              qrImgUrl
                ? 'bg-white border-emerald-200 hover:border-emerald-400 cursor-pointer'
                : 'bg-slate-100 border-slate-200 border-dashed cursor-default'
            }`}
            title={qrImgUrl ? '點擊放大 QR Code' : 'QR 尚未準備好'}
            aria-label="放大入場 QR Code"
          >
            {qrImgUrl ? (
              <>
                <img
                  src={qrImgUrl}
                  alt="入場 QR Code"
                  className="w-full h-full object-contain p-1"
                />
                <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/20 transition-colors flex items-center justify-center">
                  <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <QrCode className="w-8 h-8 text-slate-300" />
              </div>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onEnlarge}
              disabled={!qrImgUrl}
              className="w-full mb-2 bg-emerald-600 text-white font-bold py-2 rounded-xl hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-2 text-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <Maximize2 className="w-4 h-4" /> 打開 QR 給接待處掃描
            </button>
            <button
              type="button"
              onClick={onCopy}
              disabled={!entryUrl}
              className="w-full bg-white border border-slate-200 text-slate-700 text-xs font-bold py-2 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            {/* Debug hint — only shown when the QR can't be built.
                2026-08-05: lets us see which param is missing on
                the user's screen without them opening devtools. */}
            {debugReason && (
              <p className="text-[10px] text-rose-500 mt-2 font-mono break-all">
                ⚠ {debugReason} — owner={String(window.__ownerUid || '').slice(0, 6)}…,
                event={String(window.__currentEventId || '').slice(0, 6)}…,
                guest={String((entryUrl || '').split('g=')[1] || '').slice(0, 6) || '—'}…
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen overlay so reception staff can scan the
          guest's phone without the welcome cards crowding the
          view. Tap anywhere outside the card (or the X) to close.
          2026-08-05: only mount when a real QR is available —
          otherwise tapping the placeholder button does nothing. */}
      {enlarged && qrImgUrl && (
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

// 2026-08-05 — MyUploadsGallery. Small 3-column thumbnail grid
// showing the guest's own uploaded photos so they get immediate
// visual confirmation that the share worked. Tap a thumbnail
// to enlarge it (same Maximize2 + fullscreen pattern as
// EntryPassCard).
//
// Hidden when photos is empty (handled by the call site), so
// there's no empty-state placeholder to maintain.
//
// 2026-08-05 — Added a delete button (Trash2) on the enlarged
// view. The button calls onDeletePhoto(photo.id), which is
// wired from App.jsx to handleDeletePhoto. The CF
// mintPhotoDeleteToken gates on the uploader tier for guests
// (photo.uploadAuthUid === auth.currentUser.uid), so the
// rule + CF will both allow this delete. The button is
// hidden when onDeletePhoto isn't provided (defense — the
// call site always provides it but the gallery is
// standalone-importable in tests).
function MyUploadsGallery({ photos, onDeletePhoto }) {
  const [enlargedIdx, setEnlargedIdx] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  return (
    <div className="p-4 rounded-2xl border-2 border-slate-200 bg-white">
      <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-3">
        <Camera className="w-4 h-4 text-slate-600" /> 我分享的相片
        <span className="text-xs text-slate-500 font-normal">（{photos.length}）</span>
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <button
            key={p.id || i}
            type="button"
            onClick={() => setEnlargedIdx(i)}
            className="aspect-square rounded-lg overflow-hidden bg-slate-100 hover:opacity-90 transition-opacity"
            title={`分享於 ${new Date(p.createdAt || Date.now()).toLocaleString('zh-HK')}`}
          >
            <img
              src={p.thumbnailUrl || p.url}
              alt={`我分享的相片 ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {enlargedIdx !== null && (
        <div
          className="fixed inset-0 bg-slate-900/95 z-[60] flex flex-col items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={() => {
            if (!isDeleting) setEnlargedIdx(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setEnlargedIdx(null)}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2"
            title="關閉"
            aria-label="關閉相片"
            disabled={isDeleting}
          >
            <X className="w-6 h-6" />
          </button>
          <div
            className="bg-white rounded-3xl p-4 shadow-2xl max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photos[enlargedIdx]?.url || photos[enlargedIdx]?.thumbnailUrl}
              alt={`我分享的相片 ${enlargedIdx + 1} 放大版`}
              className="w-full h-auto max-h-[80vh] object-contain rounded-2xl"
            />
            <p className="text-xs text-slate-500 text-center mt-3">
              分享於 {new Date(photos[enlargedIdx]?.createdAt || Date.now()).toLocaleString('zh-HK')}
            </p>
            {/* 2026-08-05 — Guest self-delete. Trash2 button
                fires onDeletePhoto(photo.id). The CF
                mintPhotoDeleteToken + firestore.rules will
                both allow this because myPhotos is filtered
                by uploaderId === activeGuestPortal.guestId
                in App.jsx, AND photo.uploadAuthUid ===
                auth.currentUser.uid (recorded at upload).
                Same handler as the owner-side PhotoDrop
                screen, so the rule + CF paths match. */}
            {onDeletePhoto && photos[enlargedIdx]?.id && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={async () => {
                    const photoId = photos[enlargedIdx].id;
                    if (isDeleting) return;
                    setIsDeleting(true);
                    try {
                      await onDeletePhoto(photoId);
                      // Close the modal — the onSnapshot in
                      // App.jsx will remove the row from
                      // myPhotos via the filter, and
                      // enlargedIdx no longer points to a
                      // valid photo.
                      setEnlargedIdx(null);
                    } catch (err) {
                      // eslint-disable-next-line no-alert
                      alert(`刪除失敗：${err?.message || '未知錯誤'}`);
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                  disabled={isDeleting}
                  title="刪除這張相片"
                  aria-label="刪除這張相片"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? '刪除中…' : '刪除這張相片'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Additive cards (2026-08-22) ────────────────────────────────────
//
// Three small guest-facing affordances shipped in the same commit
// as the GuestMessageCard field-whitelist rules change. See the
// top-of-file header comment for the rationale (smallest additive
// wins that don't need the full Guest Hub foundation). Each card:
//   - Hides itself when its required data is missing (no stubs).
//   - Uses the same visual chrome as the existing cards (slate-50
//     backgrounds, rounded-2xl, icon-led titles) so it reads as
//     part of the existing portal family.
//   - Lives in this file rather than src/components/guest/ because
//     it's tightly coupled to the portal's data model + state —
//     splitting it out would force two-file edits for every
//     future change. Phase 2 (RSVP / calendar / timeline) WILL
//     land in src/components/guest/ when the foundation ships.

// ── Date helper ─────────────────────────────────────────────────────
//
// Parses the event doc's date + time fields (both strings — see
// how InvitationEditor.jsx reads them as `event.date || event.time`
// at line 179) into a JS Date. Returns null when either field is
// missing or malformed; the cards treat null as "don't render".
//
// Why string parsing instead of new Date(date + 'T' + time):
//   `event.date` is "YYYY-MM-DD" (per InfoStep's <input type="date">
//   at line 781), `event.time` is "HH:MM" (line 786). Concat'ing
//   them with a literal T builds an ISO string the JS Date ctor
//   parses in LOCAL timezone (matching how couples see their own
//   wedding day). UTC parsing would shift the day by ±1 in
//   Asia/Hong_Kong, which is the most common couple timezone on
//   the platform — a 2027-01-01 wedding would render as "yesterday"
//   on the morning of the day in HK if we parsed as UTC.
//
// Exported for tests + for any future caller (the InvitationEditor's
// preview might want to reuse it).
export function parseLocalEventDateTime(dateStr, timeStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const time = typeof timeStr === 'string' && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : '00:00';
  // "YYYY-MM-DDTHH:MM" — Date ctor treats this as LOCAL time, which
  // is what we want (couples see "the day" in their own timezone).
  const iso = `${dateStr}T${time}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── CountdownCard ───────────────────────────────────────────────────
//
// Pure client-side countdown to the wedding. Three copy states:
//
//   past     — "感謝您蒞臨這場婚禮 🎉" (the day has passed)
//   today    — "今天就是大日子！" + the start time
//   future   — "還有 N 天" with hours sub-label when < 2 days
//
// Tick every 60s (cheap; the card is just a text + number pair).
// Hides entirely when eventDate is missing or unparseable — couples
// who haven't set the date yet won't see a broken countdown.
//
// Live-tick implementation detail: useEffect sets a setInterval that
// calls setNow(Date.now()) once a minute. We use Date.now() (a
// monotonic-ish integer) rather than new Date() because the
// arithmetic later only cares about the timestamp. Re-renders are
// trivial (~6 lines of JSX), so 60s tick has no measurable cost.
function CountdownCard({ eventDate, eventTime }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const target = parseLocalEventDateTime(eventDate, eventTime);
  if (!target) return null;
  const targetMs = target.getTime();
  const diffMs = targetMs - now;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  let eyebrow;
  let headline;
  let sub;
  let tone;
  if (diffMs < 0) {
    // past
    eyebrow = '感謝您的祝福';
    headline = '大日子已過';
    sub = '希望您當日過得愉快 🎉';
    tone = 'rose';
  } else if (diffDays === 0) {
    // today — show start time so the guest knows when to arrive
    eyebrow = '今天就是';
    headline = '大日子！';
    const hhmm = (eventTime && /^\d{2}:\d{2}$/.test(eventTime)) ? eventTime : '';
    sub = hhmm ? `開始時間：${hhmm}` : '記得準時出席 💐';
    tone = 'rose';
  } else if (diffDays < 2) {
    // < 48h — show hours instead of days so the number is meaningful
    eyebrow = '倒數中';
    headline = `還有 ${diffHours} 小時`;
    sub = diffHours > 0
      ? `${diffMinutes - diffHours * 60} 分鐘後開始`
      : '即將開始！';
    tone = 'amber';
  } else {
    eyebrow = '倒數中';
    headline = `還有 ${diffDays} 天`;
    sub = `${target.toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`;
    tone = 'rose';
  }

  const palette = {
    rose: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', icon: 'text-rose-500' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-500' },
  }[tone];

  return (
    <div
      className={`p-5 rounded-2xl border-2 ${palette.bg} ${palette.border}`}
      data-testid="guest-countdown-card"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-2">
        <Calendar className={`w-5 h-5 ${palette.icon}`} />
        <p className={`text-xs font-bold tracking-wider ${palette.text}`}>
          {eyebrow}
        </p>
      </div>
      <p
        className={`text-3xl font-black ${palette.text}`}
        data-testid="guest-countdown-headline"
      >
        {headline}
      </p>
      <p className="text-sm text-slate-600 mt-1">{sub}</p>
    </div>
  );
}

// ── VenueMapCard ────────────────────────────────────────────────────
//
// Single-row card with a button that opens Google Maps in a new
// tab. Uses the documented `?api=1&query=` URL form so the same
// link works on iOS Safari (opens the native Google Maps app
// when installed), Android Chrome, and desktop browsers — no
// Maps SDK / API key / iframe bloat.
//
// Hides when BOTH eventVenue AND eventAddress are empty. If only
// one is present we use that one (couples often fill one without
// the other).
//
// Why the new tab + rel=noopener: keeps the guest on the portal
// when they come back. window.opener / window.name are out of
// scope; the rel attribute is the minimum that Lighthouse audits.
function VenueMapCard({ eventVenue, eventAddress }) {
  const venue = (eventVenue || '').trim();
  const address = (eventAddress || '').trim();
  if (!venue && !address) return null;
  // 2026-08-22 — Google Maps "search" deep link. The official
  // pattern from
  // https://developers.google.com/maps/documentation/urls/get-started
  // — works without an API key, falls back gracefully if the
  // Maps app isn't installed (opens the web app in a new tab).
  const query = encodeURIComponent([venue, address].filter(Boolean).join(' '));
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
  return (
    <div
      className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50"
      data-testid="guest-venue-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-5 h-5 text-slate-500" />
        <p className="text-xs font-bold tracking-wider text-slate-500">場地</p>
      </div>
      {venue && (
        <p className="text-lg font-black text-slate-800" data-testid="guest-venue-name">
          {venue}
        </p>
      )}
      {address && (
        <p className="text-sm text-slate-600 mt-1" data-testid="guest-venue-address">
          {address}
        </p>
      )}
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 w-full min-h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"
        data-testid="guest-venue-maps-link"
      >
        <MapPin className="w-4 h-4" />
        在 Google Maps 開啟
        <ExternalLink className="w-3.5 h-3.5 opacity-70" />
      </a>
    </div>
  );
}

// ── GuestMessageCard ────────────────────────────────────────────────
//
// 280-char 心意 textarea saved to /guests/{guestId}.guestMessage.
// The rules change in this commit locks the guest tier down to
// ONLY those two fields (guestMessage + guestMessageUpdatedAt),
// so this card can never accidentally widen what guests can
// write — even if a future caller adds another write here, the
// rules will reject it.
//
// UX:
//   - "Read" mode (initial mount with a saved message): show the
//     message + "修改" button.
//   - "Edit" mode (tapped 修改 or never saved): show the textarea
//     + save + cancel.
//   - 280 char limit shown live as "X / 280" so guests don't
//     hit a silent wall.
//   - Save uses the same state-machine pattern as PhotoUploadCard
//     (idle | saving | saved | error) so the toast/haptic surface
//     matches.
//   - Last-saved-at shown below the textarea in both modes (so
//     guests see "上次更新：2026-08-22 14:30" after a save).
//
// Hides entirely when onSave isn't wired — owner-preview mode
// before this prop was added renders no card. The card's outer
// mount in PersonalGuestPortal already gates on onSaveGuestMessage
// + guest.guestId, so this function defensively double-checks
// both.
function GuestMessageCard({ guest, onSave }) {
  const initialMessage = guest?.guestMessage || '';
  const initialSavedAt = guest?.guestMessageUpdatedAt || null;
  const [mode, setMode] = useState('read'); // 'read' | 'edit'
  const [draft, setDraft] = useState(initialMessage);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const maxLen = 280;

  // 2026-08-22 — when the underlying guest doc updates (the
  // rules + onSnapshot pipeline round-trips back), keep the
  // textarea draft in sync if the user isn't actively editing.
  // Active edit takes priority over the doc update so we don't
  // clobber mid-typing.
  useEffect(() => {
    if (mode === 'read') {
      setDraft(initialMessage);
    }
  }, [initialMessage, mode]);

  if (!onSave || !guest?.guestId) return null;

  async function submit(event) {
    event.preventDefault();
    if (saveState === 'saving') return;
    const trimmed = draft.trim();
    if (trimmed === initialMessage) {
      // No-op save — close edit mode silently. Avoids writing
      // a fresh serverTimestamp for a message that didn't change.
      setMode('read');
      return;
    }
    if (trimmed.length > maxLen) {
      setErrorMsg(`最多 ${maxLen} 字。`);
      return;
    }
    setSaveState('saving');
    setErrorMsg('');
    try {
      await onSave(trimmed);
      setSaveState('saved');
      setMode('read');
      // Reset to idle after a short window so the "已儲存" pill
      // disappears if the guest keeps the page open.
      window.setTimeout(() => setSaveState('idle'), 3000);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(
        err?.message || '儲存失敗，請稍後再試。',
      );
    }
  }

  return (
    <div
      className="p-5 rounded-2xl border-2 border-rose-200 bg-rose-50"
      data-testid="guest-message-card"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageCircleHeart className="w-5 h-5 text-rose-500" />
          <p className="text-xs font-bold tracking-wider text-rose-700">
            給新人的心意
          </p>
        </div>
        {saveState === 'saved' && (
          <span
            className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
            data-testid="guest-message-saved-pill"
          >
            ✅ 已儲存
          </span>
        )}
      </div>

      {mode === 'read' ? (
        <div data-testid="guest-message-read">
          {initialMessage ? (
            <p className="text-slate-800 whitespace-pre-wrap" data-testid="guest-message-content">
              {initialMessage}
            </p>
          ) : (
            <p className="text-slate-500 text-sm italic">
              寫幾句心意說話畀新人，等佢哋收到最真摯嘅祝福 💌
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(initialMessage);
              setMode('edit');
              setSaveState('idle');
              setErrorMsg('');
            }}
            className="mt-3 w-full bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"
            data-testid="guest-message-edit"
          >
            <MessageCircleHeart className="w-4 h-4" />
            {initialMessage ? '修改心意' : '寫幾句'}
          </button>
          {initialSavedAt && (
            <p className="text-[10px] text-slate-500 mt-2">
              上次更新：{formatSavedAt(initialSavedAt)}
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} data-testid="guest-message-edit-form">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, maxLen))}
            placeholder="例：祝願你哋甜甜蜜蜜，白頭偕老！"
            rows={3}
            className="w-full rounded-2xl border border-slate-200 p-3 text-sm font-normal focus:outline-none focus:border-rose-400"
            maxLength={maxLen}
            data-testid="guest-message-textarea"
          />
          <div className="flex items-center justify-between mt-1 text-[10px]">
            <span className={draft.length >= maxLen ? 'text-rose-600 font-bold' : 'text-slate-400'}>
              {draft.length} / {maxLen}
            </span>
            {initialSavedAt && (
              <span className="text-slate-400">
                上次更新：{formatSavedAt(initialSavedAt)}
              </span>
            )}
          </div>
          {errorMsg && (
            <p className="mt-2 text-xs text-rose-700" role="alert" data-testid="guest-message-error">
              {errorMsg}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(initialMessage);
                setMode('read');
                setErrorMsg('');
                setSaveState('idle');
              }}
              className="flex-1 bg-white border border-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-sm hover:bg-slate-50"
              data-testid="guest-message-cancel"
              disabled={saveState === 'saving'}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saveState === 'saving'}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
              data-testid="guest-message-save"
            >
              {saveState === 'saving' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {saveState === 'saving' ? '儲存中…' : '儲存'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// 2026-08-22 — Shared formatter for the "上次更新：YYYY-MM-DD HH:MM"
// timestamp shown under the message textarea. Handles Firestore
// Timestamp objects, ISO strings, and millisecond numbers — the
// three shapes the onSnapshot pipeline can produce. Falls back
// to an empty string when the input is malformed so the
// surrounding JSX never renders "上次更新：NaN-NaN-NaN".
function formatSavedAt(value) {
  let d = null;
  try {
    if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
      d = new Date(value.toMillis());
    } else if (typeof value === 'string') {
      d = new Date(value);
    } else if (typeof value === 'number') {
      d = new Date(value);
    }
  } catch {
    return '';
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
