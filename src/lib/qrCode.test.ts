// 2026-09-20 — V2 #2: tests for the QR-string helper. Skips
// in browser environment (qrcode requires node canvas); the
// SSR-style pure helpers still get coverage.
//
// We test the input-validation guards synchronously; the
// actual qrcode encoding is exercised by the build's runtime
// smoke check (the Find-Seat sheet renders it).

import { describe, it, expect } from 'vitest';
import { renderUrlToSvg, renderUrlToPngDataUrl } from './qrCode';

describe('renderUrlToSvg', () => {
  it('rejects empty urls', async () => {
    await expect(renderUrlToSvg('')).rejects.toThrow(/required/);
    await expect(renderUrlToSvg(null)).rejects.toThrow(/required/);
    await expect(renderUrlToSvg(undefined)).rejects.toThrow(/required/);
  });
});

describe('renderUrlToPngDataUrl', () => {
  it('rejects empty urls', async () => {
    await expect(renderUrlToPngDataUrl('')).rejects.toThrow(/required/);
    await expect(renderUrlToPngDataUrl(null)).rejects.toThrow(/required/);
    await expect(renderUrlToPngDataUrl(undefined)).rejects.toThrow(/required/);
  });
});
