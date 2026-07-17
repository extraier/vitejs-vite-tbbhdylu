// Share-shortlist helpers for the 🔍 商戶指南.
//
// Builds a human-readable text message (WhatsApp / LINE /
// email-friendly) from a list of vendors, and triggers
// navigator.share on mobile (which pops the native share sheet)
// or falls back to navigator.clipboard.writeText on desktop.
//
// Text shape (zh-HK):
//   📍 Save The Day — 商戶指南
//
//   我們嘅心水商戶：
//
//   1. Visionary Capture (攝影攝錄 · 婚禮攝影師) ⭐ 4.9
//      $18,000+
//
//   2. FairyTale Floral (佈置花藝 · 婚禮花藝佈置) ⭐ 4.8
//      $25,000+
//
//   一齊去 https://savetheday.io 睇更多啦！

import { VENDOR_CATEGORIES } from './config';

function categoryLabels(vendor) {
  const cfg = VENDOR_CATEGORIES[vendor.category];
  const top = cfg ? cfg.label : vendor.category;
  const sub = vendor.subcategory
    ? cfg?.subs?.[vendor.subcategory] || vendor.subcategory
    : null;
  return sub ? `${top} · ${sub}` : top;
}

function formatPrice(vendor) {
  // Keep price verbatim so languages / ranges / 上 bid work.
  return vendor.price || 'Price on request';
}

// Build the message text from a vendor list. The optional userName
// adds a greeting prefix if provided.
export function buildShortlistMessage(vendors, userName) {
  const greet = userName ? `Hi 我係 ${userName}，` : 'Hi，';
  if (!vendors || vendors.length === 0) return '';
  const lines = [];
  lines.push(`${greet}呢幾個商戶我哋覺得幾好：`); // "These vendors look good to us"
  lines.push('');
  vendors.forEach((v, i) => {
    const featured = v.featured ? '⭐ 推薦 · ' : '';
    const rating = v.rating ? ` · ${v.rating.toFixed(1)}★` : '';
    lines.push(
      `${i + 1}. ${v.name} — ${categoryLabels(v)}${rating ? rating : ''}${
        v.featured ? ' ' + featured.trim() : ''
      }`.replace(/\s+/g, ' '),
    );
    lines.push(`   ${formatPrice(v)}`);
  });
  lines.push('');
  lines.push('一齊去 https://savetheday.io 睇更多啦！');
  return lines.join('\n').trim();
}

// Trigger share sheet on mobile, copy to clipboard on desktop.
// Returns the formatted text so the caller can show a toast
// confirmation if needed.
export async function shareOrCopyShortlist(vendors, userName) {
  const text = buildShortlistMessage(vendors, userName);
  if (!text) return text;

  // Mobile path — native share sheet (WhatsApp / LINE / Email).
  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ text })
  ) {
    try {
      await navigator.share({
        title: 'Save The Day — 商戶指南',
        text,
      });
      return text;
    } catch (e) {
      // User cancelled or share failed — fall through to copy.
    }
  }

  // Desktop path — copy to clipboard.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return text;
    } catch (e) {
      // Permission denied / insecure context — last-ditch: prompt.
    }
  }

  // Last-resort fallback: prompt for manual copy.
  // eslint-disable-next-line no-alert
  window.prompt('複製呢段訊息：', text);
  return text;
}
