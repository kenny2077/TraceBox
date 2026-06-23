import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectProjectConfig, saveProjectConfig } from "../src/config.js";
import { openDb, closeDb, getNodeCount } from "../src/db.js";
import type { openDb as OpenDbFn } from "../src/db.js";
import { buildGraph } from "../src/graph.js";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const FIXTURE = resolve(rootDir, "test/fixtures/simple-project");

function cleanRipplegraph() {
  const rgDir = resolve(FIXTURE, ".ripplegraph");
  if (existsSync(rgDir)) {
    rmSync(rgDir, { recursive: true, force: true });
  }
}

describe("cli (integration)", () => {
  afterEach(() => {
    cleanRipplegraph();
  });

  it("init creates .ripplegraph/config.json", () => {
    const config = detectProjectConfig(FIXTURE);
    saveProjectConfig(FIXTURE, config);

    const configPath = resolve(FIXTURE, ".ripplegraph", "config.json");
    expect(existsSync(configPath)).toBe(true);
  });

  it("index builds graph with file nodes", async () => {
    const config = detectProjectConfig(FIXTURE);
    saveProjectConfig(FIXTURE, config);

    const db = openDb(FIXTURE);
    try {
      const result = await buildGraph(db, FIXTURE, config);
      expect(result.filesIndexed).toBeGreaterThan(0);
      expect(result.buildTimeMs).toBeGreaterThan(0);
      expect(getNodeCount(db)).toBeGreaterThan(0);
    } finally {
      closeDb();
    }
  });

  it("index json output works", async () => {
    const config = detectProjectConfig(FIXTURE);
    saveProjectConfig(FIXTURE, config);

    const db = openDb(FIXTURE);
    try {
      const result = await buildGraph(db, FIXTURE, config);
      const json = JSON.parse(JSON.stringify(result));
      expect(json).toHaveProperty("filesIndexed");
      expect(json).toHaveProperty("symbolsFound");
      expect(json).toHaveProperty("buildTimeMs");
    } finally {
      closeDb();
    }
  });

  it("index detects test framework vitest", () => {
    const config = detectProjectConfig(FIXTURE);
    expect(config.testFramework).toBe("vitest");
  });
});
