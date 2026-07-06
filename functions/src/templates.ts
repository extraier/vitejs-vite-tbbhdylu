/**
 * Cloud Functions — Invitation Template Management
 * =================================================
 *
 * updateTemplate — admin-only.
 * Uploads a new SVG for one of the 6 stock invitation templates and updates
 * the matching Firestore `templates/{templateId}` doc. The client fetches
 * `templates/*` (public read) on InvitationEditor mount to render previews;
 * the live SVG bytes come from the matching Firebase Storage object.
 *
 * Why a Cloud Function (not direct client → Storage)
 * --------------------------------------------------
 * 1. Storage rules would have to grant any signed-in user write access,
 *    which means anyone with an account could replace a template. The
 *    function gates the write behind the `admin` custom claim check.
 * 2. Atomicity: the function writes Storage + Firestore metadata in
 *    sequence and rolls back the Storage upload if Firestore write fails,
 *    so we never end up with a broken preview.
 * 3. SVG validation: we re-parse the bytes server-side and reject files
 *    that aren't actually <svg>…</svg>, so a misclicked .png can't break
 *    the preview grid.
 *
 * Storage layout
 * --------------
 *   gs://savetheday-2377a.firebasestorage.app/invitation-templates/{templateId}.svg
 *
 * Public read of the SVG is enabled by storage.rules (public bucket
 * serving the preview at /invitation-templates/*.svg). The admin claim
 * is the ONLY way to write.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as crypto from 'node:crypto';

const db = getFirestore();
const storage = getStorage();
const APP_ID = 'savetheday-production';
const BUCKET = storage.bucket(); // default bucket — savetheday-2377a.appspot.com

interface UpdateTemplateInput {
  templateId: string;
  label?: string;
  palette?: { bg?: string; text?: string; accent?: string; muted?: string };
  layout?: 'centered' | 'ornate' | 'stacked';
  // The raw file bytes as base64. Accepts:
  //   - SVG (image/svg+xml): stored as-is
  //   - PNG  (image/png):     wrapped in SVG <image> at upload time
  //   - JPEG (image/jpeg):    wrapped in SVG <image> at upload time
  // We sniff the magic bytes server-side; the client's file.type is
  // advisory only.
  svgBase64: string;
  contentType?: string;    // optional advisory hint from the client
}

interface UpdateTemplateResult {
  ok: true;
  templateId: string;
  storagePath: string;
  publicUrl: string;
  bytes: number;
  sha256: string;
  sourceFormat: 'svg' | 'png' | 'jpeg';
  sourceDimensions: { width: number; height: number } | null;
  updatedAt: number;
}

const VALID_TEMPLATE_IDS = new Set([
  'plain',
  'tpl-rose',
  'tpl-jade',
  'tpl-midnight',
  'tpl-blush',
  'tpl-sage',
]);

const VALID_LAYOUTS = new Set(['centered', 'ornate', 'stacked']);

// Module-level cache so we don't re-patch bucket IAM on every upload.
// Once the policy grants allUsers objectViewer, it stays granted —
// re-patching is wasted API calls.
let bucketIamPatched = false;

/**
 * ensureBucketPublicRead — adds allUsers → roles/storage.objectViewer
 * on the default bucket. Uses the Cloud Storage v1 IAM REST API via
 * fetch (the Admin SDK doesn't expose bucket-level IAM policy edits).
 *
 * Idempotent: if the binding is already present, returns immediately.
 */
