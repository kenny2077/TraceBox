import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveImport, resolveImportPath } from "../src/resolver.js";
import type { ProjectConfig } from "../src/types.js";

function makeConfig(root: string, paths: Record<string, string[]> = {}): ProjectConfig {
  return {
    version: "1.0.0",
    projectRoot: root,
    projectName: "test",
    languages: ["typescript"],
    packageManager: "npm",
    testFramework: "vitest",
    tsconfigPaths: paths,
    ignorePatterns: ["node_modules/", "dist/"],
    sourceExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  };
}

describe("resolveImportPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rg-resolver-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves ./foo to ./foo.ts", () => {
    writeFileSync(join(dir, "foo.ts"), "");
    expect(resolveImportPath(dir, "./foo")).toBe(join(dir, "foo.ts"));
  });

  it("resolves ./foo.ts to itself", () => {
    writeFileSync(join(dir, "foo.ts"), "");
    expect(resolveImportPath(dir, "./foo.ts")).toBe(join(dir, "foo.ts"));
  });

  it("resolves ./foo.tsx to itself", () => {
    writeFileSync(join(dir, "foo.tsx"), "");
    expect(resolveImportPath(dir, "./foo.tsx")).toBe(join(dir, "foo.tsx"));
  });

  it("resolves ./foo/index to ./foo/index.ts", () => {
    mkdirSync(join(dir, "foo"), { recursive: true });
    writeFileSync(join(dir, "foo", "index.ts"), "");
    expect(resolveImportPath(dir, "./foo/index")).toBe(join(dir, "foo", "index.ts"));
  });

  it("resolves ./foo/index.ts to itself", () => {
    mkdirSync(join(dir, "foo"), { recursive: true });
    writeFileSync(join(dir, "foo", "index.ts"), "");
    expect(resolveImportPath(dir, "./foo/index.ts")).toBe(join(dir, "foo", "index.ts"));
  });

  it("resolves ./foo (directory) to ./foo/index.ts", () => {
    mkdirSync(join(dir, "foo"), { recursive: true });
    writeFileSync(join(dir, "foo", "index.ts"), "");
    expect(resolveImportPath(dir, "./foo")).toBe(join(dir, "foo", "index.ts"));
  });

  it("resolves ../utils/helper to ../utils/helper.ts", () => {
    const sub = join(dir, "src", "api");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(dir, "utils"), { recursive: true });
    writeFileSync(join(dir, "utils", "helper.ts"), "");
    expect(resolveImportPath(sub, "../../utils/helper")).toBe(join(dir, "utils", "helper.ts"));
  });

  it("prefers .ts over .js when both exist", () => {
    writeFileSync(join(dir, "foo.ts"), "");
    writeFileSync(join(dir, "foo.js"), "");
    expect(resolveImportPath(dir, "./foo")).toBe(join(dir, "foo.ts"));
  });

  it("returns null for non-existent imports", () => {
    expect(resolveImportPath(dir, "./nope")).toBeNull();
  });

  it("returns null for external-looking bare specifiers", () => {
    expect(resolveImportPath(dir, "react")).toBeNull();
  });
});

describe("resolveImport", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rg-resolver-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks external packages as external", () => {
    const config = makeConfig(dir);
    const result = resolveImport("src/index.ts", "react", dir, config);
    expect(result.isExternal).toBe(true);
    expect(result.targetFile).toBeNull();
  });

  it("resolves relative imports", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "utils.ts"), "");
    const config = makeConfig(dir);
    const result = resolveImport("src/index.ts", "./utils", dir, config);
    expect(result.isExternal).toBe(false);
    expect(result.targetFile).toBe("src/utils.ts");
  });

  it("resolves tsconfig path aliases", () => {
    mkdirSync(join(dir, "src", "utils"), { recursive: true });
    writeFileSync(join(dir, "src", "utils", "helpers.ts"), "");
    const config = makeConfig(dir, { "@utils/*": ["src/utils/*"] });
    const result = resolveImport("src/index.ts", "@utils/helpers", dir, config);
    expect(result.isExternal).toBe(false);
    expect(result.targetFile).toBe("src/utils/helpers.ts");
  });

  it("resolves exact tsconfig alias without wildcard", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "config.ts"), "");
    const config = makeConfig(dir, { "@config": ["src/config"] });
    const result = resolveImport("src/index.ts", "@config", dir, config);
    expect(result.isExternal).toBe(false);
    expect(result.targetFile).toBe("src/config.ts");
  });

  it("returns unresolved for broken tsconfig alias", () => {
    const config = makeConfig(dir, { "@missing/*": ["src/missing/*"] });
    const result = resolveImport("src/index.ts", "@missing/foo", dir, config);
    expect(result.isExternal).toBe(false);
    expect(result.targetFile).toBeNull();
    expect(result.resolutionDetail).toContain("alias");
  });
});
