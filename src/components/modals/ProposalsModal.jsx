import { MessageSquare, Star, X, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';

// ProposalsModal — couple-side viewer for the proposals on a job.
//
// 2026-08-08 — major rewrite. Previously this modal read from an
// in-memory map `proposalsData[jobId]` that App.jsx filled from a
// hardcoded MOCK_PROPOSALS array. So couples NEVER saw proposals
// submitted by vendors in the live app — the vendor's
// "立即發送報價單" button only mutated that same in-memory map.
//
// Now: live subscription to /proposals filtered by jobId. The
// firestore.rules top-level mirror lets signed-in users read any
// proposal whose coupleUid matches; we filter by jobId AND
// coupleUid at query level so couples can only see their own job's
// proposals (defense in depth — rules enforce it; query hardens it).
//
// Loading skeleton + empty state preserved from the previous UX.

export function ProposalsModal({ jobId, coupleUid, onClose }) {
  if (!jobId) return null;
  const [proposals, setProposals] = useState(null); // null = loading, [] = empty
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    setProposals(null);
    setError(null);

    // Hard-require coupleUid: this is the auth check Firestore rules
    // also enforce. If we don't have it, don't risk leaking other
    // couples' proposals — fail loud.
    if (!coupleUid) {
      setError('需要登入為新人先可以睇報價單。');
      setProposals([]);
      return undefined;
    }

    let unsub = () => {};
    try {
      const q = query(
        collection(db, 'proposals'),
        where('jobId', '==', jobId),
        where('coupleUid', '==', coupleUid),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              vendorName: data.vendorName || '商戶',
              rating: typeof data.rating === 'number' ? data.rating : 0,
              price: data.price || '',
              message: data.message || '',
              // Firestore Timestamp → Date.toLocaleString; raw ISO
              // string fallback for any client that didn't normalize.
              createdAt: data.createdAt,
              date: formatProposalDate(data.createdAt),
              ref: d.ref,
            };
          });
          // Newest first — the CF writes with serverTimestamp so the
          // order is real chronological, not the time the client
          // received the snapshot.
          list.sort((a, b) => {
            const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return bt - at;
          });
          setProposals(list);
        },
        (err) => {
          if (cancelled) return;
          console.error('[ProposalsModal] onSnapshot error:', err);
          setError(err.message || '讀取報價單失敗。');
          setProposals([]);
        },
      );
    } catch (err) {
      console.error('[ProposalsModal] subscription failed:', err);
      setError(err.message || '讀取報價單失敗。');
      setProposals([]);
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [jobId, coupleUid]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[85vh] flex flex-col relative">
        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            商戶報價單
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
            aria-label="關閉"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar pr-2 flex-grow">
          {error && (
            <div className="text-center text-rose-600 py-6 text-sm">
              {error}
            </div>
          )}
          {proposals === null && !error && (
            <div className="text-center text-slate-500 py-10">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              載入中...
            </div>
          )}
          {Array.isArray(proposals) && proposals.length > 0 && (
            proposals.map((p) => (
              <div key={p.id} className="mb-4 p-5 border border-slate-200 rounded-xl bg-slate-50">
                <div className="flex justify-between items-start mb-2 gap-2">
                  <div className="font-bold text-slate-800 text-lg">{p.vendorName}</div>
                  <div className="font-bold text-rose-600 text-lg whitespace-nowrap">
                    {p.price || '待定'}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-slate-500 mb-3">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="font-medium">{p.rating.toFixed(1)}</span> • {p.date}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100 whitespace-pre-wrap">
                  {p.message}
                </p>
              </div>
            ))
          )}
          {Array.isArray(proposals) && proposals.length === 0 && !error && (
            <div className="text-center text-slate-500 py-10">
              暫時未有商戶發送報價，請耐心等候。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Firestore Timestamp → "剛剛"/"X 分鐘前" string. Mirrors the
// formatPostedAt logic in VendorDashboard.jsx but kept local so the
// modal doesn't pull in a new file. Pure formatting.
function formatProposalDate(postedAt) {
  if (!postedAt) return '剛剛';
  let date = null;
  try {
    if (typeof postedAt === 'object' && typeof postedAt.toDate === 'function') {
      date = postedAt.toDate();
    } else if (postedAt && typeof postedAt.seconds === 'number') {
      date = new Date(postedAt.seconds * 1000);
    } else if (typeof postedAt === 'number') {
      date = new Date(postedAt);
    } else if (typeof postedAt === 'string') {
      return postedAt; // already a friendly string ("剛剛")
    }
  } catch {
    return '剛剛';
  }
  if (!date || Number.isNaN(date.getTime())) return '剛剛';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return '剛剛';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}分鐘前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}小時前`;
  return `${Math.floor(diffMs / 86_400_000)}日前`;
}
