import type { HookAdapter, NormalizedHookEvent, ParseResult } from "./types.js";
import { extractPatchPaths } from "./patchPaths.js";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Codex hook adapter.
 *
 * Parses Codex PreToolUse hook JSON from stdin. The primary file-editing
 * tool is `apply_patch`. File paths are extracted from patch headers in
 * tool_input.command, with defensive fallback to tool_input.file_path,
 * tool_input.path, and tool_input.files.
 */
export const codexAdapter: HookAdapter = {
  provider: "codex",

  parse(rawInput: string): ParseResult {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawInput);
    } catch {
      return { kind: "invalid", reason: "malformed JSON input" };
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "invalid", reason: "payload is not an object" };
    }

    const toolName = payload.tool_name;
    if (!toolName || typeof toolName !== "string") {
      return { kind: "invalid", reason: "missing or invalid tool_name" };
    }

    const toolInput = payload.tool_input;
    if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
      return { kind: "invalid", reason: "missing or invalid tool_input" };
    }

    const input = toolInput as Record<string, unknown>;

    // --- tool classification ---
    const isFileEdit = isCodexEditTool(toolName);

    if (!isFileEdit) {
      return {
        kind: "unsupported",
        reason: `tool "${toolName}" is not a file-editing tool`,
      };
    }

    // --- file extraction ---
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const rawFiles = extractFiles(toolName, input);

    // Deduplicate and filter unsafe paths
    const targetFiles = dedupeAndFilter(rawFiles, cwd);
    const notes: string[] = [`tool: ${toolName}`];

    const confidence = resolveConfidence(toolName, input, targetFiles);
    if (targetFiles.length > 0) {
      notes.push(`files: ${targetFiles.join(", ")}`);
    } else {
      notes.push("no target files extracted");
    }

    const event: NormalizedHookEvent = {
      provider: "codex",
      eventName: "PreToolUse",
      toolName,
      cwd,
      targetFiles,
      raw: payload,
      source: {
        adapter: "codex",
        confidence,
        notes,
      },
    };

    return { kind: "event", event };
  },

  formatResponse(context: string): unknown {
    // Empty context → safe no-op output (matching hook convention)
    if (!context || context.trim().length === 0) {
      return {};
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Tool names Codex uses for file editing. */
const CODEX_EDIT_TOOLS = new Set(["apply_patch"]);

/** Tool names that are explicitly non-file-editing and should be skipped. */
const CODEX_SKIP_TOOLS = new Set([
  "Bash",
  "Read",
  "WebSearch",
  "WebFetch",
  "mcp__",
]);

function isCodexEditTool(toolName: string): boolean {
  // Defensive: also accept Edit/Write if they appear, per requirements
  if (toolName === "Edit" || toolName === "Write") {
    return true;
  }
  // Skip known non-edit tools
  if (CODEX_SKIP_TOOLS.has(toolName)) return false;
  // Skip MCP tools (prefix mcp__)
  if (toolName.startsWith("mcp__")) return false;
  // Only explicit edit tools are supported
  return CODEX_EDIT_TOOLS.has(toolName);
}

function extractFiles(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  const files: string[] = [];

  // Path 1: Direct file_path / path / files fields (defensive)
  const filePath = input.file_path;
  if (typeof filePath === "string" && filePath.length > 0) {
    files.push(filePath);
  }

  const path = input.path;
  if (typeof path === "string" && path.length > 0) {
    files.push(path);
  }

  const filesArr = input.files;
  if (Array.isArray(filesArr)) {
    for (const f of filesArr) {
      if (typeof f === "string" && f.length > 0) {
        files.push(f);
      }
    }
  }

  // Path 2: apply_patch — extract from command content
  if (toolName === "apply_patch") {
    const command = input.command;
    if (typeof command === "string" && command.length > 0) {
      const patchPaths = extractPatchPaths(command);
      files.push(...patchPaths);
    }
  }

  return files;
}

function dedupeAndFilter(files: string[], cwd: string): string[] {
  const seen = new Set<string>();
  const resolvedCwd = resolve(cwd);

  for (const raw of files) {
    // Reject empty
    if (!raw || raw === "/" || raw === ".") continue;

    // Normalize: make relative if absolute and inside cwd
    let normalized = raw.trim();

    if (isAbsolute(normalized)) {
      try {
        const rel = relative(resolvedCwd, normalized);
        // If relative starts with ../ it's outside the project
        if (rel.startsWith("..") || isAbsolute(rel)) continue;
        normalized = rel;
      } catch {
        continue;
      }
    }

    // Reject path traversal
    if (normalized.includes("..")) continue;

    // Reject paths that look like absolute after normalization
    if (isAbsolute(normalized)) continue;

    seen.add(normalized);
  }

  return [...seen];
}

function resolveConfidence(
  toolName: string,
  input: Record<string, unknown>,
  targetFiles: string[],
): "extracted" | "heuristic" | "unknown" {
  if (targetFiles.length === 0) return "unknown";

  // Direct file_path/path/files = extracted
  if (
    typeof input.file_path === "string" ||
    typeof input.path === "string" ||
    Array.isArray(input.files)
  ) {
    return "extracted";
  }

  // apply_patch with command = heuristic (parsed from patch headers)
  return "heuristic";
}
