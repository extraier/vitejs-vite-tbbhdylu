const KEY = 'savetheday.uiLang';

export function readUiLang() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'en' || value === 'zh') return value;
  } catch {
    /* private mode */
  }
  return 'zh';
}

export function writeUiLang(lang) {
  if (lang !== 'en' && lang !== 'zh') return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode */
  }
}
