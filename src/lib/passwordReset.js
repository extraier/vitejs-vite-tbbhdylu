/**
 * Firebase Auth password-reset continue URL.
 *
 * sendPasswordResetEmail uses Firebase Auth's own mailer. The continue
 * URL's host must already be an authorized domain in the Firebase
 * console (savetheday.io, and localhost for dev). This does not configure
 * SMTP or SendGrid.
 */
export function passwordResetActionCodeSettings(origin) {
  const base = String(origin || 'https://savetheday.io').replace(/\/+$/, '');
  return {
    url: `${base}/`,
    handleCodeInApp: false,
  };
}
