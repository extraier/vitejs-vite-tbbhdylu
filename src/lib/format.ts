/**
 * Number/money formatting helpers.
 *
 * All display sites for monetary amounts (budget screen, task list, budget
 * editor, toast messages) MUST use `formatMoney()` so thousands separators
 * stay consistent across the app. Raw `${task.actualCost}` produces ugly
 * outputs like "$10000" — always use `formatMoney()` instead.
 *
 * The display formatter uses `Intl.NumberFormat('en-US')` rather than
 * `.toLocaleString()` so the same code path runs in SSR (if we add it later)
 * and tests — `toLocaleString` respects the runtime's ICU data which varies
 * between Node versions and can produce surprising results in some locales.
 */

const EN_US = new Intl.NumberFormat('en-US');

/** Format a number with thousands separators. `"1234567"` → `"1,234,567"`. */
export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return EN_US.format(n);
}

/** Format a monetary amount with thousands separators and `$` prefix.
 *  `1234567` → `"$1,234,567"`, `0` → `"$0"`, `null` → `"$0"`.
 *  Floors to integer (no decimals) — every monetary field in the app is an
 *  integer dollar amount by product decision.
 */
export function formatMoney(value: number | string | null | undefined): string {
  return `$${formatNumber(value)}`;
}

/** Strip thousands separators and parse to integer. `"1,234,567"` → `1234567`.
 *  Used by the cost-editor input handler to round-trip user-typed formatted
 *  strings back into raw numbers for Firestore writes.
 */
export function parseFormattedNumber(formatted: string): number {
  if (!formatted) return 0;
  const digits = String(formatted).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Format a vendor's price range for display.
 *
 *   priceMin=8000,  priceMax=18000  → "HKD $8,000 - $18,000"
 *   priceMin=18000, priceMax=null   → "HKD $18,000+"
 *   priceMin=0,     priceMax=null   → "HKD 價格另議"
 *
 * Falls back to the legacy `vendor.price` string if neither new field is set
 * (back-compat for any vendor record that pre-dates this commit). The legacy
 * string is shown as-is so we never lose information.
 */
export function formatVendorPrice(vendor: {
  priceMin?: number;
  priceMax?: number | null;
  currency?: string;
  price?: string;
}): string {
  const currency = vendor.currency || 'HKD';
  if (typeof vendor.priceMin === 'number') {
    const min = formatNumber(vendor.priceMin);
    if (vendor.priceMax === null || vendor.priceMax === undefined) {
      // Open-ended top (e.g. "$18,000+") OR price-on-request (priceMin === 0).
      if (vendor.priceMin === 0) return `${currency} 價格另議`;
      return `${currency} $${min}+`;
    }
    return `${currency} $${min} - $${formatNumber(vendor.priceMax)}`;
  }
  // Legacy fallback — show whatever string the vendor had.
  return vendor.price || '';
}

/**
 * Score a vendor's fit against a couple's task budget.
 *
 * Returns:
 *   0  → range contains the budget exactly (perfect fit, top of list)
 *   1  → under budget  (priceMax ≤ budget)         — still good
 *   2  → slightly over (priceMin ≤ budget × 1.2)  — borderline
 *   3  → way over     (priceMin > budget × 1.2)   — bottom of list
 *   4  → no budget provided (or vendor has no price) — neutral, falls back
 *           to other sort signals
 *
 * Within a tier, callers can sort by `Math.abs(midpoint - budget)` to push
 * the most balanced match to the top.
 */
export function budgetFitTier(
  vendor: { priceMin?: number; priceMax?: number | null },
  taskBudget: number | null | undefined,
): 0 | 1 | 2 | 3 | 4 {
  if (!taskBudget || taskBudget <= 0) return 4;
  if (typeof vendor.priceMin !== 'number') return 4;

  const max = vendor.priceMax ?? vendor.priceMin; // open-ended top ⇒ treat as exact match if min ≤ budget
  const min = vendor.priceMin;

  // Range fully contains the budget — perfect.
  if (min <= taskBudget && taskBudget <= max) return 0;
  // All packages under budget.
  if (max <= taskBudget) return 1;
  // Slightly over (within 20% wiggle room).
  if (min <= taskBudget * 1.2) return 2;
  return 3;
}

/**
 * Distance from a vendor's price midpoint to the task budget, in dollars.
 * Lower = better fit (within a tier). Returns Infinity if either is missing.
 *
 *   vendor.priceMax=null  → midpoint = priceMin × 1.5  (assume 50% headroom)
 *   vendor.priceMin=0     → midpoint = Infinity        (price-on-request)
 */
export function budgetDistance(
  vendor: { priceMin?: number; priceMax?: number | null },
  taskBudget: number | null | undefined,
): number {
  if (!taskBudget || taskBudget <= 0) return Infinity;
  if (typeof vendor.priceMin !== 'number' || vendor.priceMin === 0) {
    return Infinity;
  }
  const midpoint =
    vendor.priceMax === null || vendor.priceMax === undefined
      ? vendor.priceMin * 1.5
      : (vendor.priceMin + vendor.priceMax) / 2;
  return Math.abs(midpoint - taskBudget);
}