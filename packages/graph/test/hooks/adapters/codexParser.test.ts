import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codexAdapter } from "../../../src/hooks/adapters/codex.js";
import { extractPatchPaths } from "../../../src/hooks/adapters/patchPaths.js";
import { getAdapter } from "../../../src/hooks/adapters/index.js";
import type { NormalizedHookEvent, ParseResult } from "../../../src/hooks/adapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../../fixtures/codex-hooks");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// patchPaths unit tests
// ---------------------------------------------------------------------------
describe("extractPatchPaths", () => {
  it("extracts from *** Update File:", () => {
    const cmd = "*** Begin Patch\n*** Update File: src/auth/service.ts\n@@ ... @@\n*** End Patch";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/auth/service.ts"]);
  });

  it("extracts from *** Add File:", () => {
    const cmd = "*** Begin Patch\n*** Add File: src/api/new.ts\n@@ ... @@";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/api/new.ts"]);
  });

  it("extracts from *** Delete File:", () => {
    const cmd = "*** Begin Patch\n*** Delete File: src/api/old.ts\n@@ ... @@";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/api/old.ts"]);
  });

  it("extracts from unified diff headers (--- a/ and +++ b/)", () => {
    const cmd = "--- a/src/utils/helpers.ts\n+++ b/src/utils/helpers.ts\n@@ -1 +1,2 @@";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/utils/helpers.ts"]);
  });

  it("extracts from diff --git headers", () => {
    const cmd = "diff --git a/src/lib/core.ts b/src/lib/core.ts\n--- a/src/lib/core.ts\n+++ b/src/lib/core.ts";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/lib/core.ts"]);
  });

  it("deduplicates paths found by multiple patterns", () => {
    const cmd = "diff --git a/src/x.ts b/src/x.ts\n*** Update File: src/x.ts\n--- a/src/x.ts";
    const paths = extractPatchPaths(cmd);
    expect(paths).toEqual(["src/x.ts"]);
  });

  it("extracts multiple files", () => {
    const cmd =
      "*** Update File: src/a.ts\n*** Add File: src/b.ts\n--- a/src/c.ts\n+++ b/src/c.ts";
    const paths = extractPatchPaths(cmd);
    expect(paths).toHaveLength(3);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("src/c.ts");
  });

  it("returns empty array for no matches", () => {
    const paths = extractPatchPaths("no file paths here");
    expect(paths).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const paths = extractPatchPaths("");
    expect(paths).toEqual([]);
  });

  it("is case-insensitive for Update/Add/Delete File", () => {
    const cmd = "*** UPDATE FILE: src/Upper.ts\n*** add file: src/lower.ts";
    const paths = extractPatchPaths(cmd);
    expect(paths).toContain("src/Upper.ts");
    expect(paths).toContain("src/lower.ts");
  });
});

