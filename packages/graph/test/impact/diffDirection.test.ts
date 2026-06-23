import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, closeDb } from "../../src/db.js";
import { buildGraph } from "../../src/graph.js";
import { detectProjectConfig, saveProjectConfig } from "../../src/config.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, mkdirSync, cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "../fixtures/repos/impact-direction");

describe("diff impact direction", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = mkdtempSync(resolve(tmpdir(), "rg-impact-dir-"));
    cpSync(FIXTURE, projectRoot, { recursive: true, filter: (src) => !src.includes(".ripplegraph") });

    // Init git so diff has something to compare
    execSync("git init && git config user.email 'test@ripplegraph.dev' && git config user.name 'Test' && git add -A && git commit -m init", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 5000,
    });

    const rgDir = resolve(projectRoot, ".ripplegraph");
    if (existsSync(rgDir)) rmSync(rgDir, { recursive: true, force: true });

    const config = detectProjectConfig(projectRoot);
    mkdirSync(rgDir, { recursive: true });
    saveProjectConfig(projectRoot, config);

    const db = openDb(projectRoot);
    await buildGraph(db, projectRoot, config, { force: true });
    closeDb();
  });

  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("reports dependents when a utility file is modified", () => {
    // Modify the utility file
    const helperPath = resolve(projectRoot, "src/utils/helper.ts");
    const original = readFileSync(helperPath, "utf-8");
    writeFileSync(helperPath, original + "\n// modified\n");

    // Run ripplegraph diff via CLI
    const CLI = resolve(dirname(__dirname), "..", "dist", "index.js");
    const result = execSync(`bun ${CLI} diff --project ${projectRoot} --format json`, {
      encoding: "utf-8",
      timeout: 10000,
    });

    // Restore
    writeFileSync(helperPath, original);

    const report = JSON.parse(result);
    const affectedFiles = new Set(report.impact.affectedCallers.map((c: { filePath: string }) => c.filePath));

    // The utility itself should NOT be listed as a dependent
    expect(affectedFiles.has("src/utils/helper.ts")).toBe(false);

    // The callers should be listed
    expect(affectedFiles.has("src/api/route.ts")).toBe(true);
    expect(affectedFiles.has("src/ui/component.ts")).toBe(true);
  });
});
