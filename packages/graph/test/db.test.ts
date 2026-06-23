import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, closeDb, insertNode, getNode, getNodeCount, getEdgeCount, setMeta, getMeta } from "../src/db.js";
import type { GraphNode } from "../src/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type DB = ReturnType<typeof openDb>;

describe("db", () => {
  let db: DB;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ripplegraph-test-"));
    db = openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates tables on open", () => {
    const rows = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("nodes");
    expect(names).toContain("edges");
    expect(names).toContain("test_map");
    expect(names).toContain("layers");
    expect(names).toContain("meta");
  });

  it("inserts and retrieves a node", () => {
    const node: GraphNode = {
      id: "file:src/index.ts",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      exported: false,
    };
    insertNode(db, node);

    const retrieved = getNode(db, "file:src/index.ts");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("file:src/index.ts");
    expect(retrieved!.type).toBe("file");
    expect(retrieved!.name).toBe("index.ts");
  });

  it("updates node on re-insert", () => {
    const node: GraphNode = {
      id: "file:src/index.ts",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      exported: false,
    };
    insertNode(db, node);

    const updated: GraphNode = { ...node, complexity: "complex" };
    insertNode(db, updated);

    const retrieved = getNode(db, "file:src/index.ts");
    expect(retrieved!.complexity).toBe("complex");
  });

  it("deletes file nodes and their edges", () => {
    const node: GraphNode = {
      id: "file:src/index.ts",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      exported: false,
    };
    insertNode(db, node);
    insertNode(db, {
      id: "file:src/other.ts",
      type: "file",
      name: "other.ts",
      filePath: "src/other.ts",
      exported: false,
    });

    db.run(
      "INSERT OR IGNORE INTO edges (source, target, type, confidence, weight, source_file) VALUES (?, ?, ?, ?, ?, ?)",
      "file:src/index.ts", "file:src/other.ts", "imports", "EXTRACTED", 0.9, "src/index.ts",
    );

    db.run("DELETE FROM edges WHERE source_file = ?", "src/index.ts");
    db.run("DELETE FROM nodes WHERE file_path = ?", "src/index.ts");

    const retrieved = getNode(db, "file:src/index.ts");
    expect(retrieved).toBeNull();

    const edges = db.all("SELECT * FROM edges WHERE source_file = ?", "src/index.ts") as unknown[];
    expect(edges.length).toBe(0);
  });

  it("counts nodes and edges", () => {
    for (let i = 0; i < 5; i++) {
      insertNode(db, {
        id: `file:src/file${i}.ts`,
        type: "file",
        name: `file${i}.ts`,
        filePath: `src/file${i}.ts`,
        exported: false,
      });
    }
    expect(getNodeCount(db)).toBe(5);
    expect(getEdgeCount(db)).toBe(0);
  });

  it("stores and retrieves meta", () => {
    setMeta(db, "test_key", "test_value");
    expect(getMeta(db, "test_key")).toBe("test_value");
    expect(getMeta(db, "nonexistent")).toBeNull();
  });
});
