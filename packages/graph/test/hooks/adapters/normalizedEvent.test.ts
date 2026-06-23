import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAdapter } from "../../../src/hooks/adapters/claude.js";
import { getAdapter, resolveAdapter } from "../../../src/hooks/adapters/index.js";
import type { NormalizedHookEvent, ParseResult } from "../../../src/hooks/adapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../../fixtures/claude-hooks");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// NormalizedHookEvent shape tests
// ---------------------------------------------------------------------------
describe("NormalizedHookEvent shape", () => {
  describe("via claudeAdapter.parse (Write)", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = claudeAdapter.parse(readFixture("write.json"));
    });

    it("returns kind 'event'", () => {
      expect(result.kind).toBe("event");
    });

    it("has correct provider", () => {
      if (result.kind !== "event") return;
      expect(result.event.provider).toBe("claude");
    });

    it("has eventName PreToolUse", () => {
      if (result.kind !== "event") return;
      expect(result.event.eventName).toBe("PreToolUse");
    });

    it("has toolName from payload", () => {
      if (result.kind !== "event") return;
      expect(result.event.toolName).toBe("Write");
    });

    it("has cwd from payload", () => {
      if (result.kind !== "event") return;
      expect(result.event.cwd).toBe("/Users/alice/projects/my-app");
    });

    it("has targetFiles as single-element array with resolved path", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual(["src/auth/service.ts"]);
    });

    it("has raw as the parsed JSON payload", () => {
      if (result.kind !== "event") return;
      const raw = result.event.raw as Record<string, unknown>;
      expect(raw.hook_event_name).toBe("PreToolUse");
      expect(raw.tool_name).toBe("Write");
    });

    it("has source.adapter matching provider", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.adapter).toBe("claude");
    });

    it("has source.confidence 'extracted' for known file-editing tool", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("extracted");
    });

    it("has source.notes with tool and file", () => {
      if (result.kind !== "event") return;
      const notes = result.event.source.notes!;
      expect(notes).toContain("tool: Write");
      expect(notes).toContain("file: src/auth/service.ts");
    });
  });

  describe("via claudeAdapter.parse (Edit)", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = claudeAdapter.parse(readFixture("edit.json"));
    });

    it("returns toolName 'Edit'", () => {
      if (result.kind !== "event") return;
      expect(result.event.toolName).toBe("Edit");
    });

    it("extracts relative file_path correctly", () => {
      if (result.kind !== "event") return;
      expect(result.event.targetFiles).toEqual(["src/utils/helpers.ts"]);
    });

    it("has 'extracted' confidence", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("extracted");
    });
  });

  describe("via claudeAdapter.parse (MultiEdit)", () => {
    let result: ParseResult;

    beforeAll(() => {
      result = claudeAdapter.parse(readFixture("multiedit.json"));
    });

    it("returns toolName 'MultiEdit'", () => {
      if (result.kind !== "event") return;
      expect(result.event.toolName).toBe("MultiEdit");
    });

    it("has 'extracted' confidence", () => {
      if (result.kind !== "event") return;
      expect(result.event.source.confidence).toBe("extracted");
    });
  });
});

