import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { detectProjectRoot, loadProjectConfig } from "../config.js";
import { openDb, closeDb, getNodeCount, getEdgeCount } from "../db.js";
import { checkStaleness } from "../index/staleness.js";

export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  remediation?: string;
}

export function doctorCommand(projectPath?: string): void {
  const cwd = projectPath ? resolve(projectPath) : process.cwd();
  const root = detectProjectRoot(cwd);

  const results: CheckResult[] = [];

  // 1. Project root detection
  if (!root) {
    results.push({
      name: "Project root",
      status: "fail",
      message: "No project detected (no package.json or .git found).",
      remediation: "Run `ripplegraph init` in a project directory with package.json or .git.",
    });
    printResults(results);
    process.exit(1);
    return;
  }
  results.push({
    name: "Project root",
    status: "pass",
    message: `Detected: ${root}`,
  });

  // 2. .ripplegraph directory
  const rgDir = join(root, ".ripplegraph");
  if (!existsSync(rgDir)) {
    results.push({
      name: "RippleGraph directory",
      status: "fail",
      message: ".ripplegraph/ does not exist.",
      remediation: "Run `ripplegraph init` to initialize RippleGraph.",
    });
    printResults(results);
    process.exit(1);
    return;
  }
  results.push({
    name: "RippleGraph directory",
    status: "pass",
    message: ".ripplegraph/ exists.",
  });

  // 3. graph.db
  const dbPath = join(rgDir, "graph.db");
  if (!existsSync(dbPath)) {
    results.push({
      name: "Graph database",
      status: "fail",
      message: "graph.db not found.",
      remediation: "Run `ripplegraph index` to build the knowledge graph.",
    });
  } else {
    results.push({
      name: "Graph database",
      status: "pass",
      message: "graph.db exists.",
    });
  }

  // 4. config.json
  const configPath = join(rgDir, "config.json");
  if (!existsSync(configPath)) {
    results.push({
      name: "Project config",
      status: "warn",
      message: "config.json not found.",
      remediation: "Run `ripplegraph init` to regenerate config.",
    });
  } else {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.projectName && config.languages) {
        results.push({
          name: "Project config",
          status: "pass",
          message: `config.json valid (${config.projectName}, ${config.languages.join(", ")}).`,
        });
      } else {
        results.push({
          name: "Project config",
          status: "warn",
          message: "config.json exists but is missing required fields.",
          remediation: "Run `ripplegraph init` to regenerate config.",
        });
      }
    } catch {
      results.push({
        name: "Project config",
        status: "fail",
        message: "config.json is malformed JSON.",
        remediation: "Delete .ripplegraph/config.json and run `ripplegraph init`.",
      });
    }
  }

  // 5. Git availability
  try {
    execSync("git --version", { cwd: root, encoding: "utf-8", stdio: "pipe", timeout: 3000 });
    results.push({
      name: "Git",
      status: "pass",
      message: "Git is available.",
    });
  } catch {
    results.push({
      name: "Git",
      status: "warn",
      message: "Git not found or not working.",
      remediation: "Install git for diff-based impact analysis.",
    });
  }

  // 6. Check for hooks
  const claudeHookPath = join(root, ".claude", "hooks", "ripplegraph.js");
  const codexHookPath = join(root, ".codex", "hooks", "ripplegraph.js");
  const hasClaudeHook = existsSync(claudeHookPath);
  const hasCodexHook = existsSync(codexHookPath);

  if (hasClaudeHook || hasCodexHook) {
    const hooks: string[] = [];
    if (hasClaudeHook) hooks.push("Claude");
    if (hasCodexHook) hooks.push("Codex");
    results.push({
      name: "Hooks",
      status: "pass",
      message: `Installed: ${hooks.join(", ")}.`,
    });
  } else {
    results.push({
      name: "Hooks",
      status: "warn",
      message: "No hooks installed.",
      remediation: "Run `ripplegraph hook install claude` or `ripplegraph hook install codex` to enable context injection.",
    });
  }

  // 7. Graph health (if db exists)
  if (existsSync(dbPath)) {
    try {
      const db = openDb(root);
      try {
        const nodeCount = getNodeCount(db);
        const edgeCount = getEdgeCount(db);
        if (nodeCount === 0) {
          results.push({
            name: "Graph health",
            status: "warn",
            message: "Graph database is empty (0 nodes).",
            remediation: "Run `ripplegraph index` to populate the graph.",
          });
        } else {
          results.push({
            name: "Graph health",
            status: "pass",
            message: `${nodeCount} nodes, ${edgeCount} edges.`,
          });
        }
      } finally {
        closeDb();
      }
    } catch (err) {
      results.push({
        name: "Graph health",
        status: "fail",
        message: `Could not read graph database: ${String(err)}`,
        remediation: "Try deleting graph.db and re-running `ripplegraph index`.",
      });
    }
  }

  // 8. Check for stale graph
  const config = loadProjectConfig(root);
  if (config && existsSync(dbPath)) {
    try {
      const staleness = checkStaleness(root, config);
      if (!staleness.fresh) {
        results.push({
          name: "Graph freshness",
          status: "warn",
          message: staleness.reason || "Graph may be stale.",
          remediation: staleness.recommendation || "Run `ripplegraph index` to refresh.",
        });
      } else {
        results.push({
          name: "Graph freshness",
          status: "pass",
          message: "Graph is up to date.",
        });
      }
    } catch {
      results.push({
        name: "Graph freshness",
        status: "warn",
        message: "Could not check graph staleness.",
      });
    }
  }

  printResults(results);

  const failCount = results.filter(r => r.status === "fail").length;
  const warnCount = results.filter(r => r.status === "warn").length;

  if (failCount > 0) {
    console.log(`\n${failCount} check(s) failed, ${warnCount} warning(s).`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`\nAll checks passed with ${warnCount} warning(s).`);
    process.exit(0);
  } else {
    console.log("\nAll checks passed.");
    process.exit(0);
  }
}

function printResults(results: CheckResult[]): void {
  console.log("\nRippleGraph Doctor");
  console.log("==================\n");

  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗";
    const color = r.status === "pass" ? "\x1b[32m" : r.status === "warn" ? "\x1b[33m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${color}${icon}${reset} ${r.name}: ${r.message}`);
    if (r.remediation) {
      console.log(`  → ${r.remediation}`);
    }
  }
}
