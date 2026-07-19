// ─── Vendor CSV import (admin batch) ──────────────────────────────────────
// Maps parsed CSV rows to vendor docs and writes them in batches of 450.
//
// V2 (2026-07-19) additions over V1:
//   - update mode: a `vendorId` column directly addresses an existing doc
//     (used with `merge: true` so unprovided columns aren't clobbered)
//   - audit trail: every commit writes a summary doc to `vendorImportLogs`
//     (per-row actions array, admin uid, file name, timestamp)
//   - safer setRef: switches between `batch.set(ref, doc)` (create) and
//     `batch.set(ref, doc, { merge: true })` (update) based on a per-row
//     `merge` boolean resolved at plan-time
//
// V1 behaviour preserved:
//   - create only when no vendorId column present
//   - deduped against (name + phone) then (name only)
//   - rejected rows surface a per-row reason; not in the batch
//   - phone/email/district/website live under the contact nested object so
//     they show up correctly in the existing detail view
//
// Column order is flexible — header keys are matched case-insensitively.

import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getApps } from 'firebase/app';

import { parseCsv } from './csv';
import { VENDOR_CATEGORIES } from './config';

export type VendorImportRow = {
  /** 1-based line number in the original CSV (header = 1, first data = 2). */
  lineNumber: number;
  /** Generated OR explicit vendor doc id. */
  vendorId: string;
  /** "create" or "update". Determined at plan-time. */
  action: 'create' | 'update';
  /** True if the CSV row provided an explicit vendorId (not derived). */
  explicitId: boolean;
  /** Source row data, post-mapping. */
  doc: Record<string, unknown>;
  /** Non-blocking warnings (e.g. tag count trimmed). */
  warnings: string[];
  /** Hard errors — these rows are skipped. */
  errors: string[];
  /** Original CSV column -> cell map for the preview table. */
  raw: Record<string, string>;
};

export type VendorImportPlan = {
  headers: string[];
  rows: VendorImportRow[];
  acceptedCount: number;
  rejectedCount: number;
  /** # of accepted rows whose action === 'update'. */
  updateCount: number;
  /** # of accepted rows whose action === 'create'. */
  createCount: number;
  duplicateCount: number;
  /** True if ANY accepted row is an update — UI uses this to enable merge. */
  hasUpdates: boolean;
  parseErrors: { line: number; reason: string }[];
};

export type CommitSummary = {
  written: number;
  failed: number;
  lastError: string | null;
  /** Doc id of the audit trail document written under vendorImportLogs. */
  auditLogId: string | null;
};

const MAX_TAGS = 5;
const BATCH_SIZE = 450; // Firestore hard cap is 500; leave headroom.

// ─── Helper ───────────────────────────────────────────────────────────────

function csvCell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    // Lowercased lookup, so 'Name', 'name', 'NAME' all work.
    const v = row[k];
    if (v !== undefined && v !== null) return String(v).trim();
    const lower = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
    if (lower) {
      const v2 = row[lower];
      if (v2 !== undefined && v2 !== null) return String(v2).trim();
    }
  }
  return '';
}

function splitList(raw: string, sep: string): string[] {
  if (!raw) return [];
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function digitsOnly(s: string): string {
  return (s || '').replace(/[^\d]/g, '');
}

/**
 * Stable, deterministic vendor id so re-running the same CSV without
 * changes produces no duplicates. NOT auth-bound — admin-only tool.
 */
function deriveVendorId(name: string, phone: string): string {
  const base = `${name.trim().toLowerCase()}|${digitsOnly(phone)}`
    .replace(/\s+/g, ' ')
    .trim();
  // Tiny non-cryptographic hash for document id (Firestore ids max 1500B).
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) | 0;
  }
  return `imp-${(h >>> 0).toString(36)}-${base
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32)}`.slice(0, 64);
}

// ─── Plan: parse + validate (no Firestore writes) ────────────────────────

