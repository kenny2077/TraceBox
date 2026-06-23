import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, closeDb } from "../../src/db.js";
import { buildGraph } from "../../src/graph.js";
import { detectProjectConfig, saveProjectConfig } from "../../src/config.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync, mkdirSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

type DB = ReturnType<typeof openDb>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "../fixtures/repos/cross-file-calls");

async function indexProject(): Promise<{ db: DB; projectRoot: string }> {
  // Copy fixture to a temp directory so tests don't mutate the shared fixture
  const projectRoot = mkdtempSync(resolve(tmpdir(), "rg-cross-file-calls-"));
  cpSync(FIXTURE, projectRoot, { recursive: true, filter: (src) => !src.includes(".ripplegraph") });

  const rgDir = resolve(projectRoot, ".ripplegraph");
  if (existsSync(rgDir)) {
    rmSync(rgDir, { recursive: true, force: true });
  }

  const config = detectProjectConfig(projectRoot);
  mkdirSync(rgDir, { recursive: true });
  saveProjectConfig(projectRoot, config);

  const db = openDb(projectRoot);
  await buildGraph(db, projectRoot, config, { force: true });

  return { db, projectRoot };
}

describe("cross-file call resolution", () => {
  let db: DB;
  let projectRoot: string;

  beforeAll(async () => {
    const ctx = await indexProject();
    db = ctx.db;
    projectRoot = ctx.projectRoot;
  });

  afterAll(() => {
    closeDb();
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("indexes exported function from math.ts", () => {
    const node = db.get(
      "SELECT * FROM nodes WHERE file_path = ? AND name = ? AND type = 'function'",
      "lib/math.ts",
      "add",
    );
    expect(node).toBeDefined();
  });

  it("indexes exported function from calc.ts", () => {
    const node = db.get(
      "SELECT * FROM nodes WHERE file_path = ? AND name = ? AND type = 'function'",
      "app/calc.ts",
      "calculate",
    );
    expect(node).toBeDefined();
  });

  it("creates cross-file calls edge from calc.ts:calculate → math.ts:add", () => {
    const callerRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "app/calc.ts",
      "calculate",
    ) as Record<string, unknown> | undefined;
    expect(callerRow).toBeDefined();

    const calleeRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "lib/math.ts",
      "add",
    ) as Record<string, unknown> | undefined;
    expect(calleeRow).toBeDefined();

    const callerId = callerRow!.id as string;
    const calleeId = calleeRow!.id as string;

    const edges = db.all(
      "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'calls'",
      callerId,
      calleeId,
    ) as Record<string, unknown>[];
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0]!.confidence).toBe("HEURISTIC");
  });

  it("creates cross-file calls edge from calc.ts → subtract in math.ts", () => {
    const callerRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "app/calc.ts",
      "calculate",
    ) as Record<string, unknown> | undefined;
    expect(callerRow).toBeDefined();

    const calleeRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "lib/math.ts",
      "subtract",
    ) as Record<string, unknown> | undefined;
    expect(calleeRow).toBeDefined();

    const edges = db.all(
      "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'calls'",
      callerRow!.id,
      calleeRow!.id,
    ) as Record<string, unknown>[];
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT create calls edge for UNIMPORTED function multiply", () => {
    const callerRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "app/calc.ts",
      "calculate",
    ) as Record<string, unknown> | undefined;
    expect(callerRow).toBeDefined();

    const calleeRow = db.get(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ?",
      "lib/math.ts",
      "multiply",
    ) as Record<string, unknown> | undefined;
    expect(calleeRow).toBeDefined();

    const edges = db.all(
      "SELECT * FROM edges WHERE source = ? AND target = ? AND type = 'calls'",
      callerRow!.id,
      calleeRow!.id,
    ) as Record<string, unknown>[];
    expect(edges.length).toBe(0);
  });
});
