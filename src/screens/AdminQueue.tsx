// 2026-07-29 — Admin Queue screen.
//
// Triages pending submissions across all 3 unlock paths so an admin
// doesn't have to query each path's collection by hand. Each row
// shows:
//
//   1. The submitter (uid + display name if known)
//   2. The unlock type + submission timestamp
//   3. The relevant fields (IG/FB URL for proofs, friend email for
//      referrals, receipt URL for payments)
//   4. Approve / Reject buttons that call the corresponding
//      adminVerify* callable
//
// We use a single collectionGroup query for proofs, referralClaims,
// and paymentReceipts because they all live at the same level
// (artifacts/{appId}/users/{uid}/{subcoll}/{docId}). The admin can
// filter by type via the segmented control.
//
// The screen is intentionally read-only-by-default with a "Load
// pending" button — collectionGroup queries can be expensive at
// scale and we don't want every page load to trigger one. (For a
// couple-month-old project this is still cheap; it's a forward-
// looking guard.)

import { useState } from 'react';
import { Inbox, RefreshCw, Check, X, ExternalLink, ArrowLeft } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collectionGroup, getDocs, query, where, limit } from 'firebase/firestore';
import { functions, db, appId } from '../lib/firebase';

type QueueType = 'socialProofs' | 'referralClaims' | 'paymentReceipts';

interface QueueItem {
  id: string;
  uid: string;
  type: QueueType;
  unlockType: string;
  postUrl?: string;
  friendName?: string;
  friendUid?: string;
  amount?: number;
  paymentMethod?: string;
  receiptUrl?: string;
  createdAt: number;
  status: string;
  rejectionReason?: string;
}

interface AdminQueueProps {
  user: any;
  isAdmin: boolean;
  onBack: () => void;
}

export function AdminQueue({ user, isAdmin, onBack }: AdminQueueProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<QueueType>('socialProofs');
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="text-rose-600 font-bold">需要管理員權限。</p>
        <button
          onClick={onBack}
          className="mt-4 text-sm font-bold text-slate-600 hover:text-slate-800 underline"
        >
          ← 返回
        </button>
      </div>
    );
  }

  const loadPending = async () => {
    setLoading(true);
    setError(null);
    try {
      const usersRef = collectionGroup(db, filter);
      const q = query(usersRef, where('status', '==', 'pending'), limit(50));
      const snap = await getDocs(q);
      const rows: QueueItem[] = snap.docs.map((d) => {
        const data = d.data();
        // The collectionGroup query gives us a path like
        // artifacts/{appId}/users/{uid}/{subcoll}/{docId}. The 2nd-to-last
        // segment is the uid; the last is the doc id.
        const pathParts = d.ref.path.split('/');
        const uid = pathParts[pathParts.length - 3];
        return {
          id: d.id,
          uid,
          type: filter,
          unlockType: data.unlockType || '',
          postUrl: data.postUrl,
          friendName: data.friendName,
          friendUid: data.friendUid,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          receiptUrl: data.receiptUrl,
          createdAt: tsToMs(data.createdAt),
          status: data.status,
          rejectionReason: data.rejectionReason,
        };
      });
      // Newest first
      rows.sort((a, b) => b.createdAt - a.createdAt);
      setItems(rows);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[AdminQueue] load failed:', err);
      setError(err?.message || '讀取失敗');
    } finally {
      setLoading(false);
    }
  };

  const decide = async (item: QueueItem, decision: 'approve' | 'reject') => {
    if (decision === 'reject') {
      const reason = window.prompt('拒絕原因（會俾返用戶睇）：');
      if (reason === null) return; // cancelled
      await _decide(item, decision, reason);
    } else {
      await _decide(item, decision, '');
    }
  };

  const _decide = async (item: QueueItem, decision: 'approve' | 'reject', reason: string) => {
    const key = `${item.uid}-${item.id}`;
    setDeciding(key);
    try {
      let fnName: string;
      if (item.type === 'socialProofs') fnName = 'adminVerifySocialProof';
      else if (item.type === 'referralClaims') fnName = 'adminVerifyReferral';
      else fnName = 'adminVerifyPayment';
      const fn = httpsCallable<
        { uid: string; proofId: string; claimId: string; receiptId: string; decision: 'approve' | 'reject'; rejectionReason?: string },
        { ok: boolean }
      >(functions, fnName);
      // All 3 adminVerify* CFs take `uid` and a per-type id field
      // (proofId / claimId / receiptId). Pass both for forward-compat
      // — the CF only reads the one it needs.
      await fn({
        uid: item.uid,
        proofId: item.type === 'socialProofs' ? item.id : '',
        claimId: item.type === 'referralClaims' ? item.id : '',
        receiptId: item.type === 'paymentReceipts' ? item.id : '',
        decision,
        rejectionReason: reason || undefined,
      });
      // Remove from local list
      setItems((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[AdminQueue] decide failed:', err);
      setError(err?.message || '操作失敗');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
          <Inbox className="w-6 h-6 text-indigo-500" />
          審批管理
        </h1>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          {(['socialProofs', 'referralClaims', 'paymentReceipts'] as QueueType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setFilter(t);
                setItems([]);
              }}
              className={`px-3 py-1.5 rounded-full text-sm font-bold ${
                filter === t
                  ? 'bg-indigo-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {filterLabel(t)}
            </button>
          ))}
          <button
            onClick={loadPending}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-full text-sm font-bold hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            載入待審 ({filterLabel(filter)})
          </button>
        </div>
        {error && (
          <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {items.length === 0 && !loading && (
        <div className="text-center py-12 text-slate-400">
          <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">按「載入待審」開始審批</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => {
            const key = `${item.uid}-${item.id}`;
            return (
              <li
                key={key}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">
                      {item.unlockType} · uid {item.uid.substring(0, 8)}…
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(item.createdAt).toLocaleString('zh-HK')}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => decide(item, 'approve')}
                      disabled={deciding === key}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-sm font-bold rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      通過
                    </button>
                    <button
                      onClick={() => decide(item, 'reject')}
                      disabled={deciding === key}
                      className="flex items-center gap-1 px-3 py-1.5 bg-rose-500 text-white text-sm font-bold rounded-lg hover:bg-rose-600 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      拒絕
                    </button>
                  </div>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  {item.type === 'socialProofs' && item.postUrl && (
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1 text-rose-600 hover:text-rose-700 break-all underline"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      {item.postUrl}
                    </a>
                  )}
                  {item.type === 'referralClaims' && (
                    <div>
                      👤 Friend: {item.friendName || item.friendUid || '—'}
                    </div>
                  )}
                  {item.type === 'paymentReceipts' && (
                    <div>
                      💰 {item.paymentMethod} · HK${item.amount}
                      {item.receiptUrl && (
                        <a
                          href={item.receiptUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block mt-2"
                        >
                          {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                          <img
                            src={item.receiptUrl}
                            alt="付款收據 screenshot"
                            className="max-w-xs max-h-64 rounded-lg border border-slate-200 hover:opacity-90 cursor-pointer"
                            loading="lazy"
                          />
                          <span className="text-xs text-slate-500 mt-1 block">放大</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function filterLabel(t: QueueType): string {
  if (t === 'socialProofs') return '社交證明';
  if (t === 'referralClaims') return '推薦 claim';
  return '付款收據';
}

function tsToMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}
