import { installClaudeHook, uninstallClaudeHook } from "../../hooks/claude/settings.js";
import { detectProjectRoot } from "../../config.js";

export function installClaudeCommand(dryRun: boolean): void {
  const root = detectProjectRoot(process.cwd());

  if (!root) {
    console.error("No project detected. Run in a directory with package.json or .git.");
    process.exit(1);
  }

  const result = installClaudeHook(root, dryRun);

  if (dryRun) {
    console.log(`[DRY RUN] Would ${result.action}: ${result.details}`);
    console.log(`  Target: ${result.path}`);
  } else {
    console.log(`${result.action === "created" ? "Created" : result.action === "updated" ? "Updated" : ""} ${result.path}`);
    console.log(result.details);

    if (result.action !== "already_installed") {
      console.log("");
      console.log("Hook configured for: Edit, Write, MultiEdit");
      console.log("The hook will run: ripplegraph hook context-inject");
      console.log("");
      console.log("To test: edit any .ts/.tsx file and observe the context injection.");
      console.log("To uninstall: ripplegraph hook uninstall claude");
    }
  }
}

export function uninstallClaudeCommand(dryRun: boolean): void {
  const root = detectProjectRoot(process.cwd());

  if (!root) {
    console.error("No project detected. Run in a directory with package.json or .git.");
    process.exit(1);
  }

  const result = uninstallClaudeHook(root, dryRun);

  if (dryRun) {
    console.log(`[DRY RUN] Would ${result.action}: ${result.details}`);
    console.log(`  Target: ${result.path}`);
  } else {
    console.log(result.details);
    console.log(`  Target: ${result.path}`);
  }
}
