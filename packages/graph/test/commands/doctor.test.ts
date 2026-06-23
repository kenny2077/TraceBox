import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

describe("doctor command", () => {
  let tempProject: string;

  beforeAll(() => {
    tempProject = mkdtempSync(resolve(tmpdir(), "rg-doctor-"));
    // Create a minimal project structure
    writeFileSync(resolve(tempProject, "package.json"), JSON.stringify({ name: "test-project" }), "utf-8");
    mkdirSync(resolve(tempProject, ".git"), { recursive: true });
  });

  afterAll(() => {
    if (tempProject) rmSync(tempProject, { recursive: true, force: true });
  });

  it("fails when project is not initialized", () => {
    let failed = false;
    try {
      execSync(`bun ${CLI} doctor --project ${tempProject}`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
    } catch (e: any) {
      failed = true;
      expect(e.status).not.toBe(0);
      expect(e.stdout || e.stderr).toContain(".ripplegraph/ does not exist");
    }
    expect(failed).toBe(true);
  });

  it("warns when graph.db is missing but .ripplegraph exists", () => {
    mkdirSync(resolve(tempProject, ".ripplegraph"), { recursive: true });
    writeFileSync(resolve(tempProject, ".ripplegraph", "config.json"), JSON.stringify({
      version: "0.1.0",
      projectRoot: tempProject,
      projectName: "test-project",
      languages: ["typescript"],
    }), "utf-8");

    let failed = false;
    try {
      const output = execSync(`bun ${CLI} doctor --project ${tempProject}`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
      // Should exit 0 with warnings
      expect(output).toContain("graph.db not found");
    } catch (e: any) {
      failed = true;
      // May exit 1 if graph.db is considered a fail
      expect(e.stdout || e.stderr).toContain("graph.db not found");
    }
  });

  it("passes all checks on a healthy project", () => {
    // We test on the actual RippleGraph project which should be initialized
    const output = execSync(`bun ${CLI} doctor --project ${resolve(__dirname, "..", "..")}`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });

    expect(output).toContain("Project root:");
    expect(output).toContain("RippleGraph directory:");
    expect(output).toContain("Graph database:");
    expect(output).toContain("Git:");
  });
});
