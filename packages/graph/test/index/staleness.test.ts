import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkStaleness, readIndexMetadata, writeIndexMetadata, type IndexMetadata, type StalenessResult } from "../../src/index/staleness.js";
import { detectProjectConfig } from "../../src/config.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

function createTestProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ripplegraph-stale-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, ".ripplegraph"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-stale", version: "1.0.0" }));
  writeFileSync(join(dir, "src/index.ts"), "export const x = 1;\n");

  // Init git
  execSync("git init && git add -A && git commit -m init", { cwd: dir, encoding: "utf-8", timeout: 5000 }).toString();

  const gitCommit = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();

  // Create a fake graph.db
  writeFileSync(join(dir, ".ripplegraph", "graph.db"), "fake-sqlite-content");

  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("staleness", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe("checkStaleness", () => {
    it("returns fresh=true when graph is up to date", () => {
      const config = detectProjectConfig(testDir);
      const gitCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: new Date().toISOString(),
        gitCommit,
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(true);
    });

    it("returns fresh=false when graph.db is missing", () => {
      rmSync(join(testDir, ".ripplegraph", "graph.db"));
      const config = detectProjectConfig(testDir);
      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(false);
      expect(result.reason).toContain("No graph database found");
    });

    it("returns fresh=false when no metadata exists", () => {
      const config = detectProjectConfig(testDir);
      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(false);
      expect(result.reason).toContain("No index metadata found");
    });

    it("returns fresh=false when git commit has changed", () => {
      const config = detectProjectConfig(testDir);

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: new Date().toISOString(),
        gitCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(false);
      expect(result.reason).toContain("new commits");
    });

    it("returns fresh=false when file contents have changed", () => {
      const config = detectProjectConfig(testDir);
      const gitCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

      // Write metadata as if last indexed
      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: new Date().toISOString(),
        gitCommit,
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      // Create a file hash cache with a hash that won't match
      const cacheDir = join(testDir, ".ripplegraph", "cache");
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, "file_hashes.json"), JSON.stringify({
        "src/index.ts": "not-the-real-hash",
      }));

      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(false);
      expect(result.reason).toContain("have changed since last index");
    });

    it("returns fresh=true when file hashes match", () => {
      const config = detectProjectConfig(testDir);
      const gitCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: new Date().toISOString(),
        gitCommit,
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      // Write the correct hash
      const hash = execSync("shasum -a 256 src/index.ts", { cwd: testDir, encoding: "utf-8" }).split(" ")[0]!;
      const cacheDir = join(testDir, ".ripplegraph", "cache");
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, "file_hashes.json"), JSON.stringify({
        "src/index.ts": hash,
      }));

      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(true);
    });

    it("provides recommendation when stale", () => {
      const config = detectProjectConfig(testDir);
      const result = checkStaleness(testDir, config);
      expect(result.fresh).toBe(false);
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation).toContain("ripplegraph index");
    });

    it("handles non-git projects gracefully", () => {
      // Remove .git directory (ignore error if already removed)
      try { rmSync(join(testDir, ".git"), { recursive: true, force: true }); } catch {}

      const config = detectProjectConfig(testDir);

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: new Date().toISOString(),
        gitCommit: null,
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      const result = checkStaleness(testDir, config);
      // Without git, may be fresh if file hash cache matches (none in this case)
      expect(result).toHaveProperty("fresh");
    });

    it("includes metadata in result when available", () => {
      const config = detectProjectConfig(testDir);
      const gitCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: "2026-01-01T00:00:00.000Z",
        gitCommit,
        totalFiles: 1,
        totalSymbols: 1,
        totalEdges: 0,
      });

      const result = checkStaleness(testDir, config);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.indexedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("readIndexMetadata", () => {
    it("returns null when no config exists", () => {
      rmSync(join(testDir, ".ripplegraph", "config.json"), { force: true });
      const meta = readIndexMetadata(testDir);
      expect(meta).toBeNull();
    });

    it("returns null when config has no indexedAt", () => {
      writeFileSync(join(testDir, ".ripplegraph", "config.json"), JSON.stringify({ projectName: "test" }));
      const meta = readIndexMetadata(testDir);
      expect(meta).toBeNull();
    });

    it("reads metadata correctly", () => {
      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: "2026-05-31T00:00:00.000Z",
        gitCommit: "abc123",
        totalFiles: 42,
        totalSymbols: 100,
        totalEdges: 200,
      });

      const meta = readIndexMetadata(testDir);
      expect(meta).not.toBeNull();
      expect(meta!.version).toBe("0.1.0");
      expect(meta!.indexedAt).toBe("2026-05-31T00:00:00.000Z");
      expect(meta!.gitCommit).toBe("abc123");
      expect(meta!.totalFiles).toBe(42);
    });
  });

  describe("writeIndexMetadata", () => {
    it("preserves existing config fields", () => {
      // Write initial config
      writeFileSync(join(testDir, ".ripplegraph", "config.json"), JSON.stringify({
        projectName: "my-app",
        testFramework: "vitest",
        customField: "keep-me",
      }));

      writeIndexMetadata(testDir, {
        version: "0.1.0",
        indexedAt: "2026-05-31T00:00:00.000Z",
        gitCommit: "def456",
        totalFiles: 10,
        totalSymbols: 20,
        totalEdges: 30,
      });

      const raw = JSON.parse(readFileSync(join(testDir, ".ripplegraph", "config.json"), "utf-8"));
      expect(raw.projectName).toBe("my-app");
      expect(raw.testFramework).toBe("vitest");
      expect(raw.customField).toBe("keep-me");
      expect(raw.gitCommit).toBe("def456");
      expect(raw.totalFiles).toBe(10);
    });
  });
});
