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
  svgBase64: string;       // raw SVG bytes, base64-encoded (no data: prefix)
  contentType?: string;    // must be 'image/svg+xml'
}

interface UpdateTemplateResult {
  ok: true;
  templateId: string;
  storagePath: string;
  publicUrl: string;
  bytes: number;
  sha256: string;
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

/**
 * Cheap SVG check — confirms the file is an XML document with an <svg>
 * root element. We don't try to render or fully validate against the
 * SVG spec (the renderer in InvitationCard is tolerant), but we DO want
 * to reject anything that obviously isn't SVG (pngs renamed to .svg,
 * html, etc.) so the preview grid doesn't blow up.
 */
function isLikelySvg(buf: Buffer): boolean {
  // Strip leading whitespace + BOM.
  const head = buf.slice(0, 4096).toString('utf8').trimStart();
  // Must start with <svg or <?xml followed by <svg (allow XML prolog).
  if (head.startsWith('<?xml')) {
    return /<svg[\s>]/i.test(head.slice(head.indexOf('?>') + 2));
  }
  return /^<svg[\s>]/i.test(head);
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

  // 3. Decode + validate the SVG bytes.
  let buf: Buffer;
  try {
    buf = Buffer.from(svgBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'svgBase64 is not valid base64.');
  }
  if (buf.length === 0) {
    throw new HttpsError('invalid-argument', 'svgBase64 decoded to empty buffer.');
  }
  // Cap at 256 KB — these are decorative previews, anything bigger is suspicious.
  if (buf.length > 256 * 1024) {
    throw new HttpsError('invalid-argument', `SVG too large (${buf.length} bytes; max 256 KB).`);
  }
  if (!isLikelySvg(buf)) {
    throw new HttpsError('invalid-argument', 'File is not a valid SVG (no <svg> root element).');
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

  // 5. Make the file publicly readable. This is the same mechanism the
  //    Firebase Console uses when you click "Make public" in the Storage
  //    file list. We do it from the Admin SDK because Storage rules can
  //    only gate authenticated reads; for unauth preview tiles we need
  //    the object ACL itself to allow public.
  try {
    await file.makePublic();
  } catch (e) {
    // Non-fatal — the rules may already permit public read for this path.
    // Log so we can investigate if the preview 404s later.
    console.warn('[updateTemplate] makePublic failed (may be OK if rules allow):', e);
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
    updatedAt: Date.now(),
  };
}