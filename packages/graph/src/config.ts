import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { ProjectConfig } from "./types.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const DEFAULT_IGNORE = ["node_modules/", "dist/", "build/", ".git/", ".ripplegraph/"];

export function detectProjectRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json")) || existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function detectProjectConfig(projectRoot: string): ProjectConfig {
  const pkgPath = join(projectRoot, "package.json");
  const tsconfigPath = join(projectRoot, "tsconfig.json");

  let projectName = projectRoot.split("/").pop() || "unknown";
  let testFramework: string | null = null;
  const tsconfigPaths: Record<string, string[]> = {};

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      projectName = pkg.name || projectName;

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.vitest) testFramework = "vitest";
      else if (allDeps.jest) testFramework = "jest";
    } catch {
      // malformed package.json — use defaults
    }
  }

  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
      const paths = tsconfig.compilerOptions?.paths;
      if (paths && typeof paths === "object") {
        for (const [alias, targets] of Object.entries(paths)) {
          if (Array.isArray(targets)) {
            tsconfigPaths[alias] = targets as string[];
          }
        }
      }
    } catch {
      // malformed tsconfig — use empty paths
    }
  }

  return {
    version: "0.1.0",
    projectRoot,
    projectName,
    languages: ["typescript", "javascript"],
    packageManager: existsSync(join(projectRoot, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb")) ? "bun"
      : existsSync(join(projectRoot, "yarn.lock")) ? "yarn"
      : "npm",
    testFramework,
    tsconfigPaths,
    ignorePatterns: [...DEFAULT_IGNORE],
    sourceExtensions: SOURCE_EXTENSIONS,
  };
}

export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
  const configPath = join(projectRoot, ".ripplegraph", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ProjectConfig;
  } catch {
    return null;
  }
}

export function saveProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const dir = join(projectRoot, ".ripplegraph");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2), "utf-8");
  writeFileSync(join(dir, ".gitignore"), "cache/\nruns/\n", "utf-8");
}
