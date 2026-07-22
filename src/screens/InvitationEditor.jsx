import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { X, Mail, Image as ImageIcon, Send, Upload, Crown, Sparkles, Edit2, Check, Loader2 } from 'lucide-react';
import {
  INVITATION_TEMPLATES,
  WORDING_TEMPLATES,
  loadLiveTemplates,
} from '../components/invitation/templates';
import { InvitationCard } from '../components/invitation/InvitationCard';
import { UpgradeModal } from '../components/modals/UpgradeModal';
import { db, functions, auth, appId } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

// 2026-07-22 — Calling sendInvitationsV2 via the default
// `functions` singleton (us-central1) instead of a region-
// specific instance. The region-specific instance sends
// requests with empty Authorization headers under Firebase
// 10.x, breaking auth. See QrCodeModal.jsx for full notes.

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
  onClose,
  onSent,
}) {
  const [step, setStep] = useState(0);
  const invitationId = 'default';  // one invitation doc per (owner, event) for now
  const [templateId, setTemplateId] = useState('plain');
  const [bgUrl, setBgUrl] = useState(null);
  const [ownerMessage, setOwnerMessage] = useState('');
  const [selectedGuestIds, setSelectedGuestIds] = useState([]);
  const [showUpgrade, setShowUpgrade] = useState(false);
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
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('[InvitationEditor] autosave failed:', err);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [templateId, bgUrl, ownerMessage, isOpen, ownerUid, invitationId]);

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

  const handleBgUpload = async (file) => {
    if (ownerTier !== 'premium') {
      setShowUpgrade(true);
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('vendorId', ownerUid);
      fd.append('file', file);
      const res = await fetch('https://cdn.savetheday.io/upload?kind=inv-bg', {
        method: 'POST',
        headers: { 'X-Upload-Token': 'PLACEHOLDER_FIXED_BY_TASK_10' },
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
              onPremiumRequired={() => setShowUpgrade(true)}
            />
          )}
          {step === 1 && (
            <InfoStep ownerMessage={ownerMessage} setOwnerMessage={setOwnerMessage} event={event} />
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
              event={event}
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

      <UpgradeModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onConfirm={() => {
          setShowUpgrade(false);
          alert('感謝支持！Premium 功能稍後正式開通，現可繼續使用免費模板。');
        }}
      />
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

function InfoStep({ ownerMessage, setOwnerMessage, event }) {
  return (
    <div className="p-6 space-y-5">
      <h3 className="font-bold text-slate-800">婚禮資料（自動從活動填入，可修改）</h3>
      <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-sm">
        <p><strong>名稱：</strong> {event?.name || '婚禮晚宴'}</p>
        <p><strong>日期：</strong> {event?.date || '—'} {event?.time && `· ${event.time}`}</p>
        <p><strong>場地：</strong> {event?.venue || '—'}</p>
        <p><strong>地址：</strong> {event?.address || '—'}</p>
      </div>
      <p className="text-xs text-slate-500">
        想改呢啲資料？去「活動設定」頁改完再返嚟。
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
      // 2026-07-22 — Calling sendInvitationsV2 via the default
      // `functions` singleton (us-central1). The default region
      // attaches auth properly; region-specific instances don't
      // in Firebase 10.x. See QrCodeModal.jsx for full notes.
      //
      // 2026-07-22b — Force the auth token to be attached.
      // Firebase 10.x's httpsCallable() sometimes sends requests
      // with empty Authorization headers (server returns "The
      // request was not authenticated"). The explicit token
      // getter + manual header sidesteps this bug.
      const currentToken = await auth.currentUser?.getIdToken();
      const fn = httpsCallable(functions, 'sendInvitationsV2');
      const result = currentToken
        ? await fn({
            eventId,
            invitationId,
            guestIds,
            customMessage,
          }, { headers: { Authorization: 'Bearer ' + currentToken } })
        : await fn({ eventId, invitationId, guestIds, customMessage });
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