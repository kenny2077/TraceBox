import { parseHookInput } from "../../hooks/claude/parseHookInput.js";
import { queryFileCallers, queryFileTests, formatHookContext } from "../../hooks/context/formatHookContext.js";
import { checkStaleness } from "../../index/staleness.js";
import { openDb, closeDb } from "../../db.js";
import { detectProjectRoot, detectProjectConfig, loadProjectConfig } from "../../config.js";
import { loadHookConfig } from "../../config/loader.js";
import { resolveAdapter } from "../../hooks/adapters/index.js";
import type { NormalizedHookEvent, ParseResult } from "../../hooks/adapters/types.js";
import type { AffectedSymbol, AffectedTest } from "../../types.js";
import type { RiskLevel } from "../../config/schema.js";
import { readSync } from "node:fs";

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Claude-only entry (backward compat). No adapter routing. */
export function contextInjectCommand(projectPath?: string): void {
  contextInjectWithAdapter("claude", projectPath);
}

/** Adapter-aware entry. Routes to Claude path or Codex path. */
export function contextInjectWithAdapter(
  adapterRaw: string | undefined,
  projectPath?: string,
): void {
  const adapter = adapterRaw || "claude";

  if (adapter === "codex") {
    codexContextInject(projectPath);
    return;
  }

  // Default: existing Claude path (unchanged)
  claudeContextInject(projectPath);
}

// ---------------------------------------------------------------------------
// Claude path (preserved from v0.2, unchanged)
// ---------------------------------------------------------------------------

function claudeContextInject(projectPath?: string): void {
  const cwd = projectPath || process.cwd();

  let stdinData = "";
  try {
    stdinData = readStdinSync();
  } catch {
    failOpen("failed to read stdin");
    return;
  }

  if (!stdinData.trim()) {
    failOpen("empty stdin");
    return;
  }

  const parsed = parseHookInput(stdinData);

  if (parsed.kind !== "file_edit") {
    printJson({});
    return;
  }

  let projectRoot: string | null = null;

  if (projectPath) {
    projectRoot = projectPath;
  } else {
    try {
      projectRoot = detectProjectRoot(parsed.cwd || process.cwd());
    } catch {
      failOpen("could not detect project root");
      return;
    }
  }

  if (!projectRoot) {
    failOpen("no project root found");
    return;
  }

  let db: ReturnType<typeof openDb>;
  try {
    db = openDb(projectRoot);
  } catch {
    failOpen("could not open graph database");
    return;
  }

  try {
    const config = loadProjectConfig(projectRoot) || detectProjectConfig(projectRoot);
    const hookConfig = loadHookConfig(projectRoot);

    if (!hookConfig.claude.enabled) {
      printJson({});
      return;
    }

    let staleness;
    try {
      staleness = checkStaleness(projectRoot, config);
    } catch {
      staleness = { fresh: false, reason: "staleness check failed" };
    }

    let callers: AffectedSymbol[] = [];
    let tests: AffectedTest[] = [];
    try {
      callers = queryFileCallers(db, parsed.filePath);
      tests = queryFileTests(db, parsed.filePath);
    } catch {
      // fall back to empty arrays
    }

    const context = formatHookContext(parsed.filePath, callers, tests, staleness, {
      minRiskLevel: hookConfig.claude.minRiskToInject,
      maxChars: hookConfig.claude.maxContextChars,
      injectOnStale: hookConfig.claude.injectOnStaleGraph,
    });

    if (!context) {
      printJson({});
      return;
    }

    printJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context,
      },
    });
  } catch (err) {
    failOpen(`internal error: ${String(err)}`);
  } finally {
    closeDb();
  }
}

// ---------------------------------------------------------------------------
// Codex path (new v0.3)
// ---------------------------------------------------------------------------

function codexContextInject(projectPath?: string): void {
  let stdinData = "";
  try {
    stdinData = readStdinSync();
  } catch {
    failOpen("failed to read stdin");
    return;
  }

  if (!stdinData.trim()) {
    failOpen("empty stdin");
    return;
  }

  const adapter = resolveAdapter("codex");
  const parsed = adapter.parse(stdinData);

  // Unsupported tools → no-op (exit 0, empty JSON)
  if (parsed.kind === "unsupported") {
    printJson({});
    return;
  }

  // Malformed input → no-op (exit 0, fail open)
  if (parsed.kind === "invalid") {
    printJson({});
    return;
  }

  // parsed.kind === "event"
  const event = parsed.event;

  // Determine project root
  let projectRoot: string | null = null;
  if (projectPath) {
    projectRoot = projectPath;
  } else {
    try {
      projectRoot = detectProjectRoot(event.cwd || process.cwd());
    } catch {
      failOpen("could not detect project root");
      return;
    }
  }

  if (!projectRoot) {
    failOpen("no project root found");
    return;
  }

  // Open DB
  let db: ReturnType<typeof openDb>;
  try {
    db = openDb(projectRoot);
  } catch {
    failOpen("could not open graph database");
    return;
  }

  try {
    const config = loadProjectConfig(projectRoot) || detectProjectConfig(projectRoot);
    const hookConfig = loadHookConfig(projectRoot);

    if (!hookConfig.codex.enabled) {
      printJson({});
      return;
    }

    // Staleness
    let staleness;
    try {
      staleness = checkStaleness(projectRoot, config);
    } catch {
      staleness = { fresh: false, reason: "staleness check failed" };
    }

    // Build combined context from target files
    const context = buildCombinedContext(
      db,
      event,
      staleness,
      hookConfig.codex.minRiskToInject,
      hookConfig.codex.maxContextChars,
      hookConfig.codex.injectOnStaleGraph,
    );

    const response = adapter.formatResponse(context);
    printJson(response);
  } catch (err) {
    failOpen(`internal error: ${String(err)}`);
  } finally {
    closeDb();
  }
}

