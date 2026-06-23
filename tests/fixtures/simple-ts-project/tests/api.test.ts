import { login, verifySession } from '../src/api.js';

describe('API', () => {
  it('returns token on login', () => {
    const result = login('test@example.com', 'pass');
    expect(result).not.toBeNull();
    expect(result?.token).toBe('abc123');
  });

  it('verifies session', () => {
    expect(verifySession('abc')).toBe(true);
  });
});
