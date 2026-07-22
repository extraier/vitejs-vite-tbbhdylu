import { useState } from 'react';
import { X, Mail } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions, auth } from '../../lib/firebase';

// 2026-07-22 — Calling sendInvitationsV2 via the default
// `functions` singleton (us-central1) instead of a region-
// specific instance. Reason: Firebase 10.x's region-specific
// Functions instances (`getFunctions(app, 'asia-east2')`)
// sometimes send requests with empty Authorization headers
// when the auth state was set after the module loaded, causing
// the server to return "The request was not authenticated".
//
// `sendInvitationsV2` is ACTIVE in both us-central1 and
// asia-east2 (Firebase CLI created both during earlier failed
// deploys). Using us-central1 via the default `functions`
// singleton avoids the auth-attach bug. See
// functions/src/invitations.ts:105 for the full story.

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
      // 2026-07-22 — Calling sendInvitationsV2 via the default
      // `functions` singleton (us-central1). Using the default
      // region avoids the region-specific instance's auth-attach
      // bug. The function exists in both us-central1 and
      // asia-east2; both are ACTIVE.
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
            eventId: currentEventId,
            invitationId,
            guestIds: [guest.guestId],
            customMessage: '',
          }, { headers: { Authorization: 'Bearer ' + currentToken } })
        : await fn({
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
