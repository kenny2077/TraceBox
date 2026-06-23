import { describe, it, expect } from "vitest";
import { detectProjectRoot, detectProjectConfig } from "../src/config.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const FIXTURE = resolve(rootDir, "test/fixtures/simple-project");

describe("config", () => {
  it("detects project root from fixture", () => {
    const root = detectProjectRoot(FIXTURE);
    expect(root).toBe(FIXTURE);
  });

  it("detects project config", () => {
    const config = detectProjectConfig(FIXTURE);
    expect(config.projectName).toBe("simple-project");
    expect(config.languages).toContain("typescript");
    expect(config.packageManager).toBe("npm");
  });

  it("detects tsconfig path aliases", () => {
    const config = detectProjectConfig(FIXTURE);
    expect(config.tsconfigPaths).toHaveProperty("@utils/*");
    expect(config.tsconfigPaths["@utils/*"]).toEqual(["src/utils/*"]);
  });

  it("detects project root from subdirectory", () => {
    const subDir = resolve(FIXTURE, "src/utils");
    const root = detectProjectRoot(subDir);
    expect(root).toBe(FIXTURE);
  });
});