// ---------------------------------------------------------------------------
// Codex adapter parse tests
// ---------------------------------------------------------------------------
describe("codexAdapter.parse", () => {
  describe("apply_patch with *** Update File:", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-update.json"));
    });

    it("returns kind 'event'", () => {
      expect(result.kind).toBe("event");
    });

    it("has provider 'codex'", () => {
      if (result.kind !== "event") return;
      expect(result.event.provider).toBe("codex");
    });

    it("has toolName 'apply_patch'", () => {
      if (result.kind !== "event") return;
      expect(result.event.toolName).toBe("apply_patch");
    });

    it("extracts file from patch header", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual(["src/auth/service.ts"]);
    });

    it("has 'heuristic' confidence", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("heuristic");
    });

    it("has raw payload", () => {
      if (result.kind !== "event") return;
      const raw = result.event.raw as Record<string, unknown>;
      expect(raw.tool_name).toBe("apply_patch");
    });

    it("has source notes", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.notes).toBeDefined();
      expect(result.event.source.notes!.length).toBeGreaterThan(0);
    });
  });

  describe("apply_patch with multiple add/delete files", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-add-delete.json"));
    });

    it("extracts add and delete files", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toContain("src/api/new-endpoint.ts");
      expect(result.event.targetFiles).toContain("src/api/old-endpoint.ts");
      expect(result.event.targetFiles).toHaveLength(2);
    });
  });

  describe("apply_patch with diff --git headers", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-diff-git.json"));
    });

    it("extracts files from diff --git", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toContain("src/utils/helpers.ts");
      expect(result.event.targetFiles).toContain("src/config/settings.ts");
      expect(result.event.targetFiles).toHaveLength(2);
    });
  });

  describe("apply_patch with direct file_path", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-file-path.json"));
    });

    it("uses direct file_path", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual(["src/direct-path.ts"]);
    });

    it("has 'extracted' confidence from direct path", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("extracted");
    });
  });

  describe("apply_patch with files array", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-files-array.json"));
    });

    it("uses all files from the array", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toContain("src/a.ts");
      expect(result.event.targetFiles).toContain("src/b.ts");
      expect(result.event.targetFiles).toContain("src/c.ts");
      expect(result.event.targetFiles).toHaveLength(3);
    });

    it("has 'extracted' confidence", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("extracted");
    });
  });

  describe("path safety — traversal", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(readFixture("apply-patch-traversal.json"));
    });

    it("filters out ../ path traversal", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual([]);
    });

    it("has 'unknown' confidence (all paths filtered)", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("unknown");
    });

    it("includes note about no files extracted", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.notes).toContain("no target files extracted");
    });
  });

  describe("path safety — absolute outside cwd", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = codexAdapter.parse(
        readFixture("apply-patch-absolute-outside.json"),
      );
    });

    it("filters out absolute path outside cwd", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual([]);
    });
  });

  describe("path safety — absolute path inside cwd", () => {
    it("normalizes absolute path within cwd to relative", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        tool_input: {
          file_path: "/repo/src/lib/valid.ts",
        },
        cwd: "/repo",
      });
      const result = codexAdapter.parse(input);
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual(["src/lib/valid.ts"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Unsupported / invalid paths
// ---------------------------------------------------------------------------
describe("codexAdapter.parse edge cases", () => {
  it("returns kind 'unsupported' for Bash", () => {
    const result = codexAdapter.parse(readFixture("bash.json"));
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("Bash");
    }
  });

  it("returns kind 'unsupported' for Read", () => {
    const result = codexAdapter.parse(readFixture("read.json"));
    expect(result.kind).toBe("unsupported");
  });

  it("returns kind 'unsupported' for WebSearch", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "WebSearch",
      tool_input: { query: "test" },
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("unsupported");
  });

  it("returns kind 'unsupported' for WebFetch", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "WebFetch",
      tool_input: { url: "https://example.com" },
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("unsupported");
  });

  it("returns kind 'unsupported' for MCP tools (mcp__ prefix)", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__read_file",
      tool_input: { path: "/x" },
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("unsupported");
  });

  it("returns kind 'invalid' for malformed JSON", () => {
    const result = codexAdapter.parse(readFixture("malformed.json"));
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for empty string", () => {
    const result = codexAdapter.parse("");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for null input", () => {
    const result = codexAdapter.parse("null");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for array input", () => {
    const result = codexAdapter.parse("[]");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for missing tool_name", () => {
    const result = codexAdapter.parse(
      JSON.stringify({ hook_event_name: "PreToolUse" }),
    );
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for missing tool_input", () => {
    const result = codexAdapter.parse(
      JSON.stringify({ tool_name: "apply_patch" }),
    );
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for null tool_input", () => {
    const input = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: null,
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("invalid");
  });

  it("never throws on any input", () => {
    const inputs = ["", "null", "undefined", "[]", "{}", "not json", "{broken"];
    for (const input of inputs) {
      expect(() => codexAdapter.parse(input)).not.toThrow();
    }
  });

  it("returns event for apply_patch with no command (empty targetFiles)", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: {},
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("event");
    if (result.kind === "event") {
      expect(result.event.targetFiles).toEqual([]);
      expect(result.event.source.confidence).toBe("unknown");
    }
  });
});

