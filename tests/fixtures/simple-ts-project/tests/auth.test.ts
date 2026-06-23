import { validateToken, getUser } from '../src/auth.js';

describe('Auth', () => {
  it('validates token', () => {
    expect(validateToken('abc')).toBe(true);
    expect(validateToken('')).toBe(false);
  });

  it('gets user', () => {
    const user = getUser('test');
    expect(user).not.toBeNull();
    expect(user?.name).toBe('Test');
  });
});
