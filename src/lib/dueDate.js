// Task due-date formatting helpers. Shared between the couple
// checklist UI and the vendor dashboard so both render the date
// consistently and in Traditional-Chinese.
//
// Conventions (2026-07-17):
//   - `dueDate` is 'YYYY-MM-DD' (mandatory, populated by date picker)
//   - `dueTime` is 'HH:MM'       (optional, populated by time picker;
//                                  empty string = all-day / date-only)
//
// `formatAbsoluteDue` returns the short, scannable label used in
// chips ("今天 14:30" / "明天" / "12月31日 14:30").
// `formatLongAbsoluteDue` returns the full ISO-style stamp for
// hover tooltips ("2026-12-31 14:30").

/**
 * @param {string} dueDate 'YYYY-MM-DD'
 * @param {string} dueTime 'HH:MM' or ''
 * @param {Date}   now     current Date (defaults to now; injected for tests)
 */
export function formatAbsoluteDue(dueDate, dueTime, now = new Date()) {
  if (!dueDate) return '';
  const [y, m, d] = dueDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dueDate;
  const localMidnight = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDelta = Math.round((localMidnight - today) / 86_400_000);

  let dateLabel;
  if (dayDelta === 0) dateLabel = '今天';
  else if (dayDelta === 1) dateLabel = '明天';
  else if (dayDelta === -1) dateLabel = '昨天';
  else if (dayDelta === 2) dateLabel = '後天';
  else dateLabel = `${m}月${d}日`;

  if (dueTime) {
    const [hh, mm] = dueTime.split(':');
    const h = hh && hh.replace(/^0/, '');
    return `${dateLabel} ${h}:${mm}`;
  }
  return dateLabel;
}

export function formatLongAbsoluteDue(dueDate, dueTime) {
  if (!dueDate) return '';
  return `${dueDate}${dueTime ? ` ${dueTime}` : ''}`;
}
