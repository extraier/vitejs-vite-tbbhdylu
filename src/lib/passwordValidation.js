// passwordValidation — shared password strength + match checks.
//
// 2026-07-30 — added when LoginScreen + ChangePasswordModal both
// needed the same rules. The previous "min 8 chars" check was on
// the HTML5 minLength attr only, which is invisible to the user
// and accepts `password` (a weak 8-char password).
//
// Rules (Option B — Microsoft / GitHub / NIST-aligned):
//   1. Minimum 8 characters.
//   2. Must contain at least 3 of these 4 categories:
//        - uppercase letter (A-Z)
//        - lowercase letter (a-z)
//        - digit           (0-9)
//        - special char    (`!@#$%^&*()_+-=[]{};':"\\|,.<>/?` ~`)
//   3. Cannot contain the user's email as a substring (case-insensitive).
//   4. Cannot be one of the top 20 common passwords (e.g. "password",
//      "12345678", "qwertyui", "letmein1", "iloveyou").
//
// Why "any 3 of 4" not "all 4"? Strict composition rules hurt UX
// (per NIST 800-63B §5.1.1.2 — banned in 2024 best-practice guidance)
// without measurably improving security. "3 of 4" still blocks
// `password`, `12345678`, and `abcdefgh`, while letting `Password1`
// pass — which is the GitHub/Microsoft pattern.
//
// Why the email check? Firebase Auth doesn't enforce this server-side,
// but it's the #1 account-takeover pattern (data breaches include
// email + password pairs). Even if the user re-uses their own email
// password, that's a footgun worth surfacing.
//
// Why the top-20 common list? `password` and `12345678` both pass
// the composition rules. The list is tiny (20 words) and covers the
// common cases. Full HIBP API integration is a v2 nicer-to-have.

const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /[0-9]/;
// Common special chars only — kept narrow to avoid double-quote /
// backslash user confusion. Covers the same set as most major apps.
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;

// Top 20 most-leaked passwords (RockYou 2009 + HaveIBeenPwned top).
// Lowercase only — we test case-insensitively.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyui',
  'qwertyuiop', '11111111', '00000000', 'iloveyou', 'iloveyou1',
  'admin123', 'abc12345', 'abcdefgh', 'letmein1', 'welcome1',
]);

// Pure function — safe to call with any input. Returns a structure
// shaped for the UI to render a live checklist.
export function evaluatePassword(password, email = '') {
  const pwd = password || '';
  const violations = [];

  // 1. Length
  const lengthOk = pwd.length >= 8;
  if (!lengthOk) violations.push('length');

  // 2. Category count
  const categories = [
    HAS_UPPER.test(pwd),
    HAS_LOWER.test(pwd),
    HAS_DIGIT.test(pwd),
    HAS_SPECIAL.test(pwd),
  ].filter(Boolean).length;
  const categoriesOk = categories >= 3;
  if (!categoriesOk) violations.push('categories');

  // 3. Email substring
  const emailLower = (email || '').toLowerCase();
  const emailLocal = emailLower.split('@')[0]; // local part is the footgun
  const containsEmail = emailLocal && emailLocal.length >= 3 && pwd.toLowerCase().includes(emailLocal);
  if (containsEmail) violations.push('email');

  // 4. Common password
  const isCommon = COMMON_PASSWORDS.has(pwd.toLowerCase());
  if (isCommon) violations.push('common');

  const isValid = lengthOk && categoriesOk && !containsEmail && !isCommon;
  const strength = scoreStrength(pwd, categories, lengthOk);

  return {
    isValid,
    isStrong: isValid && categories === 4,
    strength, // 0-4 ('weak' | 'fair' | 'good' | 'strong')
    violations, // array of: 'length' | 'categories' | 'email' | 'common'
    checks: {
      length: lengthOk,
      categories: categoriesOk,
      email: !containsEmail,
      common: !isCommon,
    },
    categoriesMet: categories,
    categoriesNeeded: 3,
  };
}

// 0-4 score used for the strength bar. Independent of the validity check
// (e.g. a 14-char password with 3 of 4 categories is "good" but valid).
function scoreStrength(pwd, categories, lengthOk) {
  if (!pwd || pwd.length < 4) return 0;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (categories >= 2) score += 1;
  if (categories >= 3) score += 1;
  if (categories === 4 && pwd.length >= 12) score += 1;
  return Math.min(score, 4);
}

// Labels for the live checklist — used by LoginScreen and
// ChangePasswordModal. Exported so the modal can re-render them
// without copy-paste.
export const PASSWORD_RULES = [
  {
    key: 'length',
    label_zh: '至少 8 個字元',
    label_en: 'At least 8 characters',
  },
  {
    key: 'categories',
    label_zh: '包含以下 3 種：大寫字母 / 小寫字母 / 數字 / 特殊符號',
    label_en: 'Include 3 of: uppercase, lowercase, number, special char',
  },
  {
    key: 'email',
    label_zh: '不可包含你電郵地址',
    label_en: 'Must not contain your email',
  },
  {
    key: 'common',
    label_zh: '不可用常見密碼 (如 password, 12345678)',
    label_en: 'Not a common password (e.g. password, 12345678)',
  },
];

// Quick non-UI check for places where we just need a boolean (e.g.
// server-side validation or form submit enabled state).
export function isPasswordValid(password, email = '') {
  return evaluatePassword(password, email).isValid;
}