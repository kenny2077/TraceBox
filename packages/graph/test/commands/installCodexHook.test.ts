import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installCodexHook,
  uninstallCodexHook,
} from "../../src/hooks/codex/settings.js";

function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ripplegraph-codex-install-"));
  mkdirSync(join(dir, ".codex"), { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// installCodexHook
// ---------------------------------------------------------------------------
describe("installCodexHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = setupProject();
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  it("creates .codex/hooks.json when absent", () => {
    rmSync(join(projectRoot, ".codex"), { recursive: true, force: true });
    const result = installCodexHook(projectRoot);
    expect(result.action).toBe("created");
    const hooks = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    expect(hooks.hooks.PreToolUse).toBeDefined();
    expect(hooks.hooks.PreToolUse[0].matcher).toBe("apply_patch|Edit|Write");
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(
      "ripplegraph hook context-inject --adapter codex",
    );
  });

  it("includes timeout and statusMessage in hook config", () => {
    const result = installCodexHook(projectRoot);
    expect(result.action).toBe("created");
    const hooks = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    const hook = hooks.hooks.PreToolUse[0].hooks[0];
    expect(hook.timeout).toBe(5);
    expect(hook.statusMessage).toBe("Checking RippleGraph impact");
  });

  it("preserves existing settings fields", () => {
    writeFileSync(
      join(projectRoot, ".codex", "hooks.json"),
      JSON.stringify({ customSetting: "keep-me", anotherField: 42 }),
    );
    installCodexHook(projectRoot);
    const hooks = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    expect(hooks.customSetting).toBe("keep-me");
    expect(hooks.anotherField).toBe(42);
    expect(hooks.hooks.PreToolUse).toBeDefined();
  });

  it("preserves existing hooks.PreToolUse entries", () => {
    writeFileSync(
      join(projectRoot, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "existing-codex-hook-command" },
              ],
            },
          ],
        },
      }),
    );
    installCodexHook(projectRoot);
    const hooks = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    const preToolUse = hooks.hooks.PreToolUse;
    expect(preToolUse.length).toBe(2);
    expect(preToolUse[0].matcher).toBe("Bash");
    expect(preToolUse[1].matcher).toBe("apply_patch|Edit|Write");
  });

  it("returns already_installed on duplicate", () => {
    installCodexHook(projectRoot);
    const result = installCodexHook(projectRoot);
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("already installed");
  });

  it("dry run does not write file", () => {
    const result = installCodexHook(projectRoot, true);
    expect(result.action).toBe("created");
    expect(existsSync(join(projectRoot, ".codex", "hooks.json"))).toBe(false);
  });

  it("handles empty existing hooks.json", () => {
    writeFileSync(join(projectRoot, ".codex", "hooks.json"), "{}");
    installCodexHook(projectRoot);
    const hooks = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    expect(hooks.hooks.PreToolUse).toBeDefined();
  });

  it("handles malformed existing hooks.json gracefully", () => {
    writeFileSync(join(projectRoot, ".codex", "hooks.json"), "not json {{{");
    const result = installCodexHook(projectRoot);
    expect(result.action).toBe("updated");
    expect(result.details).toContain("malformed");
  });

  it("creates .codex directory if it does not exist", () => {
    rmSync(join(projectRoot, ".codex"), { recursive: true, force: true });
    installCodexHook(projectRoot);
    expect(existsSync(join(projectRoot, ".codex"))).toBe(true);
    expect(existsSync(join(projectRoot, ".codex", "hooks.json"))).toBe(true);
  });

  it("writes pretty-printed JSON (2-space indent)", () => {
    installCodexHook(projectRoot);
    const raw = readFileSync(
      join(projectRoot, ".codex", "hooks.json"),
      "utf-8",
    );
    expect(raw).toContain('\n  "');
    expect(raw).toContain('"hooks": {');
  });
});

// ---------------------------------------------------------------------------
// uninstallCodexHook
// ---------------------------------------------------------------------------
describe("uninstallCodexHook", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = setupProject();
    installCodexHook(projectRoot);
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  it("removes RippleGraph hook while keeping others", () => {
    // Inject another hook alongside RippleGraph
    const hooksPath = join(projectRoot, ".codex", "hooks.json");
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8"));
    hooks.hooks.PreToolUse.unshift({
      matcher: "Bash",
      hooks: [{ type: "command", command: "other-codex-hook" }],
    });
    writeFileSync(hooksPath, JSON.stringify(hooks));

    uninstallCodexHook(projectRoot);
    const updated = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(updated.hooks.PreToolUse.length).toBe(1);
    expect(updated.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("removes entire PreToolUse when RippleGraph was the only hook", () => {
    uninstallCodexHook(projectRoot);
    const updated = JSON.parse(
      readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
    );
    expect(updated.hooks).toBeUndefined();
  });

  it("returns already_installed when hook not found", () => {
    uninstallCodexHook(projectRoot); // remove it
    const result = uninstallCodexHook(projectRoot); // try again
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("not found");
  });

  it("dry run does not modify file", () => {
    const hooksPath = join(projectRoot, ".codex", "hooks.json");
    const before = readFileSync(hooksPath, "utf-8");
    uninstallCodexHook(projectRoot, true);
    const after = readFileSync(hooksPath, "utf-8");
    expect(before).toBe(after);
  });

  it("handles missing .codex/hooks.json", () => {
    rmSync(join(projectRoot, ".codex", "hooks.json"));
    const result = uninstallCodexHook(projectRoot);
    expect(result.action).toBe("already_installed");
    expect(result.details).toContain("No .codex/hooks.json");
  });

  it("handles malformed hooks.json during uninstall", () => {
    writeFileSync(
      join(projectRoot, ".codex", "hooks.json"),
      "broken json {{{",
    );
    const result = uninstallCodexHook(projectRoot);
    expect(result.action).toBe("updated");
    expect(result.details).toContain("could not parse");
  });
});
