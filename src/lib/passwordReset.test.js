import { describe, expect, it } from 'vitest';
import { passwordResetActionCodeSettings } from './passwordReset';

describe('passwordResetActionCodeSettings', () => {
  it('sends the user back to the site root after Firebase finishes the reset', () => {
    expect(passwordResetActionCodeSettings('https://savetheday.io')).toEqual({
      url: 'https://savetheday.io/',
      handleCodeInApp: false,
    });
    expect(passwordResetActionCodeSettings('https://savetheday.io/').url).toBe('https://savetheday.io/');
  });
});