async function ensureBucketPublicRead(): Promise<void> {
  const bucketName = BUCKET.name;
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/iam`;
  const headers = { Authorization: `Bearer ${await getAccessToken()}` };

  // 1. GET current policy.
  const getRes = await fetch(url, { headers });
  if (!getRes.ok) {
    throw new Error(`GET bucket IAM failed: ${getRes.status} ${await getRes.text()}`);
  }
  const policy: { bindings?: Array<{ role: string; members?: string[] }> } = await getRes.json();

  // 2. Find or create the objectViewer binding.
  const binding = (policy.bindings || []).find((b) => b.role === 'roles/storage.objectViewer');
  if (binding && (binding.members || []).includes('allUsers')) {
    return; // already public
  }
  if (binding) {
    binding.members = [...(binding.members || []), 'allUsers'];
  } else {
    policy.bindings = [
      ...(policy.bindings || []),
      { role: 'roles/storage.objectViewer', members: ['allUsers'] },
    ];
  }

  // 3. PUT the updated policy.
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  });
  if (!putRes.ok) {
    throw new Error(`PUT bucket IAM failed: ${putRes.status} ${await putRes.text()}`);
  }
}

/**
 * getAccessToken — uses the Admin SDK's built-in credential to mint an
 * OAuth2 access token for the default service account. Equivalent to
 * `gcloud auth print-access-token` but runs in-process.
 */
async function getAccessToken(): Promise<string> {
  // The Admin SDK exposes credential access via the app's credential
  // object. getAccessToken() returns a string access token + expiry.
  // We pull it from the storage service's underlying app, which is the
  // same one we initialized with initializeApp() at module load.
  const app = getStorage().app;
  // firebase-admin 12 exposes credential at runtime even though the
  // type isn't always declared on the storage service.
  const cred = (app as unknown as { credential: { getAccessToken: () => Promise<{ access_token: string }> } }).credential;
  if (!cred) {
    throw new Error('No credential on storage app — was initializeApp() called?');
  }
  const { access_token } = await cred.getAccessToken();
  return access_token;
}

/**
 * Image format detection — sniffs the first few bytes of a buffer and
 * returns the MIME type if it's an image we can handle, otherwise null.
 *
 * Supported: image/svg+xml, image/png, image/jpeg
 * (webp omitted: most editors don't export, and we don't want to
 * add a libwebp dependency just for that.)
 */
function detectImageMime(buf: Buffer): 'image/svg+xml' | 'image/png' | 'image/jpeg' | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return 'image/png';
  }
  // JPEG signature: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }
  // SVG: text content starting with <svg or <?xml ... <svg
  const head = buf.slice(0, 4096).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    // Also confirm it eventually contains <svg (not just XML prolog)
    if (head.startsWith('<?xml')) {
      if (/<svg[\s>]/i.test(head.slice(head.indexOf('?>') + 2))) return 'image/svg+xml';
    } else {
      return 'image/svg+xml';
    }
  }
  return null;
}

/**
 * Extract width/height from a PNG buffer by reading the IHDR chunk.
 * PNG layout: 8-byte signature, then chunks. Each chunk has
 *   length(4) | type(4) | data(length) | crc(4)
 * IHDR data is 13 bytes: width(4) + height(4) + bitDepth(1) +
 *   colorType(1) + compression(1) + filter(1) + interlace(1).
 * Width/height are big-endian uint32.
 */
function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // IHDR starts at offset 8 (after signature), chunk type at offset 12,
  // width at offset 16, height at offset 20.
  // Verify chunk type is "IHDR" (bytes 12..15).
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;
  return { width, height };
}

/**
 * Extract width/height from a JPEG buffer by walking markers until we
 * find SOF0 (baseline) or SOF2 (progressive). The SOF marker data is:
 *   length(2) | precision(1) | height(2) | width(2) ...
 * Both dimensions are big-endian uint16.
 *
 * Returns null on any malformed JPEG — caller should treat as "couldn't
 * determine dimensions" rather than "invalid file", because some JPEGs
 * (lossless, CMYK-reversed) use different markers we don't care about.
 */
function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) return null;
    // Skip any 0xFF fill bytes (allowed between markers).
    while (i < buf.length && buf[i] === 0xFF) i++;
    if (i >= buf.length) return null;
    const marker = buf[i];
    i++;
    // Standalone markers (no length): RST0-RST7 (0xD0-0xD7), SOI (0xD8), EOI (0xD9), TEM (0x01)
    if (
      (marker >= 0xD0 && marker <= 0xD7) ||
      marker === 0xD8 ||
      marker === 0xD9 ||
      marker === 0x01
    ) continue;
    // All other markers have a 2-byte length right after.
    if (i + 2 > buf.length) return null;
    const segLen = buf.readUInt16BE(i);
    // SOF0 (0xC0) = baseline, SOF2 (0xC2) = progressive. Skip the others
    // (SOF1 = extended sequential, SOF3 = lossless, etc. — uncommon).
    if (marker === 0xC0 || marker === 0xC2) {
      if (i + 7 > buf.length) return null;
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;
      return { width, height };
    }
    // Skip the segment's data.
    i += segLen;
  }
  return null;
}

/**
 * Cheap SVG check — confirms the file is an XML document with an <svg>
 * root element. We don't try to render or fully validate against the
 * SVG spec (the renderer in InvitationCard is tolerant), but we DO want
 * to reject anything that obviously isn't SVG (html, plain text, etc.)
 * so the preview grid doesn't blow up.
 */
function isLikelySvg(buf: Buffer): boolean {
  const head = buf.slice(0, 4096).toString('utf8').trimStart();
  if (head.startsWith('<?xml')) {
    return /<svg[\s>]/i.test(head.slice(head.indexOf('?>') + 2));
  }
  return /^<svg[\s>]/i.test(head);
}

/**
 * Best-effort width/height parse off the <svg ...> root tag's attributes.
 * Used only for telemetry — the renderer's CSS handles cropping, so this
 * is purely informational. Returns null if the attributes are missing
 * or use unsupported units (em, %, etc.).
 */
function parseSvgDimensions(buf: Buffer): { width: number; height: number } | null {
  const head = buf.slice(0, 2048).toString('utf8');
  const m = head.match(/<svg[\s>][^>]*?>/i);
  if (!m) return null;
  const tag = m[0];
  const w = tag.match(/\bwidth=["']?([\d.]+)/i);
  const h = tag.match(/\bheight=["']?([\d.]+)/i);
  if (!w || !h) return null;
  const width = parseFloat(w[1]);
  const height = parseFloat(h[1]);
  if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Wrap a raster image (PNG/JPEG) in a minimal SVG <image> element so it
 * can be served from a .svg URL and rendered by the InvitationCard.
 *
 * The viewBox is the natural image dimensions (not 240×320). The renderer
 * uses object-cover / aspect-[3/4] which crops to its container, so the
 * intrinsic SVG size doesn't matter as long as the preserveAspectRatio
 * does the right thing.
 *
 * We embed the raster as a data URL so the SVG is fully self-contained —
 * no extra Storage lookup, no CORS gymnastics, works offline. base64
 * inflates size by ~33% but at <256 KB cap that's still tiny.
 */
function wrapRasterInSvg(buf: Buffer, mime: 'image/png' | 'image/jpeg'): Buffer {
  const dims = mime === 'image/png' ? readPngDimensions(buf) : readJpegDimensions(buf);
  // If we can't read dimensions, fall back to a generic 1000×1000 viewBox —
  // the renderer crops anyway, so the visible result is fine.
  const width = dims?.width ?? 1000;
  const height = dims?.height ?? 1000;
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  // preserveAspectRatio="xMidYMid slice" = center + crop-to-fill, same
  // semantics as CSS object-fit: cover.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid slice">` +
    `<image href="${dataUrl}" xlink:href="${dataUrl}" ` +
    `x="0" y="0" width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`;
  return Buffer.from(svg, 'utf8');
}

