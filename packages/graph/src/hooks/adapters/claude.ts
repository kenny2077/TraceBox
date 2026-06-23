import type { HookAdapter, NormalizedHookEvent, ParseResult } from "./types.js";
import { parseHookInput } from "../claude/parseHookInput.js";
import { FILE_EDITING_TOOLS } from "../claude/types.js";

/**
 * Claude Code hook adapter.
 *
 * Wraps the existing v0.2 parseHookInput() to produce provider-agnostic
 * NormalizedHookEvent instances. The existing parser is unchanged — this
 * adapter only normalizes its output shape.
 */
export const claudeAdapter: HookAdapter = {
  provider: "claude",

  parse(rawInput: string): ParseResult {
    const parsed = parseHookInput(rawInput);

    if (parsed.kind === "invalid") {
      return { kind: "invalid", reason: parsed.reason };
    }

    if (parsed.kind === "unsupported") {
      return { kind: "unsupported", reason: parsed.reason };
    }

    // parsed.kind === "file_edit"
    const event: NormalizedHookEvent = {
      provider: "claude",
      eventName: "PreToolUse",
      toolName: parsed.toolName,
      cwd: parsed.cwd,
      targetFiles: [parsed.filePath],
      raw: tryParseRaw(rawInput),
      source: {
        adapter: "claude",
        confidence: FILE_EDITING_TOOLS.has(parsed.toolName)
          ? "extracted"
          : "heuristic",
        notes: [
          `tool: ${parsed.toolName}`,
          `file: ${parsed.filePath}`,
        ],
      },
    };

    return { kind: "event", event };
  },

  formatResponse(context: string): unknown {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context,
      },
    };
  },
};

function tryParseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
