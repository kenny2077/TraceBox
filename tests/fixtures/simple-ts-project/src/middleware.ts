import { validateToken } from './auth.js';

export function authMiddleware(token: string): boolean {
  if (!token) return false;
  return validateToken(token);
}
