// 2026-09-18 — P13.4.4: Public Find-Seat page (V1 chart-only).
// 2026-09-20 — P13.4.5 V2: name-search + highlighted-table.
//
// Anonymous-reads publicSeating/{token} for the chart, then
// optionally fetches the redacted /findSeatAssignments/{token}
// collection group for name-search. Guest types their name,
// matches are returned + the matched table pulses on the canvas.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  validatePublicUrl,
  fetchPublicSnapshot,
  matchGuestName,
} from '../lib/findSeatPure';

function FindSeatPage() {
  const [status, setStatus] = useState('loading'); // loading | valid | expired | not_found | malformed | error
  const [snap, setSnap] = useState(null);
  const [now, setNow] = useState(Date.now());

  // V2 — name-search state. The full redacted list lives
  // in memory; the typed query is matched client-side via
  // matchGuestName (case-insensitive, CJK-aware, limit 5).
  const [assignments, setAssignments] = useState([]);
  const [searchStatus, setSearchStatus] = useState('idle'); // idle | loading | ready | unavailable
  const [query, setQuery] = useState('');
  const [pulseTableId, setPulseTableId] = useState(null);

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('find-seat');
  }, []);

  useEffect(() => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const validation = validatePublicUrl(url);
    if (validation) {
      setStatus(validation);
      return;
    }
    let cancelled = false;
    (async () => {
      const out = await fetchPublicSnapshot({ doc: (p) => doc(db, p) }, token);
      if (cancelled) return;
      if (out.ok) {
        setSnap(out.snap);
        setStatus('valid');
      } else if (out.reason === 'not_found' || out.reason === 'expired' || out.reason === 'malformed_token') {
        setStatus(out.reason);
      } else {
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // V2 — fetch the redacted assignments once the chart is valid.
  // This is a single collectionGroup read; we pull ALL rows and
  // filter client-side. Cost is bounded by the # of assigned
  // guests (a 500-guest wedding is ~500 200-byte docs).
  useEffect(() => {
    if (status !== 'valid' || !token) return undefined;
    let cancelled = false;
    setSearchStatus('loading');
    (async () => {
      try {
        const snap = await getDocs(collection(db, `findSeatAssignments/${token}`));
        if (cancelled) return;
        const rows = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            guestId: d.id,
            name: data.name || '',
            tableId: data.tableId || '',
            tableLabel: data.tableLabel || data.tableId || '',
          };
        });
        setAssignments(rows);
        setSearchStatus(rows.length === 0 ? 'unavailable' : 'ready');
      } catch (e) {
        // Not-found is fine — operator may have generated V1 only.
        // Treat as "name search unavailable" rather than crashing.
        if (!cancelled) setSearchStatus('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [status, token]);

  // Tick the expiry countdown once a minute.
  useEffect(() => {
    if (status !== 'valid') return undefined;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [status]);

  const matches = useMemo(
    () => (searchStatus === 'ready' ? matchGuestName(assignments, query) : []),
    [assignments, query, searchStatus],
  );

  // Pulse the selected table for ~3 seconds so the guest can
  // spot it on the chart visually.
  useEffect(() => {
    if (!matches.length) {
      setPulseTableId(null);
      return undefined;
    }
    // Pick the first match; guests typically have one table
    // and the shortest-name-first sort puts them up top.
    const top = matches[0];
    setPulseTableId(top.tableId);
    const t = setTimeout(() => setPulseTableId(null), 3000);
    return () => clearTimeout(t);
  }, [matches]);

  const onPickMatch = useCallback((m) => {
    setQuery(m.name);
    setPulseTableId(m.tableId);
  }, []);

  if (status === 'loading') {
    return <Page><Center>載入緊…</Center></Page>;
  }
  if (status === 'malformed' || status === 'missing-url' || status === 'missing-token') {
    return (
      <Page>
        <Center>
          <h2>連結無效 🤔</h2>
          <p>請掃描主人家提供嘅 QR code，或者直接問返主人家攞新連結。</p>
        </Center>
      </Page>
    );
  }
  if (status === 'not_found') {
    return (
      <Page>
        <Center>
          <h2>搵唔到呢個座位表 😅</h2>
          <p>可能係連結打錯咗、或者主人家已經撤銷咗。請聯絡主人家再攞一次。</p>
        </Center>
      </Page>
    );
  }
  if (status === 'expired') {
    return (
      <Page>
        <Center>
          <h2>呢個座位表已經過咗期 ⏰</h2>
          <p>主人家設定嘅時限已過，請聯絡主人家重新生成 QR。</p>
        </Center>
      </Page>
    );
  }
  if (status === 'error') {
    return (
      <Page>
        <Center>
          <h2>載入失敗</h2>
          <p>網絡或者服務出咗啲問題，請稍後再試，或者搵主人家確認。</p>
        </Center>
      </Page>
    );
  }

  // status === 'valid'
  const remaining = snap.expiresAt - now;
  const minsLeft = Math.max(0, Math.floor(remaining / 60_000));
  return (
    <Page>
      <Header>
        <Title>🪑 Reception 座位表</Title>
        <Subtitle>
          搵到你嘅枱：對住位置入座，或者行到畫面嘅該位置即可。
        </Subtitle>
        {minsLeft > 0 && (
          <Badge>
            連結仲有效 {minsLeft >= 60
              ? `${Math.floor(minsLeft / 60)} 小時`
              : `${minsLeft} 分鐘`}
          </Badge>
        )}
      </Header>
      <SearchPanel
        searchStatus={searchStatus}
        query={query}
        onChangeQuery={setQuery}
        matches={matches}
        onPickMatch={onPickMatch}
      />
      <Canvas snap={snap} pulseTableId={pulseTableId} />
      <Footer>
        <span>🙏 主人家 · Powered by savetheday.io</span>
      </Footer>
    </Page>
  );
}

function SearchPanel({ searchStatus, query, onChangeQuery, matches, onPickMatch }) {
  if (searchStatus === 'unavailable') return null; // V1 fallback — no redacted assignments stamped
  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'white',
        borderBottom: '1px solid #E2E8F0',
      }}
    >
      <label
        htmlFor="find-seat-name"
        style={{
          display: 'block',
          fontSize: 12,
          color: '#64748B',
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        🔍 用你嘅名搵枱（中英名都會搵到）
      </label>
      <input
        id="find-seat-name"
        type="text"
        inputMode="search"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck="false"
        value={query}
        onChange={(e) => onChangeQuery(e.target.value)}
        placeholder="例如：Chan Tai Man / 小明"
        data-testid="find-seat-search"
        aria-label="輸入你嘅名搵枱"
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 16,
          border: '1px solid #CBD5E1',
          borderRadius: 8,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      {matches.length > 0 && (
        <ul
          data-testid="find-seat-matches"
          style={{
            listStyle: 'none',
            margin: '8px 0 0',
            padding: 0,
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {matches.map((m) => (
            <li key={m.guestId}>
              <button
                type="button"
                onClick={() => onPickMatch(m)}
                data-testid={`find-seat-match-${m.guestId}`}
                style={{
                  display: 'flex',
                  width: '100%',
                  padding: '12px 14px',
                  border: 'none',
                  background: 'white',
                  borderBottom: '1px solid #F1F5F9',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  textAlign: 'left',
                  cursor: 'pointer',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{m.name}</span>
                <span style={{ color: '#0F766E', fontSize: 13 }}>→ {m.tableLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchStatus === 'ready' && query.trim().length > 0 && matches.length === 0 && (
        <p
          data-testid="find-seat-no-match"
          style={{ color: '#94A3B8', fontSize: 12, margin: '8px 0 0' }}
        >
          搵唔到「{query.trim()}」…可能係打錯字？或者行到座位表對住枱號。
        </p>
      )}
    </div>
  );
}

function Page({ children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(to bottom, #FAFAF9, #FFFFFF)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif',
        color: '#0F172A',
      }}
    >
      {children}
    </div>
  );
}

function Center({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        textAlign: 'center',
        padding: 24,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      {children}
    </div>
  );
}

function Header({ children }) {
  return (
    <div
      style={{
        padding: '24px 16px 12px',
        textAlign: 'center',
        borderBottom: '1px solid #E2E8F0',
        background: 'white',
      }}
    >
      {children}
    </div>
  );
}

function Title({ children }) {
  return <h1 style={{ margin: 0, color: '#0F766E', fontSize: 22 }}>{children}</h1>;
}

function Subtitle({ children }) {
  return (
    <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 13 }}>
      {children}
    </p>
  );
}

function Badge({ children }) {
  return (
    <span
      style={{
        display: 'inline-block',
        marginTop: 8,
        padding: '4px 10px',
        background: '#F0FDF4',
        border: '1px solid #14B8A6',
        borderRadius: 8,
        color: '#065F46',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      ⏱ {children}
    </span>
  );
}

function Footer({ children }) {
  return (
    <footer
      style={{
        padding: 20,
        textAlign: 'center',
        color: '#94A3B8',
        fontSize: 11,
      }}
    >
      {children}
    </footer>
  );
}

/**
 * Render the seating canvas using a minimal SVG implementation.
 * Round tables for 圍 categories, rectangular for long/rect.
 * Labels centered. Categories labeled (主家席/證婚席/朋友席)
 * via the tableCategory field on the snapshot.
 */
function Canvas({ snap, pulseTableId }) {
  const { canvas: c, tables } = snap;

  // Scale-to-fit the SVG into the device width (with horizontal
  // scroll on x-overflow for narrow phones).
  return (
    <div
      style={{
        padding: 12,
      }}
    >
      <div
        data-testid="find-seat-canvas"
        style={{
          background: 'white',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          overflow: 'auto',
          maxWidth: '100%',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${c.width} ${c.height}`}
          width={c.width}
          height={c.height}
          style={{
            display: 'block',
            maxWidth: '100%',
            height: 'auto',
          }}
        >
          {tables.map((t) => renderTable(t, pulseTableId))}
        </svg>
      </div>
    </div>
  );
}

function renderTable(t, pulseTableId) {
  const w = t.shape === 'long' ? 180 : t.shape === 'rect' ? 160 : 80;
  const h = t.shape === 'long' ? 60 : t.shape === 'rect' ? 100 : 80;
  const transform = t.rotation ? `rotate(${t.rotation} ${t.x + w / 2} ${t.y + h / 2})` : undefined;
  const isLong = t.shape === 'long' || t.shape === 'rect';
  const fillByCategory = {
    bride_groom: '#FCE7F3', // 主家 pink
    ceremony: '#FEF3C7',    // 證婚 amber
    groomsmen: '#DBEAFE',   // 兄弟 blue
    bridesmaid: '#FCE7F3',
    elder_family: '#FED7AA', // 長輩 orange
    friends: '#F0FDFA',     // 朋友 teal
    kids: '#ECFDF5',
    colleagues: '#F1F5F9',
    other: '#F8FAFC',
  };
  const isPulsing = pulseTableId && pulseTableId === t.id;
  return (
    <g key={t.id} transform={transform} data-table-id={t.id}>
      {isPulsing && (
        <circle
          cx={t.x + w / 2}
          cy={t.y + h / 2}
          r={(isLong ? Math.max(w, h) : 40) + 14}
          fill="none"
          stroke="#DC2626"
          strokeWidth={3}
          opacity={0.85}
        >
          <animate
            attributeName="r"
            from={(isLong ? Math.max(w, h) : 40) + 6}
            to={(isLong ? Math.max(w, h) : 40) + 22}
            dur="1.2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.9"
            to="0"
            dur="1.2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {isLong ? (
        <rect
          x={t.x}
          y={t.y}
          width={w}
          height={h}
          rx={6}
          fill={fillByCategory[t.tableCategory] ?? '#F8FAFC'}
          stroke={isPulsing ? '#DC2626' : '#0F766E'}
          strokeWidth={isPulsing ? 3 : 1}
        />
      ) : (
        <circle
          cx={t.x + 40}
          cy={t.y + 40}
          r={40}
          fill={fillByCategory[t.tableCategory] ?? '#F8FAFC'}
          stroke={isPulsing ? '#DC2626' : '#0F766E'}
          strokeWidth={isPulsing ? 3 : 1}
        />
      )}
      <text
        x={t.x + w / 2}
        y={t.y + h / 2}
        fontSize={14}
        fontWeight={600}
        fill="#0F766E"
        textAnchor="middle"
        dominantBaseline="central"
        data-testid={`public-table-label-${t.id}`}
      >
        {t.label}
      </text>
      <text
        x={t.x + w / 2}
        y={t.y + h / 2 + 18}
        fontSize={11}
        fill="#64748B"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {t.capacity} 位
      </text>
    </g>
  );
}

export default FindSeatPage;
