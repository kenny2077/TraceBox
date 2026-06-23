// Named exports
export function add(a: number, b: number): number {
  return a + b;
}

export const subtract = (a: number, b: number): number => {
  return a - b;
};

export const multiply = function(a: number, b: number): number {
  return a * b;
};

// Default export (arrow function)
const divide = (a: number, b: number): number => {
  return a / b;
};
export default divide;

// Namespace-style export object
export const MathOps = {
  pow: (a: number, b: number) => Math.pow(a, b),
  sqrt: (a: number) => Math.sqrt(a),
};
