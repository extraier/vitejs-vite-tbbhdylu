// 2026-08-01 — top-level mount.
//
// <ErrorBoundary> wraps <App /> so any uncaught render error is
// surfaced to the console instead of leaving <div id="root">
// empty. See src/components/ErrorBoundary.jsx for the rationale
// (blank-page incident — previously errors during the first
// render commit were silent).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
