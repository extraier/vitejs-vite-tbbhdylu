import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Download, Loader2, TrendingUp, Eye, MousePointerClick, Lock } from 'lucide-react';
import { db } from '../lib/firebase';
import { rowsToCsv } from '../lib/vendorAnalytics';

// VendorAnalytics — admin-only screen that aggregates vendor_events
// into a per-vendor per-month table of views and clicks, with CSV export.
//
// Data shape:
//   vendor_events/{eventId} = {
//     type: 'view' | 'click',
//     vendorId, vendorName, vendorCategory,
//     userId, sessionId, monthBucket,
//     timestamp, ua,
//   }
//
// We fetch up to N months back of events and aggregate in memory. For
// realistic wedding-season volumes (~hundreds of events/month) this is
// cheap and keeps Firestore queries simple. If traffic grows past ~50k
// events/month, swap to a server-side aggregation.

const DEFAULT_VENDORS_LOOKUP = {
  // Used as a fallback when no events exist yet — gives the admin a
  // baseline table even before any tracking happens.
  101: { vendorName: 'Visionary Capture', vendorCategory: 'photography' },
  102: { vendorName: 'Light & Shadow Studio', vendorCategory: 'photography' },
  103: { vendorName: 'FairyTale Floral', vendorCategory: 'deco' },
  104: { vendorName: 'Bethanie Charm Deco', vendorCategory: 'deco' },
};

function currentMonthBucket() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastNMonthBuckets(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function downloadCsv(filename, body) {
  // BOM for Excel UTF-8 detection.
  const blob = new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VendorAnalytics({ user, isAdmin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthBucket());

  const monthOptions = useMemo(() => lastNMonthBuckets(6), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Query events for the selected month, ordered by vendorId for
        // easier client-side grouping.
        const q = query(
          collection(db, 'vendor_events'),
          where('monthBucket', '==', selectedMonth),
          orderBy('vendorId', 'asc'),
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        // Aggregate by vendorId.
        const agg = new Map();
        snap.forEach((doc) => {
          const e = doc.data();
          if (!agg.has(e.vendorId)) {
            agg.set(e.vendorId, {
              vendorId: e.vendorId,
              vendorName: e.vendorName || DEFAULT_VENDORS_LOOKUP[e.vendorId]?.vendorName || `Vendor ${e.vendorId}`,
              vendorCategory: e.vendorCategory || DEFAULT_VENDORS_LOOKUP[e.vendorId]?.vendorCategory || '',
              monthBucket: selectedMonth,
              views: 0,
              clicks: 0,
            });
          }
          const r = agg.get(e.vendorId);
          if (e.type === 'view') r.views += 1;
          else if (e.type === 'click') r.clicks += 1;
        });

        // Always show known default vendors even with zero events, so the
        // admin has a baseline table on day 1.
        Object.entries(DEFAULT_VENDORS_LOOKUP).forEach(([id, info]) => {
          if (!agg.has(id)) {
            agg.set(id, {
              vendorId: id,
              vendorName: info.vendorName,
              vendorCategory: info.vendorCategory,
              monthBucket: selectedMonth,
              views: 0,
              clicks: 0,
            });
          }
        });

        // Sort by total engagement (views + clicks) desc.
        const sorted = Array.from(agg.values()).sort(
          (a, b) => (b.views + b.clicks) - (a.views + a.clicks),
        );
        setRows(sorted);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load analytics');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, selectedMonth]);

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-100">
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">管理員專區</h2>
          <p className="text-slate-500 text-sm">
            此頁面只供管理員使用。請聯絡系統管理員授予 admin 權限。
          </p>
          <p className="text-xs text-slate-400 mt-4">
            Signed in as: {user?.email || 'unknown'}
          </p>
        </div>
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({ views: acc.views + r.views, clicks: acc.clicks + r.clicks }),
    { views: 0, clicks: 0 },
  );

  const handleDownload = () => {
    const csv = rowsToCsv(rows);
    downloadCsv(`vendor-analytics-${selectedMonth}.csv`, csv);
  };

  return (
    <div className="max-w-6xl mx-auto mt-8 px-4 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-rose-500" />
            商戶數據分析
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            用作月費商戶會籍推廣。每位商戶的瀏覽次數與點擊次數。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-400"
            data-testid="month-selector"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={handleDownload}
            disabled={loading || rows.length === 0}
            data-testid="download-csv"
            className="bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            下載 CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
            <Eye className="w-4 h-4" /> 總瀏覽次數
          </div>
          <div className="text-3xl font-black text-slate-800">{totals.views.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
            <MousePointerClick className="w-4 h-4" /> 總點擊次數
          </div>
          <div className="text-3xl font-black text-slate-800">{totals.clicks.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="text-slate-500 text-xs font-bold mb-1">點擊率 (CTR)</div>
          <div className="text-3xl font-black text-slate-800">
            {totals.views > 0
              ? `${((totals.clicks / totals.views) * 100).toFixed(1)}%`
              : '—'}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> 載入中...
          </div>
        ) : error ? (
          <div className="p-12 text-center text-rose-600 text-sm">
            載入失敗：{error}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            本月尚無數據
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">商戶</th>
                  <th className="px-5 py-3">類別</th>
                  <th className="px-5 py-3 text-right">瀏覽</th>
                  <th className="px-5 py-3 text-right">點擊</th>
                  <th className="px-5 py-3 text-right">CTR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ctr = r.views > 0 ? ((r.clicks / r.views) * 100).toFixed(1) : '—';
                  return (
                    <tr key={r.vendorId} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-5 py-3">
                        <div className="font-bold text-slate-800">{r.vendorName}</div>
                        <div className="text-xs text-slate-400">ID: {r.vendorId}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-block bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded">
                          {r.vendorCategory || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-black text-slate-700">
                        {r.views.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right font-black text-rose-600">
                        {r.clicks.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{ctr}{ctr !== '—' && '%'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-4 text-center">
        數據自 2026 年起開始收集 · 本頁面只對 admin 用戶可見
      </p>
    </div>
  );
}