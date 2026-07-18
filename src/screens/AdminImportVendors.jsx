import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Play,
  Upload,
  XCircle,
} from 'lucide-react';

import {
  buildImportPlan,
  commitImportPlan,
  VENDOR_CSV_TEMPLATE,
} from '../lib/vendorImport';

// ─── Admin-only CSV import for vendors ─────────────────────────────────────
//
// Flow:
//   1. Pick a CSV (drag-drop OR click-to-select)
//   2. Parse + validate (per-row red/yellow/green) — preview table
//   3. Confirm "Import N new vendors"
//   4. Batch-write to Firestore (450/batch); live progress bar
//   5. Done — toast + link back to admin-vendors
//
// 2026-07-18 — initial version. Create-only (no upsert/update path).
// See src/lib/vendorImport.ts for the parser + mapper.
export function AdminImportVendors({ user, isAdmin, onBack }) {
  const [file, setFile] = useState(null);
  const [fileText, setFileText] = useState('');
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [parsingError, setParsingError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [commitResult, setCommitResult] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  // Auto-rebuild plan whenever the fileText changes.
  useEffect(() => {
    if (!fileText) {
      setPlan(null);
      setParsingError(null);
      return;
    }
    let cancelled = false;
    setPlanning(true);
    setParsingError(null);
    buildImportPlan(fileText)
      .then((p) => {
        if (cancelled) return;
        setPlan(p);
        setPlanning(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setParsingError(err?.message || 'CSV 解析失敗');
        setPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileText]);

  const acceptedRows = useMemo(
    () => (plan ? plan.rows.filter((r) => r.errors.length === 0) : []),
    [plan],
  );
  const rejectedRows = useMemo(
    () => (plan ? plan.rows.filter((r) => r.errors.length > 0) : []),
    [plan],
  );
  const warningRows = useMemo(
    () => (plan ? plan.rows.filter((r) => r.warnings.length > 0) : []),
    [plan],
  );

  // ─── File handlers ────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setParsingError(`只接受 .csv 檔 (收到 ${file.name})`);
      return;
    }
    setFile(file);
    setCommitResult(null);
    setProgress({ done: 0, total: 0, failed: 0 });
    const reader = new FileReader();
    reader.onload = (e) => setFileText(String(e.target?.result || ''));
    reader.onerror = () =>
      setParsingError(`讀取檔案失敗: ${reader.error?.message || 'unknown'}`);
    reader.readAsText(file, 'utf-8');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    handleFile(f);
  }

  function handleDownloadTemplate() {
    const blob = new Blob([VENDOR_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'savetheday-vendor-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Commit ───────────────────────────────────────────────────────────

  async function handleCommit() {
    if (!plan || acceptedRows.length === 0) return;
    if (
      !confirm(
        `確認要批次匯入 ${acceptedRows.length} 個商戶？\n\n` +
          `會新增 Firestore 文件 (vendors collection)。\n` +
          `重複的商戶名稱會跳過。`,
      )
    ) {
      return;
    }
    setCommitting(true);
    setProgress({ done: 0, total: acceptedRows.length, failed: 0 });
    const result = await commitImportPlan(plan, (p) =>
      setProgress({
        done: p.done,
        total: p.total,
        failed: p.failed,
      }),
    );
    setCommitResult(result);
    setCommitting(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-slate-100">
          <XCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">管理員專用</h2>
          <p className="text-slate-500">此頁面僅供管理員使用。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto mt-8 px-4 pb-16">
      <div className="mb-8">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 text-sm mb-3"
          >
            <ArrowLeft className="w-4 h-4" /> 返回商戶控制台
          </button>
        )}
        <div className="flex items-center gap-3 mb-2">
          <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
          <h1 className="text-3xl font-black text-slate-900">
            批次匯入商戶 (CSV)
          </h1>
        </div>
        <p className="text-slate-500">
          準備好一份包含全部商戶資料的 CSV 檔，整批上傳到 Firestore。
          行內格式錯誤會被跳過，匯入前可預覽。
        </p>
      </div>

      {/* ── Step 1: Pick file ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-sm font-black">
              1
            </span>
            上載 CSV 檔
          </h2>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-3 py-2 rounded-lg"
          >
            <Download className="w-4 h-4" /> 下載範本
          </button>
        </div>

        <label
          htmlFor="vendor-csv-input"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={handleDrop}
          className="block border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
        >
          <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-700 font-bold">
            {file ? file.name : '點擊選擇 .csv 檔 或 拖到這裡'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            接受 CSV 格式 ｜ 預設編碼 UTF-8 (Excel 輸出亦可)
          </p>
          <input
            id="vendor-csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="hidden"
          />
        </label>

        {parsingError && (
          <div className="mt-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{parsingError}</span>
          </div>
        )}
      </section>

      {/* ── Step 2: Preview ── */}
      {planning && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6 text-slate-500">
          解析中…
        </div>
      )}

      {plan && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-sm font-black">
                2
              </span>
              預覽及確認
            </h2>
            <div className="flex gap-2 text-sm flex-wrap">
              <Stat
                label="總行數"
                value={plan.rows.length}
                tone="slate"
              />
              <Stat
                label="可匯入"
                value={plan.acceptedCount}
                tone="emerald"
              />
              {plan.rejectedCount > 0 && (
                <Stat
                  label="錯誤"
                  value={plan.rejectedCount}
                  tone="rose"
                />
              )}
              {warningRows.length > 0 && (
                <Stat
                  label="警告"
                  value={warningRows.length}
                  tone="amber"
                />
              )}
              {plan.duplicateCount > 0 && (
                <Stat
                  label="CSV 內重複"
                  value={plan.duplicateCount}
                  tone="amber"
                />
              )}
            </div>
          </div>

          {plan.parseErrors.length > 0 && (
            <details className="mb-3 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm">
              <summary className="font-bold text-rose-700 cursor-pointer">
                CSV 解析錯誤 ({plan.parseErrors.length})
              </summary>
              <ul className="mt-2 space-y-1 text-rose-700">
                {plan.parseErrors.map((e, i) => (
                  <li key={i}>
                    第 {e.line} 行: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {acceptedRows.length > 0 && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      行
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      商戶名稱
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      類別 · 次類別
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      電話
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      地區
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      價位
                    </th>
                    <th className="text-left px-3 py-2 font-bold text-slate-600">
                      標籤
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {acceptedRows.slice(0, 50).map((r) => (
                    <tr
                      key={r.lineNumber}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 text-slate-500">
                        {r.lineNumber}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-800">
                        {r.doc.name}
                        {r.warnings.length > 0 && (
                          <span
                            className="ml-1 text-amber-600"
                            title={r.warnings.join('\n')}
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {(r.doc.subcategory
                          ? `${r.doc.category} · ${r.doc.subcategory}`
                          : r.doc.category) || (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.doc.contact?.phone || (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.doc.serviceArea || (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.doc.priceMin != null && r.doc.priceMax != null
                          ? `${r.doc.priceMin}–${r.doc.priceMax}`
                          : r.doc.priceMin != null && r.doc.priceMax === null
                            ? `${r.doc.priceMin}+`
                            : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.doc.tags.length > 0
                          ? r.doc.tags.join(' · ')
                          : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {acceptedRows.length > 50 && (
                <div className="text-center text-xs text-slate-400 py-2 bg-slate-50">
                  預覽只顯示首 50 筆；匯入時會處理全部 {acceptedRows.length}{' '}
                  筆
                </div>
              )}
            </div>
          )}

          {rejectedRows.length > 0 && (
            <details
              className="mt-4 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm"
              open={showErrors}
              onToggle={(e) => setShowErrors(e.target.open)}
            >
              <summary className="font-bold text-rose-700 cursor-pointer">
                錯誤詳情 ({rejectedRows.length})
              </summary>
              <ul className="mt-2 space-y-1 text-rose-700">
                {rejectedRows.map((r) => (
                  <li key={r.lineNumber}>
                    第 {r.lineNumber} 行 · {r.doc.name || '(無名稱)'}：
                    {r.errors.join('；')}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {warningRows.length > 0 && (
            <details
              className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm"
              open={showWarnings}
              onToggle={(e) => setShowWarnings(e.target.open)}
            >
              <summary className="font-bold text-amber-700 cursor-pointer">
                警告詳情 ({warningRows.length})
              </summary>
              <ul className="mt-2 space-y-1 text-amber-700">
                {warningRows.map((r) => (
                  <li key={r.lineNumber}>
                    第 {r.lineNumber} 行 · {r.doc.name}：
                    {r.warnings.join('；')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ── Step 3: Commit ── */}
      {plan && acceptedRows.length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-sm font-black">
              3
            </span>
            確認匯入
          </h2>

          <button
            type="button"
            disabled={committing}
            onClick={handleCommit}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50"
          >
            {committing ? (
              <>
                <svg
                  className="animate-spin w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    className="opacity-75"
                  />
                </svg>
                匯入中…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                匯入 {acceptedRows.length} 個商戶到 Firestore
              </>
            )}
          </button>

          {committing && (
            <div className="mt-4">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {progress.done} / {progress.total} 已寫入 (失敗：{progress.failed}
                )
              </p>
            </div>
          )}

          {commitResult && (
            <div
              className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${
                commitResult.failed === 0
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-amber-50 border border-amber-200 text-amber-700'
              }`}
            >
              {commitResult.failed === 0 ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <span>
                已寫入 <b>{commitResult.written}</b> 個商戶文件
                {commitResult.failed > 0 && (
                  <>
                    ；有 <b>{commitResult.failed}</b> 個批次的寫入失敗。
                    {commitResult.lastError && (
                      <>
                        <br />
                        <span className="text-xs">
                          最近錯誤：{commitResult.lastError}
                        </span>
                      </>
                    )}
                  </>
                )}
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Stat pill ──────────────────────────────────────────────────────────
function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span
      className={`px-3 py-1.5 rounded-lg border text-sm font-bold ${tones[tone]}`}
    >
      {label} <span className="ml-1 text-base">{value}</span>
    </span>
  );
}
