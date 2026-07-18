// ─── CSV parser (admin CSV import) ────────────────────────────────────────
// Tiny, dependency-free RFC-4180-ish CSV reader. Handles:
//   - quoted fields: "a, b" with literal comma
//   - escaped double quotes inside quoted fields: "he said ""ok"""
//   - CRLF / LF / CR line endings
//   - BOM stripping (Excel default)
//   - empty trailing lines (silently ignored)
//
// Returns array of objects keyed by the header row (first non-empty row).
// Caller is responsible for column-name lookup; we keep it shape-agnostic
// so this same parser can be reused for guest/tasks/rundown CSVs later.
//
// 2026-07-18 — extracted from a future in-place prototype to keep
// `vendorImport.ts` clean. The parser unit-test pattern is:
//   parseCsv('a,b\n"1, 2",3\n').rows === [{ a: '1, 2', b: '3' }]

export type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
  errors: { line: number; reason: string }[];
};

export function parseCsv(input: string): CsvParseResult {
  const errors: CsvParseResult['errors'] = [];

  // Strip BOM (Excel adds 0xFEFF on save).
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Tokenize into rows of fields.
  const records: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside quoted field.
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') {
      // Bare CR or CRLF — both treated as row terminator.
      cur.push(field);
      field = '';
      if (cur.length > 0) records.push(cur);
      cur = [];
      if (text[i + 1] === '\n') i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      field = '';
      if (cur.length > 0) records.push(cur);
      cur = [];
      continue;
    }
    field += ch;
  }
  // Flush the trailing field/row (file may not end in a newline).
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 0) records.push(cur);
  }

  // Drop fully-empty trailing rows.
  while (
    records.length > 0 &&
    records[records.length - 1].every((c) => c.trim() === '')
  ) {
    records.pop();
  }

  if (records.length === 0) {
    return { headers: [], rows: [], errors: [{ line: 0, reason: 'CSV is empty' }] };
  }

  // First non-empty row is the header.
  const headerIdx = records.findIndex((r) => r.some((c) => c.trim() !== ''));
  const rawHeaders = records[headerIdx] ?? [];
  const headers = rawHeaders.map((h) => h.trim());

  const rows: Record<string, string>[] = [];
  for (let r = headerIdx + 1; r < records.length; r++) {
    const record = records[r];
    if (record.every((c) => c.trim() === '')) continue; // blank line
    if (record.length !== headers.length) {
      errors.push({
        line: r + 1, // 1-indexed for human display
        reason: `欄位數量 (${record.length}) 與標題 (${headers.length}) 不吻合`,
      });
      // Still salvage what we can — pad with empty / truncate.
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (record[c] ?? '').trim();
    }
    rows.push(obj);
  }

  return { headers, rows, errors };
}
