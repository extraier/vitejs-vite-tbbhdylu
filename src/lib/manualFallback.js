// 2026-08-25 — Manus P9.
//
// Pure helper that decides whether the QR-scan failure path
// should auto-open the manual fallback section. Extracted from
// ReceptionScanner.handleScanResult so we can test the matrix
// without mounting React.
//
// Cross-owner / cross-event warnings are intentional safety
// stops — they must NOT auto-open the manual fallback because
// that could let staff silently check in someone else.

const AUTO_OPEN_NAMES = new Set(['無效 QR Code', '無此賓客']);

export function shouldAutoOpenManualFallback(result) {
  if (!result || result.kind !== 'warn') return false;
  return AUTO_OPEN_NAMES.has(result.name);
}