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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { parseGuestQrToken } from '../lib/firestorePaths';
import { playSuccessChime } from '../lib/successChime';
import { shouldAutoOpenManualFallback } from '../lib/manualFallback';
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
  ownerUid: activeOwnerUid = null,
  eventId: activeEventId = null,
}) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const [scannerState, setScannerState] = useState('idle'); // idle | starting | active | error | denied
  const [scannerError, setScannerError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind: 'ok'|'warn', name, table, at, id }
  const feedbackTimer = useRef(null);

  // 2026-08-25 — Manus P9: optional Web Audio success chime.
  // Browsers require a user gesture before audio can start; we
  // expose a button so staff can opt in once per session.
  const audioContextRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const enableSuccessSound = useCallback(async () => {
    const AudioContextClass =
      typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;

    if (!AudioContextClass) {
      setSoundEnabled(false);
      return;
    }

    const context = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = context;

    try {
      if (context.state === 'suspended') await context.resume();
      setSoundEnabled(context.state === 'running');
    } catch {
      // Audio remains optional. Visual feedback is always reliable.
      setSoundEnabled(false);
    }
  }, []);

  useEffect(
    () => () => {
      audioContextRef.current?.close?.().catch(() => {});
    },
    [],
  );

  // 2026-08-25 — Manus P9: manual fallback state. Auto-opens
  // after a 「無效 QR Code」 or 「無此賓客」 warning so staff
  // can pick a guest from the dropdown immediately. Cross-owner
  // / cross-event warnings do NOT auto-open — those are
  // intentional safety stops, not fallbacks.
  const [manualGuestKey, setManualGuestKey] = useState('');
  const [showManualFallback, setShowManualFallback] = useState(false);

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

  // ---- Manual fallback list (pending first, then by name) ----
  const manualGuestOptions = useMemo(
    () =>
      [...eventGuests].sort((a, b) => {
        if (Boolean(a.hasAttended) !== Boolean(b.hasAttended)) {
          return Number(a.hasAttended) - Number(b.hasAttended);
        }
        return (a.name || a.guestId || '').localeCompare(
          b.name || b.guestId || '',
          'zh-HK',
        );
      }),
    [eventGuests],
  );

  const selectedManualGuest = useMemo(
    () =>
      manualGuestOptions.find(
        (guest) => (guest.id || guest.guestId) === manualGuestKey,
      ) || null,
    [manualGuestKey, manualGuestOptions],
  );

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
            onDecodeError: (error) => {
              const message = error?.message || String(error || '');
              // Normal camera frames rarely contain a QR code. This is
              // expected, not an actionable scanner failure.
              if (/no qr code found/i.test(message)) return;
              // Preserve unexpected decoder diagnostics without flooding console.
              console.warn('[ReceptionScanner] QR decode error:', error);
            },
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
    const result = resolveScan({
      raw: data,
      activeOwnerUid,
      activeEventId,
      eventGuests,
    });
    if (result.kind === 'checkin') {
      // Audio cue first; visual feedback must not depend on it.
      playSuccessChime({ context: audioContextRef.current });
      flashFeedback({
        kind: 'ok',
        name: result.guest.name || result.guest.guestId,
        detail: result.guest.table,
      });
      onCheckIn?.(result.guest);
      return;
    }
    flashFeedback({ kind: 'warn', name: result.name, detail: result.detail });

    // Auto-open the manual fallback for ordinary QR failures. We
    // deliberately do NOT auto-open on 其他婚禮/其他活動 — those
    // are safety stops, not prompts to check in someone else.
    if (shouldAutoOpenManualFallback(result)) {
      setShowManualFallback(true);
    }
  }

  function flashFeedback({ kind, name, detail }) {
    // Unique id per feedback so React re-mounts the card and
    // the success animation replays on each scan, not just on
    // the first one. Date.now() is sufficient resolution for
    // 2.2s-clearTimeout feedback cycles.
    setFeedback({
      kind,
      name,
      detail,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
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
    // Audio cue first; visual feedback must not depend on it.
    playSuccessChime({ context: audioContextRef.current });
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
          key={feedback.id}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`fixed inset-x-0 top-4 z-50 mx-auto max-w-md px-4 animate-in slide-in-from-top-4 fade-in duration-200`}
        >
          <div
            className={`relative overflow-hidden rounded-2xl shadow-2xl p-4 flex items-center gap-3 ${
              feedback.kind === 'ok'
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-500 text-white'
            }`}
          >
            {feedback.kind === 'ok' && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-2xl bg-white/20 motion-safe:animate-ping"
              />
            )}
            {feedback.kind === 'ok' ? (
              <CheckCircle2 className="relative z-10 w-10 h-10 flex-shrink-0 motion-safe:animate-bounce" />
            ) : (
              <AlertCircle className="relative z-10 w-8 h-8 flex-shrink-0" />
            )}
            <div className="relative z-10 flex-1 min-w0">
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
            type="button"
            onClick={enableSuccessSound}
            className={`w-full mb-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
              soundEnabled
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
            }`}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? '🔊 成功提示音已啟用' : '🔈 點按啟用成功提示音'}
          </button>

          <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-3 text-left">
            <button
              type="button"
              onClick={() => {
                setShowManualFallback((visible) => !visible);
                setSearchOpen(true);
              }}
              className="w-full text-white font-bold py-2 flex items-center justify-between gap-2"
              aria-expanded={showManualFallback}
            >
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                QR 掃描失敗？改用手動賓客名單
              </span>
              <span aria-hidden="true">{showManualFallback ? '⌃' : '⌄'}</span>
            </button>

            {showManualFallback && (
              <div className="mt-3 space-y-3 border-t border-slate-700 pt-3">
                <label
                  className="block text-sm font-bold text-slate-100"
                  htmlFor="manual-guest-select"
                >
                  從目前婚禮的賓客名單選擇
                </label>
                <select
                  id="manual-guest-select"
                  value={manualGuestKey}
                  onChange={(event) => setManualGuestKey(event.target.value)}
                  className="w-full rounded-xl border border-slate-500 bg-white px-3 py-3 text-slate-900"
                >
                  <option value="">請選擇賓客…</option>
                  {manualGuestOptions.map((guest) => {
                    const key = guest.id || guest.guestId;
                    return (
                      <option
                        key={key}
                        value={key}
                        disabled={guest.hasAttended}
                      >
                        {(guest.name || guest.guestId || '未命名賓客') +
                          (guest.table ? ` · 桌號 ${guest.table}` : '') +
                          (guest.hasAttended ? ' · 已報到' : '')}
                      </option>
                    );
                  })}
                </select>

                {selectedManualGuest && (
                  <div className="rounded-xl bg-slate-700 px-3 py-2 text-sm text-white">
                    <div className="font-bold">
                      {selectedManualGuest.name || selectedManualGuest.guestId}
                    </div>
                    <div className="text-slate-300">
                      {selectedManualGuest.table
                        ? `桌號 ${selectedManualGuest.table}`
                        : '未設定桌號'}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!selectedManualGuest || selectedManualGuest.hasAttended}
                  onClick={() => {
                    if (!selectedManualGuest) return;
                    handleManualPick(selectedManualGuest);
                    setManualGuestKey('');
                    setShowManualFallback(false);
                  }}
                  className="w-full rounded-xl bg-indigo-500 py-3 font-bold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-600"
                >
                  {selectedManualGuest?.hasAttended
                    ? '此賓客已報到'
                    : '確認手動報到'}
                </button>

                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="w-full text-sm font-bold text-indigo-200 underline"
                >
                  以姓名、編號或桌號搜尋
                </button>
              </div>
            )}
          </div>
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
              {(searchQuery.trim() ? searchResults : manualGuestOptions).map((g) => (
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

/**
 * Pure resolution of a scan payload → a decision tree.
 *
 * Extracted from the React component so the binding logic
 * (parseGuestQrToken + owner/event guard + guest lookup +
 * attendance check) is unit-testable without mocking QrScanner
 * or mounting React. The component wraps this with feedback UI
 * and onCheckIn callback.
 *
 * 2026-08-25 — P8: reception desk was rejecting valid invitation
 * QRs because the parser only knew the legacy ?q=event/guest form.
 * The canonical format is now ?o=owner&e=event&g=guest. We also
 * bind the lookup to the active owner/event so the scanner can
 * never silently check in a guest from a different wedding.
 */
export function resolveScan({
  raw,
  activeOwnerUid = null,
  activeEventId = null,
  eventGuests = [],
}) {
  const parsed = parseGuestQrToken(raw);

  if (!parsed?.guestId) {
    return {
      kind: 'warn',
      name: '無效 QR Code',
      detail: '請掃描由 Save The Day 產生的嘉賓邀請 QR Code',
    };
  }

  // Never redirect the scanner to a QR-selected wedding. The QR
  // must belong to the owner/event already assigned to this desk.
  if (
    activeOwnerUid &&
    parsed.ownerUid &&
    parsed.ownerUid !== activeOwnerUid
  ) {
    return {
      kind: 'warn',
      name: '其他婚禮的 QR Code',
      detail: '此 QR Code 不屬於目前接待處的婚禮',
    };
  }

  if (
    activeEventId &&
    parsed.eventId &&
    parsed.eventId !== activeEventId
  ) {
    return {
      kind: 'warn',
      name: '其他活動的 QR Code',
      detail: '請確認目前已選擇正確婚禮',
    };
  }

  if (eventGuests.length === 0) {
    return {
      kind: 'warn',
      name: '賓客名單載入中',
      detail: '請稍候數秒後重新掃描，或使用手動搜尋',
    };
  }

  const guest = eventGuests.find(
    (candidate) =>
      candidate.guestId === parsed.guestId ||
      candidate.id === parsed.guestId,
  );

  if (!guest) {
    return {
      kind: 'warn',
      name: '無此賓客',
      detail: parsed.guestId,
    };
  }

  if (guest.hasAttended) {
    return {
      kind: 'warn',
      name: guest.name || guest.guestId,
      detail: `已報到過${guest.table ? ` · 桌號 ${guest.table}` : ''}`,
    };
  }

  return { kind: 'checkin', guest };
}