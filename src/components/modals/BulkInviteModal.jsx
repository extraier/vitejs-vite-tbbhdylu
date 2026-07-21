// BulkInviteModal — admin modal for batch-minting invitation tokens
// for many vendors at once. Triggered from AdminVendors.jsx "批量發邀請"
// button. Shows per-row progress + summary when done.
//
// 2026-07-20 — first version. Calls bulkActivateSeededVendors
// (cloud function, admin-only). Each row returns either:
//   { ok: true, signupUrl, emailSent? } — minted OK
//   { ok: false, error } — failed (already claimed, etc.)
//
// The modal also surfaces a CSV download of the minted URLs so the
// admin can copy/paste into WhatsApp groups, Telegram channels,
// etc. — useful when vendors have no email on file yet.

import { useState, useEffect, useMemo } from 'react';
import { X, Download, AlertCircle, CheckCircle2, Mail, Send, Loader2, Copy } from 'lucide-react';
import { bulkActivateSeededVendors } from '../../lib/vendorActivation';

export function BulkInviteModal({ items, onClose, onComplete }) {
  // items: [{ vendorUid, name, signupStatus }] — already validated as
  // safe-to-invite by the caller (claimed vendors should be filtered out)
  const [phase, setPhase] = useState('confirm'); // 'confirm' | 'running' | 'done'
  const [sendEmails, setSendEmails] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: items.length });
  const [result, setResult] = useState(null); // BulkActivateSeededVendorsResult
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Snapshot items so the modal is stable even if AdminVendors re-renders
  const snapshot = useMemo(() => items.slice(), [items]);
  const itemCount = snapshot.length;

  async function runBulk() {
    setPhase('running');
    setError(null);
    try {
      const r = await bulkActivateSeededVendors({
        items: snapshot.map((v) => ({
          slug: v.vendorUid,
          // No email on the vendor doc by default. Admin can use the
          // email field per-vendor before clicking "確認發送", but
          // for the bulk path we just mint links and let admin copy.
          email: v.email || undefined,
        })),
        sendEmails,
      });
      setResult(r);
      setPhase('done');
      setProgress({ done: r.totalRequested, total: r.totalRequested });
      onComplete?.(r);
    } catch (e) {
      setError(e?.message || String(e));
      setPhase('confirm'); // back to confirm screen
    }
  }

  async function copyAllLinks() {
    if (!result) return;
    const links = result.rows
      .filter((r) => r.ok && r.signupUrl)
      .map((r) => r.signupUrl)
      .join('\n');
    try {
      await navigator.clipboard.writeText(links);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('複製以下邀請連結（一行一條）:', links);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const rows = result.rows
      .filter((r) => r.ok && r.signupUrl)
      .map((r) => [r.slug, r.signupUrl, r.invitationExpiresAt || ''].join(','))
      .join('\n');
    const body = '\uFEFF' + 'slug,signupUrl,expiresAt\n' + rows;
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendor-invites-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-gradient-to-br from-emerald-50 to-white">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-slate-900 truncate">
                批量發邀請
              </h2>
              <p className="text-sm text-slate-600 truncate">
                一次過幫 {itemCount} 個 vendor 開啟 activation 連結
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
        <div className="overflow-y-auto flex-1 p-6">
          {phase === 'confirm' && (
            <div className="space-y-5">
              {/* Email toggle */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendEmails}
                    onChange={(e) => setSendEmails(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-emerald-600"
                  />
                  <div className="flex-1">
                    <p className="font-bold text-emerald-900 text-sm flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      同時寄邀請 email
                    </p>
                    <p className="text-xs text-emerald-700 mt-1">
                      每個 vendor 都會收到 branded HTML 邀請信。需要該 vendor 嘅 email
                      已經有喺 doc 裡面先會寄出；冇 email 嘅會淨係 mint token 唔寄。
                      預設 14 日有效。
                    </p>
                  </div>
                </label>
              </div>

              {/* Vendor list preview */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  即將邀請 ({itemCount} 個)
                </p>
                <ul className="max-h-64 overflow-y-auto bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {snapshot.slice(0, 50).map((v) => (
                    <li
                      key={v.vendorUid}
                      className="px-3 py-2 text-sm flex items-center justify-between gap-2"
                    >
                      <span className="font-mono text-xs text-slate-600 truncate">
                        {v.vendorUid}
                      </span>
                      <span className="text-slate-700 truncate flex-1">
                        {v.name}
                      </span>
                      {v.email && (
                        <span className="text-xs text-slate-400 truncate hidden sm:inline">
                          {v.email}
                        </span>
                      )}
                    </li>
                  ))}
                  {itemCount > 50 && (
                    <li className="px-3 py-2 text-xs text-slate-500 text-center">
                      ...同埋另外 {itemCount - 50} 個
                    </li>
                  )}
                </ul>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-900 text-sm">執行失敗</p>
                    <p className="text-xs text-red-800 font-mono mt-1">{error}</p>
                  </div>
                </div>
              )}

              <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p>
                  每個 vendor 都會獲得一個<strong className="text-slate-700">全新</strong>
                  嘅 14 日有效 token。已激活嘅 vendor 會被自動跳過，唔會出錯。
                  你嘅 admin UID 會記低喺每個 vendor 嘅 <code className="font-mono">invitedBy</code>
                  欄，方便日後追蹤。
                </p>
              </div>
            </div>
          )}

          {phase === 'running' && (
            <div className="py-12 text-center">
              <Loader2 className="w-10 h-10 mx-auto text-emerald-500 animate-spin" />
              <p className="text-base font-bold text-slate-700 mt-4">
                處理中...
              </p>
              <p className="text-sm text-slate-500 mt-1">
                系統會逐個 vendor 開 token{sendEmails ? ' + 寄 email' : ''}，可能要幾分鐘。
              </p>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                  <p className="text-2xl font-black text-emerald-700">{result.minted}</p>
                  <p className="text-xs text-emerald-600 mt-1">已開啟 token</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
                  <Mail className="w-6 h-6 text-indigo-600 mx-auto mb-1" />
                  <p className="text-2xl font-black text-indigo-700">{result.emailsSent}</p>
                  <p className="text-xs text-indigo-600 mt-1">已寄 email</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
                  <AlertCircle className="w-6 h-6 text-rose-600 mx-auto mb-1" />
                  <p className="text-2xl font-black text-rose-700">{result.emailsFailed}</p>
                  <p className="text-xs text-rose-600 mt-1">寄信失敗</p>
                </div>
              </div>

              {/* Failed rows */}
              {result.rows.some((r) => !r.ok) && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                  <p className="font-bold text-rose-900 text-sm mb-2 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    失敗嘅 vendor ({result.rows.filter((r) => !r.ok).length})
                  </p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {result.rows.filter((r) => !r.ok).map((r) => (
                      <li key={r.slug} className="text-xs font-mono text-rose-800">
                        {r.slug}: {r.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Bulk actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={copyAllLinks}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copied ? '已複製全部連結' : '複製全部連結'}
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  下載 CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {phase === 'confirm' && '確認後立即執行，唔可以 undo'}
            {phase === 'running' && '請勿關閉呢個 modal'}
            {phase === 'done' && '完成。可以關閉呢個 modal 並繼續操作。'}
          </p>
          {phase === 'confirm' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={runBulk}
                disabled={itemCount === 0}
                className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg flex items-center gap-1"
              >
                <Send className="w-4 h-4" />
                確認發送 ({itemCount})
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
