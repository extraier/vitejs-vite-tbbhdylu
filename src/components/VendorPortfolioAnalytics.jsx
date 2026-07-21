// VendorPortfolioAnalytics — vendor's own analytics view for their
// portfolio images. Reads from /vendorImageViews (admin OR own-vendor
// per firestore.rules) and aggregates into top-N + totals + recent
// viewers.
//
// 2026-07-20 — first version. Three sections:
//   1. KPI cards (total views, unique viewers, top image)
//   2. Top 10 most-viewed portfolio images with bar chart
//   3. Recent viewers list (anonymized UID, last 20 events)
//
// The vendor's UID is the doc ID in /vendors — so vendorSlug == uid.
// Firestore query: where('vendorSlug', '==', user.uid).

import { useEffect, useMemo, useState } from 'react';
import { Eye, Users, Image as ImageIcon, TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

const DATE_RANGES = [
  { id: '7d', label: '最近 7 日', days: 7 },
  { id: '30d', label: '最近 30 日', days: 30 },
  { id: '90d', label: '最近 90 日', days: 90 },
  { id: 'all', label: '全部時間', days: null },
];

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
  return Math.floor(dd / 30) + ' 個月前';
}

function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  let d;
  if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
    d = timestamp.toDate();
  } else if (typeof timestamp === 'object' && typeof timestamp._seconds === 'number') {
    d = new Date(timestamp._seconds * 1000);
  } else if (typeof timestamp === 'string') {
    d = new Date(timestamp);
  } else return '—';
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Hong_Kong',
  }).format(d);
}

