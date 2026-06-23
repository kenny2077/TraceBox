// Named import
import { add, subtract } from "./utils";

// Default import
import divide from "./utils";

// Namespace import
import * as Utils from "./utils";

// Component imports
import { UserCard, AdminPanel } from "./components";

export function calculate(x: number, y: number): number {
  const sum = add(x, y);
  const diff = subtract(x, y);
  const quot = divide(x, y);
  const prod = Utils.MathOps.pow(x, y);
  return sum + diff + quot + prod;
}

export function renderUser(name: string, age: number): string {
  return UserCard({ name, age });
}
