// ActivationHistoryModal — admin-only modal that surfaces the timeline
// of vendor activation events from /vendorActivationLogs/{auto}.
//
// Each row is one of 9 event types:
//   token_issued   — admin minted a fresh invitation token
//   email_sent     — admin sent the SMTP invite (success)
//   email_failed   — SMTP rejected (vendor still has the URL in modal)
//   claim_attempt  — vendor tried to claim (legacy claimSeededVendor path)
//   claim_failed   — token mismatch, expired, already-claimed, etc.
//   claim_success  — vendor successfully claimed (legacy path)
//   apply_attempt  — vendor's wizard submit reached claimAndApplyAsVendor
//   apply_failed   — wizard validation rejected (token, expiry, dup auth uid)
//   apply_success  — wizard claim committed (doc migrated, storage moved)
//
// 2026-07-20 — first version. Reads via simple collection query
// where('slug', '==', ...). For very-active vendors this could grow
// large — but in practice each vendor has <10 events in their entire
// lifetime, so a flat query is fine.

import { useEffect, useState } from 'react';
import { X, History, AlertCircle, CheckCircle2, Mail, MailX, Clock, Ban, Send, Award, ArrowRight, FileEdit } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const EVENT_META = {
  token_issued: {
    label: '管理員發出邀請',
    Icon: Send,
    color: 'indigo',
    description: '管理員生成了新的邀請連結 (token_issued)',
  },
  email_sent: {
    label: '邀請信已送出',
    Icon: Mail,
    color: 'emerald',
    description: 'SMTP 成功寄出邀請 email',
  },
  email_failed: {
    label: '邀請信寄送失敗',
    Icon: MailX,
    color: 'red',
    description: 'SMTP 寄信失敗 — 商家可能收唔到 email',
  },
  claim_attempt: {
    label: '商家嘗試認領',
    Icon: Clock,
    color: 'slate',
    description: '商家打開咗連結 (舊版認領流程)',
  },
  claim_failed: {
    label: '認領失敗',
    Icon: Ban,
    color: 'red',
    description: '舊版認領被拒 — 可能 token 過期或已用過',
  },
  claim_success: {
    label: '成功認領',
    Icon: CheckCircle2,
    color: 'emerald',
    description: '商家成功認領此 vendor slot',
  },
  apply_attempt: {
    label: '商家送出 wizard 表單',
    Icon: FileEdit,
    color: 'indigo',
    description: '商家完成註冊 wizard 並送出',
  },
  apply_failed: {
    label: 'Wizard 申請失敗',
    Icon: AlertCircle,
    color: 'red',
    description: 'wizard 驗證失敗 — token、expiry 或 dup auth uid',
  },
  apply_success: {
    label: '完成啟動',
    Icon: Award,
    color: 'emerald',
    description: 'wizard 完成並已過戶 doc + portfolio 到新 auth 帳號',
  },
};

const COLOR_CLASSES = {
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-200',  text: 'text-indigo-700',  Icon: 'text-indigo-600' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', Icon: 'text-emerald-600' },
  red:     { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     Icon: 'text-red-600' },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-700',   Icon: 'text-slate-600' },
};

function formatDate(timestamp) {
  if (!timestamp) return '—';
  // Firestore Timestamp → Date
  let d;
  if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
    d = timestamp.toDate();
  } else if (typeof timestamp === 'object' && typeof timestamp._seconds === 'number') {
    d = new Date(timestamp._seconds * 1000);
  } else if (typeof timestamp === 'string') {
    d = new Date(timestamp);
  } else if (typeof timestamp === 'number') {
    d = new Date(timestamp);
  } else {
    return '—';
  }
  if (isNaN(d.getTime())) return '—';
  // 2026年7月20日 14:32 — zh-HK format
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Hong_Kong',
  }).format(d);
}

function relTime(timestamp) {
  if (!timestamp) return '';
  let d;
  if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
    d = timestamp.toDate();
  } else if (typeof timestamp === 'object' && typeof timestamp._seconds === 'number') {
    d = new Date(timestamp._seconds * 1000);
  } else if (typeof timestamp === 'string') {
    d = new Date(timestamp);
  } else return '';
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' 秒前';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分鐘前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小時前';
  const dd = Math.floor(h / 24);
  if (dd < 30) return dd + ' 日前';
  const mo = Math.floor(dd / 30);
  if (mo < 12) return mo + ' 個月前';
  return Math.floor(mo / 12) + ' 年前';
}