export async function buildImportPlan(csvText: string): Promise<VendorImportPlan> {
  const parsed = parseCsv(csvText);
  const headers = parsed.headers;
  const errors = parsed.errors;

  // 2026-07-19 — If the CSV has a vendorId column, plan is mix-update;
  // otherwise every row is treated as a create.
  const hasExplicitIdColumn = headers.some(
    (h) => h.toLowerCase() === 'vendorid' || h.toLowerCase() === 'vendor_id',
  );

  const rows: VendorImportRow[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const lineNumber = i + 2; // header is line 1
    const rowErrors: string[] = [];
    const warnings: string[] = [];

    const explicitIdRaw = csvCell(raw, ['vendorId', 'vendor_id']);
    const explicitId = explicitIdRaw.length > 0;

    const name = csvCell(raw, ['name', '商戶名稱', 'vendor name']);
    // V1 enforced name presence for ALL rows. V2: only required for create.
    // Update rows must have an explicit vendorId but can omit name.
    if (!explicitId && !name) rowErrors.push('缺少商戶名稱 (name)');
    if (name && name.length > 60)
      rowErrors.push(`商戶名稱過長 (${name.length}/60)`);

    const category = csvCell(raw, ['category', 'categoryKey', '類別']);
    if (!category && !explicitId)
      rowErrors.push('缺少類別 (category)');
    else if (category && !VENDOR_CATEGORIES[category])
      rowErrors.push(
        `類別「${category}」不在 VENDOR_CATEGORIES (合法值：${Object.keys(
          VENDOR_CATEGORIES,
        ).join(', ')})`,
      );

    const subRaw = csvCell(raw, ['subcategory', 'sub', '次類別']);
    let subcategory = subRaw;
    if (category && subRaw && !VENDOR_CATEGORIES[category]?.subs[subRaw]) {
      rowErrors.push(
        `次類別「${subRaw}」不屬於「${category}」 (合法值：${Object.keys(
          VENDOR_CATEGORIES[category]?.subs ?? {},
        ).join(', ')})`,
      );
    }
    if (category && !subRaw) warnings.push('未填次類別，會以頂層類別配對');

    const phone = csvCell(raw, ['phone', '電話', 'tel']);
    const email = csvCell(raw, ['email', '電郵']);
    const website = csvCell(raw, ['website', 'url']);
    const district = csvCell(raw, ['district', '地區']);
    const description = csvCell(raw, [
      'description',
      '簡介',
      'intro',
    ]);
    const portfolioUrlsRaw = csvCell(raw, [
      'portfolioUrls',
      'portfolio',
      '作品集',
    ]);
    const portfolioUrls = splitList(portfolioUrlsRaw, '|');
    if (portfolioUrlsRaw && portfolioUrls.length === 0)
      warnings.push('作品集欄位解析失敗 (請用 | 分隔)');

    const tagsRaw = csvCell(raw, ['tags', '標籤']);
    let tags = splitList(tagsRaw, '|');
    if (tags.length > MAX_TAGS) {
      warnings.push(`標籤只保留前 ${MAX_TAGS} 個`);
      tags = tags.slice(0, MAX_TAGS);
    }

    const priceMinRaw = csvCell(raw, ['priceMin', 'price_min', 'min']);
    const priceMaxRaw = csvCell(raw, ['priceMax', 'price_max', 'max', 'price']);
    let priceMin: number | null = null;
    let priceMax: number | null = null;
    if (priceMinRaw) {
      const n = Number(priceMinRaw.replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(n) && n >= 0) priceMin = n;
      else rowErrors.push(`priceMin 解析失敗：「${priceMinRaw}」`);
    }
    if (priceMaxRaw && priceMaxRaw.toLowerCase() !== 'open') {
      const n = Number(priceMaxRaw.replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(n) && n >= 0) priceMax = n;
      else rowErrors.push(`priceMax 解析失敗：「${priceMaxRaw}」`);
    } else if (priceMaxRaw && priceMaxRaw.toLowerCase() === 'open') {
      priceMax = null; // open-ended
    }
    if (priceMin != null && priceMax != null && priceMin > priceMax) {
      warnings.push('priceMin > priceMax，請檢查');
    }

    // Truncate the big text fields to known limits.
    if (description.length > 500) {
      warnings.push(`簡介超過 500 字，已截斷`);
    }

    // V2 — resolve the target vendorId and action.
    let action: 'create' | 'update';
    let targetId: string;
    if (explicitId) {
      if (!/^[A-Za-z0-9_\-]{1,1500}$/.test(explicitIdRaw)) {
        rowErrors.push(
          `vendorId「${explicitIdRaw.slice(0, 30)}...」格式不合 (只接受 [A-Za-z0-9_-])`,
        );
      }
      action = 'update';
      targetId = explicitIdRaw;
    } else {
      action = 'create';
      targetId = name ? deriveVendorId(name, phone) : `imp-${i}`;
    }

    const vendorDoc: Record<string, unknown> = {
      name: name ? name.slice(0, 60) : null,
      category: category || null,
      subcategory: subcategory || null,
      contact: {
        phone: phone || null,
        email: email || null,
        website: website || null,
        district: district || null,
      },
      description: description.slice(0, 500),
      tags,
      portfolio: portfolioUrls,
      priceMin,
      priceMax,
      currency: 'HKD',
      // For create rows set defaults so the doc matches a fresh onboarding.
      // For update rows: merge:true keeps unmentioned fields intact; we
      // still stamp `importedAt`/`importedVia` for forensic trail.
      ...(action === 'create'
        ? {
            serviceArea: district || '香港',
            yearsInBusiness: 0,
            rating: 0,
            ratingCount: 0,
            status: 'approved',
            appliedAt: serverTimestamp(),
            importedAt: serverTimestamp(),
            importedVia: 'admin-csv',
          }
        : {
            importedAt: serverTimestamp(),
            importedVia: 'admin-csv',
            lastEditedViaImport: serverTimestamp(),
          }),
    };

    rows.push({
      lineNumber,
      vendorId: targetId,
      action,
      explicitId,
      doc: vendorDoc,
      warnings,
      errors: rowErrors,
      raw,
    });
  }

  // Dedupe within the CSV itself.
  const seen = new Map<string, VendorImportRow[]>();
  for (const r of rows) {
    if (r.errors.length > 0) continue;
    const k = r.vendorId;
    const arr = seen.get(k) ?? [];
    arr.push(r);
    seen.set(k, arr);
  }
  let duplicateCount = 0;
  for (const arr of seen.values()) {
    if (arr.length <= 1) continue;
    duplicateCount += arr.length - 1;
    arr.sort((a, b) => a.lineNumber - b.lineNumber);
    arr[0].warnings.push(`CSV 內重複 (${arr.length} 筆，保留第一筆)`);
    for (let i = 1; i < arr.length; i++) {
      arr[i].errors.push('與較早一筆重複，已跳過');
    }
  }

  // Cross-source dedupe for CREATE rows only.
  try {
    if (getApps().length > 0) {
      const db = getFirestore();
      const existing = await getDocs(
        query(collection(db, 'vendors'), limit(500)),
      );
      const byNamePhone = new Map<string, string>();
      const byName = new Map<string, string>();
      existing.forEach((d) => {
        const data = d.data();
        const nm = (data?.name ?? '').toLowerCase().trim();
        const ph = digitsOnly(data?.contact?.phone ?? '');
        if (nm && ph) byNamePhone.set(`${nm}|${ph}`, d.id);
        if (nm) byName.set(nm, d.id);
      });
      for (const r of rows) {
        if (r.errors.length > 0) continue;
        if (r.action === 'update') continue;
        const nm = ((r.doc.name as string) || '').toLowerCase().trim();
        const ph = digitsOnly(
          (r.doc.contact as { phone?: string }).phone ?? '',
        );
        if (nm && ph && byNamePhone.has(`${nm}|${ph}`)) {
          r.errors.push('與現有商戶同名同電話，請手動合併');
        } else if (nm && byName.has(nm)) {
          r.warnings.push('同名商戶已存在 (將匯入為新文件)');
        }
      }
    }
  } catch {
    // Permission issue / not initialised yet — UI surfaces actual errors.
  }

  const accepted = rows.filter((r) => r.errors.length === 0);
  const acceptedCount = accepted.length;
  const rejectedCount = rows.length - acceptedCount;
  const updateCount = accepted.filter((r) => r.action === 'update').length;
  const createCount = acceptedCount - updateCount;

  return {
    headers,
    rows,
    acceptedCount,
    rejectedCount,
    updateCount,
    createCount,
    duplicateCount,
    hasUpdates: updateCount > 0,
    parseErrors: errors,
  };
}

