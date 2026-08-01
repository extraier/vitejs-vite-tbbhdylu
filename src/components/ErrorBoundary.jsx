// 2026-08-01 (incident response) — top-level <ErrorBoundary>
//
// Wraps the App() root so any uncaught render error is surfaced
// to the console instead of leaving <div id="root"> empty.
//
// Without this boundary, React 18 production unmounts the whole
// tree on error and (importantly) silent-aborts when the error
// fires synchronously during the first render commit. We've been
// debugging a blank-page incident where this swallowed the
// actual failure mode.
//
// Once the blank-page root cause is identified, this stays —
// it's the same pattern the host element uses for other
// surfaces (LandingScreen, EventRenameModal). Cheap, no
// behavioural change for the happy path.

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error, info: null };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info);
    this.setState({ error, info });
  }

  render() {
    if (this.state.error) {
      // Render a visible diagnostic so production users can
      // give us a screenshot. We deliberately avoid throwing
      // here (we'd just loop).
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: '#f8fafc',
            color: '#0f172a',
            fontFamily:
              'system-ui, -apple-system, "PingFang HK", sans-serif',
          }}
        >
          <h1 style={{ fontSize: '20px', fontWeight: 700 }}>
            ⚠️ 系統發生錯誤
          </h1>
          <p style={{ fontSize: '14px', color: '#475569' }}>
            我們已自動記錄錯誤。麻煩你:
          </p>
          <ol style={{ fontSize: '14px', color: '#475569', paddingLeft: '20px' }}>
            <li>截圖呢個畫面</li>
            <li>撳 Cmd/Ctrl+R 強制 reload(可能解決暫時性問題)</li>
            <li>如果重複出現,請傳截圖到 https://t.me/roooo</li>
          </ol>
          <details
            style={{
              marginTop: '16px',
              fontSize: '12px',
              color: '#64748b',
              background: '#fff',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              技術詳情(給開發者)
            </summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginTop: '8px',
              }}
            >
              {String(this.state.error?.stack || this.state.error)}
              {this.state.info?.componentStack
                ? `\n\nComponent stack:\n${this.state.info.componentStack}`
                : ''}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: '#0f172a',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            強制 Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
