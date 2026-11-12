// Paths the product already links to. There is no Save the Day policy
// text in the repo. public/privacy.html was a FoodSwipe HK policy and
// is not used here.

const PAGES = {
  privacy: { zh: '私隱', en: 'Privacy' },
  terms: { zh: '條款', en: 'Terms' },
  tos: { zh: '條款', en: 'Terms' },
  'vendor-terms': { zh: '商戶服務條款', en: 'Vendor terms' },
};

export function legalNoticeKey(pathname) {
  const path = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  const key = path.replace(/^\//, '');
  return Object.prototype.hasOwnProperty.call(PAGES, key) ? key : null;
}

export function legalNoticeTitle(key) {
  return PAGES[key] || null;
}
