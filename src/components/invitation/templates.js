// Pure-data registry of stock invitation templates.
// Each template describes a visual layout; the renderer (InvitationCard.jsx)
// uses these props to paint text + accents on top of an optional bg image.
//
// Storage layout
// --------------
// The 6 hardcoded entries below are the BUNDLED FALLBACK. When Firestore
// has an overriding doc at artifacts/{appId}/templates/{id}, `loadLiveTemplates`
// merges it on top — admin-uploaded SVGs win, but the same 6 IDs stay stable
// so the picker never breaks.
//
// Why hardcoded IDs (not generated)
// ---------------------------------
// IDs are referenced everywhere (background templates, InvitationCard renderer,
// email templates, email log records). Changing one would orphan every saved
// invitation. Keep these stable forever.

export const INVITATION_TEMPLATES = [
  {
    id: 'plain',
    label: '簡約純白',
    palette: { bg: '#ffffff', text: '#1e293b', accent: '#e11d48', muted: '#64748b' },
    layout: 'centered',
    isPremium: false,
    previewUrl: '/templates/plain.svg',
    storagePath: 'invitation-templates/plain.svg',
    isCustom: false,
  },
  {
    id: 'tpl-rose',
    label: '玫瑰金邊',
    palette: { bg: '#fff1f2', text: '#881337', accent: '#e11d48', muted: '#9f1239' },
    layout: 'ornate',
    isPremium: false,
    previewUrl: '/templates/rose.svg',
    storagePath: 'invitation-templates/rose.svg',
    isCustom: false,
  },
  {
    id: 'tpl-jade',
    label: '翡翠中式',
    palette: { bg: '#ecfdf5', text: '#064e3b', accent: '#047857', muted: '#065f46' },
    layout: 'stacked',
    isPremium: false,
    previewUrl: '/templates/jade.svg',
    storagePath: 'invitation-templates/jade.svg',
    isCustom: false,
  },
  {
    id: 'tpl-midnight',
    label: '深藍星夜',
    palette: { bg: '#0f172a', text: '#f8fafc', accent: '#fbbf24', muted: '#cbd5e1' },
    layout: 'centered',
    isPremium: false,
    previewUrl: '/templates/midnight.svg',
    storagePath: 'invitation-templates/midnight.svg',
    isCustom: false,
  },
  {
    id: 'tpl-blush',
    label: '裸粉花卉',
    palette: { bg: '#fdf2f8', text: '#500724', accent: '#db2777', muted: '#831843' },
    layout: 'ornate',
    isPremium: false,
    previewUrl: '/templates/blush.svg',
    storagePath: 'invitation-templates/blush.svg',
    isCustom: false,
  },
  {
    id: 'tpl-sage',
    label: '鼠尾草綠',
    palette: { bg: '#f0fdf4', text: '#14532d', accent: '#16a34a', muted: '#166534' },
    layout: 'stacked',
    isPremium: false,
    previewUrl: '/templates/sage.svg',
    storagePath: 'invitation-templates/sage.svg',
    isCustom: false,
  },
];

export function getTemplate(id) {
  return INVITATION_TEMPLATES.find((t) => t.id === id) || INVITATION_TEMPLATES[0];
}

// ─── Live overlay ─────────────────────────────────────────────────────────
//
// loadLiveTemplates(db, appId) reads artifacts/{appId}/templates/* + the
// cache-buster meta doc, then returns a NEW array of 6 templates where any
// admin-uploaded overrides win over the bundled fallback. The function is
// defensive: a Firestore read failure returns the bundled fallback
// unchanged (the picker never goes blank).
//
// Why we DON'T mutate INVITATION_TEMPLATES
// ----------------------------------------
// Modules in JS are cached singletons. Mutating exports means a stale
// Vercel bundle could ship a poisoned picker the next time the user
// refreshes — once. We return a fresh array each call so the function is
// pure and the caller controls when to re-render.

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

export async function loadLiveTemplates(db, appId) {
  try {
    const snap = await getDocs(collection(db, 'artifacts', appId, 'templates'));
    if (snap.empty) return INVITATION_TEMPLATES;

    const overrides = {};
    snap.forEach((d) => { overrides[d.id] = d.data(); });

    return INVITATION_TEMPLATES.map((tpl) => {
      const ov = overrides[tpl.id];
      if (!ov) return tpl;
      return {
        ...tpl,
        // Admin-uploaded SVG wins; fall back to bundled if missing.
        previewUrl: ov.publicUrl || tpl.previewUrl,
        storagePath: ov.storagePath || tpl.storagePath,
        label: ov.label || tpl.label,
        palette: { ...tpl.palette, ...(ov.palette || {}) },
        layout: ov.layout || tpl.layout,
        // Mark as custom-uploaded so the UI shows an "updated X" badge.
        updatedAt: ov.updatedAt || null,
        updatedBy: ov.updatedBy || null,
        isCustom: true,
        // 2026-07-03 — surface upload metadata so the admin tile can
        // show "Original: 343×361 PNG" etc.
        // ov.bytes is the wrapped-SVG size; not useful for the user.
        // We surface sourceFormat + sourceDimensions from the Cloud
        // Function response (which writes these to Firestore too).
        sourceFormat: ov.sourceFormat || null,
        sourceDimensions: ov.sourceDimensions || null,
      };
    });
  } catch (err) {
    console.warn('[templates] loadLiveTemplates failed; using bundled fallback:', err);
    return INVITATION_TEMPLATES;
  }
}

// Returns the server timestamp of the last template upload (or null). The
// caller can compare against its last-known value to decide whether to
// re-fetch loadLiveTemplates.
export async function getTemplatesVersion(db, appId) {
  try {
    const snap = await getDoc(doc(db, 'artifacts', appId, 'meta', 'templates'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.updatedAt?.toMillis?.() || null;
  } catch {
    return null;
  }
}

// Preset messages the owner can pick from when filling the "personal
// note" field. Each template targets a different HK wedding tone
// (formal/traditional/casual/bilingual). The user can also write
// their own — these are starting points that respect the 200-char
// textarea limit.
export const WORDING_TEMPLATES = [
  {
    id: 'classic',
    label: '經典中式',
    icon: '囍',
    text: '謹訂於公曆二〇二六年十月十八日（星期六）下午六時，假香港麗思卡爾頓酒店三樓宴會廳，敬備喜酌。恭請蒞臨。',
  },
  {
    id: 'warm',
    label: '溫馨',
    icon: '♡',
    text: '我們結婚了 ❤️ 誠意邀請您蒞臨見證我們的重要時刻，一同分享這份喜悅。期待當晚見到您！',
  },
  {
    id: 'casual',
    label: '輕鬆',
    icon: '✨',
    text: 'Hi！我哋今年 10 月結婚啦，想邀請你一齊嚟見證 + 飲杯 🍾 唔好嘥咗個位啊！',
  },
  {
    id: 'family',
    label: '家族聚會',
    icon: '⌂',
    text: '家族大喜之日，誠邀各位親朋戚友一同慶賀見證。請於 10 月 1 日前回覆以便安排座位。',
  },
  {
    id: 'grateful',
    label: '感恩',
    icon: '🙏',
    text: '感謝您一直以來對我們嘅關懷同支持，期待喺呢個特別嘅日子同您共度。',
  },
];