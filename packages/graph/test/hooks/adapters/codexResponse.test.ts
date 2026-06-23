import { describe, it, expect } from "vitest";
import { codexAdapter } from "../../../src/hooks/adapters/codex.js";

// ---------------------------------------------------------------------------
// formatResponse — valid context
// ---------------------------------------------------------------------------
describe("codexAdapter.formatResponse — valid context", () => {
  const context =
    "RippleGraph edit-risk briefing for src/auth/service.ts:\nRisk: MODERATE (3 callers, 2 tests)\nCallers: src/api/login.ts, src/middleware/session.ts\nTests: src/auth/__tests__/service.test.ts";

  it("returns a JSON-serializable object", () => {
    const output = codexAdapter.formatResponse(context);
    expect(() => JSON.stringify(output)).not.toThrow();
    const json = JSON.stringify(output);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes hookSpecificOutput wrapper", () => {
    const output = codexAdapter.formatResponse(context) as Record<
      string,
      unknown
    >;
    expect(output).toHaveProperty("hookSpecificOutput");
    expect(typeof output.hookSpecificOutput).toBe("object");
  });

  it("includes hookEventName: 'PreToolUse'", () => {
    const output = codexAdapter.formatResponse(context) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.hookEventName).toBe("PreToolUse");
  });

  it("includes additionalContext with the context string", () => {
    const output = codexAdapter.formatResponse(context) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toBe(context);
  });

  it("does NOT include permissionDecision", () => {
    const output = codexAdapter.formatResponse(context) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso).not.toHaveProperty("permissionDecision");
  });

  it("does NOT include permissionDecisionReason", () => {
    const output = codexAdapter.formatResponse(context) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso).not.toHaveProperty("permissionDecisionReason");
  });

  it("output is compact — only hookSpecificOutput at top level", () => {
    const output = codexAdapter.formatResponse(
      context,
    ) as Record<string, unknown>;
    const keys = Object.keys(output);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("hookSpecificOutput");
  });

  it("hookSpecificOutput has exactly the expected keys", () => {
    const output = codexAdapter.formatResponse(
      context,
    ) as Record<string, unknown>;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    const keys = Object.keys(hso).sort();
    expect(keys).toEqual(["additionalContext", "hookEventName"]);
  });
});

// ---------------------------------------------------------------------------
// formatResponse — empty / falsy context
// ---------------------------------------------------------------------------
describe("codexAdapter.formatResponse — empty context", () => {
  it("returns empty object for empty string", () => {
    const output = codexAdapter.formatResponse("");
    expect(output).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    const output = codexAdapter.formatResponse("   \n  \t  ");
    expect(output).toEqual({});
  });

  it("returns empty object for null-like value (defensive)", () => {
    // TypeScript would prevent this at compile time, but test defensively
    const output = codexAdapter.formatResponse(
      undefined as unknown as string,
    );
    expect(output).toEqual({});
  });

  it("empty object serializes to '{}'", () => {
    const output = codexAdapter.formatResponse("");
    expect(JSON.stringify(output)).toBe("{}");
  });

  it("empty object is valid JSON and parseable", () => {
    const output = codexAdapter.formatResponse("");
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// formatResponse — various context sizes
// ---------------------------------------------------------------------------
describe("codexAdapter.formatResponse — context variations", () => {
  it("handles single-line context", () => {
    const ctx = "Risk: LOW — no callers or tests found.";
    const output = codexAdapter.formatResponse(ctx) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toBe(ctx);
  });

  it("handles multi-line context with blank lines", () => {
    const ctx = "Line 1\n\nLine 3\n\n\nLine 6";
    const output = codexAdapter.formatResponse(ctx) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toBe(ctx);
  });

  it("handles context with special JSON characters", () => {
    const ctx = 'Risk: HIGH\nFile: src/"quoted".ts\nPath: src/unix\\windows';
    const json = JSON.stringify(codexAdapter.formatResponse(ctx));
    expect(() => JSON.parse(json)).not.toThrow();
    // Round-trip: special chars survive serialization
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.additionalContext).toBe(ctx);
  });

  it("handles context with unicode", () => {
    const ctx = "Risk: MODERATE\nFile: src/über/café.ts\nCallers: 日本語.ts";
    const json = JSON.stringify(codexAdapter.formatResponse(ctx));
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.additionalContext).toBe(ctx);
  });

  it("handles context with emoji (JSON-safe)", () => {
    const ctx = "Risk: HIGH ⚠️\nFile: src/main.ts";
    const json = JSON.stringify(codexAdapter.formatResponse(ctx));
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.additionalContext).toBe(ctx);
  });

  it("handles context at 9000 characters (max hook budget)", () => {
    const ctx = "x".repeat(9000);
    const output = codexAdapter.formatResponse(ctx) as Record<
      string,
      unknown
    >;
    const hso = output.hookSpecificOutput as Record<string, unknown>;
    expect(hso.additionalContext).toHaveLength(9000);
  });

  it("handles very long context (beyond typical max)", () => {
    const ctx = "y".repeat(50000);
    const output = codexAdapter.formatResponse(ctx) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(output).length).toBeGreaterThan(50000);
  });
});

// ---------------------------------------------------------------------------
// formatResponse — contract invariants
// ---------------------------------------------------------------------------
describe("codexAdapter.formatResponse — contract", () => {
  it("always returns an object (never a string)", () => {
    for (const ctx of ["hello", "", "   ", "multi\nline"]) {
      const output = codexAdapter.formatResponse(ctx);
      expect(typeof output).toBe("object");
      expect(output).not.toBeNull();
      expect(Array.isArray(output)).toBe(false);
    }
  });

  it("is always JSON-serializable", () => {
    const contexts = [
      "simple",
      "",
      "with\nnewlines",
      'with "quotes"',
      "with \\ backslashes",
      "with \t tabs",
      "unicode: café 日本語",
    ];
    for (const ctx of contexts) {
      expect(() => JSON.stringify(codexAdapter.formatResponse(ctx))).not.toThrow();
    }
  });

  it("does not emit raw text or non-JSON output", () => {
    // The function returns an object, not a string
    const output = codexAdapter.formatResponse("test");
    expect(typeof output).not.toBe("string");
  });

  it("round-trips through JSON.parse(JSON.stringify())", () => {
    const ctx = "Risk: MODERATE\nCallers: src/a.ts, src/b.ts";
    const output = codexAdapter.formatResponse(ctx);
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(ctx);
  });
});
