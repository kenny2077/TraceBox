import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, closeDb } from "../../src/db.js";
import { buildGraph } from "../../src/graph.js";
import { detectProjectConfig, saveProjectConfig } from "../../src/config.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, mkdirSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "../fixtures/repos/symbol-extraction");

describe("symbol extraction", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = mkdtempSync(resolve(tmpdir(), "rg-sym-ext-"));
    cpSync(FIXTURE, projectRoot, { recursive: true, filter: (src) => !src.includes(".ripplegraph") });

    const rgDir = resolve(projectRoot, ".ripplegraph");
    if (existsSync(rgDir)) rmSync(rgDir, { recursive: true, force: true });

    const config = detectProjectConfig(projectRoot);
    mkdirSync(rgDir, { recursive: true });
    saveProjectConfig(projectRoot, config);

    const db = openDb(projectRoot);
    await buildGraph(db, projectRoot, config, { force: true });
    closeDb();
  });

  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("detects exported const arrow functions as function nodes", () => {
    const db = openDb(projectRoot);
    try {
      const node = db.get("SELECT * FROM nodes WHERE id = ?", "function:src/utils.ts:subtract") as Record<string, unknown> | undefined;
      expect(node).toBeDefined();
      expect(node?.type).toBe("function");
      expect(node?.name).toBe("subtract");
      expect(node?.exported).toBe(1);
    } finally {
      closeDb();
    }
  });

  it("detects exported function expressions as function nodes", () => {
    const db = openDb(projectRoot);
    try {
      const node = db.get("SELECT * FROM nodes WHERE id = ?", "function:src/utils.ts:multiply") as Record<string, unknown> | undefined;
      expect(node).toBeDefined();
      expect(node?.type).toBe("function");
      expect(node?.name).toBe("multiply");
    } finally {
      closeDb();
    }
  });

  it("treats PascalCase exported arrow functions as function nodes", () => {
    const db = openDb(projectRoot);
    try {
      const node = db.get("SELECT * FROM nodes WHERE id = ?", "function:src/components.ts:UserCard") as Record<string, unknown> | undefined;
      expect(node).toBeDefined();
      expect(node?.type).toBe("function");
      expect(node?.name).toBe("UserCard");
      expect(node?.exported).toBe(1);
    } finally {
      closeDb();
    }
  });

  it("still creates variable nodes for non-function const declarations", () => {
    const db = openDb(projectRoot);
    try {
      const node = db.get("SELECT * FROM nodes WHERE id = ?", "variable:src/utils.ts:MathOps") as Record<string, unknown> | undefined;
      expect(node).toBeDefined();
      expect(node?.type).toBe("variable");
      expect(node?.name).toBe("MathOps");
    } finally {
      closeDb();
    }
  });

  it("creates file-level imports edge for default imports", () => {
    const db = openDb(projectRoot);
    try {
      const edge = db.get(
        "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'imports'",
        "file:src/consumer.ts", "file:src/utils.ts"
      ) as Record<string, unknown> | undefined;
      expect(edge).toBeDefined();
      // Edge may be EXTRACTED (from named imports) or HEURISTIC (from default import)
      // since they target the same file; what matters is the edge exists
      expect(["EXTRACTED", "HEURISTIC"]).toContain(edge?.confidence);
    } finally {
      closeDb();
    }
  });

  it("creates references edge for namespace imports", () => {
    const db = openDb(projectRoot);
    try {
      const edge = db.get(
        "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'references'",
        "file:src/consumer.ts", "file:src/utils.ts"
      ) as Record<string, unknown> | undefined;
      expect(edge).toBeDefined();
      expect(edge?.confidence).toBe("HEURISTIC");
    } finally {
      closeDb();
    }
  });

  it("creates EXTRACTED imports edge for named imports", () => {
    const db = openDb(projectRoot);
    try {
      const edge = db.get(
        "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'imports' AND confidence = 'EXTRACTED'",
        "file:src/consumer.ts", "file:src/components.ts"
      ) as Record<string, unknown> | undefined;
      expect(edge).toBeDefined();
    } finally {
      closeDb();
    }
  });

  it("extracts cross-file call edges for arrow function callers", () => {
    const db = openDb(projectRoot);
    try {
      const edge = db.get(
        "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'calls'",
        "function:src/consumer.ts:calculate", "function:src/utils.ts:add"
      ) as Record<string, unknown> | undefined;
      expect(edge).toBeDefined();
    } finally {
      closeDb();
    }
  });
});
