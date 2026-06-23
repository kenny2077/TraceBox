import { validateToken, getUser, User } from './auth.js';

export function login(email: string, password: string): { token: string; user: User } | null {
  const user = getUser(email);
  if (!user) return null;
  return { token: "abc123", user };
}

export function verifySession(token: string): boolean {
  return validateToken(token);
}
