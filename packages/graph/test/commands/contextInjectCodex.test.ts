import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

// Use the basic-auth-project fixture which has an indexed graph
const fixtureDir = resolve(__dirname, "../fixtures/repos/basic-auth-project");

function runContextInject(
  fixtureName: string,
  adapter: string,
  projectPath?: string,
) {
  const fixturePath = resolve(
    __dirname,
    "../fixtures/codex-hooks",
    fixtureName,
  );

  // Read the fixture JSON
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const stdinData = readFileSync(fixturePath, "utf-8");

  const args = [
    resolve(repoRoot, "dist", "index.js"),
    "hook",
    "context-inject",
    "--adapter",
    adapter,
  ];

  if (projectPath) {
    args.push("--project", projectPath);
  }

  const result = spawnSync("bun", args, {
    input: stdinData,
    encoding: "utf-8",
    env: { ...process.env, RIPPLEGRAPH_DEBUG: "1" },
  });

  return result;
}

// ---------------------------------------------------------------------------
// apply_patch with valid file targets
// ---------------------------------------------------------------------------
describe("ripplegraph hook context-inject --adapter codex", () => {
  describe("apply_patch with Update File", () => {
    let result: ReturnType<typeof spawnSync>;

    beforeAll(() => {
      result = runContextInject(
        "apply-patch-update.json",
        "codex",
        fixtureDir,
      );
    });

    it("exits with code 0", () => {
      expect(result.status).toBe(0);
    });

    it("stdout is valid JSON", () => {
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    });

    it("produces hookSpecificOutput with additionalContext when risk threshold met", () => {
      const output = JSON.parse(result.stdout.trim());
      if (Object.keys(output).length === 0) {
        // empty is valid too (risk below threshold)
        return;
      }
      expect(output).toHaveProperty("hookSpecificOutput");
      expect(output.hookSpecificOutput).toHaveProperty("additionalContext");
      expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(typeof output.hookSpecificOutput.additionalContext).toBe("string");
      expect(output.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
    });

    it("stdout is only JSON (no stray text)", () => {
      const raw = result.stdout.trim();
      expect(raw.startsWith("{")).toBe(true);
    });
  });

  describe("apply_patch with multiple add/delete files", () => {
    let result: ReturnType<typeof spawnSync>;

    beforeAll(() => {
      result = runContextInject(
        "apply-patch-add-delete.json",
        "codex",
        fixtureDir,
      );
    });

    it("exits with code 0", () => {
      expect(result.status).toBe(0);
    });

    it("stdout is valid JSON", () => {
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    });
  });

  describe("apply_patch with diff --git headers", () => {
    let result: ReturnType<typeof spawnSync>;

    beforeAll(() => {
      result = runContextInject(
        "apply-patch-diff-git.json",
        "codex",
        fixtureDir,
      );
    });

    it("exits with code 0", () => {
      expect(result.status).toBe(0);
    });

    it("stdout is valid JSON", () => {
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    });
  });

  describe("apply_patch with path traversal (rejected paths)", () => {
    let result: ReturnType<typeof spawnSync>;

    beforeAll(() => {
      result = runContextInject(
        "apply-patch-traversal.json",
        "codex",
        fixtureDir,
      );
    });

    it("exits with code 0 (fail open)", () => {
      expect(result.status).toBe(0);
    });

    it("returns empty or project-level context (no file-specific context)", () => {
      const output = JSON.parse(result.stdout.trim());
      // Project-level context or empty — both safe
      if (Object.keys(output).length > 0) {
        const ctx = output.hookSpecificOutput?.additionalContext as string;
        expect(ctx).toContain("project-risk");
      }
    });
  });

  describe("apply_patch with direct file_path", () => {
    let result: ReturnType<typeof spawnSync>;

    beforeAll(() => {
      result = runContextInject(
        "apply-patch-file-path.json",
        "codex",
        fixtureDir,
      );
    });

    it("exits with code 0", () => {
      expect(result.status).toBe(0);
    });

    it("stdout is valid JSON", () => {
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Unsupported tools → no-op
// ---------------------------------------------------------------------------
describe("ripplegraph hook context-inject --adapter codex — unsupported tools", () => {
  it("returns no-op for Bash payload", () => {
    const result = runContextInject("bash.json", "codex", fixtureDir);
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({});
  });

  it("returns no-op for Read payload", () => {
    const result = runContextInject("read.json", "codex", fixtureDir);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Malformed input → no-op (fail open)
// ---------------------------------------------------------------------------
describe("ripplegraph hook context-inject --adapter codex — malformed input", () => {
  it("returns no-op for invalid JSON", () => {
    const result = spawnSync(
      "bun",
      [
        resolve(repoRoot, "dist", "index.js"),
        "hook",
        "context-inject",
        "--adapter",
        "codex",
        "--project",
        fixtureDir,
      ],
      {
        input: "not valid json {{{",
        encoding: "utf-8",
        env: { ...process.env, RIPPLEGRAPH_DEBUG: "1" },
      },
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({});
  });

  it("exits 0 for empty stdin", () => {
    const result = spawnSync(
      "bun",
      [
        resolve(repoRoot, "dist", "index.js"),
        "hook",
        "context-inject",
        "--adapter",
        "codex",
        "--project",
        fixtureDir,
      ],
      {
        input: "",
        encoding: "utf-8",
      },
    );
    expect(result.status).toBe(0);
  });

  it("never crashes on any garbage input", () => {
    const garbageInputs = [
      "",
      "null",
      "undefined",
      "[]",
      "{}",
      '{"tool_name": "apply_patch"}',
      "{broken",
    ];

    for (const input of garbageInputs) {
      const result = spawnSync(
        "bun",
        [
          resolve(repoRoot, "dist", "index.js"),
          "hook",
          "context-inject",
          "--adapter",
          "codex",
          "--project",
          fixtureDir,
        ],
        {
          input,
          encoding: "utf-8",
          env: { ...process.env, RIPPLEGRAPH_DEBUG: "1" },
        },
      );
      expect(result.status).toBe(0);
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Claude backward compat — existing behavior unchanged
// ---------------------------------------------------------------------------
describe("ripplegraph hook context-inject — Claude backward compat", () => {
  it("Claude path works without --adapter flag (default)", () => {
    const writeFixture = resolve(
      __dirname,
      "../fixtures/claude-hooks",
      "write.json",
    );
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const stdinData = readFileSync(writeFixture, "utf-8");

    const result = spawnSync(
      "bun",
      [
        resolve(repoRoot, "dist", "index.js"),
        "hook",
        "context-inject",
        "--project",
        fixtureDir,
      ],
      {
        input: stdinData,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
  });

  it("Claude path works with explicit --adapter claude", () => {
    const writeFixture = resolve(
      __dirname,
      "../fixtures/claude-hooks",
      "write.json",
    );
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const stdinData = readFileSync(writeFixture, "utf-8");

    const result = spawnSync(
      "bun",
      [
        resolve(repoRoot, "dist", "index.js"),
        "hook",
        "context-inject",
        "--adapter",
        "claude",
        "--project",
        fixtureDir,
      ],
      {
        input: stdinData,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
  });

  it("Bash payload for Claude returns no-op", () => {
    const bashFixture = resolve(
      __dirname,
      "../fixtures/claude-hooks",
      "bash.json",
    );
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const stdinData = readFileSync(bashFixture, "utf-8");

    const result = spawnSync(
      "bun",
      [
        resolve(repoRoot, "dist", "index.js"),
        "hook",
        "context-inject",
        "--project",
        fixtureDir,
      ],
      {
        input: stdinData,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Contract invariants
// ---------------------------------------------------------------------------
describe("ripplegraph hook context-inject --adapter codex — contract", () => {
  it("stdout is always valid JSON (never plain text)", () => {
    const inputs = [
      readFixtureAsInput("apply-patch-update.json"),
      readFixtureAsInput("bash.json"),
      "garbage input",
      "",
    ];

    for (const input of inputs) {
      const result = spawnSync(
        "bun",
        [
          resolve(repoRoot, "dist", "index.js"),
          "hook",
          "context-inject",
          "--adapter",
          "codex",
          "--project",
          fixtureDir,
        ],
        { input, encoding: "utf-8" },
      );
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
    }
  });

  it("always exits 0", () => {
    const inputs = [
      readFixtureAsInput("apply-patch-update.json"),
      readFixtureAsInput("bash.json"),
      "",
      "garbage",
    ];

    for (const input of inputs) {
      const result = spawnSync(
        "bun",
        [
          resolve(repoRoot, "dist", "index.js"),
          "hook",
          "context-inject",
          "--adapter",
          "codex",
          "--project",
          fixtureDir,
        ],
        { input, encoding: "utf-8" },
      );
      expect(result.status).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readFixtureAsInput(name: string): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const fixturePath = resolve(__dirname, "../fixtures/codex-hooks", name);
  return readFileSync(fixturePath, "utf-8");
}