export function ActivationHistoryModal({ slug, vendorName, onClose }) {
  const [events, setEvents] = useState(null); // null = loading, [] = done
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        // Admin-only query. firestore.rules restricts this read path
        // to isAdmin() — the calling code wraps this in an isAdmin
        // gate via VendorInviteLinkModal's caller pattern.
        const q = query(
          collection(db, 'vendorActivationLogs'),
          where('slug', '==', slug),
          orderBy('createdAt', 'desc'),
          limit(50),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEvents(list);
      } catch (e) {
        if (cancelled) return;
        // The most common cause here is PERMISSION_DENIED if the
        // user is not admin — surface that explicitly so admins
        // understand why their UI looks empty.
        const msg = e?.message || String(e);
        setError(msg);
        setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-gradient-to-br from-slate-50 to-white">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0">
              <History className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-slate-900 truncate">
                啟動紀錄
              </h2>
              <p className="text-sm text-slate-600 truncate">
                {vendorName || slug}
              </p>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {slug}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:bg-slate-100 rounded-lg p-2 flex-shrink-0"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {events === null && (
            <div className="p-12 text-center">
              <div className="w-8 h-8 mx-auto border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-sm text-slate-500 mt-3">載入紀錄中...</p>
            </div>
          )}

          {events !== null && error && (
            <div className="p-6 m-4 rounded-xl bg-red-50 border border-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-red-900 text-sm mb-1">無法載入啟動紀錄</p>
                  <p className="text-xs text-red-800 font-mono">{error}</p>
                </div>
              </div>
            </div>
          )}

          {events !== null && !error && events.length === 0 && (
            <div className="p-12 text-center">
              <History className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-700 mb-1">未有啟動紀錄</h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                從未對呢個 vendor 發出邀請。點「發邀請」就會喺度睇到 timeline。
              </p>
            </div>
          )}

          {events !== null && !error && events.length > 0 && (
            <ol className="p-6 space-y-3 relative">
              {/* Vertical timeline line */}
              <div
                className="absolute top-6 bottom-6 w-px bg-slate-200"
                style={{ left: 'calc(2.5rem + 1.5rem)' }}
                aria-hidden
              />
              {events.map((ev) => {
                const meta = EVENT_META[ev.type] || {
                  label: ev.type,
                  Icon: AlertCircle,
                  color: 'slate',
                  description: 'Unknown event type',
                };
                const c = COLOR_CLASSES[meta.color] || COLOR_CLASSES.slate;
                const Icon = meta.Icon;
                return (
                  <li key={ev.id} className="relative flex items-start gap-3">
                    {/* Icon bubble */}
                    <div
                      className={`w-10 h-10 rounded-full ${c.bg} ${c.border} border flex items-center justify-center flex-shrink-0 relative z-10`}
                    >
                      <Icon className={`w-5 h-5 ${c.Icon}`} />
                    </div>
                    {/* Content */}
                    <div className={`flex-1 min-w-0 ${c.bg} ${c.border} border rounded-xl px-4 py-3`}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <p className={`font-bold ${c.text} text-sm`}>{meta.label}</p>
                        <p className="text-xs text-slate-500 flex-shrink-0" title={formatDate(ev.createdAt)}>
                          {relTime(ev.createdAt)}
                        </p>
                      </div>
                      <p className={`text-xs ${c.text} opacity-80 mb-2`}>{meta.description}</p>
                      <div className="text-xs text-slate-500 space-y-0.5 font-mono">
                        <p>{formatDate(ev.createdAt)}</p>
                        {ev.actorUid && (
                          <p className="truncate">actor: {ev.actorUid}</p>
                        )}
                        {ev.authUid && (
                          <p className="truncate">auth: {ev.authUid}</p>
                        )}
                        {ev.detail && Object.keys(ev.detail).length > 0 && (
                          <p className="truncate">
                            detail: {JSON.stringify(ev.detail).slice(0, 120)}
                          </p>
                        )}
                        {ev.errorMessage && (
                          <p className="text-red-600 truncate">error: {ev.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {events && events.length > 0
              ? `共 ${events.length} 個事件`
              : '9 種事件類型覆蓋整個啟動流程'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 rounded-lg"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
