import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GraphNode, GraphEdge } from "./types.js";

// Detect runtime: Bun has Bun.sqlite, Node.js doesn't
const isBun = typeof globalThis.Bun !== "undefined";

// Use dynamic import for better-sqlite3 in Node.js ESM
let BetterSQLite3: any = null;

async function loadBetterSQLite3() {
  if (!BetterSQLite3 && !isBun) {
    BetterSQLite3 = (await import("better-sqlite3")).default;
  }
  return BetterSQLite3;
}

function createDB(dbPath: string) {
  if (isBun) {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath);
    return {
      run: (sql: string, ...params: unknown[]) => db.run(sql, ...params),
      all: (sql: string, ...params: unknown[]) => db.query(sql).all(...params),
      get: (sql: string, ...params: unknown[]) => db.query(sql).get(...params),
      exec: (sql: string) => { db.run(sql); },
      close: () => db.close(),
    };
  } else {
    // For Node.js, we need to handle this differently since we're in ESM
    // The createDB function needs to be async or we need to use a different approach
    throw new Error("Node.js support requires async initialization. Use createDBAsync instead.");
  }
}

export async function createDBAsync(dbPath: string) {
  if (isBun) {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath);
    return {
      run: (sql: string, ...params: unknown[]) => db.run(sql, ...params),
      all: (sql: string, ...params: unknown[]) => db.query(sql).all(...params),
      get: (sql: string, ...params: unknown[]) => db.query(sql).get(...params),
      exec: (sql: string) => { db.run(sql); },
      close: () => db.close(),
    };
  } else {
    const BS3 = await loadBetterSQLite3();
    const db = new BS3(dbPath);
    return {
      run: (sql: string, ...params: unknown[]) => { db.prepare(sql).run(...params); },
      all: (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
      get: (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params),
      exec: (sql: string) => { db.exec(sql); },
      pragma: (pragma: string) => { db.pragma(pragma); },
      close: () => db.close(),
    };
  }
}

let _db: ReturnType<typeof createDB> | null = null;

export function openDb(projectRoot: string) {
  if (_db) return _db;
  const dbPath = join(projectRoot, ".ripplegraph", "graph.db");
  const dir = join(projectRoot, ".ripplegraph");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = createDB(dbPath);
  return _db;
}

export async function openDbAsync(projectRoot: string) {
  if (_db) return _db;
  const dbPath = join(projectRoot, ".ripplegraph", "graph.db");
  const dir = join(projectRoot, ".ripplegraph");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = await createDBAsync(dbPath);
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getNodeCount(db: any) {
  const row = db.get("SELECT COUNT(*) as count FROM nodes");
  return (row as { count: number }).count;
}

export function getEdgeCount(db: any) {
  const row = db.get("SELECT COUNT(*) as count FROM edges");
  return (row as { count: number }).count;
}

export function getNode(db: any, id: string): GraphNode | undefined {
  return db.get("SELECT * FROM nodes WHERE id = ?", id) as GraphNode | undefined;
}

export function getOutgoingEdges(db: any, source: string): GraphEdge[] {
  return db.all("SELECT * FROM edges WHERE source = ?", source) as GraphEdge[];
}