// ---------------------------------------------------------------------------
// Multi-file context builder
// ---------------------------------------------------------------------------

function buildCombinedContext(
  db: ReturnType<typeof openDb>,
  event: NormalizedHookEvent,
  staleness: ReturnType<typeof checkStaleness>,
  minRiskLevel: RiskLevel,
  maxChars: number,
  injectOnStale: boolean,
): string {
  const { targetFiles } = event;

  // No files → build a project-level context
  if (targetFiles.length === 0) {
    return formatProjectLevelContext(db, staleness, maxChars, injectOnStale);
  }

  // Build per-file contexts, score by caller count, take top-N
  const maxFiles = 5;
  const maxCharsPerFile = Math.floor(maxChars / Math.min(targetFiles.length, maxFiles));

  interface FileContext {
    file: string;
    context: string;
    callerCount: number;
  }

  const fileContexts: FileContext[] = [];

  for (const file of targetFiles.slice(0, 10)) { // hard cap at 10 to bound work
    let callers: AffectedSymbol[] = [];
    let tests: AffectedTest[] = [];
    try {
      callers = queryFileCallers(db, file);
      tests = queryFileTests(db, file);
    } catch {
      // fall back to empty
    }

    const ctx = formatHookContext(file, callers, tests, staleness, {
      minRiskLevel,
      maxChars: maxCharsPerFile,
      injectOnStale,
    });

    if (ctx) {
      fileContexts.push({ file, context: ctx, callerCount: callers.length });
    }
  }

  if (fileContexts.length === 0) {
    return "";
  }

  // Sort by caller count descending (highest risk first)
  fileContexts.sort((a, b) => b.callerCount - a.callerCount);

  // Take top-N and combine
  const top = fileContexts.slice(0, maxFiles);
  const combined = top.map(fc => fc.context).join("\n---\n");

  // Cap to maxChars
  if (combined.length > maxChars) {
    return combined.slice(0, maxChars - 3) + "...";
  }

  return combined;
}

function formatProjectLevelContext(
  db: ReturnType<typeof openDb>,
  staleness: ReturnType<typeof checkStaleness>,
  maxChars: number,
  injectOnStale: boolean,
): string {
  const parts: string[] = [];
  parts.push("RippleGraph project-risk briefing (no specific file targeted).");

  // Staleness
  if (injectOnStale && !staleness.fresh) {
    parts.push(`WARNING: Graph is stale. ${staleness.reason || "Consider re-indexing."}`);
  }

  // Count total files
  try {
    const row = db.get("SELECT COUNT(*) as count FROM nodes WHERE type = 'file'") as { count: number } | undefined;
    if (row && row.count > 0) {
      parts.push(`Indexed files: ${row.count}.`);
    }
  } catch {
    // ignore
  }

  // Recommendation
  if (!staleness.fresh) {
    parts.push("Run `ripplegraph index` to refresh the graph.");
  }

  const result = parts.join(" ");
  return result.length > maxChars ? result.slice(0, maxChars - 3) + "..." : result;
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function readStdinSync(): string {
  const { stdin } = process;

  if (stdin.isTTY) {
    return "";
  }

  const fd = 0;
  const buf = Buffer.alloc(65536);
  let offset = 0;
  let truncated = false;

  while (offset < buf.length) {
    try {
      const bytesRead = readSync(fd, buf, offset, buf.length - offset, null!);
      if (bytesRead === 0) break;
      offset += bytesRead;
    } catch {
      break;
    }
  }

  // Detect truncation: if the buffer is full and more data might be available,
  // log a warning so users can diagnose missing context injection.
  if (offset >= buf.length) {
    truncated = true;
  }

  if (truncated) {
    console.error("[ripplegraph] stdin exceeded 64 KiB buffer; input was truncated");
  }

  return buf.subarray(0, offset).toString("utf-8");
}

function failOpen(reason: string): void {
  console.error(`[ripplegraph] ${reason}`);
  printJson({});
}

function printJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}
