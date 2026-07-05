// Pure-data registry of stock invitation templates.
// Each template describes a visual layout; the renderer (InvitationCard.jsx)
// uses these props to paint text + accents on top of an optional bg image.

export const INVITATION_TEMPLATES = [
  {
    id: 'plain',
    label: '簡約純白',
    palette: { bg: '#ffffff', text: '#1e293b', accent: '#e11d48', muted: '#64748b' },
    layout: 'centered',
    isPremium: false,
    previewUrl: '/templates/plain.svg',
  },
  {
    id: 'tpl-rose',
    label: '玫瑰金邊',
    palette: { bg: '#fff1f2', text: '#881337', accent: '#e11d48', muted: '#9f1239' },
    layout: 'ornate',
    isPremium: false,
    previewUrl: '/templates/rose.svg',
  },
  {
    id: 'tpl-jade',
    label: '翡翠中式',
    palette: { bg: '#ecfdf5', text: '#064e3b', accent: '#047857', muted: '#065f46' },
    layout: 'stacked',
    isPremium: false,
    previewUrl: '/templates/jade.svg',
  },
  {
    id: 'tpl-midnight',
    label: '深藍星夜',
    palette: { bg: '#0f172a', text: '#f8fafc', accent: '#fbbf24', muted: '#cbd5e1' },
    layout: 'centered',
    isPremium: false,
    previewUrl: '/templates/midnight.svg',
  },
  {
    id: 'tpl-blush',
    label: '裸粉花卉',
    palette: { bg: '#fdf2f8', text: '#500724', accent: '#db2777', muted: '#831843' },
    layout: 'ornate',
    isPremium: false,
    previewUrl: '/templates/blush.svg',
  },
  {
    id: 'tpl-sage',
    label: '鼠尾草綠',
    palette: { bg: '#f0fdf4', text: '#14532d', accent: '#16a34a', muted: '#166534' },
    layout: 'stacked',
    isPremium: false,
    previewUrl: '/templates/sage.svg',
  },
];

export function getTemplate(id) {
  return INVITATION_TEMPLATES.find((t) => t.id === id) || INVITATION_TEMPLATES[0];
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