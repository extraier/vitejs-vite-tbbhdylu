import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { X, Mail, Image as ImageIcon, Send, Upload, Crown, Sparkles } from 'lucide-react';
import { INVITATION_TEMPLATES } from '../components/invitation/templates';
import { InvitationCard } from '../components/invitation/InvitationCard';
import { UpgradeModal } from '../components/modals/UpgradeModal';
import { db, appId } from '../lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';

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

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-rose-50 to-pink-50">
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === 0 && (
            <BackgroundStep
              templateId={templateId}
              setTemplateId={setTemplateId}
              bgUrl={bgUrl}
              setBgUrl={setBgUrl}
              onUpload={handleBgUpload}
              isUploading={isUploading}
              fileInputRef={fileInputRef}
              ownerTier={ownerTier}
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

        {/* Live preview pane (always visible) */}
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
        <div className="p-4 border-t border-slate-200 flex justify-between">
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
  );
}

function BackgroundStep({ templateId, setTemplateId, bgUrl, setBgUrl, onUpload, isUploading, fileInputRef, ownerTier, onPremiumRequired }) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
          <ImageIcon className="w-4 h-4" /> 揀一個模板
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {INVITATION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTemplateId(t.id); setBgUrl(null); }}
              className={`relative rounded-xl border-2 overflow-hidden text-left transition-all ${
                templateId === t.id ? 'border-rose-500 ring-2 ring-rose-200' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div
                className="h-24 flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: t.palette.bg, color: t.palette.text }}
              >
                {t.label}
              </div>
              <div className="p-2 text-xs font-bold text-slate-700 flex justify-between items-center">
                {t.label}
                {t.isPremium && <Crown className="w-3 h-3 text-amber-500" />}
              </div>
            </button>
          ))}
        </div>
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
    <div className="p-6 space-y-4">
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
      const fn = httpsCallable(getFunctions(), 'sendInvitations');
      const result = await fn({ eventId, invitationId, guestIds, customMessage });
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