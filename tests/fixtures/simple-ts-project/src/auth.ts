export function validateToken(token: string): boolean {
  return token.length > 0;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export function getUser(id: string): User | null {
  return { id, name: "Test", email: "test@example.com" };
}
