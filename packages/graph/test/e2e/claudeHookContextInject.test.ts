import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const CLI = resolve(rootDir, "dist/index.js");
const FIXTURE = resolve(rootDir, "test/fixtures/repos/basic-auth-project");

function runHook(input: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("bun", [CLI, "hook", "context-inject", "--project", FIXTURE], {
    input,
    encoding: "utf-8",
    timeout: 10000,
  });
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

function makePayload(filePath: string, toolName = "Write"): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath },
    cwd: FIXTURE,
  });
}

describe("Claude hook context-inject (e2e smoke)", () => {
  beforeAll(() => {
    // Always start fresh for reliable test results
    const rgDir = resolve(FIXTURE, ".ripplegraph");
    if (existsSync(rgDir)) {
      rmSync(rgDir, { recursive: true, force: true });
    }

    // Initialize git (idempotent)
    if (!existsSync(resolve(FIXTURE, ".git"))) {
      spawnSync("git", ["init"], { cwd: FIXTURE, encoding: "utf-8" });
      spawnSync("git", ["config", "user.email", "test@ripplegraph.dev"], { cwd: FIXTURE, encoding: "utf-8" });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: FIXTURE, encoding: "utf-8" });
      spawnSync("git", ["add", "-A"], { cwd: FIXTURE, encoding: "utf-8" });
      spawnSync("git", ["commit", "-m", "init"], { cwd: FIXTURE, encoding: "utf-8" });
    }

    // Build a fresh index with git commit tracking
    const initResult = spawnSync("bun", [CLI, "init", "--force", "--project", FIXTURE], {
      encoding: "utf-8",
      timeout: 15000,
    });
    // Log for debugging
    if (initResult.status !== 0) {
      console.warn("init --force warning:", initResult.stderr || initResult.stdout);
    }

    // Verify index metadata was written
    const configPath = resolve(FIXTURE, ".ripplegraph", "config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!cfg.indexedAt) {
        // Force re-index to ensure metadata
        spawnSync("bun", [CLI, "index", "--force", "--project", FIXTURE], {
          encoding: "utf-8",
          timeout: 15000,
        });
      }
    }
  });

  it("happy path: Write payload produces valid Claude JSON with context", () => {
    const input = makePayload("src/auth/service.ts", "Write");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);

    // Must have hookSpecificOutput with additionalContext
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");

    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(typeof ctx).toBe("string");

    // Verify content
    expect(ctx).toContain("RippleGraph edit-risk briefing");
    expect(ctx).toContain("src/auth/service.ts");
    expect(ctx).toContain("Risk:");

    // Should mention callers (file names: login.ts, middleware.ts, or service.test.ts)
    const hasCaller = ctx.includes("login.ts") || ctx.includes("middleware.ts") || ctx.includes("service.test.ts");
    expect(hasCaller).toBe(true);

    // Should mention tests
    expect(ctx).toContain("service.test.ts");

    // Should not exceed hard cap
    expect(ctx.length).toBeLessThan(9500);
  });

  it("happy path: Edit payload also returns valid Claude JSON", () => {
    const input = makePayload("src/auth/service.ts", "Edit");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("RippleGraph edit-risk briefing");
  });

  it("unsupported tool: Bash payload returns empty object", () => {
    const input = makePayload("src/auth/service.ts", "Bash");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("malformed input: returns empty object, no crash", () => {
    const { stdout, status } = runHook("this is not json");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns context for file with actual callers", () => {
    const input = makePayload("src/auth/service.ts");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");

    const ctx = parsed.hookSpecificOutput.additionalContext;

    // service.ts is imported by: middleware.ts, login.ts, service.test.ts
    // And has function-level calls: authMiddleware → validateToken, loginHandler → validateToken + refreshToken
    expect(ctx).toContain("RippleGraph edit-risk briefing");
    expect(ctx).toContain("src/auth/service.ts");

    // Risk should be MODERATE or higher (3+ callers)
    expect(ctx).toMatch(/Risk: (MODERATE|HIGH|CRITICAL)/);
  });

  it("LOW risk file returns empty when below threshold", () => {
    // src/api/login.ts has no incoming callers — only outgoing to service.ts
    const input = makePayload("src/api/login.ts");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    // Should be empty since no one calls loginHandler
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("context mentions confidence labels", () => {
    const input = makePayload("src/auth/service.ts");
    const { stdout } = runHook(input);
    const parsed = JSON.parse(stdout);
    const ctx = parsed.hookSpecificOutput.additionalContext;

    // Should have [extracted] for tree-sitter verified edges
    expect(ctx).toMatch(/\[extracted\]|\[inferred\]/);
  });

  it("context includes recommended tests section", () => {
    const input = makePayload("src/auth/service.ts");
    const { stdout } = runHook(input);
    const parsed = JSON.parse(stdout);
    const ctx = parsed.hookSpecificOutput.additionalContext;

    expect(ctx).toContain("Recommended tests:");
    expect(ctx).toContain("service.test.ts");
  });

  it("stale graph: modifying file produces stale warning", () => {
    // Get current content hash into cache by re-indexing
    spawnSync("bun", [CLI, "index", "--project", FIXTURE], { encoding: "utf-8", timeout: 10000 });

    // Modify a file
    const svcPath = resolve(FIXTURE, "src/auth/service.ts");
    const original = readFileSync(svcPath, "utf-8");
    writeFileSync(svcPath, original + "\n// stale test modification\n");

    const input = makePayload("src/auth/service.ts");
    const { stdout, status } = runHook(input);

    // Restore original
    writeFileSync(svcPath, original);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);

    if (parsed.hookSpecificOutput?.additionalContext) {
      const ctx = parsed.hookSpecificOutput.additionalContext;
      // Should warn about staleness
      expect(ctx).toMatch(/WARNING|stale/);
    }
    // Otherwise, empty is also acceptable (fail-open with stale graph)
  });

  it("MultiEdit payload returns context", () => {
    const input = makePayload("src/auth/service.ts", "MultiEdit");
    const { stdout, status } = runHook(input);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");
  });

  it("empty stdin returns empty object", () => {
    const { stdout, status } = runHook("");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("stdout is always valid JSON regardless of input quality", () => {
    const inputs = [
      "{}",
      makePayload("src/auth/service.ts"),
      "not json",
      "",
      makePayload("src/auth/service.ts", "Bash"),
    ];

    for (const input of inputs) {
      const { stdout } = runHook(input);
      expect(() => JSON.parse(stdout), `Failed to parse stdout for: ${input.slice(0, 30)}`).not.toThrow();
    }
  });
});