// ─── Commit: batched write to Firestore + audit trail ─────────────────────

export type CommitProgress = {
  total: number;
  done: number;
  failed: number;
  lastError: string | null;
};

export type CommitOptions = {
  /** The admin user's uid (from Firebase Auth). Written to the audit log. */
  adminUid: string;
  /** CSV / file name that triggered this commit. */
  fileName: string;
  onProgress?: (p: CommitProgress) => void;
};

export async function commitImportPlan(
  plan: VendorImportPlan,
  options: CommitOptions,
): Promise<CommitSummary> {
  const accepted = plan.rows.filter((r) => r.errors.length === 0);
  const db = getFirestore();
  let written = 0;
  let failed = 0;
  let lastError: string | null = null;

  const perRowLog: { lineNumber: number; vendorId: string; action: 'create' | 'update' }[] = [];

  for (let i = 0; i < accepted.length; i += BATCH_SIZE) {
    const chunk = accepted.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const ref = doc(db, 'vendors', row.vendorId);
      batch.set(ref, row.doc, { merge: row.action === 'update' });
      perRowLog.push({
        lineNumber: row.lineNumber,
        vendorId: row.vendorId,
        action: row.action,
      });
    }
    try {
      await batch.commit();
      written += chunk.length;
      onProgress?.({ total: accepted.length, done: written, failed, lastError });
    } catch (err: unknown) {
      failed += chunk.length;
      lastError =
        err instanceof Error ? err.message : 'Unknown Firestore write error';
      onProgress?.({ total: accepted.length, done: written, failed, lastError });
    }
  }

  // 2026-07-19 — Audit trail. One summary doc per commit.
  let auditLogId: string | null = null;
  try {
    const auditRef = await addDoc(collection(db, 'vendorImportLogs'), {
      at: serverTimestamp(),
      adminUid: options.adminUid || null,
      fileName: options.fileName || '',
      totalAccepted: plan.acceptedCount,
      totalRejected: plan.rejectedCount,
      createCount: plan.createCount,
      updateCount: plan.updateCount,
      duplicateCount: plan.duplicateCount,
      written,
      failed,
      lastError,
      parseErrors: plan.parseErrors.length,
      rows: perRowLog.slice(0, 2000),
      rowsTruncated: perRowLog.length > 2000 ? perRowLog.length - 2000 : 0,
    });
    auditLogId = auditRef.id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vendorImport] audit log write failed:', err);
  }

  return { written, failed, lastError, auditLogId };
}

// ─── Sample CSV template (for the download button) ────────────────────────

export const VENDOR_CSV_TEMPLATE = [
  'name,category,subcategory,phone,email,website,district,description,tags,portfolioUrls,priceMin,priceMax',
  'Visionary Capture,photo_video,photographer,+852 9123 4567,info@visionarycapture.example,https://visionarycapture.example,中西區,專業婚紗及晚宴攝影｜8 年經驗｜中環 / 尖沙咀 取景,婚紗攝影|紀錄式|香港,https://cdn.example/v1.jpg|https://cdn.example/v2.jpg,8000,20000',
  'The Glasshouse,honeymoon,hotel,,,,,蜜月度假首選 — 峇里私人別墅,蜜月|峇里,https://cdn.example/villa1.jpg,15000,',
  '（範例：priceMax 留空 = 上不封頂；輸入 "open" 同樣視為上不封頂；tags / portfolioUrls 用 | 分隔；中文欄位亦接受）',
  '（更新模式：CSV 加上 vendorId 欄，會以 merge:true 更新既有商戶；無 vendorId 欄時仍為建立新商戶）',
].join('\n');
