import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { X, Mail, Image as ImageIcon, Send, Upload, Crown, Sparkles, Edit2, Check, Loader2 } from 'lucide-react';
import {
  INVITATION_TEMPLATES,
  WORDING_TEMPLATES,
  loadLiveTemplates,
} from '../components/invitation/templates';
import { InvitationCard } from '../components/invitation/InvitationCard';
// 2026-08-23 — Manus P4.1 (PDF Patch 4): removed UpgradeModal import.
// InvitationEditor no longer owns its own upgrade modal — it
// delegates to the global <PurchaseModal> the parent (App.jsx)
// already mounts. The screen calls onRequestPremium when a locked
// background is hit, the parent sets purchaseLockedTypes and
// opens the global modal with the locked-type picker shown.
// See App.jsx for purchaseLockedTypes state + the prop wiring.
import { db, functions, auth, appId } from '../lib/firebase';
import { callFirebaseFn } from '../lib/firebaseFn';
// 2026-08-13 — H-01: helper for attaching the Firebase ID token
// as Authorization: Bearer on same-origin upload calls. The proxy
// verifyIdToken's this header before minting a NAS HMAC.
import { buildUploadAuthHeader } from '../lib/uploadAuthHeader';

// 2026-07-22 — Calling sendInvitationsV2 via the Vercel proxy
// to bypass Cloud Run's CORS preflight rejection. See
// src/lib/firebaseFn.js for the proxy helper.

const STEPS = [
  { id: 'background', label: '揀背景' },
  { id: 'info', label: '寫心意' },
  { id: 'guests', label: '寄出去' },
];

