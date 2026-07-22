import { useState } from 'react';
import { X, Mail } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, app, appId } from '../../lib/firebase';

// 2026-07-22 — Cache the asia-east2 functions instance at module
// level. Previously we called `httpsCallable(getFunctions('asia-east2'), ...)`
// on every send, which Firebase 10.x handles inconsistently — the
// internal provider cache can return undefined for `getProvider()`
// when the same app gets both default and region-specific instances,
// surfacing as `code: UNKNOWN, message: Cannot read properties of
// undefined (reading 'getProvider')`.
//
// Module-level singleton sidesteps the issue: same Functions
// instance returned every time.
const functionsAsiaEast2 = getFunctions(app, 'asia-east2');

export function QrCodeModal({
  guest,
  eventId,
  eventName,
  onClose,
  onCopy,
}) {
  const [sendingEmail, setSendingEmail] = useState(false);
  if (!guest) return null;

  const hostUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : '';
  const ownerUid = window.__ownerUid || '';
  const currentEventId = eventId || window.__currentEventId || '';
  const invitationId = 'default';
  const shareUrl = `${hostUrl}/?o=${ownerUid}&e=${currentEventId}&g=${guest.guestId}`;
  const qrCodeImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(shareUrl)}&color=312e81`;

  const handleSendEmail = async () => {
    if (!guest.email) {
      alert('此嘉賓未有電郵地址。請先喺 嘉賓名單 補回 email 然後再寄。');
      return;
    }
    setSendingEmail(true);
    try {
      // Ensure the invitation doc exists before calling sendInvitations
      // (autosave only fires on edit; first-send was failing previously)
      const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'invitations', invitationId);
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
      // 2026-07-22 — Calling sendInvitationsV2 in asia-east2
      // instead of sendInvitations (us-central1) to bypass a
      // stuck 409 on the original function resource. See
      // functions/src/invitations.ts:105 for the full story.
      // Uses a cached module-level Functions instance to avoid
      // Firebase 10.x's `getProvider` undefined bug.
      const fn = httpsCallable(functionsAsiaEast2, 'sendInvitationsV2');
      const result = await fn({
        eventId: currentEventId,
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
        {/* Action buttons: Email + Copy/WhatsApp */}
        <button
          onClick={handleSendEmail}
          disabled={sendingEmail || !guest.email}
          className="w-full mb-2 bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={!guest.email ? '此嘉賓無電郵地址' : '寄出電子喜帖'}
        >
          <Mail className="w-4 h-4" />
          {sendingEmail ? '寄送中…' : '📧 寄出電子喜帖'}
        </button>
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
