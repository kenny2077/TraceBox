import { existsSync, mkdirSync, rmSync, cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { detectProjectRoot, detectProjectConfig, saveProjectConfig, loadProjectConfig } from "../config.js";
import { openDb, closeDb, getNodeCount, getEdgeCount } from "../db.js";
import { buildGraph } from "../graph.js";

export interface VerifyResult {
  passed: boolean;
  checks: VerifyCheck[];
}

export interface VerifyCheck {
  name: string;
  passed: boolean;
  message: string;
}

export async function verifyCommand(projectPath?: string): Promise<void> {
  const cwd = projectPath ? resolve(projectPath) : process.cwd();
  const root = detectProjectRoot(cwd);

  const checks: VerifyCheck[] = [];

  // 1. Detect project
  if (!root) {
    checks.push({
      name: "Project detection",
      passed: false,
      message: "No project detected.",
    });
    printResults(checks);
    process.exit(1);
    return;
  }
  checks.push({
    name: "Project detection",
    passed: true,
    message: `Project: ${root}`,
  });

  // 2. Initialize a temp project with built-in fixture
  const fixtureSrc = join(dirname(dirname(__dirname)), "test", "fixtures", "repos", "basic-auth-project");
  let tempProject: string | null = null;

  if (existsSync(fixtureSrc)) {
    try {
      tempProject = mkdtempSync(resolve(tmpdir(), "rg-verify-"));
      cpSync(fixtureSrc, tempProject, { recursive: true, filter: (src) => !src.includes(".ripplegraph") });

      // Init git
      try {
        execSync("git init", { cwd: tempProject, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
        execSync("git config user.email 'test@ripplegraph.dev'", { cwd: tempProject, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
        execSync("git config user.name 'Test'", { cwd: tempProject, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
        execSync("git add -A", { cwd: tempProject, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
        execSync("git commit -m init", { cwd: tempProject, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
      } catch (gitErr) {
        // Git init may fail on some systems; continue without it
        // diff command will fail later if git is not available, which is expected
      }

      const rgDir = join(tempProject, ".ripplegraph");
      if (existsSync(rgDir)) rmSync(rgDir, { recursive: true, force: true });

      const config = detectProjectConfig(tempProject);
      mkdirSync(rgDir, { recursive: true });
      saveProjectConfig(tempProject, config);

      checks.push({
        name: "Fixture setup",
        passed: true,
        message: `Using built-in fixture: ${fixtureSrc}`,
      });
    } catch (err) {
      checks.push({
        name: "Fixture setup",
        passed: false,
        message: `Failed to set up fixture: ${String(err)}`,
      });
    }
  } else {
    // Fallback: use the current project itself
    tempProject = root;
    checks.push({
      name: "Fixture setup",
      passed: true,
      message: "Using current project as fixture (built-in fixture not found).",
    });
  }

  // 3. Index the fixture
  if (tempProject) {
    try {
      const config = loadProjectConfig(tempProject) || detectProjectConfig(tempProject);
      const db = openDb(tempProject);
      try {
        const result = await buildGraph(db, tempProject, config, { force: true });
        if (result.filesIndexed > 0) {
          checks.push({
            name: "Graph indexing",
            passed: true,
            message: `Indexed ${result.filesIndexed} files, ${result.symbolsFound} symbols, ${result.edgesCreated} edges.`,
          });
        } else {
          checks.push({
            name: "Graph indexing",
            passed: false,
            message: "No files were indexed.",
          });
        }
      } finally {
        closeDb();
      }
    } catch (err) {
      checks.push({
        name: "Graph indexing",
        passed: false,
        message: `Indexing failed: ${String(err)}`,
      });
    }
  }

  // 4. Verify graph has expected nodes
  if (tempProject) {
    try {
      const db = openDb(tempProject);
      try {
        const nodeCount = getNodeCount(db);
        const edgeCount = getEdgeCount(db);

        if (nodeCount >= 3) {
          checks.push({
            name: "Node count",
            passed: true,
            message: `${nodeCount} nodes in graph.`,
          });
        } else {
          checks.push({
            name: "Node count",
            passed: false,
            message: `Only ${nodeCount} nodes (expected at least 3).`,
          });
        }

        if (edgeCount >= 2) {
          checks.push({
            name: "Edge count",
            passed: true,
            message: `${edgeCount} edges in graph.`,
          });
        } else {
          checks.push({
            name: "Edge count",
            passed: false,
            message: `Only ${edgeCount} edges (expected at least 2).`,
          });
        }

        // Check for function nodes
        const fnRows = db.all("SELECT COUNT(*) as cnt FROM nodes WHERE type = 'function'") as { cnt: number }[];
        const fnCount = fnRows[0]?.cnt ?? 0;
        if (fnCount > 0) {
          checks.push({
            name: "Symbol extraction",
            passed: true,
            message: `${fnCount} function(s) extracted.`,
          });
        } else {
          checks.push({
            name: "Symbol extraction",
            passed: false,
            message: "No function symbols extracted.",
          });
        }

        // Check for import edges
        const importRows = db.all("SELECT COUNT(*) as cnt FROM edges WHERE type = 'imports'") as { cnt: number }[];
        const importCount = importRows[0]?.cnt ?? 0;
        if (importCount > 0) {
          checks.push({
            name: "Import edges",
            passed: true,
            message: `${importCount} import edge(s).`,
          });
        } else {
          checks.push({
            name: "Import edges",
            passed: false,
            message: "No import edges found.",
          });
        }
      } finally {
        closeDb();
      }
    } catch (err) {
      checks.push({
        name: "Graph verification",
        passed: false,
        message: `Could not verify graph: ${String(err)}`,
      });
    }
  }

  // 5. Simulate diff on a modified file
  if (tempProject) {
    try {
      const servicePath = join(tempProject, "src", "auth", "service.ts");
      if (existsSync(servicePath)) {
        const original = readFileSync(servicePath, "utf-8");
        writeFileSync(servicePath, original + "\n// verify-test-modification\n");

        const CLI = resolve(dirname(dirname(__dirname)), "dist", "index.js");
        const result = execSync(`bun ${CLI} diff --project ${tempProject} --format json`, {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 15000,
        });

        // Restore
        writeFileSync(servicePath, original);

        const report = JSON.parse(result);
        if (report.impact && Array.isArray(report.impact.affectedCallers)) {
          checks.push({
            name: "Diff command",
            passed: true,
            message: `diff returned ${report.impact.affectedCallers.length} affected caller(s).`,
          });
        } else {
          checks.push({
            name: "Diff command",
            passed: false,
            message: "diff output missing impact data.",
          });
        }
      } else {
        checks.push({
          name: "Diff command",
          passed: false,
          message: "Fixture file not found for diff test.",
        });
      }
    } catch (err) {
      checks.push({
        name: "Diff command",
        passed: false,
        message: `diff command failed: ${String(err)}`,
      });
    }
  }

  // 6. Simulate explain command
  if (tempProject) {
    try {
      const CLI = resolve(dirname(dirname(__dirname)), "dist", "index.js");
      const result = execSync(`bun ${CLI} explain src/auth/service.ts --project ${tempProject}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10000,
      });

      if (result.includes("Node:") && result.includes("Type:")) {
        checks.push({
          name: "Explain command",
          passed: true,
          message: "explain returned node information.",
        });
      } else {
        checks.push({
          name: "Explain command",
          passed: false,
          message: "explain output missing expected fields.",
        });
      }
    } catch (err) {
      checks.push({
        name: "Explain command",
        passed: false,
        message: `explain command failed: ${String(err)}`,
      });
    }
  }

  // 7. Simulate tests command
  if (tempProject) {
    try {
      const CLI = resolve(dirname(dirname(__dirname)), "dist", "index.js");
      const result = execSync(`bun ${CLI} tests src/auth/service.ts --project ${tempProject}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10000,
      });

      // tests command may return "No tests found" which is valid
      checks.push({
        name: "Tests command",
        passed: true,
        message: result.trim() || "tests command executed.",
      });
    } catch (err) {
      checks.push({
        name: "Tests command",
        passed: false,
        message: `tests command failed: ${String(err)}`,
      });
    }
  }

  // Cleanup temp project
  if (tempProject && tempProject !== root) {
    try {
      rmSync(tempProject, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  printResults(checks);

  const failCount = checks.filter(c => !c.passed).length;
  if (failCount > 0) {
    console.log(`\n${failCount} check(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll verification checks passed.");
    process.exit(0);
  }
}

function printResults(checks: VerifyCheck[]): void {
  console.log("\nRippleGraph Verify");
  console.log("==================\n");

  for (const c of checks) {
    const icon = c.passed ? "✓" : "✗";
    const color = c.passed ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${color}${icon}${reset} ${c.name}: ${c.message}`);
  }
}