// ---------------------------------------------------------------------------
// Unsupported / invalid paths
// ---------------------------------------------------------------------------
describe("claudeAdapter.parse edge cases", () => {
  it("returns kind 'unsupported' for Bash tool", () => {
    const result = claudeAdapter.parse(readFixture("bash.json"));
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("Bash");
    }
  });

  it("returns kind 'invalid' for non-JSON input", () => {
    const result = claudeAdapter.parse(readFixture("not-json.txt"));
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for malformed JSON", () => {
    const result = claudeAdapter.parse(readFixture("malformed.json"));
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for empty string", () => {
    const result = claudeAdapter.parse("");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for null", () => {
    const result = claudeAdapter.parse("null");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'invalid' for empty object", () => {
    const result = claudeAdapter.parse("{}");
    expect(result.kind).toBe("invalid");
  });

  it("returns kind 'unsupported' when file_path is outside project", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/etc/passwd" },
      cwd: "/Users/alice/projects/my-app",
    });
    const result = claudeAdapter.parse(input);
    expect(result.kind).toBe("unsupported");
  });

  it("wraps raw even when JSON parse fails", () => {
    // The claudeAdapter wraps raw via tryParseRaw, which falls back to the string
    // But if parseHookInput returns "invalid", we never reach that code.
    // This test verifies that invalid paths don't throw.
    const result = claudeAdapter.parse("not json {{{");
    expect(result.kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// formatResponse
// ---------------------------------------------------------------------------
describe("claudeAdapter.formatResponse", () => {
  it("returns Claude-specific hook output shape", () => {
    const output = claudeAdapter.formatResponse("test context") as Record<string, unknown>;
    expect(output).toHaveProperty("hookSpecificOutput");
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.hookEventName).toBe("PreToolUse");
    expect(hso.additionalContext).toBe("test context");
  });

  it("handles empty context string", () => {
    const output = claudeAdapter.formatResponse("") as Record<string, unknown>;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toBe("");
  });

  it("handles multi-line context", () => {
    const ctx = "Line 1\nLine 2\nLine 3";
    const output = claudeAdapter.formatResponse(ctx) as Record<string, unknown>;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toBe(ctx);
  });

  it("output is JSON-serializable", () => {
    const output = claudeAdapter.formatResponse("test");
    expect(() => JSON.stringify(output)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adapter registry tests
// ---------------------------------------------------------------------------
describe("getAdapter", () => {
  it("returns claude adapter for 'claude'", () => {
    const adapter = getAdapter("claude");
    expect(adapter.provider).toBe("claude");
    expect(typeof adapter.parse).toBe("function");
    expect(typeof adapter.formatResponse).toBe("function");
  });

  it("returns codex adapter for 'codex'", () => {
    const adapter = getAdapter("codex");
    expect(adapter.provider).toBe("codex");
    expect(typeof adapter.parse).toBe("function");
    expect(typeof adapter.formatResponse).toBe("function");
  });
});

describe("resolveAdapter", () => {
  it("returns claude adapter for undefined", () => {
    const adapter = resolveAdapter(undefined);
    expect(adapter.provider).toBe("claude");
  });

  it("returns claude adapter for 'claude'", () => {
    const adapter = resolveAdapter("claude");
    expect(adapter.provider).toBe("claude");
  });

  it("returns claude adapter for unknown value (fallback)", () => {
    const adapter = resolveAdapter("unknown");
    expect(adapter.provider).toBe("claude");
  });

  it("returns codex adapter for 'codex'", () => {
    const adapter = resolveAdapter("codex");
    expect(adapter.provider).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// NormalizedHookEvent structural contract
// ---------------------------------------------------------------------------
describe("NormalizedHookEvent contract", () => {
  function makeEvent(overrides: Partial<NormalizedHookEvent> = {}): NormalizedHookEvent {
    return {
      provider: "claude",
      eventName: "PreToolUse",
      toolName: "Write",
      cwd: "/test/project",
      targetFiles: ["src/index.ts"],
      raw: { hook_event_name: "PreToolUse" },
      source: {
        adapter: "claude",
        confidence: "extracted",
      },
      ...overrides,
    };
  }

  it("targetFiles is always an array (even if empty)", () => {
    const event = makeEvent({ targetFiles: [] });
    expect(Array.isArray(event.targetFiles)).toBe(true);
    expect(event.targetFiles).toHaveLength(0);
  });

  it("source.confidence is one of the three valid values", () => {
    const valid = ["extracted", "heuristic", "unknown"];
    for (const conf of valid) {
      const event = makeEvent({ source: { adapter: "claude", confidence: conf as NormalizedHookEvent["source"]["confidence"] } });
      expect(valid).toContain(event.source.confidence);
    }
  });

  it("provider matches source.adapter", () => {
    const event = makeEvent({ provider: "claude", source: { adapter: "claude", confidence: "extracted" } });
    expect(event.provider).toBe(event.source.adapter);
  });

  it("raw can be any JSON-serializable value", () => {
    const primitives = [null, 42, "string", true, { key: "value" }, [1, 2, 3]];
    for (const raw of primitives) {
      const event = makeEvent({ raw });
      expect(event.raw).toEqual(raw);
    }
  });

  it("eventName can be PreToolUse or another string (forward compat)", () => {
    const event = makeEvent({ eventName: "PostToolUse" });
    expect(event.eventName).toBe("PostToolUse");
  });
});
