import { describe, it, expect } from "vitest";
import { hello, greet } from "../src/index";

describe("index", () => {
  it("hello returns hello", () => {
    expect(hello()).toBe("hello");
  });

  it("greet returns greeting", () => {
    expect(greet("World")).toBe("Hello, World!");
  });
});
