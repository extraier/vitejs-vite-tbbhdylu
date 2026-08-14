// AdminCspReports — admin-only diagnostic view for CSP violation
// reports persisted by /api/csp-report.
//
// Storage layout (matches api/csp-report.js writer):
//   /artifacts/{appId}/admin/cspReports/reports/{autoId}
//   fields: violatedDirective, effectiveDirective, documentUri,
//           blockedUri, disposition, source, lineNumber, columnNumber,
//           sample, clientIp, ua, createdAt, timestamp
//
// Rules (firestore.rules):
//   match /cspReports/{reportId} {
//     allow read: if isAdmin();
//     allow write: if false;
//   }
//
// 2026-08-14 — M-06 follow-up. The /api/csp-report endpoint
// started persisting real CSP reports in production after the
// `dd45934` + `6ac232c` commits. Admins now have a view to
// inspect what's actually being violated.
//
// 2026-08-14 — also fixes a small visibility gap: the admin
// UI is the only way to read cspReports (no Cloud Function
// wrapper). We use the client SDK directly with the existing
// admin claim to satisfy the read rule. No data leaves the
// browser besides the Firestore reads.

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  Lock,
  AlertCircle,
  Loader2,
  Shield,
  Globe,
  RefreshCw,
  Clock,
  FileWarning,
} from 'lucide-react';
import { db, appId } from '../lib/firebase';

// Path is fixed by the writer in api/csp-report.js. We use the
// production appId explicitly (matches resolveAppId default).
const REPORTS_COLLECTION = `artifacts/${appId}/admin/cspReports/reports`;
const PAGE_SIZE = 50; // bounded so the screen stays responsive

// Marshal a Firestore Timestamp-ish (or ISO string) value into a
// JS Date. Returns null for missing/invalid values.
function toDate(v) {
  if (!v) return null;
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000);
  }
  return null;
}

// Extract a short host from a URL or URI for compact display.
function shortHost(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const u = new URL(uri);
    return u.host;
  } catch {
    // blocked-uri can be 'inline' or 'eval' etc. — return as-is.
    return uri.length > 40 ? uri.slice(0, 40) + '…' : uri;
  }
}

export function AdminCspReports({ isAdmin }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, REPORTS_COLLECTION),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const docs = [];
      snap.forEach((d) => {
        const data = d.data();
        docs.push({
          id: d.id,
          ...data,
          // Marshal createdAt to a JS Date for sorting + display.
          createdAtDate: toDate(data.createdAt) || toDate(data.timestamp),
        });
      });
      setReports(docs);
      setLastFetched(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to load CSP reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // Top-violated-directive aggregation. We group by the
  // violated-directive field so admins can see which policy
  // is being violated most often.
  const topDirectives = useMemo(() => {
    const counts = new Map();
    for (const r of reports) {
      const key = r.violatedDirective || r.effectiveDirective || '(unknown)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [reports]);

  // ---- Admin gate ----
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-100">
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">管理員專用</h2>
          <p className="text-slate-500">此頁面僅供管理員使用。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto mt-8 px-4 pb-16">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900 mb-2 flex items-center gap-2">
            <Shield className="w-7 h-7 text-indigo-600" /> CSP 違規報告
          </h1>
          <p className="text-slate-500">
            由 <code>/api/csp-report</code> 收集嘅瀏覽器 CSP 警告。
            內容包括違規 directive、被阻擋嘅 URI、來源頁等。
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          重新整理
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-rose-900">載入失敗</div>
            <div className="text-sm text-rose-700 whitespace-pre-wrap">{error}</div>
            <div className="text-xs text-rose-600 mt-2">
              提示：常見原因係 <code>isAdmin()</code> claim 唔存在；請確認 Firebase Auth token 內有 <code>admin: true</code>。
            </div>
          </div>
        </div>
      )}

      {/* Top-directive summary */}
      {!loading && reports.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h2 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-amber-600" />
            最常被違反嘅 directive
          </h2>
          <ul className="space-y-2">
            {topDirectives.map(([directive, count]) => (
              <li key={directive} className="flex items-center justify-between gap-3">
                <code className="text-xs text-slate-700 truncate">{directive}</code>
                <span className="text-xs font-mono text-slate-500 whitespace-nowrap">
                  {count} 次
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">載入中…</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <Shield className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-900 mb-1">冇 CSP 違規記錄</h2>
          <p className="text-sm text-slate-500">
            過去 <strong>冇任何瀏覽器</strong> 觸發過 CSP 違規。
            當有真實違規時，瀏覽器會自動 POST 到 <code>/api/csp-report</code>，呢度會列出最新 {PAGE_SIZE} 條。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500 px-1">
            最近 {reports.length} 條報告
            {lastFetched && (
              <> · 最後載入於 {lastFetched.toLocaleTimeString()}</>
            )}
          </div>
          {reports.map((r) => (
            <ReportRow key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Sub-component: single report row ----
function ReportRow({ report }) {
  const when = report.createdAtDate;
  const timeStr = when ? when.toLocaleString() : '—';
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <code className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
            {report.violatedDirective || report.effectiveDirective || 'unknown'}
          </code>
          <span className="text-xs text-slate-400">→</span>
          <code className="text-xs text-slate-700 truncate max-w-[280px]">
            {report.blockedUri || '(no blocked-uri)'}
          </code>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap flex-shrink-0">
          <Clock className="w-3 h-3" />
          {timeStr}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <DetailRow icon={Globe} label="來源頁" value={shortHost(report.documentUri)} />
        <DetailRow
          icon={FileWarning}
          label="來源"
          value={report.source === 'reporting-api' ? 'Reporting API' : 'legacy CSP'}
        />
        {report.lineNumber != null && (
          <DetailRow
            icon={FileWarning}
            label="行/列"
            value={`${report.lineNumber}:${report.columnNumber || 0}`}
          />
        )}
        {report.clientIp && (
          <DetailRow icon={Globe} label="來源 IP" value={report.clientIp} />
        )}
      </div>
      {report.sample && (
        <details className="mt-2">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
            顯示 script sample
          </summary>
          <pre className="mt-2 text-[10px] bg-slate-900 text-slate-100 p-2 rounded overflow-x-auto">
            {report.sample}
          </pre>
        </details>
      )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="font-semibold">{label}：</span>
      <span className="text-slate-700 truncate">{value}</span>
    </div>
  );
}
