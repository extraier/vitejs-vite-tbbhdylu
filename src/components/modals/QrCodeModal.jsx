import { useState } from 'react';
import { X, Mail } from 'lucide-react';
import {
  doc,
  setDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { callFirebaseFn } from '../../lib/firebaseFn';
import { buildInvitationQr } from '../../lib/invitationQr';
import { buildQrRegenerationUpdate } from '../../lib/qrRegeneration';

// 2026-08-25 — Manus P10: this modal now takes the canonical
// owner UID explicitly from App.jsx (dataOwnerUid), so a
// co-owner who opens the QR for a guest still encodes the
// wedding's *primary* owner, not their own signed-in UID. The
// modal no longer reads window.__ownerUid — the global is
// preserved for the guest-portal EntryPassCard fallback only.

const appId = auth?.app?.options?.appId
  || (typeof window !== 'undefined' && window.__firebaseAppId)
  || 'savetheday';

export function QrCodeModal({
  guest,
  ownerUid,
  eventId,
  eventName,
  ownerLabel,
  onClose,
  onCopy,
}) {
  const [sendingEmail, setSendingEmail] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratedAt, setRegeneratedAt] = useState(null);

  if (!guest) return null;

  const hostUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : '';

  const {
    shareUrl,
    qrCodeImgUrl,
    hasCanonicalContext,
    canonicalOwnerUid,
    canonicalEventId,
    canonicalGuestId,
  } = buildInvitationQr({
    hostUrl,
    ownerUid,
    eventId,
    guestId: guest.guestId,
  });

  const invitationId = 'default';

  const handleSendEmail = async () => {
    if (!hasCanonicalContext) {
      // 2026-08-25 — P10: refuse to write an invitation under the
      // wrong owner namespace. Without this guard, a co-owner
      // could create an invitation doc under their own UID and
      // the email would still encode a wrong-owner QR.
      alert('未能確認此 QR Code 所屬婚禮。請返回賓客名單，重新選擇活動後再試。');
      return;
    }
    if (!guest.email) {
      alert('此嘉賓未有電郵地址。請先喺 嘉賓名單 補回 email 然後再寄。');
      return;
    }
    setSendingEmail(true);
    try {
      // Ensure the invitation doc exists before calling sendInvitations
      // (autosave only fires on edit; first-send was failing previously)
      const ref = doc(
        db,
        'artifacts',
        appId,
        'users',
        canonicalOwnerUid,
        'invitations',
        invitationId,
      );
      await setDoc(
        ref,
        {
          templateId: 'plain',
          bgUrl: null,
          ownerMessage: '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      // 2026-07-22 — Using Vercel proxy (callFirebaseFn above)
      // to bypass Cloud Run CORS preflight rejection.
      const result = await callFirebaseFn('sendInvitationsV2', {
        eventId: canonicalEventId,
        invitationId,
        guestIds: [guest.guestId],
        customMessage: '',
      });
      const sent = result.data?.sent || [];
      const ok = sent.find((s) => s.status === 'sent');
      const skipped = sent.find((s) => s.status === 'skipped');
      if (ok) {
        alert(`✅ 已寄出電子喜帖到 ${guest.email}`);
      } else if (skipped) {
        alert(`⚠️ 跳過：${skipped.reason || '未設定 SMTP / 電郵地址無效'}`);
      } else if (result.data?.dryRun) {
        alert('🔧 DRY RUN：模擬寄出，未真正寄出。請到 Firebase Console 設定 SMTP secrets。');
      } else {
        alert('⚠️ 寄出失敗，請稍後再試。');
      }
    } catch (err) {
      const code = err?.code || 'UNKNOWN';
      const detail = err?.details?.message || err?.details || err?.message || String(err);
      alert('寄出失敗\ncode: ' + code + '\nmessage: ' + detail);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleRegenerateQr = async () => {
    if (!hasCanonicalContext) {
      alert('未能確認此 QR Code 所屬婚禮。請返回賓客名單後重試。');
      return;
    }

    const confirmed = window.confirm(
      '這會重新產生此賓客的正確 QR Code。請將新連結重新傳送或列印；之前由非主理人產生的 QR Code 可能無法在接待處使用。是否繼續？',
    );
    if (!confirmed) return;

    setRegenerating(true);
    try {
      const update = buildQrRegenerationUpdate({
        canonicalOwnerUid,
        canonicalEventId,
        guestDocId: guest.id || guest.guestId,
        regeneratorUid: auth?.currentUser?.uid || null,
      });
      if (!update.ready) {
        throw new Error(`QR regeneration not ready: ${update.reason}`);
      }

      // Build the real Firestore reference (path was templated
      // with {appId} for clarity in tests/logs).
      const guestRef = doc(
        db,
        'artifacts',
        appId,
        'users',
        canonicalOwnerUid,
        'events',
        canonicalEventId,
        'guests',
        guest.id || guest.guestId,
      );
      await updateDoc(guestRef, {
        qrRegeneratedAt: serverTimestamp(),
        qrRegeneratedByUid: auth?.currentUser?.uid || null,
        qrCanonicalOwnerUid: canonicalOwnerUid,
        qrCanonicalEventId: canonicalEventId,
      });
      setRegeneratedAt(new Date());
      alert('✅ 已重新產生正確 QR Code。請複製新連結、重新寄出電子喜帖，或下載後重新列印。');
    } catch (error) {
      console.error('[QrCodeModal] QR regeneration audit write failed:', error);
      alert('未能記錄 QR Code 更新。請稍後再試。');
    } finally {
      setRegenerating(false);
    }
  };

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

        {/* 2026-08-25 — P10: surface the canonical owner/event that
            the reception desk will validate against. This block
            is shown in authenticated owner/co-owner contexts only. */}
        <div className="my-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left">
          <p className="text-xs font-black uppercase tracking-wide text-indigo-700">
            接待處驗證資料
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">
            婚禮：{eventName || '未命名活動'}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            資料擁有人：{ownerLabel || '此婚禮資料擁有人'}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
            Owner ID: {canonicalOwnerUid || '未載入'}
          </p>
          <p className="break-all font-mono text-[11px] text-slate-500">
            Event ID: {canonicalEventId || '未載入'}
          </p>
        </div>

        {!hasCanonicalContext && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700"
          >
            無法確認此 QR Code 的婚禮資料。為避免接待處掃描失敗，請關閉此視窗、重新選擇活動後再試。
          </div>
        )}

        {hasCanonicalContext ? (
          <div className="bg-indigo-50 p-6 rounded-3xl border-2 border-indigo-100 my-6 inline-block">
            <img
              src={qrCodeImgUrl}
              className="w-48 h-48 mx-auto rounded-xl"
              alt={`${guest.name || '賓客'} 的婚禮入場 QR Code`}
            />
          </div>
        ) : null}

        <p className="text-slate-500 mb-3">
          親愛的 <strong>{guest.name}</strong>，憑此 QR Code 入場。
        </p>

        {canonicalGuestId ? (
          <p className="text-[10px] text-slate-400 break-all mb-6 bg-slate-50 p-2 rounded">
            {shareUrl}
          </p>
        ) : null}

        {/* 2026-08-25 — P10: regenerate action. Writes the four
            QR audit fields under the canonical owner/event path.
            Reception/helper users must never see this button; it
            is only mounted in the owner/co-owner flow. */}
        <button
          type="button"
          onClick={handleRegenerateQr}
          disabled={regenerating || !hasCanonicalContext}
          className="w-full mb-2 border border-amber-300 bg-amber-50 text-amber-900 font-bold py-3 rounded-xl hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {regenerating ? '正在重新產生…' : '🔄 重新產生並重新分享 QR Code'}
        </button>

        {regeneratedAt && (
          <p
            className="mb-3 text-xs font-medium text-emerald-700"
            role="status"
          >
            已於 {regeneratedAt.toLocaleString('zh-HK')} 產生正確 QR Code。
          </p>
        )}

        {/* Action buttons: Email + Copy/WhatsApp */}
        <button
          onClick={handleSendEmail}
          disabled={sendingEmail || !guest.email || !hasCanonicalContext}
          className="w-full mb-2 bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            !hasCanonicalContext
              ? '尚未確認婚禮資料'
              : !guest.email
                ? '此嘉賓無電郵地址'
                : '寄出電子喜帖'
          }
        >
          <Mail className="w-4 h-4" />
          {sendingEmail ? '寄送中…' : '📧 寄出電子喜帖'}
        </button>
        <button
          onClick={() => onCopy(shareUrl)}
          disabled={!hasCanonicalContext}
          className="w-full bg-indigo-500 text-white font-bold py-3 rounded-xl hover:bg-indigo-600 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          複製專屬連結 (WhatsApp 發送)
        </button>
      </div>
    </div>
  );
}