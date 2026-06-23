import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installClaudeHook, uninstallClaudeHook } from "../../src/hooks/claude/settings.js";

function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ripplegraph-install-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("installClaudeHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = setupProject();
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  it("creates .claude/settings.json when absent", () => {
    rmSync(join(projectRoot, ".claude"), { recursive: true, force: true });
    const result = installClaudeHook(projectRoot);
    expect(result.action).toBe("created");
    const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("ripplegraph hook context-inject");
  });

  it("preserves existing settings fields", () => {
    writeFileSync(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ customSetting: "keep-me", anotherField: 42 }),
    );
    installClaudeHook(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    expect(settings.customSetting).toBe("keep-me");
    expect(settings.anotherField).toBe(42);
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  it("preserves existing hooks.PreToolUse entries", () => {
    writeFileSync(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "existing-hook-command" }],
            },
          ],
        },
      }),
    );
    installClaudeHook(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    const preToolUse = settings.hooks.PreToolUse;
    expect(preToolUse.length).toBe(2);
    expect(preToolUse[0].matcher).toBe("Bash");
    expect(preToolUse[1].matcher).toBe("Edit|Write|MultiEdit");
  });

  it("returns already_installed on duplicate", () => {
    installClaudeHook(projectRoot);
    const result = installClaudeHook(projectRoot);
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("already installed");
  });

  it("dry run does not write file", () => {
    const result = installClaudeHook(projectRoot, true);
    expect(result.action).toBe("created");
    expect(existsSync(join(projectRoot, ".claude", "settings.json"))).toBe(false);
  });

  it("handles empty existing settings.json", () => {
    writeFileSync(join(projectRoot, ".claude", "settings.json"), "{}");
    installClaudeHook(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  it("handles malformed existing settings.json gracefully", () => {
    writeFileSync(join(projectRoot, ".claude", "settings.json"), "not json {{{");
    const result = installClaudeHook(projectRoot);
    expect(result.action).toBe("updated");
    expect(result.details).toContain("malformed");
  });
});

describe("uninstallClaudeHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = setupProject();
    installClaudeHook(projectRoot);
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  it("removes RippleGraph hook while keeping others", () => {
    // First inject another hook alongside RippleGraph
    const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    settings.hooks.PreToolUse.unshift({
      matcher: "Bash",
      hooks: [{ type: "command", command: "other-hook" }],
    });
    writeFileSync(join(projectRoot, ".claude", "settings.json"), JSON.stringify(settings));

    uninstallClaudeHook(projectRoot);
    const updated = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    expect(updated.hooks.PreToolUse.length).toBe(1);
    expect(updated.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("removes entire PreToolUse when RippleGraph was the only hook", () => {
    uninstallClaudeHook(projectRoot);
    const updated = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"));
    expect(updated.hooks).toBeUndefined();
  });

  it("returns already_installed when hook not found", () => {
    uninstallClaudeHook(projectRoot); // remove it
    const result = uninstallClaudeHook(projectRoot); // try again
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("not found");
  });

  it("dry run does not modify file", () => {
    const before = readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8");
    uninstallClaudeHook(projectRoot, true);
    const after = readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8");
    expect(before).toBe(after);
  });

  it("handles missing .claude/settings.json", () => {
    rmSync(join(projectRoot, ".claude", "settings.json"));
    const result = uninstallClaudeHook(projectRoot);
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("No .claude/settings.json");
  });
});
