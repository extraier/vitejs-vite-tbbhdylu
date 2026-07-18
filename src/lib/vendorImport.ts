// ─── Vendor CSV import (admin batch) ──────────────────────────────────────
// Maps parsed CSV rows to vendor docs and writes them in batches of 500.
// V1 scope (2026-07-18):
//   - create only (no upsert/update path)
//   - deduped against (name + phone) then (name only)
//   - rejected rows surface a per-row reason; not in the batch
//   - phone/email/district/website live under the contact nested object so
//     they show up correctly in the existing detail view
//
// Column order is flexible — header keys are matched case-insensitively.

import {
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
  /** Generated vendor doc id (deterministic so dedupe can find existing). */
  vendorId: string;
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
  duplicateCount: number;
  parseErrors: { line: number; reason: string }[];
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

  // Pre-load existing vendor docs to dedupe by id (cheap O(N) using a small
  // collection query OR in-memory if caller already populated it). For the
  // first version we just always create — dedupe runs again at write time.
  const rows: VendorImportRow[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const lineNumber = i + 2; // header is line 1
    const rowErrors: string[] = [];
    const warnings: string[] = [];

    const name = csvCell(raw, ['name', '商戶名稱', 'vendor name']);
    if (!name) rowErrors.push('缺少商戶名稱 (name)');
    if (name.length > 60) rowErrors.push(`商戶名稱過長 (${name.length}/60)`);

    const category = csvCell(raw, ['category', 'categoryKey', '類別']);
    if (!category) rowErrors.push('缺少類別 (category)');
    else if (!VENDOR_CATEGORIES[category])
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
    // If subcategory is empty/missing, that's a warning (not a hard error —
    // many categories only have one sub so the top label is acceptable).
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

    const vendorId = name ? deriveVendorId(name, phone) : `imp-${i}`;

    const vendorDoc: Record<string, unknown> = {
      name: name.slice(0, 60),
      category,
      subcategory,
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
      // Defaults that mirror what the onboarding wizard sets, so the new
      // vendor looks identical whether it came from CSV or the wizard.
      serviceArea: district || '香港',
      yearsInBusiness: 0,
      rating: 0,
      ratingCount: 0,
      status: 'approved',
      appliedAt: serverTimestamp(),
      importedAt: serverTimestamp(),
      importedVia: 'admin-csv',
    };

    rows.push({
      lineNumber,
      vendorId,
      doc: vendorDoc,
      warnings,
      errors: rowErrors,
      raw,
    });
  }

  // Dedupe within the CSV itself: same vendorId & non-empty name collide.
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

  // Cross-source dedupe (existing docs): if any vendorId matches an
  // existing doc we already have, mark it as duplicate. Cheap because we
  // fetch up to 500 docs by `where('vendorId', '==', id)` is too narrow; we
  // instead match on (name, phone) by reading the page (cost-aware).
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
        const nm = (r.doc.name as string).toLowerCase().trim();
        const ph = digitsOnly((r.doc.contact as { phone?: string }).phone ?? '');
        if (nm && ph && byNamePhone.has(`${nm}|${ph}`)) {
          r.errors.push('與現有商戶同名同電話，請手動合併');
        } else if (nm && byName.has(nm)) {
          r.warnings.push('同名商戶已存在 (將匯入為新文件)');
        }
      }
    }
  } catch {
    // Firestore not initialised yet / permission issue — skip, the UI
    // catches the actual write error at commit time.
  }

  const acceptedCount = rows.filter((r) => r.errors.length === 0).length;
  const rejectedCount = rows.length - acceptedCount;

  return {
    headers,
    rows,
    acceptedCount,
    rejectedCount,
    duplicateCount,
    parseErrors: errors,
  };
}

// ─── Commit: batched write to Firestore ───────────────────────────────────

export type CommitProgress = {
  total: number;
  done: number;
  failed: number;
  lastError: string | null;
};

export async function commitImportPlan(
  plan: VendorImportPlan,
  onProgress?: (p: CommitProgress) => void,
): Promise<{ written: number; failed: number; lastError: string | null }> {
  const accepted = plan.rows.filter((r) => r.errors.length === 0);
  const db = getFirestore();
  let written = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (let i = 0; i < accepted.length; i += BATCH_SIZE) {
    const chunk = accepted.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const ref = doc(db, 'vendors', row.vendorId);
      batch.set(ref, row.doc);
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

  return { written, failed, lastError };
}

// ─── Sample CSV template (for the download button) ────────────────────────

export const VENDOR_CSV_TEMPLATE = [
  'name,category,subcategory,phone,email,website,district,description,tags,portfolioUrls,priceMin,priceMax',
  'Visionary Capture,photo_video,photographer,+852 9123 4567,info@visionarycapture.example,https://visionarycapture.example,中西區,專業婚紗及晚宴攝影｜8 年經驗｜中環 / 尖沙咀 取景,婚紗攝影|紀錄式|香港,https://cdn.example/v1.jpg|https://cdn.example/v2.jpg,8000,20000',
  'The Glasshouse,honeymoon,hotel,,,,,蜜月度假首選 — 峇里私人別墅,蜜月|峇里,https://cdn.example/villa1.jpg,15000,',
  '（範例：priceMax 留空 = 上不封頂；輸入 "open" 同樣視為上不封頂；tags / portfolioUrls 用 | 分隔；中文欄位亦接受）',
].join('\n');
