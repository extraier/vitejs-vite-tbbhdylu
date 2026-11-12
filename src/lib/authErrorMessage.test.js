import { describe, expect, it, vi } from 'vitest';
import { authErrorMessage, withAuthTimeout } from './authErrorMessage';

describe('authErrorMessage', () => {
  it('maps a network failure instead of showing the Firebase string', () => {
    const err = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' };
    expect(authErrorMessage(err, 'zh')).toBe('網絡連線失敗，請檢查網絡後再試');
    expect(authErrorMessage(err, 'zh')).not.toContain('Firebase:');
  });

  it('maps wrong password, too many attempts, and an unknown code', () => {
    expect(authErrorMessage({ code: 'auth/wrong-password' }, 'en')).toBe('Incorrect email or password.');
    expect(authErrorMessage({ code: 'auth/too-many-requests' }, 'zh')).toBe('嘗試次數太多，請稍後再試');
    expect(authErrorMessage({ code: 'auth/internal-error', message: 'Firebase: Error (auth/internal-error).' }, 'zh')).toBe('登入失敗，請稍後再試');
  });
});

describe('withAuthTimeout', () => {
  it('rejects a hung sign-in so the button can leave the pending state', async () => {
    vi.useFakeTimers();
    const hung = new Promise(() => {});
    const result = withAuthTimeout(hung, 50);
    const assertion = expect(result).rejects.toMatchObject({ code: 'auth/timeout' });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    vi.useRealTimers();
  });
});
