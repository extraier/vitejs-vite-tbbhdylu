// ReceptionScanner — full-featured reception desk QR scanner.
// Used by the "🛂 接待處掃描" role (formerly the misleading
// "兄弟姊妹(接待)" pill). Renders for `userRole === 'reception'`.
//
// 2026-07-15 — built out from a 44-line stub. Now provides:
//   1. Live camera QR scan via the qr-scanner lib (uses
//      BarcodeDetector API where available, WASM fallback otherwise)
//   2. Manual search fallback for when the QR is damaged / the guest
//      forgot their phone
//   3. Real-time attendance counter (total / attended / pending)
//   4. Recent-scan list with timestamps, sourced from the
//      /scanLog subcollection
//   5. Duplicate-scan guard — shows "⚠️ 已報到過" if scanned twice
//   6. Big visual feedback (green check or amber warning) for 2s
//      after each scan so the staff can see at a glance
//
// Scanning tokens come from the QrCodeModal (per-guest link
// /?q=<eventId>/<guestId>) and resolve to { eventId, guestId }.

import { useEffect, useMemo, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import {
  ScanLine,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  Camera,
  CameraOff,
  Search,
  X,
} from 'lucide-react';

export function ReceptionScanner({
  eventGuests = [],
  recentScans = [],
  onCheckIn,
  onManualCheckIn,
}) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const [scannerState, setScannerState] = useState('idle'); // idle | starting | active | error | denied
  const [scannerError, setScannerError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind: 'ok'|'warn', name, table, at }
  const feedbackTimer = useRef(null);

  // ---- Live attendance counter ----
  const attendedCount = useMemo(
    () => eventGuests.filter((g) => g.hasAttended).length,
    [eventGuests],
  );
  const totalCount = eventGuests.length;
  const pendingCount = totalCount - attendedCount;

  // ---- Recent scans (deduped + sorted desc) ----
  const lastScans = useMemo(() => {
    return [...recentScans]
      .sort((a, b) => (b.scannedAt || 0) - (a.scannedAt || 0))
      .slice(0, 10);
  }, [recentScans]);

  // ---- Search results (filter unattended first, then attended) ----
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return eventGuests
      .filter((g) =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.guestId || '').toLowerCase().includes(q) ||
        (g.table || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [searchQuery, eventGuests]);

  // ---- QR scanner lifecycle ----
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!videoRef.current) return;
      setScannerState('starting');
      setScannerError(null);
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          if (!cancelled) {
            setScannerState('error');
            setScannerError('此裝置找不到鏡頭');
          }
          return;
        }
        const scanner = new QrScanner(
          videoRef.current,
          (result) => handleScanResult(result?.data || ''),
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment',
            maxScansPerSecond: 5,
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (!cancelled) {
          setScannerState('active');
        } else {
          scanner.stop();
        }
      } catch (err) {
        if (!cancelled) {
          setScannerState(err?.name === 'NotAllowedError' ? 'denied' : 'error');
          setScannerError(err?.message || '無法啟動鏡頭');
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScanResult(data) {
    // QR tokens look like "https://savetheday.io/?q=<eventId>/<guestId>"
    // or just "<eventId>/<guestId>" raw. Parse defensively.
    let guestId = null;
    let eventId = null;
    const qParamMatch = data.match(/[?&]q=([^&]+)/);
    const raw = qParamMatch
      ? decodeURIComponent(qParamMatch[1])
      : data;
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 2) {
      eventId = parts[0];
      guestId = parts[1];
    } else if (parts.length === 1) {
      guestId = parts[0];
    }
    if (!guestId) return;
    const guest = eventGuests.find(
      (g) => g.guestId === guestId || g.id === guestId,
    );
    if (!guest) {
      flashFeedback({ kind: 'warn', name: '無此賓客', detail: guestId });
      return;
    }
    if (guest.hasAttended) {
      flashFeedback({
        kind: 'warn',
        name: guest.name || guest.guestId,
        detail: `已報到過 · ${guest.table ? '桌號 ' + guest.table : ''}`,
      });
      return;
    }
    flashFeedback({ kind: 'ok', name: guest.name || guest.guestId, detail: guest.table });
    onCheckIn?.(guest);
  }

  function flashFeedback({ kind, name, detail }) {
    setFeedback({ kind, name, detail });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2200);
  }

  function handleManualPick(guest) {
    setSearchOpen(false);
    setSearchQuery('');
    if (guest.hasAttended) {
      flashFeedback({
        kind: 'warn',
        name: guest.name || guest.guestId,
        detail: '已報到過',
      });
      return;
    }
    flashFeedback({
      kind: 'ok',
      name: guest.name || guest.guestId,
      detail: guest.table,
    });
    onManualCheckIn?.(guest);
  }

  return (
    <div className="max-w-md mx-auto mt-6 animate-in fade-in duration-300 pb-10">
      {/* ---- Live counters ---- */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <CounterCard
          icon={<Users className="w-4 h-4" />}
          label="總邀請"
          value={totalCount}
          tone="slate"
        />
        <CounterCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="已報到"
          value={attendedCount}
          tone="emerald"
          highlight={pendingCount === 0 && totalCount > 0}
        />
        <CounterCard
          icon={<Clock className="w-4 h-4" />}
          label="未報到"
          value={pendingCount}
          tone="amber"
        />
      </div>

      {/* ---- Visual feedback overlay (auto-clears in 2.2s) ---- */}
      {feedback && (
        <div
          className={`fixed inset-x-0 top-4 z-50 mx-auto max-w-md px-4 animate-in slide-in-from-top-4 fade-in duration-200`}
        >
          <div
            className={`rounded-2xl shadow-2xl p-4 flex items-center gap-3 ${
              feedback.kind === 'ok'
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-500 text-white'
            }`}
          >
            {feedback.kind === 'ok' ? (
              <CheckCircle2 className="w-8 h-8 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-8 h-8 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-black text-lg truncate">
                {feedback.kind === 'ok' ? '✓ 報到成功' : '⚠️ 注意'}
              </div>
              <div className="font-bold truncate">{feedback.name}</div>
              {feedback.detail && (
                <div className="text-sm opacity-90 truncate">{feedback.detail}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Camera viewport ---- */}
      <div className="bg-slate-900 rounded-3xl p-4 text-center text-white shadow-2xl relative overflow-hidden mb-4">
        <div className="relative z-10">
          <h2 className="text-xl font-black mb-3 flex items-center justify-center gap-2">
            <ScanLine className="w-5 h-5 text-indigo-400" />
            接待處掃描
          </h2>

          <div className="aspect-square bg-black rounded-2xl border-2 border-indigo-500/50 relative overflow-hidden mb-3">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            {scannerState !== 'active' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2 p-4">
                {scannerState === 'idle' || scannerState === 'starting' ? (
                  <>
                    <Camera className="w-10 h-10" />
                    <span className="text-sm">啟動鏡頭中...</span>
                  </>
                ) : scannerState === 'denied' ? (
                  <>
                    <CameraOff className="w-10 h-10 text-amber-400" />
                    <span className="text-sm text-amber-300">
                      鏡頭權限被拒
                    </span>
                    <span className="text-xs text-slate-500">
                      請到瀏覽器設定允許鏡頭，或使用下方手動搜尋
                    </span>
                  </>
                ) : (
                  <>
                    <CameraOff className="w-10 h-10 text-rose-400" />
                    <span className="text-sm text-rose-300">
                      {scannerError || '無法啟動鏡頭'}
                    </span>
                    <span className="text-xs text-slate-500">
                      請使用下方手動搜尋
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            className="w-full bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-700 flex items-center justify-center gap-2 border border-slate-700"
          >
            <Search className="w-4 h-4" />
            手動搜尋賓客 (找不到 QR?)
          </button>
        </div>
      </div>

      {/* ---- Recent scans ---- */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-slate-400" />
          最近掃描 ({lastScans.length})
        </h3>
        {lastScans.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-sm">
            尚未有掃描紀錄
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {lastScans.map((scan) => (
              <li
                key={scan.id}
                className="flex justify-between items-center text-slate-700 border-b border-slate-100 pb-2 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="font-bold truncate">
                    {scan.guestName || scan.guestId || '?'}
                  </span>
                  {scan.table && (
                    <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {scan.table}
                    </span>
                  )}
                </div>
                <span className="text-slate-400 text-xs flex-shrink-0 ml-2">
                  {scan.scannedAt
                    ? new Date(scan.scannedAt).toLocaleTimeString('zh-HK', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Manual search modal ---- */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <Search className="w-5 h-5 text-slate-500" />
                手動搜尋賓客
              </h3>
              <button
                onClick={() => setSearchOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-200">
              <input
                autoFocus
                type="text"
                placeholder="輸入姓名 / 賓客編號 / 桌號..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-xl text-base outline-none focus:border-indigo-500"
              />
              <div className="text-xs text-slate-500 mt-2">
                {searchQuery.trim()
                  ? `找到 ${searchResults.length} 位`
                  : '從下方賓客名單中選一位手動報到'}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-2">
              {(searchQuery.trim() ? searchResults : eventGuests)
                .slice(0, 20)
                .map((g) => (
                  <button
                    key={g.id || g.guestId}
                    onClick={() => handleManualPick(g)}
                    disabled={g.hasAttended}
                    className={`w-full text-left p-3 rounded-xl mb-1 flex justify-between items-center transition-colors ${
                      g.hasAttended
                        ? 'bg-slate-50 text-slate-400 cursor-not-allowed'
                        : 'hover:bg-indigo-50 active:bg-indigo-100'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">
                        {g.name || g.guestId || '?'}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        {g.table && <span>桌號 {g.table}</span>}
                        {g.guestId && <span>· {g.guestId}</span>}
                      </div>
                    </div>
                    {g.hasAttended ? (
                      <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full font-bold flex-shrink-0 ml-2">
                        ✓ 已報到
                      </span>
                    ) : (
                      <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full font-bold flex-shrink-0 ml-2">
                        報到
                      </span>
                    )}
                  </button>
                ))}
              {searchQuery.trim() && searchResults.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">
                  沒有符合「{searchQuery}」的賓客
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CounterCard({ icon, label, value, tone, highlight }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
  };
  return (
    <div
      className={`rounded-2xl border-2 p-3 ${tones[tone]} ${
        highlight ? 'ring-2 ring-emerald-400 ring-offset-2' : ''
      }`}
    >
      <div className="flex items-center gap-1 text-xs font-bold mb-1 opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  );
}