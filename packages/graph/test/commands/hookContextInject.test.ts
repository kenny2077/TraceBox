import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const CLI = resolve(rootDir, "dist/index.js");
const FIXTURE_ROOT = resolve(rootDir, "test/fixtures/simple-project");
const HOOK_FIXTURES = resolve(rootDir, "test/fixtures/claude-hooks");

function runHook(input: string, project?: string): { stdout: string; stderr: string; status: number | null } {
  const args = [CLI, "hook", "context-inject"];
  if (project) args.push("--project", project);
  const result = spawnSync("bun", args, { input, encoding: "utf-8", timeout: 10000 });
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

describe("hook context-inject CLI", () => {
  beforeAll(() => {
    // Always ensure clean graph state for this test file
    const rgDir = resolve(FIXTURE_ROOT, ".ripplegraph");
    if (existsSync(rgDir)) {
      rmSync(rgDir, { recursive: true, force: true });
    }
    spawnSync("bun", [CLI, "init", "--force", "--project", FIXTURE_ROOT], { encoding: "utf-8", timeout: 15000 });
  });

  it("returns empty object for Write when file not in fixture (LOW risk below threshold)", () => {
    const input = readFileSync(resolve(HOOK_FIXTURES, "write.json"), "utf-8");
    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns empty object for Edit when file not in fixture (LOW risk below threshold)", () => {
    const input = readFileSync(resolve(HOOK_FIXTURES, "edit.json"), "utf-8");
    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns empty object for Bash payload", () => {
    const input = readFileSync(resolve(HOOK_FIXTURES, "bash.json"), "utf-8");
    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns empty object for malformed JSON", () => {
    const input = readFileSync(resolve(HOOK_FIXTURES, "malformed.json"), "utf-8");
    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns empty object for non-JSON input", () => {
    const { stdout, status } = runHook("not valid json", FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("returns empty object for empty stdin", () => {
    const { stdout, status } = runHook("", FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("provides context for file with actual callers in fixture", () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/index.ts" },
      cwd: FIXTURE_ROOT,
    });

    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("RippleGraph edit-risk briefing");
    expect(ctx).toContain("src/index.ts");
    expect(ctx).toContain("Risk:");
    expect(ctx.length).toBeLessThan(3000);
  });

  it("always exits with status 0 (fail-open)", () => {
    const { status } = runHook("{}", "/nonexistent/path");
    expect(status).toBe(0);
  });

  it("stdout is always valid JSON", () => {
    for (const input of ["{}", '{"tool_name":"Write","tool_input":{"file_path":"x"},"cwd":"."}', "not json", ""]) {
      const { stdout } = runHook(input, FIXTURE_ROOT);
      expect(() => JSON.parse(stdout)).not.toThrow();
    }
  });

  it("MultiEdit payload does not crash", () => {
    const input = readFileSync(resolve(HOOK_FIXTURES, "multiedit.json"), "utf-8");
    const { stdout, status } = runHook(input, FIXTURE_ROOT);
    expect(status).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});
