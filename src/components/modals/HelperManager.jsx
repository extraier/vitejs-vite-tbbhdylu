// HelperManager — owner-facing UI to invite, configure, and revoke helpers
// (兄弟姊妹).
//
// Renders as a modal. Owner enters an email, picks permissions, generates an
// invite. Pending invites show until the helper accepts (signs up + accepts).
//
// Active helpers show their current perms inline with toggles. Revoke kills
// access immediately (rules check status == 'active').

import { useEffect, useState } from 'react';
import { X, UserPlus, Users, Mail, Trash2, Check, RefreshCw } from 'lucide-react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../../lib/firebase';
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

  // Subscribe to active helpers in real-time
  useEffect(() => {
    if (!ownerUid) return undefined;
    const q = query(
      collection(db, 'artifacts', appId, 'users', ownerUid, 'helpers'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setHelpers(all.filter((h) => h.status === 'active'));
        setPendingInvites(all.filter((h) => h.status === 'invited'));
      },
      (err) => setError(err.message),
    );
    return unsub;
  }, [ownerUid]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;
    setBusy(true);
    setError(null);
    try {
      await helpersApi.invite({
        email: inviteEmail.trim().toLowerCase(),
        displayName: inviteName.trim(),
        perms: invitePerms,
      });
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
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
            {error}
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
            <PendingList pending={pendingInvites} />
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

function PendingList({ pending }) {
  if (pending.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400">
        目前沒有待接受的邀請。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {pending.map((p) => (
        <div key={p.id} className="flex items-center justify-between p-4 border border-amber-200 bg-amber-50 rounded-xl">
          <div>
            <div className="font-bold text-slate-800">{p.displayName}</div>
            <div className="text-xs text-slate-500">{p.email}</div>
            <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> 等待對方登入並接受邀請
            </div>
          </div>
          <Check className="w-5 h-5 text-amber-500" />
        </div>
      ))}
    </div>
  );
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