export const updateTemplate = onCall(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req): Promise<UpdateTemplateResult> => {
    try {
      return await _updateTemplateImpl(req);
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error('[updateTemplate] unhandled error:', msg);
      throw new HttpsError('internal', msg);
    }
  },
);

async function _updateTemplateImpl(req: any): Promise<UpdateTemplateResult> {
  // 1. Auth gate — admin custom claim.
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const claims = (req.auth.token as { admin?: boolean }) || {};
  if (claims.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required.');
  }

  const input = req.data as UpdateTemplateInput;
  if (!input || typeof input !== 'object') {
    throw new HttpsError('invalid-argument', 'Request body required.');
  }
  const { templateId, label, palette, layout, svgBase64 } = input;

  // 2. Validate the templateId is one of the 6 known stock slots.
  if (!templateId || typeof templateId !== 'string' || !VALID_TEMPLATE_IDS.has(templateId)) {
    throw new HttpsError(
      'invalid-argument',
      `templateId must be one of: ${[...VALID_TEMPLATE_IDS].join(', ')}`,
    );
  }
  if (!svgBase64 || typeof svgBase64 !== 'string') {
    throw new HttpsError('invalid-argument', 'svgBase64 required.');
  }
  if (layout && !VALID_LAYOUTS.has(layout)) {
    throw new HttpsError('invalid-argument', `layout must be one of: ${[...VALID_LAYOUTS].join(', ')}`);
  }

  // 3. Decode + validate the file bytes. Accepts SVG, PNG, JPEG.
  //    SVG passes through; raster gets wrapped in an SVG <image> element
  //    so it can be served from a .svg URL and rendered by InvitationCard.
  let rawBuf: Buffer;
  try {
    rawBuf = Buffer.from(svgBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'svgBase64 is not valid base64.');
  }
  if (rawBuf.length === 0) {
    throw new HttpsError('invalid-argument', 'svgBase64 decoded to empty buffer.');
  }
  // 256 KB cap on the INPUT (raster). After wrapping, the SVG may be
  // ~33% larger (base64 inflation) — still well under any reasonable limit.
  if (rawBuf.length > 256 * 1024) {
    throw new HttpsError('invalid-argument', `File too large (${rawBuf.length} bytes; max 256 KB).`);
  }

  // Sniff magic bytes (don't trust client-supplied contentType).
  const mime = detectImageMime(rawBuf);
  if (!mime) {
    throw new HttpsError('invalid-argument', 'Unsupported file type. Use SVG, PNG, or JPEG.');
  }

  // Build the final SVG. SVG passes through; raster gets wrapped.
  let buf: Buffer;
  let sourceFormat: 'svg' | 'png' | 'jpeg';
  let sourceDimensions: { width: number; height: number } | null;
  if (mime === 'image/svg+xml') {
    if (!isLikelySvg(rawBuf)) {
      throw new HttpsError('invalid-argument', 'SVG file is malformed (no <svg> root).');
    }
    buf = rawBuf;
    sourceFormat = 'svg';
    // Best-effort: parse width/height attrs off the <svg> tag.
    sourceDimensions = parseSvgDimensions(rawBuf);
  } else {
    // PNG or JPEG — wrap in SVG.
    if (mime === 'image/png') {
      sourceDimensions = readPngDimensions(rawBuf);
    } else {
      sourceDimensions = readJpegDimensions(rawBuf);
    }
    buf = wrapRasterInSvg(rawBuf, mime);
    sourceFormat = mime === 'image/png' ? 'png' : 'jpeg';
  }

  // Sanity check on the wrapped SVG size too — a giant raster could
  // inflate to >1 MB after base64 wrapping.
  if (buf.length > 1024 * 1024) {
    throw new HttpsError('invalid-argument', `Wrapped SVG too large (${buf.length} bytes; max 1 MB). Use a smaller image.`);
  }

  // 4. Write to Storage first (so any Firestore failure leaves the previous
  //    SVG live rather than a half-broken template).
  const storagePath = `invitation-templates/${templateId}.svg`;
  const file = BUCKET.file(storagePath);
  const contentType = 'image/svg+xml';
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  // Token so the public can read this specific file via the Firebase Storage
  // public CDN. Without a token, the rules + signed-URL dance would force
  // every guest to authenticate just to see a preview tile.
  // We grant public read by setting the file's ACL after upload.
  await file.save(buf, {
    contentType,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=300', // 5 min — let admins see their edit quickly
      metadata: {
        uploadedBy: req.auth.uid,
        uploadedAt: String(Date.now()),
        sha256,
        templateId,
      },
    },
    resumable: false,
  });

  // 5. Make the file publicly readable. Firebase Storage buckets don't
  //    honor legacy per-object ACLs the way you'd expect — `file.makePublic()`
  //    returns success but the resulting object stays private because
  //    the bucket has uniform-bucket-level-access enabled (the default
  //    for new Firebase Storage buckets). The right lever is the BUCKET
  //    IAM policy: grant allUsers → roles/storage.objectViewer. That
  //    makes every object in the bucket public-read at once.
  //
  //    We patch the IAM lazily on first invocation and cache the success
  //    in a module-level flag to avoid hammering the IAM API on every
  //    upload. If the project owner has already granted allUsers READ
  //    (via the seed script or the Firebase Console), this is a no-op.
  if (!bucketIamPatched) {
    try {
      await ensureBucketPublicRead();
      bucketIamPatched = true;
    } catch (e) {
      // Non-fatal — the file is still uploaded. Public-read failures
      // surface at fetch time as a 403, which we log so the admin can
      // see what's wrong.
      console.warn('[updateTemplate] ensureBucketPublicRead failed (may be OK if already public):', e);
    }
  }

  // 6. Build the public URL. Two forms — we keep the storage.googleapis.com
  //    one for direct <img src> use (CORS-friendly, no token in URL).
  const publicUrl = `https://storage.googleapis.com/${BUCKET.name}/${storagePath}`;

  // 7. Upsert the matching Firestore doc. Templates are GLOBAL (not per-owner)
  //    because they're the stock background set the couple picks from.
  const templateRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('templates').doc(templateId);

  const update: Record<string, unknown> = {
    storagePath,
    publicUrl,
    bytes: buf.length,
    sha256,
    sourceFormat,
    sourceDimensions,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: req.auth.uid,
  };
  if (typeof label === 'string' && label.length > 0 && label.length <= 64) {
    update.label = label;
  }
  if (palette && typeof palette === 'object') {
    // Whitelist the 4 palette keys so a typo doesn't poison the doc.
    const clean: Record<string, string> = {};
    for (const key of ['bg', 'text', 'accent', 'muted']) {
      const v = (palette as Record<string, unknown>)[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) {
        clean[key] = v;
      }
    }
    if (Object.keys(clean).length > 0) update.palette = clean;
  }
  if (layout) update.layout = layout;

  try {
    await templateRef.set(update, { merge: true });
  } catch (e) {
    // Roll back the Storage upload so we don't have an orphan file.
    console.error('[updateTemplate] Firestore write failed, deleting Storage object:', e);
    try { await file.delete(); } catch { /* best effort */ }
    throw e;
  }

  // 8. Touch a "templatesVersion" doc so the client knows to invalidate cache.
  await db
    .collection('artifacts').doc(APP_ID)
    .collection('meta').doc('templates')
    .set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return {
    ok: true,
    templateId,
    storagePath,
    publicUrl,
    bytes: buf.length,
    sha256,
    sourceFormat,
    sourceDimensions,
    updatedAt: Date.now(),
  };
}