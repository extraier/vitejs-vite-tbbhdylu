// 2026-09-20 — V2 #2: pure QR-string generation helper.
//
// Wraps the `qrcode` package's `toString` SVG path so the
// rendering layer can be tested without bundling the qrcode
// library. `qrcode.toString` produces an SVG document with
// the matrix inside — much smaller than the dataURL PNG,
// and the operator can save it as a vector file.
//
// We keep this tiny so the seating chunk doesn't pay for
// qrcode's encoder until the operator actually opens the
// Find-Seat sheet (which lazy-imports the package).

import QRCode from 'qrcode';

/**
 * Render a URL to an SVG string suitable for inlining into
 * an `<img src="data:image/svg+xml,...">` or rendering
 * directly as SVG.
 *
 * Options tuned for a 320x320 print target on a 2x retina
 * scan — margin of 2 modules, ECC level M (denser QR
 * that's still recoverable if ~15% gets smudged).
 *
 * @param {string} url - the URL to encode
 * @returns {Promise<string>} an SVG document string
 */
export async function renderUrlToSvg(url) {
  if (!url) throw new Error('renderUrlToSvg: url is required');
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

/**
 * Render a URL to a PNG dataURL (base64-encoded). Smaller
 * browser support surface than SVG, but works everywhere
 * and renders crisply at any size when sized via CSS.
 *
 * @param {string} url - the URL to encode
 * @returns {Promise<string>} a `data:image/png;base64,…` URL
 */
export async function renderUrlToPngDataUrl(url) {
  if (!url) throw new Error('renderUrlToPngDataUrl: url is required');
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}
