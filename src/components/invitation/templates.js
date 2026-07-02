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