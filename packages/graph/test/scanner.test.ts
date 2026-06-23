import { describe, it, expect } from "vitest";
import { scanFiles, classifyFile } from "../src/scanner.js";
import { detectProjectConfig } from "../src/config.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const FIXTURE = resolve(rootDir, "test/fixtures/simple-project");

describe("scanner", () => {
  const config = detectProjectConfig(FIXTURE);

  it("finds source files", () => {
    const files = scanFiles(FIXTURE, config);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/utils/helpers.ts");
    expect(paths).toContain("src/types.ts");
  });

  it("finds test files", () => {
    const files = scanFiles(FIXTURE, config);
    const testFiles = files.filter((f) => f.classification === "test");
    const paths = testFiles.map((f) => f.path);
    expect(paths).toContain("tests/index.test.ts");
  });

  it("finds doc files", () => {
    const files = scanFiles(FIXTURE, config);
    const docs = files.filter((f) => f.classification === "doc");
    const paths = docs.map((f) => f.path);
    // README.md should be found
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("finds config files", () => {
    const files = scanFiles(FIXTURE, config);
    const configs = files.filter((f) => f.classification === "config");
    const paths = configs.map((f) => f.path);
    // package.json and tsconfig.json should be found
    expect(configs.length).toBeGreaterThanOrEqual(1);
    expect(paths.some(p => p.includes("package.json") || p.includes("tsconfig.json"))).toBe(true);
  });

  it("respects gitignore", () => {
    const files = scanFiles(FIXTURE, config);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain("node_modules/");
    expect(paths).not.toContain("dist/");
  });

  it("classifies test files correctly", () => {
    expect(classifyFile("src/auth.test.ts")).toBe("test");
    expect(classifyFile("src/__tests__/auth.ts")).toBe("test");
    expect(classifyFile("tests/unit/auth.test.ts")).toBe("test");
  });

  it("classifies config files correctly", () => {
    expect(classifyFile("tsconfig.json")).toBe("config");
    expect(classifyFile(".eslintrc.yaml")).toBe("config");
  });

  it("classifies doc files correctly", () => {
    expect(classifyFile("README.md")).toBe("doc");
    expect(classifyFile("docs/guide.md")).toBe("doc");
  });
});