export function InvitationEditor({
  isOpen,
  ownerUid,
  eventId,
  event,
  guests,
  ownerTier = 'free',
  isAdmin = false,
  // 2026-08-23 — Manus P4.1 (PDF Patch 4): onRequestPremium is the
  // hook the editor uses to ask the parent (App.jsx) to open the
  // global <PurchaseModal> with lockedTypes=['custom-template'].
  // Previously the editor mounted its own UpgradeModal here; the
  // UpgradeModal→PurchaseModal chain had a non-trivial dead-code
  // path. Now there's one PaymentModal in the whole app, owned by
  // the parent, and this screen just signals when to open it.
  onRequestPremium,
  onClose,
  onSent,
}) {
  const [step, setStep] = useState(0);
  const invitationId = 'default';  // one invitation doc per (owner, event) for now
  const [templateId, setTemplateId] = useState('plain');
  const [bgUrl, setBgUrl] = useState(null);
  const [ownerMessage, setOwnerMessage] = useState('');
  // 2026-08-14 — invitation-level overrides for event metadata.
  // The event record is the canonical source for date/time/venue/
  // address, but the user often wants to nudge the date shown on
  // the invitation (e.g. "ceremony is 2pm but reception is 7pm")
  // without rewriting the event record. Overrides are stored on
  // the invitation doc, not the event, so we don't disturb other
  // surfaces (dashboard, RSVP, rundown). Empty string means
  // "fall back to event value"; populated means "use this".
  const [eventOverrides, setEventOverrides] = useState({
    date: '',
    time: '',
    venue: '',
    address: '',
  });
  const [selectedGuestIds, setSelectedGuestIds] = useState([]);
  // 2026-08-23 — Manus P4.1: removed showUpgrade state — the editor
  // no longer owns its own upgrade modal. Locked-background hits
  // route through onRequestPremium → parent → global PurchaseModal.
  const [sending, setSending] = useState(false);
  const [previewGuestId, setPreviewGuestId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // 2026-07-03 — load live templates from Firestore/Storage so admin
  // SVG uploads show up in the picker. INVITATION_TEMPLATES is the
  // bundled fallback; loadLiveTemplates overlays Firestore overrides
  // (previewUrl / palette / label / layout) on top.
  const [templates, setTemplates] = useState(INVITATION_TEMPLATES);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const live = await loadLiveTemplates(db, appId);
      if (!cancelled) setTemplates(live);
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Load existing invitation doc on mount
  useEffect(() => {
    if (!isOpen || !ownerUid) return;
    (async () => {
      try {
        const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'invitations', invitationId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const d = snap.data();
          setTemplateId(d.templateId || 'plain');
          setBgUrl(d.bgUrl || null);
          setOwnerMessage(d.ownerMessage || '');
          // Restore overrides — only the four scalar fields. Older
          // invitations without these keys get '' (fall back to event).
          setEventOverrides({
            date: typeof d.dateOverride === 'string' ? d.dateOverride : '',
            time: typeof d.timeOverride === 'string' ? d.timeOverride : '',
            venue: typeof d.venueOverride === 'string' ? d.venueOverride : '',
            address: typeof d.addressOverride === 'string' ? d.addressOverride : '',
          });
        }
      } catch (err) {
        console.warn('[InvitationEditor] load failed:', err);
      }
    })();
  }, [isOpen, ownerUid, invitationId]);

  // Autosave on any change (debounced 500ms)
  useEffect(() => {
    if (!isOpen || !ownerUid) return;
    const t = setTimeout(async () => {
      try {
        const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'invitations', invitationId);
        await setDoc(ref, {
          templateId,
          bgUrl,
          ownerMessage,
          // Persist the four override fields. We store them as
          // separate top-level keys so they're easy to query and
          // diff. Empty strings mean "no override; use event value".
          dateOverride: eventOverrides.date || '',
          timeOverride: eventOverrides.time || '',
          venueOverride: eventOverrides.venue || '',
          addressOverride: eventOverrides.address || '',
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('[InvitationEditor] autosave failed:', err);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [templateId, bgUrl, ownerMessage, eventOverrides, isOpen, ownerUid, invitationId]);

  // Ensure the invitation doc exists the first time the editor opens,
  // so cloud functions that look up `invitations/default` succeed even
  // when the user hasn't changed any field yet (autosave only fires on
  // change → first send used to fail with 'Invitation not found').
  useEffect(() => {
    if (!isOpen || !ownerUid) return;
    (async () => {
      try {
        const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'invitations', invitationId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            templateId: 'plain',
            bgUrl: null,
            ownerMessage: '',
            // Seed override keys so reads via .data() always see
            // a consistent shape — saves us a typeof check elsewhere.
            dateOverride: '',
            timeOverride: '',
            venueOverride: '',
            addressOverride: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('[InvitationEditor] ensure-default-doc failed:', err);
      }
    })();
  }, [isOpen, ownerUid, invitationId]);

  if (!isOpen) return null;

  const previewGuest = guests?.find((g) => g.guestId === previewGuestId) || guests?.[0];
  const previewShareUrl = previewGuest
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?o=${ownerUid}&e=${eventId}&g=${previewGuest.guestId}`
    : '';

  // 2026-08-14 — merge event metadata with invitation-level overrides.
  // Each override is treated as "use this instead" when non-empty;
  // empty strings fall back to the event record. We do NOT mutate
  // `event` itself — the spread builds a new object the InfoStep and
  // InvitationCard both consume.
  const effectiveEvent = event
    ? {
        ...event,
        date: eventOverrides.date || event.date,
        time: eventOverrides.time || event.time,
        venue: eventOverrides.venue || event.venue,
        address: eventOverrides.address || event.address,
      }
    : event;

  // 2026-07-23 — switched from direct NAS POST to /api/photo-upload.
  // The HMAC token is no longer minted client-side: the proxy mints
  // it with the server-only HMAC secret after reading the multipart
  // body. The browser only ever knows the *destination URL* (/api/
  // photo-upload, same-origin) and never touches the HMAC secret.
  // The receiver (deploy/photo_upload_server.py) verifies the
  // server-minted token with constant-time HMAC compare.
  //
  // 2026-07-27 — replaced literal "PLACEHOLDER_FIXED_BY_TASK_10"
  // X-Upload-Token (which leaked the auth bypass string into the
  // public bundle) with the standard /api/photo-upload path. The
  // background upload reuses the same proxy as guest photos by
  // mapping (vendorId, file) -> (eventId="inv-bg", guestId=vendorUid,
  // file). The receiver's storage layout becomes
  // /photos/inv-bg/<vendorUid>/<ts>_abcd.jpg, distinct from any
  // real event's guest uploads. SAFE_ID regex accepts both ids.
  const handleBgUpload = async (file) => {
    if (ownerTier !== 'premium') {
      // 2026-08-23 — Manus P4.1 (PDF Patch 4): non-premium users
      // hit the global PurchaseModal with lockedTypes=['custom-template']
      // so the SKU picker shows the exact item this background
      // would unlock. Parent wires onRequestPremium → setPurchaseLockedTypes
      // + setPurchaseModalOpen(true).
      onRequestPremium?.();
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      // Field names MUST match what the Vercel proxy and the NAS
      // receiver expect: eventId / guestId / uploaderName / file.
      // ownerUid is the vendor's Firebase UID (defense in depth:
      // SAFE_ID regex on the receiver side caps at 64 chars; Firebase
      // UIDs are 28 chars, fits).
      fd.append('eventId', 'inv-bg');
      fd.append('guestId', ownerUid);
      // 2026-08-13 — H-01: include ownerUid so the proxy can look
      // up the event doc and confirm the caller is a member of this
      // owner's event. For invitation-bg uploads, the event is the
      // designer's own pseudo-event "inv-bg" — the proxy treats
      // that case as "ownerUid === caller" (special-case).
      fd.append('ownerUid', ownerUid);
      fd.append('uploaderName', ownerUid); // vendor's uid as uploader name
      fd.append('file', file);
      const res = await fetch('/api/photo-upload', {
        method: 'POST',
        // No X-Upload-Token / X-Upload-Expires — the proxy mints
        // them server-side now. Removing the literal placeholder
        // closes the prior leak. Client never sees the secret.
        //
        // 2026-08-13 — H-01: attach Authorization Bearer. The
        // signed-in designer's Firebase ID token. The proxy
        // verifies the token, then special-cases eventId='inv-bg'
        // to allow only when request.auth.uid === ownerUid.
        //
        // 2026-08-23 — Manus P4.1 (PDF Patch 4): the previous call to
        // `buildAuthHeaders()` is a typo — the function is exported
        // from src/lib/uploadAuthHeader.js as `buildUploadAuthHeader`.
        // The typo meant the proxy couldn't verify the caller's
        // Firebase ID token, so the upload was rejected. Now it
        // returns the same { Authorization: 'Bearer ...' } header.
        headers: await buildUploadAuthHeader(),
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || 'upload failed');
      setBgUrl(json.url);
    } catch (err) {
      alert('上傳失敗: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // 2026-07-03 — admin-only template SVG editor. Base64-encodes the
  // chosen file, calls the `updateTemplate` Cloud Function, then refreshes
  // the live templates list so the picker immediately reflects the new
  // preview. The function gates on the admin custom claim; if the caller
  // somehow has the UI without the claim, the call returns
  // permission-denied and we surface that to the admin so they know to
  // re-check their auth state.
  const handleTemplateUpload = async (templateId, file, label) => {
    setIsUploading(true);
    try {
      // Soft client-side check. Server-side magic-byte sniffing is the
      // source of truth — we just want to give a friendlier error before
      // uploading a 256KB blob that will be rejected anyway.
      const ok =
        file.type === 'image/svg+xml' ||
        file.type === 'image/png' ||
        file.type === 'image/jpeg' ||
        file.name.toLowerCase().match(/\.(svg|png|jpe?g)$/);
      if (!ok) {
        throw new Error('檔案必須係 SVG / PNG / JPG');
      }
      if (file.size > 256 * 1024) {
        throw new Error('檔案太大 (上限 256 KB)');
      }
      // Read as base64 (chunked-safe; works for files up to a few MB).
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const svgBase64 = dataUrl.split(',')[1];

      const fn = httpsCallable(getFunctions(), 'updateTemplate');
      const result = await fn({ templateId, svgBase64, label });
      // Refresh the live list so the picker reflects the new preview URL.
      const live = await loadLiveTemplates(db, appId);
      setTemplates(live);
      // Tiny visual confirmation — we don't toast here because the
      // BackgroundStep already shows an inline check.
      return result.data;
    } catch (err) {
      // httpsCallable surfaces the server message in err.message.
      const msg = err?.message || '上傳失敗';
      alert(`模板上傳失敗: ${msg}`);
      throw err;
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="min-h-full flex items-start sm:items-center justify-center p-4 pt-20 pb-12 sm:py-8">
      <div className="bg-white rounded-3xl max-w-5xl w-full flex flex-col shadow-2xl my-auto">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-rose-50 to-pink-50 rounded-t-3xl">
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Mail className="w-5 h-5 text-rose-500" />
              設計電子喜帖
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{event?.name} · 步驟 {step + 1}/3 · {STEPS[step].label}</p>
          </div>
          <button onClick={onClose} className="bg-slate-100 rounded-full p-1.5 hover:bg-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-slate-200">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setStep(i)}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                i === step ? 'text-rose-600 border-b-2 border-rose-500' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>

        {/* Body — keeps its natural content height. `flex-1` would zero
            out here because the modal is content-sized (no h-[X]),
            and flex-1 with flex-basis:0% means "grow from 0", which
            leaves 0 leftover for siblings that already consume all
            the room. Without flex-1, the body simply takes its
            natural ~500px on step 2 / ~600px on step 1. The outer
            fixed-inset-0 overflow-y-auto handles scroll if the
            modal exceeds viewport. */}
        <div className="overflow-visible">
          {step === 0 && (
            <BackgroundStep
              templates={templates}
              templateId={templateId}
              setTemplateId={setTemplateId}
              bgUrl={bgUrl}
              setBgUrl={setBgUrl}
              onUpload={handleBgUpload}
              onTemplateUpload={handleTemplateUpload}
              isUploading={isUploading}
              fileInputRef={fileInputRef}
              ownerTier={ownerTier}
              isAdmin={isAdmin}
              // 2026-08-23 — Manus P4.1 (PDF Patch 4): wire the
              // template-picker background step directly to the
              // global PurchaseModal. Same onRequestPremium
              // contract as handleBgUpload above.
              onPremiumRequired={() => onRequestPremium?.()}
            />
          )}
          {step === 1 && (
            <InfoStep
              ownerMessage={ownerMessage}
              setOwnerMessage={setOwnerMessage}
              event={effectiveEvent}
              overrides={eventOverrides}
              setOverrides={setEventOverrides}
            />
          )}
          {step === 2 && (
            <GuestsStep
              guests={guests || []}
              selectedGuestIds={selectedGuestIds}
              setSelectedGuestIds={setSelectedGuestIds}
              previewGuest={previewGuest}
              setPreviewGuestId={setPreviewGuestId}
            />
          )}
        </div>

        {/* Live preview pane (always visible) — collapsible on small screens */}
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-500 mb-2 font-bold flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> 即時預覽 · {previewGuest?.name || '（揀一位嘉賓）'}
          </p>
          <div className="max-w-xs mx-auto">
            <InvitationCard
              templateId={templateId}
              bgUrl={bgUrl}
              event={effectiveEvent}
              guest={previewGuest}
              ownerMessage={ownerMessage}
              shareUrl={previewShareUrl}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex justify-between rounded-b-3xl">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="px-5 py-2.5 text-slate-600 bg-slate-100 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-30"
          >
            上一步
          </button>
          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="px-5 py-2.5 text-white bg-rose-600 hover:bg-rose-700 rounded-xl font-bold"
            >
              下一步
            </button>
          ) : (
            <SendButton
              ownerUid={ownerUid}
              eventId={eventId}
              invitationId={invitationId}
              guestIds={selectedGuestIds}
              customMessage={ownerMessage}
              sending={sending}
              setSending={setSending}
              onSent={(result) => {
                onSent?.(result);
                onClose();
              }}
            />
          )}
        </div>
      </div>

      {/* 2026-08-23 — Manus P4.1 (PDF Patch 4): UpgradeModal mount
          removed. The parent (App.jsx) mounts a single global
          <PurchaseModal> that this screen signals open via
          onRequestPremium when a locked background is hit. */}
      </div>
      </div>
  );
}

function BackgroundStep({
  templates,
  templateId,
  setTemplateId,
  bgUrl,
  setBgUrl,
  onUpload,
  onTemplateUpload,
  isUploading,
  fileInputRef,
  ownerTier,
  isAdmin,
  onPremiumRequired,
}) {
  // Per-tile file inputs for the admin upload (one ref per template id so
  // each tile can trigger its own picker).
  const tileInputRefs = useRef({});
  // Track which tile is currently being uploaded so we can show a spinner
  // overlay on that exact tile, not on the whole grid.
  const [uploadingTileId, setUploadingTileId] = useState(null);
  // Cache-bust the preview <img> after an upload so the browser re-fetches
  // the freshly-updated Storage object (cacheControl=300s means a single
  // upload inside 5 min would otherwise show the old SVG).
  const [previewNonce, setPreviewNonce] = useState(0);
  // Briefly show a green checkmark on a tile after a successful upload.
  const [recentlyUploadedId, setRecentlyUploadedId] = useState(null);

  // 2026-07-03 — admin upload handler. Wraps onTemplateUpload so we can
  // show a per-tile spinner + cache-bust the preview.
  const handleTileUpload = async (tileId, file) => {
    setUploadingTileId(tileId);
    try {
      const tpl = (templates || INVITATION_TEMPLATES).find((t) => t.id === tileId);
      await onTemplateUpload(tileId, file, tpl?.label);
      // Force re-fetch of the SVG. The storage object's publicUrl is stable
      // across uploads (same path), so we append a query string that the
      // browser treats as a different resource.
      setPreviewNonce((n) => n + 1);
      setRecentlyUploadedId(tileId);
      setTimeout(() => setRecentlyUploadedId(null), 2500);
    } catch {
      // alert already shown by onTemplateUpload
    } finally {
      setUploadingTileId(null);
    }
  };

  // Compose the rendered templates list. Default to INVITATION_TEMPLATES
  // so the grid renders even before loadLiveTemplates resolves.
  const tpls = (templates && templates.length > 0) ? templates : INVITATION_TEMPLATES;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <ImageIcon className="w-4 h-4" /> 揀一個模板
            {isAdmin && (
              <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">
                管理員可編輯
              </span>
            )}
          </h3>
          <span className="text-xs text-slate-400">{tpls.length} 個</span>
        </div>
        {(!tpls || tpls.length === 0) ? (
          <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-xl">
            載入模板中... 如果長時間空白,請 refresh 頁面。
          </div>
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {tpls.map((t) => {
            const isSelected = templateId === t.id;
            const isUploadingThis = uploadingTileId === t.id;
            const justUploaded = recentlyUploadedId === t.id;
            // Cache-bust uploaded previews: append ?v=<nonce> so the browser
            // fetches the freshly-stored SVG instead of the cached one.
            // We only need the nonce when the template is custom-uploaded;
            // the bundled fallback already changes when the bundle hash
            // changes (Vite asset hashing).
            const src = (t.isCustom && previewNonce > 0)
              ? `${t.previewUrl}${t.previewUrl.includes('?') ? '&' : '?'}v=${previewNonce}`
              : t.previewUrl;
            return (
              <div
                key={t.id}
                className={`relative rounded-xl border-2 overflow-hidden text-left transition-all bg-white ${
                  isSelected ? 'border-rose-500 ring-2 ring-rose-200' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => { setTemplateId(t.id); setBgUrl(null); }}
                  className="block w-full text-left"
                >
                  <div className="bg-slate-100 aspect-[3/4] flex items-center justify-center overflow-hidden relative">
                    {/* Render real SVG preview of the design so the user can
                        visualize the layout before sending. Falls back to a
                        color block if the SVG file is missing. */}
                    <img
                      src={src}
                      alt={t.label}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // If the SVG 404s, swap to the colored fallback so the
                        // UI is never visually empty.
                        const el = e.currentTarget;
                        if (!el.dataset.fallback) {
                          el.dataset.fallback = '1';
                          el.style.display = 'none';
                          const parent = el.parentElement;
                          if (parent && !parent.querySelector('.fallback-tile')) {
                            const fb = document.createElement('div');
                            fb.className = 'fallback-tile h-24 w-full flex items-center justify-center text-xs font-bold';
                            fb.style.backgroundColor = t.palette.bg;
                            fb.style.color = t.palette.text;
                            fb.textContent = t.label;
                            parent.appendChild(fb);
                          }
                        }
                      }}
                    />
                    {/* Per-tile uploading overlay */}
                    {isUploadingThis && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
                      </div>
                    )}
                    {/* Just-uploaded confirmation overlay */}
                    {justUploaded && !isUploadingThis && (
                      <div className="absolute inset-0 bg-emerald-50/80 flex items-center justify-center">
                        <div className="bg-emerald-500 text-white rounded-full p-2">
                          <Check className="w-5 h-5" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-2 text-xs font-bold text-slate-700 flex flex-col gap-0.5">
                    <span className="flex items-center gap-1">
                      {t.label}
                      {t.isPremium && <Crown className="w-3 h-3 text-amber-500" />}
                      {t.isCustom && (
                        <span className="text-[9px] font-normal text-emerald-600 ml-1" title="已自訂上傳">
                          自訂
                        </span>
                      )}
                    </span>
                    {/* 2026-07-03 — admin can see the source dimensions + format of
                        their uploaded design. Helps when iterating in a graphics
                        editor (e.g. "should I export at 600×800 instead of 343×361?").
                        Shows nothing for the bundled fallback templates. */}
                    {t.isCustom && (t.sourceFormat || t.sourceDimensions) && (
                      <span className="text-[9px] font-normal text-slate-400 leading-tight">
                        {t.sourceDimensions
                          ? `${t.sourceDimensions.width}×${t.sourceDimensions.height}`
                          : '?'}
                        {' '}
                        {t.sourceFormat ? t.sourceFormat.toUpperCase() : ''}
                      </span>
                    )}
                  </div>
                </button>
                {/* Admin-only edit button (rendered ABOVE the click target so it
                    doesn't accidentally trigger the tile's select handler). */}
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        tileInputRefs.current[t.id]?.click();
                      }}
                      disabled={isUploading || isUploadingThis}
                      title="更換此模板的 SVG"
                      className="absolute top-2 right-2 bg-white/90 hover:bg-white text-slate-600 hover:text-rose-600 rounded-full p-1.5 shadow-sm border border-slate-200 transition-colors disabled:opacity-40"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <input
                      ref={(el) => { tileInputRefs.current[t.id] = el; }}
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,.svg,.png,.jpg,.jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        handleTileUpload(t.id, f);
                        // Reset so the same file can be re-picked.
                        e.target.value = '';
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-6">
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
          <Upload className="w-4 h-4" /> 上傳自家背景
          {ownerTier !== 'premium' && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <Crown className="w-3 h-3" /> Premium
            </span>
          )}
        </h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (ownerTier !== 'premium') {
              onPremiumRequired();
              return;
            }
            onUpload(f);
          }}
        />
        <button
          onClick={() => {
            if (ownerTier !== 'premium') {
              onPremiumRequired();
              return;
            }
            fileInputRef.current?.click();
          }}
          disabled={isUploading}
          className="w-full p-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-rose-400 hover:bg-rose-50 font-bold transition-colors"
        >
          {isUploading ? '上載中…' : bgUrl ? '✓ 已上傳（按此更換）' : '📤 點擊上傳 JPG / PNG / WebP'}
        </button>
        {bgUrl && (
          <div className="mt-3">
            <img src={bgUrl} alt="custom background" className="rounded-xl max-h-32 mx-auto" />
          </div>
        )}
      </div>
    </div>
  );
}

