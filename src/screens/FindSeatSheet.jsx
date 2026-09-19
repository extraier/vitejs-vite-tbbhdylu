// 2026-09-18 — P13.4.4: Find-Seat QR (operator side).
//
// Owner generates a random token, writes a publicSeating
// snapshot doc to Firestore, and renders a QR + URL for
// guests to scan. Token TTL defaults to 11:59 PM tonight.
// Regenerate button stamps a fresh doc (does NOT update —
// rules forbid update; just creates a new doc with a new
// token, old link immediately expires because no one knows
// the new random token).

import { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  generateFindSeatToken,
  defaultTokenExpiry,
  formatTokenExpiry,
  tokenTimeRemaining,
  buildPublicSnapshot,
  buildFindSeatUrl,
} from '../lib/findSeatPure';

function FindSeatSheet({
  ownerUid,
  eventId,
  meta,
  tables,
  onClose,
}) {
  const [token, setToken] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const regenerate = async () => {
    setWriting(true);
    setError(null);
    setCopied(false);
    try {
      const newToken = generateFindSeatToken();
      const expiry = defaultTokenExpiry();
      const snap = buildPublicSnapshot(eventId, ownerUid, meta, tables, expiry);
      await setDoc(doc(db, `publicSeating/${newToken}`), snap);
      setToken(newToken);
      setExpiresAt(expiry);
    } catch (e) {
      console.error('[find-seat] regenerate', e);
      setError('無法產生 QR，請稍後再試');
    }
    setWriting(false);
  };

  // Auto-generate on mount.
  useEffect(() => {
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick the countdown every 30s.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const url = token && typeof window !== 'undefined'
    ? buildFindSeatUrl(window.location.origin + window.location.pathname, token)
    : null;

  // QR via Google Charts (no API key, returns PNG). 320x320 is the
  // smallest reliable render on a 2x retina scan.
  const qrSrc = url
    ? `https://chart.googleapis.com/chart?cht=qr&chs=320x320&chld=L|0&chl=${encodeURIComponent(url)}`
    : null;

  const remaining = expiresAt ? tokenTimeRemaining(expiresAt, now) : '...';
  const isExpired = expiresAt && expiresAt.getTime() <= now;

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('[find-seat] copy', e);
    }
  };

  return (
    <div role="dialog" style={modalBackdrop} onClick={onClose}>
      <div
        data-testid="find-seat-sheet"
        style={{ ...modalCard, maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>📱 Find-Seat QR</h3>
        <p style={{ color: '#64748B', fontSize: 13 }}>
          賓客用手機掃呢個 QR 就睇到座位表，唔需要登入。
        </p>

        {error && (
          <div
            style={{
              padding: 10,
              background: '#FEF2F2',
              color: '#991B1B',
              borderRadius: 6,
              marginTop: 12,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {qrSrc ? (
          <div
            data-testid="find-seat-qr"
            style={{
              marginTop: 16,
              padding: 16,
              background: 'white',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              textAlign: 'center',
            }}
          >
            <img
              src={qrSrc}
              alt="Find-Seat QR"
              width="320"
              height="320"
              style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
              crossOrigin="anonymous"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                setError('QR 圖片載入失敗 — 請用以下 URL 嘅連結');
              }}
            />
          </div>
        ) : (
          <div
            style={{
              marginTop: 16,
              padding: 32,
              textAlign: 'center',
              color: '#94A3B8',
              background: '#F8FAFC',
              borderRadius: 8,
            }}
          >
            {writing ? '產生緊…' : '產生 QR 中'}
          </div>
        )}

        {url && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
              連結（可分享到 WhatsApp / Telegram / IG Story）：
            </div>
            <div
              data-testid="find-seat-url"
              style={{
                display: 'flex', gap: 6, alignItems: 'center',
              }}
            >
              <input
                readOnly
                value={url}
                data-testid="find-seat-url-input"
                style={{
                  flex: 1, padding: '8px 10px', fontSize: 12,
                  border: '1px solid #CBD5E1', borderRadius: 6,
                  fontFamily: 'monospace', background: '#F8FAFC',
                }}
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                data-testid="find-seat-copy"
                style={{
                  padding: '8px 12px', fontSize: 12, fontWeight: 600,
                  border: '1px solid #0F766E',
                  background: copied ? '#0F766E' : 'white',
                  color: copied ? 'white' : '#0F766E',
                  borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ 已複製' : '📋 複製'}
              </button>
            </div>
          </div>
        )}

        {expiresAt && (
          <div
            data-testid="find-seat-expiry"
            style={{
              marginTop: 16,
              padding: 10,
              background: isExpired ? '#FEF2F2' : '#F0FDF4',
              border: '1px solid ' + (isExpired ? '#DC2626' : '#14B8A6'),
              borderRadius: 6,
              fontSize: 12,
              color: isExpired ? '#991B1B' : '#065F46',
            }}
          >
            {isExpired ? '⚠️ 已過期' : `✓ 有效至今日 ${formatTokenExpiry(expiresAt)} · 仲有 ${remaining}`}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={regenerate}
            disabled={writing}
            data-testid="find-seat-regenerate"
            style={{
              padding: '6px 12px', fontSize: 12,
              border: '1px solid #14B8A6', background: 'white',
              color: '#0F766E', borderRadius: 6, cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            🔄 重新產生（新 token · 舊連結失效）
          </button>
          <button onClick={onClose} style={btnGhost}>關閉</button>
        </div>
      </div>
    </div>
  );
}

// Style helpers — duplicates of CoupleSeating.jsx style block to
// keep FindSeatSheet self-contained. If a future refactor moves
// styles to a shared module, both will pick it up.
const modalBackdrop = {
  position: 'fixed', inset: 0,
  background: 'rgba(15, 23, 42, 0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 16,
};
const modalCard = {
  background: 'white', borderRadius: 12, padding: 20,
  width: '100%', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
};
const btnGhost = {
  padding: '6px 12px', fontSize: 12,
  border: '1px solid #CBD5E1', background: 'white',
  color: '#475569', borderRadius: 6, cursor: 'pointer',
};

export default FindSeatSheet;
