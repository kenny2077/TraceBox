#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  detectProjectRoot,
  detectProjectConfig,
  saveProjectConfig,
  loadProjectConfig,
} from "./config.js";
import { openDb, closeDb, getNodeCount, getEdgeCount, getNode, getOutgoingEdges } from "./db.js";
import { buildGraph } from "./graph.js";
import { scanFiles, classifyFile } from "./scanner.js";
import { formatImpactReportTerminal, formatImpactReportMarkdown, formatContextPackMarkdown } from "./report.js";
import type { ImpactReport, AffectedSymbol, AffectedTest, SymbolChange, RiskFactor } from "./types.js";
import { checkStaleness } from "./index/staleness.js";
import { contextInjectCommand, contextInjectWithAdapter } from "./commands/hook/contextInject.js";
import { installClaudeCommand, uninstallClaudeCommand } from "./commands/hook/installClaude.js";
import { installCodexCommand, uninstallCodexCommand } from "./commands/hook/installCodex.js";
import { doctorCommand } from "./commands/doctor.js";
import { verifyCommand } from "./commands/verify.js";

export function runCli(): void {
  const program = new Command();

  program
    .name("ripplegraph")
    .description("Impact analysis and context briefing for AI coding agents")
    .version("1.0.0");

  program
    .command("init")
    .description("Initialize RippleGraph for the current project")
    .option("--force", "Build initial index immediately")
    .option("--project <path>", "Project root directory")
    .action(async (opts: { force?: boolean; project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root) {
        console.error("No project detected. Run in a directory with package.json or .git.");
        process.exit(1);
      }
      const config = detectProjectConfig(root);
      const d = resolve(root, ".ripplegraph");
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
      saveProjectConfig(root, config);

      // Write .ripplegraph/.gitignore to prevent committing sensitive graph data
      const riGitingore = resolve(d, ".gitignore");
      if (!existsSync(riGitingore)) {
        writeFileSync(riGitingore, "# RippleGraph knowledge graph data — do not commit\ncache/\nruns/\ngraph.db\ngraph.db-wal\ngraph.db-shm\n*.db\n", "utf-8");
      }

      console.log(`RippleGraph initialized for "${config.projectName}" (${config.languages.join(", ")}).`);
      if (opts.force) {
        console.log("Building initial index...");
        const db = openDb(root);
        try {
          const result = await buildGraph(db, root, config);
          console.log(`Indexed ${result.filesIndexed} files in ${(result.buildTimeMs / 1000).toFixed(1)}s.`);
          console.log(`Graph: ${getNodeCount(db)} nodes, ${getEdgeCount(db)} edges.`);
        } finally { closeDb(); }
      } else {
        console.log("Run `ripplegraph index` to build the knowledge graph.");
      }
    });

  program
    .command("index")
    .description("Build or rebuild the knowledge graph")
    .option("--force", "Rebuild full graph")
    .option("--changed-only", "Only re-index changed files")
    .option("--format <format>", "table | json", "table")
    .option("--project <path>", "Project root")
    .action(async (opts: { force?: boolean; changedOnly?: boolean; format?: string; project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root || !existsSync(resolve(root, ".ripplegraph"))) {
        console.error("Not initialized. Run `ripplegraph init` first.");
        process.exit(1);
      }
      const config = loadProjectConfig(root) || detectProjectConfig(root);
      const db = openDb(root);
      try {
        const result = await buildGraph(db, root, config, {
          force: opts.force,
          changedOnly: opts.changedOnly ?? !opts.force,
        });
        if (opts.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Indexed ${result.filesIndexed} files in ${(result.buildTimeMs / 1000).toFixed(1)}s.`);
          if (result.newFiles > 0 || result.changedFiles > 0 || result.deletedFiles > 0) {
            const parts: string[] = [];
            if (result.newFiles > 0) parts.push(`${result.newFiles} new`);
            if (result.changedFiles > 0) parts.push(`${result.changedFiles} changed`);
            if (result.deletedFiles > 0) parts.push(`${result.deletedFiles} deleted`);
            console.log(`  (${parts.join(", ")})`);
          }
          console.log(`Graph: ${getNodeCount(db)} nodes, ${getEdgeCount(db)} edges.`);
        }
      } finally { closeDb(); }
    });

  program
    .command("explain <target>")
    .description("Explain a file or symbol and its relationships")
    .option("--format <format>", "terminal | json", "terminal")
    .option("--project <path>", "Project root")
    .action((target: string, opts: { format?: string; project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root) { console.error("No project detected."); process.exit(1); }
      const db = openDb(root);

      // Resolve target: could be a file path or file:symbol
      let nodeId: string;
      if (target.includes(":")) {
        nodeId = target;
      } else {
        nodeId = `file:${target}`;
      }

      let foundNode: Record<string, unknown> | undefined = db.get("SELECT * FROM nodes WHERE id = ?", nodeId) as Record<string, unknown> | undefined;
      if (!foundNode) {
        const matches = db.all(
          "SELECT * FROM nodes WHERE name LIKE ? OR id LIKE ? LIMIT 1",
          `%${target}%`, `%${target}%`,
        ) as Record<string, unknown>[];
        if (matches.length === 0) {
          console.error(`No node found matching "${target}".`);
          closeDb();
          process.exit(1);
        }
        foundNode = matches[0] as Record<string, unknown>;
        nodeId = foundNode.id as string;
      }

      console.log(`\nNode: ${foundNode.name || nodeId}`);
      console.log(`  Type: ${foundNode.type}  File: ${foundNode.file_path || "N/A"}`);
      if (foundNode.line_start !== undefined) {
        console.log(`  Lines: ${foundNode.line_start}-${foundNode.line_end}`);
      }

      const neighbors = db.all(
        "SELECT e.*, n.name as target_name, n.file_path as target_file FROM edges e LEFT JOIN nodes n ON e.target = n.id WHERE e.source = ? LIMIT 20",
        nodeId,
      ) as Record<string, unknown>[];

      const reverseNeighbors = db.all(
        "SELECT e.*, n.name as source_name, n.file_path as source_file FROM edges e LEFT JOIN nodes n ON e.source = n.id WHERE e.target = ? LIMIT 20",
        nodeId,
      ) as Record<string, unknown>[];

      if (neighbors.length > 0) {
        console.log(`\nOutgoing (${neighbors.length}):`);
        for (const e of neighbors) {
          console.log(`  → ${e.target_name || e.target} [${e.type}] ${e.confidence === "EXTRACTED" ? "✓" : "~"}`);
        }
      }

      if (reverseNeighbors.length > 0) {
        console.log(`\nIncoming (${reverseNeighbors.length}):`);
        for (const e of reverseNeighbors) {
          console.log(`  ← ${e.source_name || e.source} [${e.type}] ${e.confidence === "EXTRACTED" ? "✓" : "~"}`);
        }
      }

      console.log("");
      closeDb();
    });

  program
    .command("tests <target>")
    .description("Find tests related to a file or symbol")
    .option("--project <path>", "Project root")
    .action((target: string, opts: { project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root) { console.error("No project detected."); process.exit(1); }
      const db = openDb(root);

      // Find test files that import the target file
      const tests = db.all(
        "SELECT source, type, confidence FROM edges WHERE target = ? AND type = 'imports' AND source LIKE 'file:%'",
        `file:${target}`,
      ) as Record<string, unknown>[];

      const testEdges = tests.filter(t => {
        const src = db.get("SELECT type FROM nodes WHERE id = ?", t.source) as Record<string, unknown> | undefined;
        return src?.type === "test_file";
      });

      if (testEdges.length === 0) {
        console.log(`No tests found for "${target}".`);
      } else {
        console.log(`\nTests for ${target}:`);
        for (const t of testEdges) {
          const name = (t.source as string).replace("file:", "");
          console.log(`  ${name} [~] import_graph`);
        }
      }

      closeDb();
    });

  program
    .command("context-pack <files...>")
    .description("Generate agent-ready context bundle")
    .option("--max-tokens <n>", "Token budget", "2000")
    .option("--project <path>", "Project root")
    .action((files: string[], opts: { maxTokens?: string; project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root) { console.error("No project detected."); process.exit(1); }
      const db = openDb(root);

      const targets = files;
      const callers: AffectedSymbol[] = [];
      const testList: AffectedTest[] = [];

      for (const f of targets) {
        const nodeId = `file:${f}`;
        // Find dependents: nodes that call/import/export this file
        const incoming = db.all(
          "SELECT * FROM edges WHERE target = ? AND type IN ('calls', 'imports', 'exports') LIMIT 30",
          nodeId,
        ) as Record<string, unknown>[];
        for (const e of incoming) {
          const sourceNode = db.get("SELECT name, file_path FROM nodes WHERE id = ?", e.source) as Record<string, unknown> | undefined;
          callers.push({
            symbolId: e.source as string,
            symbolName: (sourceNode?.name as string) || (e.source as string),
            filePath: (sourceNode?.file_path as string) || "",
            relation: e.type as string,
            confidence: e.confidence as "EXTRACTED" | "HEURISTIC" | "INFERRED" | "UNKNOWN",
            depth: 1,
          });
        }

        // Find tests
        const testEdges = db.all(
          "SELECT e.source FROM edges e JOIN nodes n ON e.source = n.id WHERE e.target = ? AND n.type = 'test_file'",
          nodeId,
        ) as Record<string, unknown>[];
        for (const t of testEdges) {
          testList.push({
            testFile: (t.source as string).replace("file:", ""),
            targetFile: f,
            confidence: "HEURISTIC",
            source: "import_graph",
          });
        }
      }

      const config = loadProjectConfig(root) || detectProjectConfig(root);
      const stale = checkStaleness(root, config);

      const output = formatContextPackMarkdown(
        targets,
        callers.slice(0, 15),
        testList.slice(0, 10),
        "Read dependent files and run affected tests before merging.",
        parseInt(opts.maxTokens || "2000", 10),
        stale,
      );

      console.log(output);
      closeDb();
    });

  program
    .command("diff")
    .description("Analyze impact of uncommitted changes")
    .option("--format <format>", "terminal | markdown | json", "terminal")
    .option("--depth <n>", "Traversal depth", "3")
    .option("--project <path>", "Project root")
    .action((opts: { format?: string; depth?: string; project?: string }) => {
      const cwd = opts.project ? resolve(opts.project) : process.cwd();
      const root = detectProjectRoot(cwd);
      if (!root) { console.error("No project detected."); process.exit(1); }
      if (!existsSync(resolve(root, ".ripplegraph"))) {
        console.error("Not initialized. Run `ripplegraph index` first.");
        process.exit(1);
      }

      // Get changed files from git
      let changedFiles: string[] = [];
      try {
        const output = execSync("git diff --name-only && git diff --cached --name-only", { cwd: root, encoding: "utf-8" });
        changedFiles = output.split("\n").filter(f => f.trim().length > 0);
      } catch {
        console.error("Could not get git diff. Is this a git repository?");
        process.exit(1);
      }

      if (changedFiles.length === 0) {
        console.log("No changes detected.");
        process.exit(0);
      }

      const db = openDb(root);
      const config = loadProjectConfig(root) || detectProjectConfig(root);
      const depth = parseInt(opts.depth || "3", 10);
      const sourceExtensions = config.sourceExtensions || [".ts", ".tsx", ".js", ".jsx", ".mjs"];
      const isSource = (f: string) => sourceExtensions.some(ext => f.endsWith(ext));

      const sourceChanges = changedFiles.filter(isSource);
      const otherChanges = changedFiles.filter(f => !isSource(f));

      // Build impact report
      const symbolDetails: SymbolChange[] = [];
      const affectedCallers: AffectedSymbol[] = [];
      const affectedTests: AffectedTest[] = [];
      const allAffectedFiles = new Set<string>(sourceChanges);

      for (const file of sourceChanges) {
        const fileNodeId = `file:${file}`;
        const fileSymbols = db.all(
          "SELECT id, name, type FROM nodes WHERE file_path = ? AND type != 'file'",
          file,
        ) as Record<string, unknown>[];
        for (const s of fileSymbols) {
          symbolDetails.push({
            id: s.id as string,
            name: s.name as string,
            filePath: file,
            changeType: "modified",
          });
        }

        // Multi-hop reverse traversal: find dependents (callers, importers, inheritors)
        // FIXED: We traverse INCOMING edges (target -> source) to find what DEPENDS ON this file
        let frontier = [fileNodeId, ...fileSymbols.map(s => s.id as string)];
        const visited = new Set<string>(frontier);
        for (let hop = 0; hop < depth; hop++) {
          if (frontier.length === 0) break;
          const placeholders = frontier.map(() => "?").join(",");
          // CRITICAL FIX: target IN frontier finds edges where frontier nodes are the TARGET
          // This means we find nodes that POINT TO our file (callers, importers)
          const edges = db.all(
            `SELECT * FROM edges WHERE target IN (${placeholders}) AND type IN ('calls', 'imports', 'exports', 'inherits', 'implements')`,
            ...frontier,
          ) as Record<string, unknown>[];
          const nextFrontier: string[] = [];
          for (const e of edges) {
            const sourceId = e.source as string;
            if (!visited.has(sourceId)) {
              visited.add(sourceId);
              nextFrontier.push(sourceId);
              const sourceNode = db.get("SELECT name, file_path FROM nodes WHERE id = ?", sourceId) as Record<string, unknown> | undefined;
              if (sourceNode?.file_path) allAffectedFiles.add(sourceNode.file_path as string);
              affectedCallers.push({
                symbolId: sourceId,
                symbolName: (sourceNode?.name as string) || sourceId,
                filePath: (sourceNode?.file_path as string) || "",
                relation: e.type as string,
                confidence: e.confidence as "EXTRACTED" | "HEURISTIC" | "INFERRED" | "UNKNOWN",
                depth: hop + 1,
              });
            }
          }
          frontier = nextFrontier;
        }
      }

      // Find tests for all affected files
      for (const af of allAffectedFiles) {
        const nodeId = `file:${af}`;
        const testEdges = db.all(
          "SELECT e.source FROM edges e JOIN nodes n ON e.source = n.id WHERE e.target = ? AND n.type = 'test_file'",
          nodeId,
        ) as Record<string, unknown>[];
        for (const t of testEdges) {
          const tf = (t.source as string).replace("file:", "");
          if (!affectedTests.some(at => at.testFile === tf)) {
            affectedTests.push({ testFile: tf, targetFile: af, confidence: "HEURISTIC", source: "import_graph" });
          }
        }
      }

      // Risk scoring — deterministic point-based system
      const riskFactors: RiskFactor[] = [];
      let riskPoints = 0;

      const callingAffected = affectedCallers.filter(c => c.relation === "calls");
      const totalDependents = affectedCallers.length;

      // Fan-in: direct callers
      if (callingAffected.length >= 21) {
        riskFactors.push({ factor: "fan-in", severity: "critical", detail: `${callingAffected.length} direct callers` });
        riskPoints += 4;
      } else if (callingAffected.length >= 6) {
        riskFactors.push({ factor: "fan-in", severity: "warning", detail: `${callingAffected.length} direct callers` });
        riskPoints += 2;
      } else if (callingAffected.length >= 1) {
        riskFactors.push({ factor: "fan-in", severity: "info", detail: `${callingAffected.length} direct caller(s)` });
        riskPoints += 1;
      }

      // Total dependents (including importers, inheritors)
      if (totalDependents >= 21 && totalDependents !== callingAffected.length) {
        riskFactors.push({ factor: "total-dependents", severity: "warning", detail: `${totalDependents} total dependents` });
        riskPoints += 1;
      }

      // Cross-layer impact
      const layers = new Set<string>();
      for (const af of allAffectedFiles) {
        layers.add(assignLayer(af));
      }
      if (layers.size > 1) {
        riskFactors.push({ factor: "cross-layer", severity: "warning", detail: `spans ${layers.size} layers: ${[...layers].join(", ")}` });
        riskPoints += 2;
      }

      // Public export surface: changed files have exported symbols
      const hasPublicExports = symbolDetails.some(s => s.id.startsWith("function:") || s.id.startsWith("class:") || s.id.startsWith("variable:"));
      if (hasPublicExports) {
        riskFactors.push({ factor: "public-export", severity: "info", detail: "modified symbols are exported" });
        riskPoints += 1;
      }

      // Test coverage
      if (affectedTests.length > 0) {
        riskFactors.push({ factor: "test-coverage", severity: "info", detail: `${affectedTests.length} related test file(s)` });
        riskPoints += 1;
      } else {
        riskFactors.push({ factor: "test-coverage", severity: "warning", detail: "no related tests found" });
        riskPoints += 2;
      }

      // Stale graph
      const staleCheck = checkStaleness(root, config);
      if (!staleCheck.fresh) {
        riskFactors.push({ factor: "stale-graph", severity: "warning", detail: staleCheck.reason });
        riskPoints += 1;
      }

      // Config/auth/db path heuristics
      for (const cf of changedFiles) {
        if (cf.includes("config") || cf.includes("auth") || cf.includes("db") || cf.includes("middleware")) {
          riskFactors.push({ factor: "config-path", severity: "warning", detail: `changes to ${cf}` });
          riskPoints += 2;
          break; // only count once
        }
      }

      // Map points to risk level
      let riskLevel: ImpactReport["riskLevel"] = "LOW";
      if (riskPoints >= 8) riskLevel = "CRITICAL";
      else if (riskPoints >= 5) riskLevel = "HIGH";
      else if (riskPoints >= 2) riskLevel = "MODERATE";

      const report: ImpactReport = {
        project: config.projectName,
        timestamp: new Date().toISOString(),
        gitStatus: "unstaged + staged",
        riskLevel,
        riskScore: Math.min(riskPoints / 10, 1.0),
        changes: {
          changedFiles: changedFiles,
          changedSymbols: {
            added: symbolDetails.filter(s => s.changeType === "added").map(s => s.id),
            removed: symbolDetails.filter(s => s.changeType === "removed").map(s => s.id),
            modified: symbolDetails.filter(s => s.changeType === "modified").map(s => s.id),
          },
          symbolDetails,
        },
        impact: {
          affectedCallers: affectedCallers.slice(0, 20),
          affectedTests: affectedTests.slice(0, 10),
          affectedDocs: [],
          affectedLayers: [...layers],
        },
        riskFactors,
        recommendation: affectedTests.length > 0
          ? `Run ${affectedTests.length} affected tests. Read ${callingAffected.length} callers before merging.`
          : `Read ${callingAffected.length} callers before merging.`,
      };

      if (opts.format === "json") {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.format === "markdown") {
        const staleMd = checkStaleness(root, config);
        console.log(formatImpactReportMarkdown(report, staleMd));
      } else {
        const staleTerm = checkStaleness(root, config);
        console.log(formatImpactReportTerminal(report, staleTerm));
      }

      closeDb();
    });

  program
    .command("doctor")
    .description("Check RippleGraph setup and project health")
    .option("--project <path>", "Project root")
    .action((opts: { project?: string }) => {
      doctorCommand(opts.project);
    });

  program
    .command("verify")
    .description("Run self-test on a built-in fixture to verify RippleGraph works")
    .option("--project <path>", "Project root (optional, uses built-in fixture)")
    .action(async (opts: { project?: string }) => {
      await verifyCommand(opts.project);
    });

  const hookCmd = program
    .command("hook")
    .description("Claude Code hook integration");

  hookCmd
    .command("context-inject")
    .description("Process hook JSON from stdin and output context injection")
    .option("--project <path>", "Project root")
    .option("--adapter <provider>", "Hook provider (claude or codex)")
    .action((opts: { project?: string; adapter?: string }) => {
      contextInjectWithAdapter(opts.adapter, opts.project);
    });

  hookCmd
    .command("install <provider>")
    .description("Install RippleGraph PreToolUse hook (claude or codex)")
    .option("--dry", "Show what would change without writing")
    .action((provider: string, opts: { dry?: boolean }) => {
      if (provider === "codex") {
        installCodexCommand(opts.dry === true);
      } else {
        installClaudeCommand(opts.dry === true);
      }
    });

  hookCmd
    .command("uninstall <provider>")
    .description("Remove RippleGraph PreToolUse hook (claude or codex)")
    .option("--dry", "Show what would change without writing")
    .action((provider: string, opts: { dry?: boolean }) => {
      if (provider === "codex") {
        uninstallCodexCommand(opts.dry === true);
      } else {
        uninstallClaudeCommand(opts.dry === true);
      }
    });

  program
    .command("analyze")
    .description("Analyze a file for impact (JSON output for TraceBox integration)")
    .argument("<file>", "File to analyze")
    .option("--project <path>", "Project root")
    .option("--format <format>", "Output format", "json")
    .action((file: string, opts: { project?: string; format?: string }) => {
      const root = opts.project || process.cwd();
      const config = loadProjectConfig(root);
      const db = openDb(root);
      
      // Get file node
      const fileNodeId = `file:${file}`;
      const fileNode = db.get("SELECT id FROM nodes WHERE id = ?", fileNodeId) as Record<string, unknown> | undefined;
      
      if (!fileNode) {
        console.log(JSON.stringify({ error: "File not found in graph", file }));
        closeDb();
        return;
      }
      
      // Get symbols in file
      const fileSymbols = db.all(
        "SELECT id, name, type FROM nodes WHERE file_path = ? AND type != 'file'",
        file,
      ) as Record<string, unknown>[];
      
      // Find dependents (callers, importers)
      const frontier = [fileNodeId, ...fileSymbols.map(s => s.id as string)];
      const visited = new Set<string>(frontier);
      const affectedCallers: Array<{ symbol: string; file: string; relation: string }> = [];
      
      for (const nodeId of frontier) {
        const edges = db.all(
          "SELECT source, type FROM edges WHERE target = ? AND type IN ('calls', 'imports', 'exports')",
          nodeId,
        ) as Record<string, unknown>[];
        for (const e of edges) {
          const sourceId = e.source as string;
          if (!visited.has(sourceId)) {
            visited.add(sourceId);
            const sourceNode = db.get("SELECT name, file_path FROM nodes WHERE id = ?", sourceId) as Record<string, unknown> | undefined;
            if (sourceNode) {
              affectedCallers.push({
                symbol: (sourceNode.name as string) || sourceId,
                file: (sourceNode.file_path as string) || "",
                relation: e.type as string,
              });
            }
          }
        }
      }
      
      // Find tests
      const affectedTests: string[] = [];
      const testEdges = db.all(
        "SELECT e.source FROM edges e JOIN nodes n ON e.source = n.id WHERE e.target = ? AND n.type = 'test_file'",
        fileNodeId,
      ) as Record<string, unknown>[];
      for (const t of testEdges) {
        affectedTests.push((t.source as string).replace("file:", ""));
      }
      
      // Risk assessment
      const riskPoints = affectedCallers.length + (affectedTests.length > 0 ? 1 : 2);
      let risk = "low";
      if (riskPoints >= 8) risk = "critical";
      else if (riskPoints >= 5) risk = "high";
      else if (riskPoints >= 2) risk = "medium";
      
      const result = {
        file,
        risk,
        impact_score: Math.min(riskPoints * 10, 100),
        affected_callers: affectedCallers.slice(0, 20),
        affected_tests: affectedTests.slice(0, 10),
        symbol_count: fileSymbols.length,
      };
      
      console.log(JSON.stringify(result, null, 2));
      closeDb();
    });

  program.parse();
}

function assignLayer(filePath: string): string {
  if (filePath.includes("/routes/") || filePath.includes("/api/") || filePath.includes("/controllers/") || filePath.includes("/handlers/")) return "api";
  if (filePath.includes("/services/") || filePath.includes("/core/") || filePath.includes("/domain/")) return "service";
  if (filePath.includes("/components/") || filePath.includes("/ui/") || filePath.includes("/pages/")) return "ui";
  if (filePath.includes("/utils/") || filePath.includes("/helpers/") || filePath.includes("/lib/")) return "utility";
  if (filePath.startsWith("tests/") || filePath.includes("__tests__/") || filePath.includes(".test.")) return "test";
  if (filePath.endsWith(".md")) return "docs";
  return "src";
}
