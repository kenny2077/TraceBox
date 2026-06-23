import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ClaudePreToolUseHook {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: ClaudePreToolUseHook[];
  };
}

const RIPPLEGRAPH_HOOK_COMMAND = "ripplegraph hook context-inject";
const DEFAULT_MATCHER = "Edit|Write|MultiEdit";

export interface InstallResult {
  action: "created" | "updated" | "already_installed";
  details: string;
  path: string;
}

export function installClaudeHook(
  projectRoot: string,
  dryRun = false,
): InstallResult {
  const claudeDir = join(projectRoot, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  let existing: ClaudeSettings = {};

  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      return { action: "updated", details: "could not parse existing settings.json (malformed JSON)", path: settingsPath };
    }
  }

  // Check if already installed
  const preToolUse = existing.hooks?.PreToolUse || [];
  const alreadyInstalled = preToolUse.some((hook) =>
    hook.hooks?.some((h) => h.command === RIPPLEGRAPH_HOOK_COMMAND),
  );

  if (alreadyInstalled) {
    return { action: "already_installed", details: "RippleGraph PreToolUse hook is already installed", path: settingsPath };
  }

  const rippleHook: ClaudePreToolUseHook = {
    matcher: DEFAULT_MATCHER,
    hooks: [
      {
        type: "command",
        command: RIPPLEGRAPH_HOOK_COMMAND,
      },
    ],
  };

  const updated: ClaudeSettings = {
    ...existing,
    hooks: {
      ...existing.hooks,
      PreToolUse: [...(existing.hooks?.PreToolUse || []), rippleHook],
    },
  };

  if (!dryRun) {
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  }

  const wasEmpty = !existsSync(settingsPath) || Object.keys(existing).length === 0;

  return {
    action: wasEmpty ? "created" : "updated",
    details: wasEmpty
      ? `Created .claude/settings.json with RippleGraph PreToolUse hook`
      : `Updated .claude/settings.json: added RippleGraph PreToolUse hook (${DEFAULT_MATCHER})`,
    path: settingsPath,
  };
}

export function uninstallClaudeHook(
  projectRoot: string,
  dryRun = false,
): InstallResult {
  const claudeDir = join(projectRoot, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  if (!existsSync(settingsPath)) {
    return { action: "already_installed", details: "No .claude/settings.json found", path: settingsPath };
  }

  let existing: ClaudeSettings;
  try {
    existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return { action: "updated", details: "could not parse existing settings.json", path: settingsPath };
  }

  const preToolUse = existing.hooks?.PreToolUse || [];
  const filtered = preToolUse.filter((hook) =>
    !hook.hooks?.some((h) => h.command === RIPPLEGRAPH_HOOK_COMMAND),
  );

  if (filtered.length === preToolUse.length) {
    return { action: "already_installed", details: "RippleGraph PreToolUse hook not found", path: settingsPath };
  }

  const updated: ClaudeSettings = {
    ...existing,
    hooks: {
      ...existing.hooks,
      PreToolUse: filtered.length > 0 ? filtered : undefined,
    },
  };

  // Clean up empty hooks
  if (updated.hooks && !updated.hooks.PreToolUse) {
    delete updated.hooks.PreToolUse;
  }
  if (updated.hooks && Object.keys(updated.hooks).length === 0) {
    delete updated.hooks;
  }

  if (!dryRun) {
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  }

  return {
    action: "updated",
    details: "Removed RippleGraph PreToolUse hook from .claude/settings.json",
    path: settingsPath,
  };
}
