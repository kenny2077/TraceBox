import { hello } from "../src/index";

export function helper(): string {
  return hello() + " from helper";
}

export function format(value: string): string {
  return value.trim().toLowerCase();
}