// ---------------------------------------------------------------------------
// Defensive: Edit/Write aliases
// ---------------------------------------------------------------------------
describe("codexAdapter.parse defensive aliases", () => {
  it("accepts Edit as file-editing tool", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "src/edited.ts" },
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("event");
    if (result.kind === "event") {
      expect(result.event.targetFiles).toEqual(["src/edited.ts"]);
      expect(result.event.source.confidence).toBe("extracted");
    }
  });

  it("accepts Write as file-editing tool", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/written.ts" },
      cwd: "/repo",
    });
    const result = codexAdapter.parse(input);
    expect(result.kind).toBe("event");
    if (result.kind === "event") {
      expect(result.event.targetFiles).toEqual(["src/written.ts"]);
      expect(result.event.source.confidence).toBe("extracted");
    }
  });
});

// ---------------------------------------------------------------------------
// formatResponse
// ---------------------------------------------------------------------------
describe("codexAdapter.formatResponse", () => {
  it("returns Codex hook output shape", () => {
    const output = codexAdapter.formatResponse("project context") as Record<
      string,
      unknown
    >;
    expect(output).toHaveProperty("hookSpecificOutput");
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.hookEventName).toBe("PreToolUse");
    expect(hso.additionalContext).toBe("project context");
  });

  it("returns empty object for empty context (safe no-op)", () => {
    const output = codexAdapter.formatResponse("");
    expect(output).toEqual({});
  });

  it("output is JSON-serializable", () => {
    const output = codexAdapter.formatResponse("test");
    expect(() => JSON.stringify(output)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Registry integration
// ---------------------------------------------------------------------------
describe("adapter registry — codex", () => {
  it("getAdapter('codex') returns the codex adapter", () => {
    const adapter = getAdapter("codex");
    expect(adapter.provider).toBe("codex");
    expect(typeof adapter.parse).toBe("function");
    expect(typeof adapter.formatResponse).toBe("function");
  });

  it("getAdapter('codex') no longer throws", () => {
    expect(() => getAdapter("codex")).not.toThrow();
  });

  it("codex adapter parses a valid apply_patch payload", () => {
    const adapter = getAdapter("codex");
    const result = adapter.parse(readFixture("apply-patch-update.json"));
    expect(result.kind).toBe("event");
  });
});

// ---------------------------------------------------------------------------
// NormalizedHookEvent contract (Codex flavor)
// ---------------------------------------------------------------------------
describe("NormalizedHookEvent contract — Codex", () => {
  function makeCodexEvent(
    overrides: Partial<NormalizedHookEvent> = {},
  ): NormalizedHookEvent {
    return {
      provider: "codex",
      eventName: "PreToolUse",
      toolName: "apply_patch",
      cwd: "/repo",
      targetFiles: ["src/x.ts"],
      raw: { hook_event_name: "PreToolUse", tool_name: "apply_patch" },
      source: {
        adapter: "codex",
        confidence: "heuristic",
        notes: ["tool: apply_patch", "files: src/x.ts"],
      },
      ...overrides,
    };
  }

  it("provider is 'codex'", () => {
    const event = makeCodexEvent();
    expect(event.provider).toBe("codex");
  });

  it("targetFiles is always an array", () => {
    const event = makeCodexEvent({ targetFiles: [] });
    expect(Array.isArray(event.targetFiles)).toBe(true);
  });

  it("source.confidence can be 'heuristic' for patch extraction", () => {
    const event = makeCodexEvent({
      source: { adapter: "codex", confidence: "heuristic" },
    });
    expect(event.source.confidence).toBe("heuristic");
  });

  it("source.confidence can be 'unknown' when no files found", () => {
    const event = makeCodexEvent({
      targetFiles: [],
      source: { adapter: "codex", confidence: "unknown" },
    });
    expect(event.source.confidence).toBe("unknown");
  });

  it("eventName is PreToolUse", () => {
    const event = makeCodexEvent();
    expect(event.eventName).toBe("PreToolUse");
  });
});
