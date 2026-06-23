import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatHookContext, queryFileCallers, queryFileTests } from "../../../src/hooks/context/formatHookContext.js";
import { openDb, closeDb, insertNode, insertEdge } from "../../../src/db.js";
import type { GraphNode, GraphEdge, AffectedSymbol, AffectedTest } from "../../../src/types.js";
import type { StalenessResult } from "../../../src/index/staleness.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function freshStaleness(): StalenessResult {
  return {
    fresh: true,
    metadata: {
      version: "0.1.0",
      indexedAt: new Date().toISOString(),
      gitCommit: "abc123",
      totalFiles: 10,
      totalSymbols: 50,
      totalEdges: 80,
    },
  };
}

function staleResult(): StalenessResult {
  return {
    fresh: false,
    reason: "1 of 10 sampled files have changed since last index",
    recommendation: "Run `ripplegraph index` to update the graph.",
    metadata: {
      version: "0.1.0",
      indexedAt: new Date(Date.now() - 3600000).toISOString(),
      gitCommit: "abc123",
      totalFiles: 10,
      totalSymbols: 50,
      totalEdges: 80,
    },
  };
}

function setupDb(): { db: ReturnType<typeof openDb>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ripplegraph-hookctx-"));
  const db = openDb(dir);

  // Create file nodes
  const files = [
    { id: "file:src/auth/service.ts", type: "file" as const, name: "service.ts", filePath: "src/auth/service.ts" },
    { id: "file:src/middleware/session.ts", type: "file" as const, name: "session.ts", filePath: "src/middleware/session.ts" },
    { id: "file:src/api/login.ts", type: "file" as const, name: "login.ts", filePath: "src/api/login.ts" },
    { id: "file:src/api/logout.ts", type: "file" as const, name: "logout.ts", filePath: "src/api/logout.ts" },
    { id: "file:tests/auth/service.test.ts", type: "test_file" as const, name: "service.test.ts", filePath: "tests/auth/service.test.ts" },
    { id: "file:tests/api/login.test.ts", type: "test_file" as const, name: "login.test.ts", filePath: "tests/api/login.test.ts" },
    { id: "file:tests/api/logout.test.ts", type: "test_file" as const, name: "logout.test.ts", filePath: "tests/api/logout.test.ts" },
  ];

  for (const f of files) {
    insertNode(db, { ...f, exported: false });
  }

  // Create symbol nodes in service.ts
  const symbols = [
    { id: "function:src/auth/service.ts:validateToken", type: "function" as const, name: "validateToken", filePath: "src/auth/service.ts" },
    { id: "function:src/auth/service.ts:refreshToken", type: "function" as const, name: "refreshToken", filePath: "src/auth/service.ts" },
  ];

  for (const s of symbols) {
    insertNode(db, { ...s, exported: true });
    insertEdge(db, { source: "file:src/auth/service.ts", target: s.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
    insertEdge(db, { source: s.id, target: "file:src/auth/service.ts", type: "exports", confidence: "EXTRACTED", weight: 0.9 });
  }

  // Create edges: callers → service.ts symbols
  // middleware calls validateToken
  insertNode(db, { id: "function:src/middleware/session.ts:sessionMiddleware", type: "function", name: "sessionMiddleware", filePath: "src/middleware/session.ts", exported: true });
  insertEdge(db, { source: "function:src/middleware/session.ts:sessionMiddleware", target: "function:src/auth/service.ts:validateToken", type: "calls", confidence: "EXTRACTED", weight: 0.9 });

  // login handler calls validateToken and refreshToken
  insertNode(db, { id: "function:src/api/login.ts:loginHandler", type: "function", name: "loginHandler", filePath: "src/api/login.ts", exported: true });
  insertEdge(db, { source: "function:src/api/login.ts:loginHandler", target: "function:src/auth/service.ts:validateToken", type: "calls", confidence: "EXTRACTED", weight: 0.9 });
  insertEdge(db, { source: "function:src/api/login.ts:loginHandler", target: "function:src/auth/service.ts:refreshToken", type: "calls", confidence: "EXTRACTED", weight: 0.9 });

  // logout handler imports service.ts
  insertEdge(db, { source: "file:src/api/logout.ts", target: "file:src/auth/service.ts", type: "imports", confidence: "EXTRACTED", weight: 0.9 });

  // Test edges
  insertEdge(db, { source: "file:tests/auth/service.test.ts", target: "file:src/auth/service.ts", type: "imports", confidence: "EXTRACTED", weight: 0.9 });
  insertEdge(db, { source: "file:tests/api/login.test.ts", target: "file:src/api/login.ts", type: "imports", confidence: "EXTRACTED", weight: 0.9 });

  return { db, dir };
}

describe("formatHookContext", () => {
  let ctx: ReturnType<typeof setupDb>;

  beforeEach(() => {
    ctx = setupDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("returns compact context for file with callers", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(callers.length).toBeGreaterThan(0);
    expect(tests.length).toBeGreaterThan(0);
    expect(result).toContain("RippleGraph edit-risk briefing");
    expect(result).toContain("Risk:");
    expect(result).toContain("Likely affected:");
    expect(result).toContain("Recommended tests:");
  });

  it("returns empty string for LOW risk with fresh graph", () => {
    const callers: AffectedSymbol[] = [];
    const tests: AffectedTest[] = [];
    const staleness = freshStaleness();

    const result = formatHookContext("src/nobody-uses-this.ts", callers, tests, staleness);
    expect(result).toBe("");
  });

  it("returns non-empty for LOW risk when graph is stale", () => {
    const callers: AffectedSymbol[] = [];
    const tests: AffectedTest[] = [];
    const staleness = staleResult();

    const result = formatHookContext("src/nobody-uses-this.ts", callers, tests, staleness, { skipLowRisk: true });

    expect(result).not.toBe("");
    expect(result).toContain("WARNING: Graph is stale");
  });

  it("includes stale warning in output", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = staleResult();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(result).toContain("WARNING: Graph is stale");
    expect(result).toContain("1 of 10 sampled files have changed");
  });

  it("includes risk reasons", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    // Should have caller count reason
    expect(result).toContain("Why:");
    expect(result).toContain("callers");
    // Should have test count reason
    expect(result).toContain("related tests");
  });

  it("includes read-first section", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(result).toContain("Read first:");
  });

  it("includes confidence labels as [extracted] or [inferred]", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(result).toContain("[extracted]");
  });

  it("includes recommended tests with runnable commands", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(result).toContain("bun test --");
    expect(result).toContain("tests/auth/service.test.ts");
  });

  it("includes rules section for non-LOW risk", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);

    expect(result).toContain("Rules:");
    expect(result).toContain("Preserve public function signatures");
    expect(result).toContain("Run recommended tests before committing.");
  });

  it("does not include rules for LOW risk", () => {
    const callers: AffectedSymbol[] = [];
    const tests: AffectedTest[] = [];
    const staleness = freshStaleness();

    const result = formatHookContext("src/file.ts", callers, tests, staleness, { minRiskLevel: "LOW" });
    expect(result).toContain("Risk: LOW");
  });

  it("respects maxChars option", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness, { maxChars: 100 });

    // Should be roughly around maxChars + truncation message
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result).toContain("[... truncated]");
  });

  it("never exceeds 9000 character hard cap", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness, { maxChars: 9500 });
    // Hard cap chops maxChars to 9000
    expect(result.length).toBeLessThan(9000);
  });

  it("does not skip LOW risk when minRiskLevel is LOW", () => {
    const callers: AffectedSymbol[] = [];
    const tests: AffectedTest[] = [];
    const staleness = freshStaleness();

    const result = formatHookContext("src/file.ts", callers, tests, staleness, { minRiskLevel: "LOW" });
    expect(result).not.toBe("");
    expect(result).toContain("RippleGraph edit-risk briefing");
  });

  it("queries callers correctly via queryFileCallers", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    expect(callers.length).toBe(5);

    const names = callers.map((c) => c.symbolName);
    expect(names).toContain("sessionMiddleware");
    expect(names).toContain("loginHandler");
  });

  it("queries tests correctly via queryFileTests", () => {
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    expect(tests.length).toBe(1); // only service.test.ts imports service.ts
    expect(tests[0]!.testFile).toBe("tests/auth/service.test.ts");
  });

  it("deduplicates callers", () => {
    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const ids = callers.map((c) => c.symbolId);

    // loginHandler appears twice (calls 2 different functions), which is correct
    // All other callers are unique
    const idCounts = new Map<string, number>();
    for (const id of ids) {
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }

    expect(idCounts.get("function:src/api/login.ts:loginHandler")).toBe(2);
    expect(idCounts.get("function:src/middleware/session.ts:sessionMiddleware")).toBe(1);
    expect(idCounts.get("file:src/api/logout.ts")).toBe(1);
    expect(idCounts.get("file:tests/auth/service.test.ts")).toBe(1);
    expect(callers.length).toBe(5);
  });

  it("formats scores correctly for HIGH risk", () => {
    // Create 3 fake callers to push past >5 → HIGH (base 5 + 3 = 8)
    for (let i = 0; i < 3; i++) {
      const callerId = `function:src/caller${i}.ts:caller${i}`;
      insertNode(ctx.db, {
        id: callerId,
        type: "function",
        name: `caller${i}`,
        filePath: `src/caller${i}.ts`,
        exported: true,
      });
      insertEdge(ctx.db, {
        source: callerId,
        target: "function:src/auth/service.ts:validateToken",
        type: "calls",
        confidence: "EXTRACTED",
        weight: 0.9,
      });
    }

    const callers = queryFileCallers(ctx.db, "src/auth/service.ts");
    const tests = queryFileTests(ctx.db, "src/auth/service.ts");
    const staleness = freshStaleness();

    const result = formatHookContext("src/auth/service.ts", callers, tests, staleness);
    expect(result).toContain("Risk: HIGH");
  });
});
