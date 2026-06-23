import { add, subtract } from "../lib/math";

export function calculate(x: number, y: number): number {
  const sum = add(x, y);
  const diff = subtract(x, y);
  return sum + diff;
}