// 2026-08-14 — EditableField is the building block for the four
// invitation-metadata overrides. Click the text → it becomes an
// input; blur or Enter saves; Esc cancels. The original (event.*)
// value is shown as a placeholder/hint when the field is empty,
// so users see what they're overriding.
function EditableField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  inputClass = '',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const commit = () => {
    onChange(draft);
    setEditing(false);
  };
  // Keep draft in sync if value changes from above (e.g. loaded async)
  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);
  return (
    <div className="flex items-baseline gap-2">
      <strong className="shrink-0 w-12 text-slate-700">{label}</strong>
      {editing ? (
        <input
          type={type}
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(value || '');
              setEditing(false);
            }
          }}
          className={`flex-1 px-2 py-1 border border-rose-300 rounded outline-none focus:border-rose-500 text-sm ${inputClass}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 text-left px-2 py-1 -mx-2 rounded hover:bg-rose-50 text-slate-800 hover:text-rose-700 transition-colors text-sm group flex items-center gap-1.5"
          title={hint || '點擊修改'}
        >
          {value || <span className="text-slate-400 italic">{placeholder || '—'}</span>}
          <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-50 text-rose-400 shrink-0" />
        </button>
      )}
    </div>
  );
}

function InfoStep({ ownerMessage, setOwnerMessage, event, overrides, setOverrides }) {
  // Build a setter per field — keeps the override state immutable
  // and lets EditableField stay generic.
  const setOverride = (key) => (val) =>
    setOverrides((prev) => ({ ...prev, [key]: val }));
  return (
    <div className="p-6 space-y-5">
      <h3 className="font-bold text-slate-800">婚禮資料（自動從活動填入，可修改）</h3>
      <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
        <p className="flex items-baseline gap-2">
          <strong className="shrink-0 w-12 text-slate-700">名稱：</strong>
          <span className="flex-1 px-2 py-1 -mx-2 text-slate-800 text-sm">
            {event?.name || '婚禮晚宴'}
          </span>
        </p>
        <EditableField
          label="日期："
          value={overrides.date}
          onChange={setOverride('date')}
          placeholder={event?.date || 'YYYY-MM-DD'}
          type="date"
          inputClass="font-mono"
          hint="點擊改日期（只影響呢封電子喜帖）"
        />
        <EditableField
          label="時間："
          value={overrides.time}
          onChange={setOverride('time')}
          placeholder={event?.time || 'HH:MM'}
          type="time"
          inputClass="font-mono"
          hint="點擊改時間（只影響呢封電子喜帖）"
        />
        <EditableField
          label="場地："
          value={overrides.venue}
          onChange={setOverride('venue')}
          placeholder={event?.venue || '例：四季酒店'}
          hint="點擊改場地（只影響呢封電子喜帖）"
        />
        <EditableField
          label="地址："
          value={overrides.address}
          onChange={setOverride('address')}
          placeholder={event?.address || '例：香港中環…'}
          hint="點擊改地址（只影響呢封電子喜帖）"
        />
      </div>
      <p className="text-xs text-slate-500">
        上面四個欄位嘅覆寫只影響呢封電子喜帖，唔會改活動設定。
      </p>

      {/* Wording templates — pick a starting point, then edit freely below */}
      <div>
        <label className="block font-bold text-slate-800 mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-rose-500" /> 心意範本（揀一個再改都得）
        </label>
        {(!WORDING_TEMPLATES || WORDING_TEMPLATES.length === 0) ? (
          <div className="text-xs text-slate-400 italic p-3 bg-slate-50 rounded-xl">
            範本載入中...如果長時間空白,請 refresh 頁面。
          </div>
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {WORDING_TEMPLATES.map((w) => {
            const isSelected = ownerMessage === w.text;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setOwnerMessage(w.text.slice(0, 200))}
                className={`text-left p-3 rounded-xl border-2 transition-all bg-white ${
                  isSelected
                    ? 'border-rose-500 ring-2 ring-rose-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <span className="text-base">{w.icon}</span>
                  {w.label}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 line-clamp-2 leading-snug">
                  {w.text}
                </p>
              </button>
            );
          })}
        </div>
        )}
      </div>

      <div>
        <label className="block font-bold text-slate-800 mb-2">個人訊息（會出現在電子喜帖同 email 入面）</label>
        <textarea
          value={ownerMessage}
          onChange={(e) => setOwnerMessage(e.target.value.slice(0, 200))}
          maxLength={200}
          rows={3}
          placeholder="例：誠意邀請您蒞臨見證我哋嘅大日子…"
          className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:border-rose-500"
        />
        <p className="text-xs text-slate-400 mt-1 text-right">{ownerMessage.length}/200</p>
      </div>
    </div>
  );
}