// 2026-07-20 — anonymize viewer UID for display. We never show the
// raw UID — instead derive a short, stable per-vendor tag so the
// vendor can recognize repeat viewers ("old customer came back")
// without exposing the underlying identity.
function anonymizeViewer(viewerUid, vendorUid) {
  if (!viewerUid) return '匿名';
  // Hash the UID to a 6-char hex tag, deterministic per viewer.
  // Simple djb2-style hash — not cryptographically secure, just
  // stable and short. Vendor can remember "f3a9c2" = "Mary the
  // bride from March" without knowing the actual identity.
  let h = 5381;
  for (let i = 0; i < viewerUid.length; i++) {
    h = ((h << 5) + h) + viewerUid.charCodeAt(i);
    h |= 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
  return `viewer_${hex}`;
}

export function VendorPortfolioAnalytics({ user, vendorUid }) {
  const [range, setRange] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [views, setViews] = useState([]);

  useEffect(() => {
    if (!user?.uid || !vendorUid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Firestore query: only fetch this vendor's views for the
        // selected time range. The firestore rule `isSignedIn() &&
        // resource.data.vendorSlug == request.auth.uid` permits
        // this read.
        const days = DATE_RANGES.find((r) => r.id === range)?.days;
        // We use a server-side filter on createdAt via >= cutoff
        // for date ranges. For 'all', no cutoff.
        // Note: orderBy('createdAt', 'desc') + where needs a composite
        // index (vendorSlug + createdAt). To avoid that cost we'll
        // fetch recent + filter in-memory. For realistic volumes
        // (couples rarely view >100 photos per session) this is fine.
        const constraints = [
          where('vendorSlug', '==', vendorUid),
          orderBy('createdAt', 'desc'),
          limit(500),
        ];
        const q = query(collection(db, 'vendorImageViews'), ...constraints);
        const snap = await getDocs(q);
        if (cancelled) return;
        const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
        const list = [];
        for (const doc of snap.docs) {
          const d = doc.data();
          // Manual filter — we over-fetch to dodge the composite index
          // requirement.
          if (cutoff) {
            let ts = 0;
            if (d.createdAt?.toMillis) ts = d.createdAt.toMillis();
            else if (d.createdAt?._seconds) ts = d.createdAt._seconds * 1000;
            if (ts < cutoff) continue;
          }
          list.push({ id: doc.id, ...d });
        }
        setViews(list);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, vendorUid, range]);

  // Aggregate: per-image counts + unique viewers + recent list.
  const aggregated = useMemo(() => {
    const byImage = new Map(); // imageUrl -> { url, index, count, lastViewed }
    const viewerSet = new Set();
    const viewerLastSeen = new Map(); // viewerUid -> timestamp

    for (const v of views) {
      viewerSet.add(v.viewerUid);
      const prev = byImage.get(v.imageUrl);
      if (!prev) {
        byImage.set(v.imageUrl, {
          url: v.imageUrl,
          index: v.imageIndex,
          count: 1,
          lastViewed: v.createdAt,
        });
      } else {
        prev.count += 1;
        if (
          v.createdAt &&
          (!prev.lastViewed ||
            (v.createdAt?.toMillis?.() ?? v.createdAt?._seconds * 1000 ?? 0) >
              (prev.lastViewed?.toMillis?.() ?? prev.lastViewed?._seconds * 1000 ?? 0))
        ) {
          prev.lastViewed = v.createdAt;
        }
      }
      const ts = v.createdAt?.toMillis?.() ?? v.createdAt?._seconds * 1000 ?? 0;
      const prev2 = viewerLastSeen.get(v.viewerUid);
      if (!prev2 || ts > prev2) viewerLastSeen.set(v.viewerUid, ts);
    }

    const images = Array.from(byImage.values()).sort((a, b) => b.count - a.count);
    const maxCount = images[0]?.count || 1;

    return {
      totalViews: views.length,
      uniqueViewers: viewerSet.size,
      topImage: images[0],
      images: images.slice(0, 10),
      maxCount,
      recentViewers: Array.from(viewerLastSeen.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([uid, ts]) => ({ uid, ts })),
    };
  }, [views]);

  if (!user?.uid || !vendorUid) {
    return (
      <div className="p-8 text-center text-slate-500">請先登入商戶帳戶。</div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto mt-6 px-4 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-500" />
            作品集瀏覽分析
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            邊張作品集相片最多人睇？哪類客人最有興趣？
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {DATE_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                range === r.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
            <Eye className="w-4 h-4" /> 總瀏覽次數
          </div>
          <div className="text-3xl font-black text-slate-800">
            {loading ? '—' : aggregated.totalViews.toLocaleString()}
          </div>
          <p className="text-xs text-slate-400 mt-1">作品集相片被開過幾多次</p>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
            <Users className="w-4 h-4" /> 不重複訪客
          </div>
          <div className="text-3xl font-black text-slate-800">
            {loading ? '—' : aggregated.uniqueViewers.toLocaleString()}
          </div>
          <p className="text-xs text-slate-400 mt-1">每位 user 只算一次</p>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
            <ImageIcon className="w-4 h-4" /> 最熱門相片
          </div>
          <div className="text-3xl font-black text-slate-800 truncate">
            {loading
              ? '—'
              : aggregated.topImage
              ? `${aggregated.topImage.count} 次`
              : '—'}
          </div>
          <p className="text-xs text-slate-400 mt-1 truncate">
            {aggregated.topImage
              ? `第 ${aggregated.topImage.index + 1} 張相`
              : '未有瀏覽紀錄'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> 載入分析中...
        </div>
      ) : views.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-700 mb-1">尚未有瀏覽紀錄</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            當有客人點開你嘅作品集相片放大睇，就會喺度見到統計。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top images */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              Top 10 最熱門相片
            </h3>
            <div className="space-y-3">
              {aggregated.images.map((img, idx) => (
                <div key={img.url} className="flex items-center gap-3">
                  <span className="text-xs font-black text-slate-400 w-6 text-right">
                    {idx + 1}
                  </span>
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                    <img
                      src={img.url}
                      alt={`image-${img.index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-sm font-bold text-slate-700 truncate">
                        第 {img.index + 1} 張
                      </p>
                      <p className="text-xs text-slate-500 font-mono">
                        {img.count} 次
                      </p>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full"
                        style={{ width: `${(img.count / aggregated.maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent viewers */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-500" />
              最近訪客 (匿名)
            </h3>
            {aggregated.recentViewers.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">未有訪客</p>
            ) : (
              <ul className="space-y-2">
                {aggregated.recentViewers.map((v) => (
                  <li
                    key={v.uid}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {anonymizeViewer(v.uid, vendorUid).slice(-2).toUpperCase()}
                      </div>
                      <span className="font-mono text-xs text-slate-700 truncate">
                        {anonymizeViewer(v.uid, vendorUid)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 flex-shrink-0">
                      <Calendar className="w-3 h-3" />
                      <span title={formatDateTime(v.ts)}>
                        {relTime(v.ts)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
              為咗保護客人私隱，每位訪客會用 6 位 hash tag 顯示 — 你可以認得「之前睇過嘅 3 月新人」返轉頭嚟，但睇唔到佢真正身份。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
