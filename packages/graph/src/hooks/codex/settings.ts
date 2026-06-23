import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CodexHookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
    statusMessage?: string;
  }>;
}

interface CodexHooksConfig {
  hooks?: {
    PreToolUse?: CodexHookEntry[];
  };
}

const RIPPLEGRAPH_CODEX_COMMAND = "ripplegraph hook context-inject --adapter codex";
const DEFAULT_MATCHER = "apply_patch|Edit|Write";

export interface InstallResult {
  action: "created" | "updated" | "already_installed";
  details: string;
  path: string;
}

export function installCodexHook(
  projectRoot: string,
  dryRun = false,
): InstallResult {
  const codexDir = join(projectRoot, ".codex");
  const hooksPath = join(codexDir, "hooks.json");

  let existing: CodexHooksConfig = {};

  if (existsSync(hooksPath)) {
    try {
      existing = JSON.parse(readFileSync(hooksPath, "utf-8"));
    } catch {
      return {
        action: "updated",
        details: "could not parse existing .codex/hooks.json (malformed JSON)",
        path: hooksPath,
      };
    }
  }

  // Check if already installed
  const preToolUse = existing.hooks?.PreToolUse || [];
  const alreadyInstalled = preToolUse.some((hook) =>
    hook.hooks?.some((h) => h.command === RIPPLEGRAPH_CODEX_COMMAND),
  );

  if (alreadyInstalled) {
    return {
      action: "already_installed",
      details: "RippleGraph PreToolUse hook is already installed for Codex",
      path: hooksPath,
    };
  }

  const rippleHook: CodexHookEntry = {
    matcher: DEFAULT_MATCHER,
    hooks: [
      {
        type: "command",
        command: RIPPLEGRAPH_CODEX_COMMAND,
        timeout: 5,
        statusMessage: "Checking RippleGraph impact",
      },
    ],
  };

  const updated: CodexHooksConfig = {
    ...existing,
    hooks: {
      ...existing.hooks,
      PreToolUse: [...preToolUse, rippleHook],
    },
  };

  if (!dryRun) {
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }
    writeFileSync(hooksPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  }

  const wasEmpty =
    !existsSync(hooksPath) || Object.keys(existing).length === 0;

  return {
    action: wasEmpty ? "created" : "updated",
    details: wasEmpty
      ? "Created .codex/hooks.json with RippleGraph PreToolUse hook"
      : `Updated .codex/hooks.json: added RippleGraph PreToolUse hook for Codex`,
    path: hooksPath,
  };
}

export function uninstallCodexHook(
  projectRoot: string,
  dryRun = false,
): InstallResult {
  const codexDir = join(projectRoot, ".codex");
  const hooksPath = join(codexDir, "hooks.json");

  if (!existsSync(hooksPath)) {
    return {
      action: "already_installed",
      details: "No .codex/hooks.json found",
      path: hooksPath,
    };
  }

  let existing: CodexHooksConfig;
  try {
    existing = JSON.parse(readFileSync(hooksPath, "utf-8"));
  } catch {
    return {
      action: "updated",
      details: "could not parse existing .codex/hooks.json",
      path: hooksPath,
    };
  }

  const preToolUse = existing.hooks?.PreToolUse || [];
  const filtered = preToolUse.filter(
    (hook) =>
      !hook.hooks?.some((h) => h.command === RIPPLEGRAPH_CODEX_COMMAND),
  );

  if (filtered.length === preToolUse.length) {
    return {
      action: "already_installed",
      details: "RippleGraph PreToolUse hook not found in .codex/hooks.json",
      path: hooksPath,
    };
  }

  const updated: CodexHooksConfig = {
    ...existing,
    hooks: {
      ...existing.hooks,
      PreToolUse: filtered.length > 0 ? filtered : undefined,
    },
  };

  // Clean up empty containers
  if (updated.hooks && !updated.hooks.PreToolUse) {
    delete updated.hooks.PreToolUse;
  }
  if (updated.hooks && Object.keys(updated.hooks).length === 0) {
    delete updated.hooks;
  }

  if (!dryRun) {
    writeFileSync(hooksPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  }

  return {
    action: "updated",
    details: "Removed RippleGraph PreToolUse hook from .codex/hooks.json",
    path: hooksPath,
  };
}