function GuestsStep({ guests, selectedGuestIds, setSelectedGuestIds, previewGuest, setPreviewGuestId }) {
  // Household-aware filtering: only show top-level rows (parents + singles).
  // Children are auto-included via their parent's selection.
  const memberCount = (parent) =>
    guests.filter((g) => g.householdId === parent.guestId && g.id !== parent.id).length;

  const topLevel = guests.filter((g) => {
    // Skip children — only their parent shows in the list
    if (g.householdId && g.householdId !== g.guestId && !g.isHouseholdParent) {
      const parentExists = guests.some(
        (p) => p.guestId === g.householdId && p.isHouseholdParent,
      );
      if (parentExists) return false; // hide — shown under parent
    }
    return true;
  });
  const withEmail = topLevel.filter((g) => g.email);

  const toggle = (g) => {
    const ids = g.isHouseholdParent
      ? // Selecting a parent = select all members too
        [g.guestId, ...guests.filter((m) => m.householdId === g.guestId && m.id !== g.id).map((m) => m.guestId)]
      : [g.guestId];
    setSelectedGuestIds((prev) => {
      const has = ids.every((id) => prev.includes(id));
      if (has) return prev.filter((x) => !ids.includes(x));
      return [...prev, ...ids.filter((id) => !prev.includes(id))];
    });
  };

  const isSelected = (g) => {
    if (g.isHouseholdParent) {
      return selectedGuestIds.includes(g.guestId);
    }
    return selectedGuestIds.includes(g.guestId);
  };

  const totalSelected = selectedGuestIds.length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-slate-800">揀要寄出嘅嘉賓</h3>
        <button
          onClick={() => setSelectedGuestIds(withEmail.map((g) => g.guestId))}
          className="text-xs px-3 py-1 bg-rose-100 text-rose-700 rounded-full font-bold"
        >
          全選有 email
        </button>
      </div>

      {withEmail.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          名單入面冇任何嘉賓有 email。請先喺嘉賓名單加入 email。
        </div>
      )}

      <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
        {withEmail.map((g) => {
          const members = g.isHouseholdParent ? memberCount(g) : 0;
          const isParent = g.isHouseholdParent && members > 0;
          return (
            <label key={g.guestId} className={`flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer ${isParent ? 'bg-rose-50/30' : ''}`}>
              <input
                type="checkbox"
                checked={isSelected(g)}
                onChange={() => toggle(g)}
                className="w-4 h-4 accent-rose-500"
              />
              <div className="flex-1">
                <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  {isParent && <span>👨‍👩‍👧</span>}
                  {g.name}
                  {isParent && (
                    <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">
                      {members + 1}人
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">{g.email}</p>
                {isParent && (
                  <p className="text-[10px] text-rose-500 mt-0.5">一個家庭一封 email，每位成員獨立 QR Code</p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setPreviewGuestId(g.guestId); }}
                className={`text-xs px-2 py-1 rounded ${
                  previewGuest?.guestId === g.guestId ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                預覽
              </button>
            </label>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        已揀 <strong>{totalSelected}</strong> 位（{withEmail.filter((g) => g.isHouseholdParent).length} 個家庭，
        {withEmail.filter((g) => !g.isHouseholdParent).length} 位單人）· 預覽：<strong>{previewGuest?.name || '—'}</strong>
      </p>
    </div>
  );
}

function SendButton({ ownerUid, eventId, invitationId, guestIds, customMessage, sending, setSending, onSent }) {
  const handleSend = async () => {
    if (guestIds.length === 0) {
      alert('請至少揀一位嘉賓');
      return;
    }
    setSending(true);
    try {
      // 2026-07-22 — Vercel proxy bypasses Cloud Run CORS preflight.
      const result = await callFirebaseFn('sendInvitationsV2', {
        eventId,
        invitationId,
        guestIds,
        customMessage,
      });
      const sentCount = result.data.sent.filter((s) => s.status === 'sent').length;
      const skipped = result.data.sent.filter((s) => s.status === 'skipped').length;
      alert(
        result.data.dryRun
          ? `🔧 DRY RUN：模擬寄出 ${result.data.sent.length} 封（未設定 SMTP，未真正寄出）。請到 Firebase Console 設定 SMTP secrets。`
          : `✅ 已寄出 ${sentCount} 封${skipped ? `，${skipped} 位無 email 已跳過` : ''}`
      );
      onSent(result.data);
    } catch (err) {
      // Firebase callable wraps real errors — surface code + details, not just `message`
      // (which is often the placeholder string "INTERNAL").
      const code = err?.code || 'UNKNOWN';
      const detail = err?.details?.message || err?.details || err?.message || String(err);
      const serverMsg = err?.details?.sent
        ? `\n\n伺服器回傳 ${err.details.sent.length} 筆結果：\n` +
          err.details.sent
            .map((s) => `  • ${s.email}: ${s.status}${s.reason ? ' (' + s.reason + ')' : ''}`)
            .join('\n')
        : '';
      alert(
        '寄出失敗\n' +
          `code: ${code}\n` +
          `message: ${detail}` +
          serverMsg
      );
      console.error('[sendInvitations]', { code, detail, full: err });
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleSend}
      disabled={sending || guestIds.length === 0}
      className="px-5 py-2.5 text-white bg-rose-600 hover:bg-rose-700 rounded-xl font-bold disabled:opacity-50 flex items-center gap-2"
    >
      <Send className="w-4 h-4" />
      {sending ? '寄出中…' : `寄出 ${guestIds.length} 封電子喜帖`}
    </button>
  );
}