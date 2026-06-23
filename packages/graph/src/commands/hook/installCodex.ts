import { installCodexHook, uninstallCodexHook } from "../../hooks/codex/settings.js";
import { detectProjectRoot } from "../../config.js";

export function installCodexCommand(dryRun: boolean): void {
  const root = detectProjectRoot(process.cwd());

  if (!root) {
    console.error("No project detected. Run in a directory with package.json or .git.");
    process.exit(1);
  }

  const result = installCodexHook(root, dryRun);

  if (dryRun) {
    console.log(`[DRY RUN] Would ${result.action}: ${result.details}`);
    console.log(`  Target: ${result.path}`);
  } else {
    const verb =
      result.action === "created"
        ? "Created"
        : result.action === "updated"
          ? "Updated"
          : "";
    if (verb) {
      console.log(`${verb} ${result.path}`);
    }
    console.log(result.details);

    if (result.action !== "already_installed") {
      console.log("");
      console.log("Hook configured for: apply_patch, Edit, Write");
      console.log("The hook will run: ripplegraph hook context-inject --adapter codex");
      console.log("");
      console.log("Open Codex and run /hooks to review and trust this hook.");
      console.log("To uninstall: ripplegraph hook uninstall codex");
    }
  }
}

export function uninstallCodexCommand(dryRun: boolean): void {
  const root = detectProjectRoot(process.cwd());

  if (!root) {
    console.error("No project detected. Run in a directory with package.json or .git.");
    process.exit(1);
  }

  const result = uninstallCodexHook(root, dryRun);

  if (dryRun) {
    console.log(`[DRY RUN] Would ${result.action}: ${result.details}`);
    console.log(`  Target: ${result.path}`);
  } else {
    console.log(result.details);
    console.log(`  Target: ${result.path}`);
  }
}
