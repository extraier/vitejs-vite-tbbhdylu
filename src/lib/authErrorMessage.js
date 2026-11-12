// Map Firebase Auth errors to copy the couple or vendor can act on.
// Never surface the SDK's `Firebase: Error (auth/…)` string.

const ZH = {
  'auth/network-request-failed': '網絡連線失敗，請檢查網絡後再試',
  'auth/timeout': '網絡連線失敗，請檢查網絡後再試',
  'auth/too-many-requests': '嘗試次數太多，請稍後再試',
  'auth/wrong-password': '電郵或密碼錯誤',
  'auth/user-not-found': '電郵或密碼錯誤',
  'auth/invalid-credential': '電郵或密碼錯誤',
  'auth/invalid-login-credentials': '電郵或密碼錯誤',
  'auth/email-already-in-use': '此電郵已被註冊，請改用登入',
  'auth/weak-password': '密碼強度不足，請用 8 個字元以上',
  'auth/invalid-email': '電郵格式不正確',
  'auth/popup-closed-by-user': '已取消 Google 登入',
  'auth/cancelled-popup-request': '已取消 Google 登入',
  'auth/popup-blocked': '瀏覽器封鎖咗 Google 登入視窗，請允許彈出式視窗後再試',
  'auth/user-disabled': '此帳號已停用',
};

const EN = {
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/timeout': 'Network error. Check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/email-already-in-use': 'This email is already registered. Sign in instead.',
  'auth/weak-password': 'Password is too weak. Use at least 8 characters.',
  'auth/invalid-email': 'That email address is not valid.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups and try again.',
  'auth/user-disabled': 'This account is disabled.',
};

export function authErrorMessage(err, lang = 'zh') {
  const table = lang === 'en' ? EN : ZH;
  const fallback = lang === 'en' ? 'Sign-in failed. Please try again.' : '登入失敗，請稍後再試';
  const code = String(err?.code || '');
  if (table[code]) return table[code];
  const message = String(err?.message || '');
  const embedded = message.match(/auth\/[a-z0-9-]+/i);
  if (embedded && table[embedded[0]]) return table[embedded[0]];
  if (message.startsWith('Firebase:')) return fallback;
  return fallback;
}

export function withAuthTimeout(promise, ms = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('auth/timeout');
      err.code = 'auth/timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timer);
  });
}
