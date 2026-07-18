// HelperManager — owner-facing UI to invite, configure, and revoke helpers
// (兄弟姊妹).
//
// Renders as a modal. Owner enters an email, picks permissions, generates an
// invite. Pending invites show until the helper accepts (signs up + accepts).
//
// Active helpers show their current perms inline with toggles. Revoke kills
// access immediately (rules check status == 'active').

import { useEffect, useState } from 'react';
import { X, UserPlus, Users, Mail, Trash2, Check, RefreshCw, Clock, ChevronRight } from 'lucide-react';
import { collection, query, onSnapshot, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { sendSignInLinkToEmail } from 'firebase/auth';
import { db, appId, auth } from '../../lib/firebase';
import {
  helpersApi,
  defaultHelperPerms,
  HELPER_PERMS,
  HELPER_PERM_LABELS,
} from '../../lib/helpers';

export function HelperManager({ ownerUid, onClose }) {
  const [activeTab, setActiveTab] = useState('active');
    const [helpers, setHelpers] = useState([]);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');
    const [invitePerms, setInvitePerms] = useState(defaultHelperPerms());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    // 2026-07-18 — Copy-link state. Set when an email-send
    // fails so the owner can still share the signup URL
    // manually. Rendered as a code block + 複製連結 button under
    // the error prose. Lives separately from `error` so the
    // prose doesn't have to embed the URL twice.
    const [copyLink, setCopyLink] = useState(null);

  // 2026-07-17 — Subscribe to BOTH /helpers and /pendingInvites in
  // parallel. We need both because:
  //   - /helpers/{uid}            : invite to a registered email
  //                                 (or after acceptHelperInvite)
  //   - /pendingInvites/{email}   : invite to an email that hasn't
  //                                 registered yet
  // The "待接受" tab merges the two so the owner sees ALL invites
  // regardless of which subcollection they live in.
  useEffect(() => {
    if (!ownerUid) return undefined;

    setError(null);

    const helpersQ = query(
      collection(db, 'artifacts', appId, 'users', ownerUid, 'helpers'),
      orderBy('invitedAt', 'desc'),
    );
    const pendingQ = query(
      collection(db, 'artifacts', appId, 'users', ownerUid, 'pendingInvites'),
      orderBy('invitedAt', 'desc'),
    );

    let activeHelpers = [];
    let pendingFromHelpers = [];
    let pendingFromEmails = [];

    const recompute = () => {
      // 'invited' status on /helpers = registered email still pending
      // 'invited' status on /pendingInvites = email-only invite
      const pending = [
        ...pendingFromEmails.map((p) => ({
          ...p,
          _src: 'pendingInvites',
        })),
        ...pendingFromHelpers.map((p) => ({
          ...p,
          _src: 'helpers',
        })),
      ];
      setHelpers(activeHelpers);
      setPendingInvites(pending);
    };

    const unsubHelpers = onSnapshot(
      helpersQ,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        activeHelpers = all.filter((h) => h.status === 'active');
        pendingFromHelpers = all.filter((h) => h.status === 'invited');
        recompute();
      },
      (err) => setError(err.message),
    );

    const unsubPending = onSnapshot(
      pendingQ,
      (snap) => {
        // 2026-07-17 — pendingInvites docs are immediately 'invited'
        // by construction (the inviteHelper function sets it on
        // write). We surface them all to the pending list, sorted
        // by invitedAt descending.
        pendingFromEmails = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recompute();
      },
      (err) => {
        // Soft-fail — pendingInvites might not yet exist, that's OK
        // (no pending email invites means nothing to show).
        // eslint-disable-next-line no-console
        console.warn('pendingInvites subscribe failed:', err?.message);
        pendingFromEmails = [];
        recompute();
      },
    );

    return () => {
      unsubHelpers();
      unsubPending();
    };
  }, [ownerUid]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;
    setBusy(true);
    setError(null);
    setCopyLink(null);  // 2026-07-18 — clear stale copy-link on retry
    try {
      // 2026-07-18 — Step 1: invoke the cloud function, which writes
      // the placeholder doc. CF returns { ok, helperUid, pendingEmailRegistration }.
      // When pendingEmailRegistration === true, the invitee has never
      // signed up — which is when we want to send the magic-link email.
      const inviteRes = await helpersApi.invite({
        email: inviteEmail.trim().toLowerCase(),
        displayName: inviteName.trim(),
        perms: invitePerms,
      });
      // 2026-07-18 — Step 2: dispatch the passwordless sign-in email.
      // We use Firebase Auth's built-in delivery (no third-party
      // email service needed) so the helper receives a real email
      // containing a one-time signed link that auto-signs-them-in
      // when they click it. The link lands on
      // `https://savetheday.io/?__heroinvite=1` (see useAuth below).
      //
      // We persist the email locally so the AuthScreen useEffect can
      // call signInWithEmailLink(email, link) without prompting the
      // helper to re-enter the address — otherwise the link click
      // would only land them on a blank screen.
      if (inviteRes?.pendingEmailRegistration) {
        // 2026-07-18 — Try the rich SMTP email FIRST. The new
        // sendHelperInviteEmail cloud function renders a branded
        // Traditional-Chinese HTML template (rose gradient hero,
        // couple's name in From, etc.) and sends via the same
        // Nodemailer envelope as the e-card flow.
        //
        // We still want the client-side sendSignInLinkToEmail as
        // a safety net — that call works even when SMTP_URL is
        // unset (delivered through Firebase's built-in templates),
        // so the existing UX is preserved if the rich path fails
        // for any reason (network, CF cold-start, permission, etc).
        let richEmailOk = false;
        let richEmailError = null;
        try {
          const smtpRes = await helpersApi.sendInviteEmail({
            ownerUid,
            helperEmail: inviteEmail.trim().toLowerCase(),
            helperDisplayName: inviteName.trim(),
            role: 'wedding helper',
          });
          if (smtpRes?.sent) {
            // Rich email delivered via SMTP — we're done. No need to
            // call sendSignInLinkToEmail; the magic link inside the
            // rich HTML is the same shape and will land on the same
            // `?__heroinvite=1` URL.
            richEmailOk = true;
            window.localStorage.setItem(
              '__heroinvite_email',
              inviteEmail.trim().toLowerCase(),
            );
            setError('📧 精美電郵已發送。對方點擊連結即可加入。');
            setCopyLink(null);
          } else if (smtpRes?.dryRun && smtpRes?.magicLinkUrl) {
            setCopyLink(smtpRes.magicLinkUrl);
            richEmailError = 'SMTP_URL not configured on server (dryRun)';
          } else if (smtpRes?.error) {
            richEmailError = `CF returned error: ${smtpRes.error}`;
          }
        } catch (smtpErr) {
          // 2026-07-18 — SMTP path failed. Keep both the console
          // warning (so DevTools shows it) AND a user-visible
          // error banner so we can diagnose the next attempt.
          // eslint-disable-next-line no-console
          console.warn('[HelperManager] rich SMTP email failed, falling back to Firebase Auth email link:', smtpErr);
          richEmailError = smtpErr?.message || String(smtpErr);
        }

        if (richEmailError) {
          console.error('[HelperManager] SMTP path diagnostic:', richEmailError);
        }

        if (!richEmailOk) {
        try {
          await sendSignInLinkToEmail(
            auth,
            inviteEmail.trim().toLowerCase(),
            {
              url: 'https://savetheday.io/?__heroinvite=1',
              // 2026-07-18 — DO NOT pass `handleCodeInApp: false`.
              // Firebase REQUIRES `handleCodeInApp: true` for
              // sendSignInLinkToEmail, even if it feels weird —
              // the email link IS the "in-app" link because it
              // sends the helper back to savetheday.io. Passing
              // `false` here is silently asserted by the JS SDK
              // and throws `auth/argument-error` with no
              // helpful message. Always `true`.
              // See node_modules/firebase/firebase-auth-compat.js:
              //   G(r.handleCodeInApp, n, "argument-error")
              handleCodeInApp: true,
            },
          );
          // localStorage flag is read by the AuthScreen useEffect
          // (mounted on https://savetheday.io/?__heroinvite=1) to
          // know which email to apply the link to.
          window.localStorage.setItem(
            '__heroinvite_email',
            inviteEmail.trim().toLowerCase(),
          );
          // 2026-07-18 — Distinguish the two paths in the success
          // message so the owner knows which one delivered. If the
          // SMTP path above already set a copyLink for dryRun mode,
          // it's still rendered underneath this message by the JSX
          // (the copyLink state is independent of the error message).
          setError('📧 已發送邀請電郵。對方點擊連結即可加入。');
        } catch (emailErr) {
          // 2026-07-18 — Surface a more diagnostic message than
          // the generic Firebase Auth error. The most common
          // failure modes when calling sendSignInLinkToEmail are:
          //   (a) Email-link sign-in method isn't enabled in
          //       Firebase Console > Authentication > Sign-in
          //       method. Yields `auth/operation-not-allowed` OR
          //       `auth/argument-error` depending on the SDK
          //       version.
          //   (b) `savetheday.io` isn't in Authorized Domains.
          //       Yields `auth/unauthorized-domain`.
          //   (c) Cloud Firestore auth state / email quota issues
          //       (rare).
          // We map both (a) variants to the same hint, plus a
          // generic fallback that ALWAYS points at the Firebase
          // Console, so even with a fresh error code we don't lose
          // the helpful instruction.
          // eslint-disable-next-line no-console
          console.warn('[HelperManager] email send failed:', emailErr);
          const code = emailErr?.code || 'unknown';
          const msg = emailErr?.message || String(emailErr);
          const isAuthConfigErr =
            code === 'auth/operation-not-allowed' ||
            code === 'auth/unauthorized-domain' ||
            code === 'auth/invalid-action-code' ||
            code === 'auth/missing-android-pkg-name' ||
            code === 'auth/missing-continue-uri' ||
            code === 'auth/missing-ios-bundle-id';
          // 2026-07-18 — auth/argument-error from sendSignInLinkToEmail
          // is thrown when `handleCodeInApp !== true`. It's a
          // CODE bug, not a config bug. We just fixed it; if it
          // happens again it'll be because someone passed the
          // wrong flag value.
          const isArgumentErr = code === 'auth/argument-error';
          const reason = isAuthConfigErr
            ? 'Firebase 尚未開啟「Email link (passwordless sign-in)」登入方法，或 savetheday.io 不在 Authorized Domains。'
            : isArgumentErr
              ? 'sendSignInLinkToEmail 的 config 唔啱。最常見係 `handleCodeInApp` 設錯。請檢查最近嘅 App 改動。'
              : msg;
          const fallback =
            '請到 Firebase Console > Authentication > Sign-in method，啟用「Email/Password」的「Email link (passwordless sign-in)」；並到 Settings > Authorized Domains 加入 savetheday.io。';
          setError(
            `⚠️ 邀請已儲存，但電郵未能發送。\n\n錯誤 (${code}): ${reason}\n\n${fallback}\n\n未解決前可手動複製下方連結傳俾對方：`,
          );
          // 2026-07-18 — Prefer the SMTP-server-generated magic link
          // (from sendHelperInviteEmail dryRun) over the locally
          // crafted one. The server version is the canonical URL
          // and matches what the deployed AuthScreen would have
          // signed-into.
          if (!copyLink) {
            setCopyLink(
              `https://savetheday.io/?__heroinvite=1&email=${encodeURIComponent(inviteEmail.trim().toLowerCase())}`,
            );
          }
        }
        } // end if (!richEmailOk)
      }
      setInviteEmail('');
      setInviteName('');
      setInvitePerms(defaultHelperPerms());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePerm = async (helper, perm) => {
    const newPerms = { ...helper.perms, [perm]: !helper.perms[perm] };
    // Optimistic update
    setHelpers((prev) =>
      prev.map((h) => (h.id === helper.id ? { ...h, perms: newPerms } : h)),
    );
    try {
      await helpersApi.updatePerms({ helperUid: helper.helperUid || helper.id, perms: { [perm]: !helper.perms[perm] } });
    } catch (err) {
      // Revert on error
      setHelpers((prev) =>
        prev.map((h) => (h.id === helper.id ? { ...h, perms: helper.perms } : h)),
      );
      setError(err.message);
    }
  };

  const handleRevoke = async (helper) => {
    if (!confirm(`撤銷 ${helper.displayName} 的助手權限？`)) return;
    try {
      await helpersApi.revoke({ helperUid: helper.helperUid || helper.id });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-500" />
            <h2 className="text-xl font-black text-slate-800">兄弟姊妹管理</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm whitespace-pre-line">
            {error}
            {copyLink && (
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 p-2 bg-white border border-rose-200 rounded font-mono text-xs break-all">
                  {copyLink}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      navigator.clipboard?.writeText(copyLink);
                    } catch {
                      /* noop */
                    }
                  }}
                  className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                >
                  複製連結
                </button>
              </div>
            )}
          </div>
        )}

        <div className="px-6 pt-4 flex gap-1 border-b border-slate-100">
          <TabButton active={activeTab === 'active'} onClick={() => setActiveTab('active')}>
            已加入 ({helpers.length})
          </TabButton>
          <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')}>
            待接受 ({pendingInvites.length})
          </TabButton>
          <TabButton active={activeTab === 'invite'} onClick={() => setActiveTab('invite')}>
            <UserPlus className="w-4 h-4" /> 新增邀請
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'active' && (
            <ActiveList helpers={helpers} onTogglePerm={handleTogglePerm} onRevoke={handleRevoke} />
          )}
          {activeTab === 'pending' && (
            <PendingList pending={pendingInvites} ownerUid={ownerUid} />
          )}
          {activeTab === 'invite' && (
            <InviteForm
              email={inviteEmail}
              name={inviteName}
              perms={invitePerms}
              busy={busy}
              onEmailChange={setInviteEmail}
              onNameChange={setInviteName}
              onPermsChange={setInvitePerms}
              onSubmit={handleInvite}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-bold border-b-[3px] transition-colors flex items-center gap-1 ${
        active ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function PermRow({ label, enabled, onToggle }) {
  return (
    <label className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${
            enabled ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </label>
  );
}

function ActiveList({ helpers, onTogglePerm, onRevoke }) {
  if (helpers.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400">
        尚未加入任何 兄弟姊妹。點擊「新增邀請」開始。
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {helpers.map((h) => (
        <div key={h.id} className="border border-slate-200 rounded-xl p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="font-bold text-slate-800 flex items-center gap-2">
                {h.displayName}
                <span className="text-xs font-normal text-slate-400 flex items-center gap-1">
                  <Mail className="w-3 h-3" /> {h.email}
                </span>
              </div>
            </div>
            <button
              onClick={() => onRevoke(h)}
              className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg"
              title="撤銷權限"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {HELPER_PERMS.map((perm) => (
              <PermRow
                key={perm}
                label={HELPER_PERM_LABELS[perm]}
                enabled={h.perms[perm]}
                onToggle={() => onTogglePerm(h, perm)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingList({ pending, ownerUid }) {
  // 2026-07-17 — Owner can cancel an invite directly via the
  // Firestore client. Rules permit owner-only delete on both
  // subcollections, so we don't need a Cloud Function round-trip
  // for this. Returns a Promise so the caller can await.
  const handleCancel = (p) => {
    const ref = p._src === 'pendingInvites'
      ? doc(db, 'artifacts', appId, 'users', ownerUid, 'pendingInvites', p.id)
      : doc(db, 'artifacts', appId, 'users', ownerUid, 'helpers', p.id);
    return deleteDoc(ref);
  };

  if (pending.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400">
        目前沒有待接受的邀請。
        <div className="text-xs mt-2 text-slate-400">
          從「新增邀請」分頁發送邀請後，無論對方有否註冊帳號都會喺度見到。
        </div>
      </div>
    );
  }

  // 2026-07-17 — Column layout for the pending list. We render:
  //   • Display name + email
  //   • Permission summary (e.g. "接待 + 名冊")
  //   • Days pending (with red badge for >7 days)
  //   • Source pill (email-pending vs registered-but-unaccepted)
  //   • Action: cancel invite (deletes the underlying doc).
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-200">
        <div className="col-span-4">姓名 / 電郵</div>
        <div className="col-span-3">權限</div>
        <div className="col-span-2">等待</div>
        <div className="col-span-2">來源</div>
        <div className="col-span-1 text-right">操作</div>
      </div>
      {pending.map((p) => {
        const days = ageInDays(p.invitedAt);
        const perms = Object.entries(p.perms || {})
          .filter(([, v]) => v)
          .map(([k]) => HELPER_PERM_LABELS[k] || k)
          .join(' · ') || '無權限';
        const isEmailPending = p._src === 'pendingInvites';
        return (
          <div
            key={p.id}
            className="grid grid-cols-12 gap-2 items-center px-3 py-2 border border-amber-200 bg-amber-50/50 rounded-lg hover:bg-amber-50 transition-colors"
          >
            <div className="col-span-4 min-w-0">
              <div className="font-bold text-slate-800 truncate flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                {p.displayName || p.email || '(未命名)'}
              </div>
              <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                <Mail className="w-3 h-3" /> {p.email}
              </div>
            </div>
            <div className="col-span-3 text-xs text-slate-600 truncate" title={perms}>
              {perms}
            </div>
            <div className="col-span-2 text-xs">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-bold ${
                  days > 7
                    ? 'bg-rose-100 text-rose-700'
                    : days > 3
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
                title={days === 1 ? '已等待 1 日' : `已等待 ${days} 日`}
              >
                {days === 0 ? '今日' : days === 1 ? '1 日' : `${days} 日`}
              </span>
            </div>
            <div className="col-span-2 text-xs">
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border font-medium ${
                  isEmailPending
                    ? 'border-amber-300 bg-white text-amber-700'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
                title={
                  isEmailPending
                    ? '對方尚未註冊帳號：等待佢用呢個電郵註冊並登入'
                    : '對方已註冊但未點擊接受：依然要等佢首次登入才會自動接手'
                }
              >
                {isEmailPending ? (
                  <>
                    <Mail className="w-3 h-3" /> 待註冊
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" /> 待接受
                  </>
                )}
              </span>
            </div>
            <div className="col-span-1 flex justify-end">
              <button
                onClick={async () => {
                  if (!confirm(`取消 ${p.displayName || p.email} 的邀請？`)) return;
                  try {
                    await handleCancel(p);
                  } catch (err) {
                    alert(`取消失敗：${err.message}`);
                  }
                }}
                className="text-slate-400 hover:text-rose-500 p-1 rounded"
                title="取消邀請"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 2026-07-17 — helper for the "等待" column.
// invitedAt is a Firestore Timestamp (or null). We fall back to
// `now()` if missing so the column never crashes on orphan docs.
function ageInDays(invitedAt) {
  if (!invitedAt) return 0;
  const ms = invitedAt.toMillis ? invitedAt.toMillis() : Number(invitedAt);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function InviteForm({ email, name, perms, busy, onEmailChange, onNameChange, onPermsChange, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">助手姓名</label>
        <input
          type="text"
          required
          placeholder="例如: 大妗姐 Agnes"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full p-2.5 rounded-lg border border-slate-300 outline-none focus:border-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">電郵</label>
        <input
          type="email"
          required
          placeholder="helper@example.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          className="w-full p-2.5 rounded-lg border border-slate-300 outline-none focus:border-indigo-500"
        />
        <p className="text-xs text-slate-500 mt-1">
          對方需要用此電郵註冊帳號，首次登入後會自動看到邀請。
        </p>
      </div>

      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">權限</label>
        <div className="border border-slate-200 rounded-lg p-2 space-y-1">
          {HELPER_PERMS.map((perm) => (
            <PermRow
              key={perm}
              label={HELPER_PERM_LABELS[perm]}
              enabled={perms[perm]}
              onToggle={() => onPermsChange({ ...perms, [perm]: !perms[perm] })}
            />
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-indigo-500 text-white font-bold py-3 rounded-xl hover:bg-indigo-600 disabled:bg-slate-300"
      >
        {busy ? '處理中...' : '發送邀請'}
      </button>
    </form>
  );
}