import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import ignore from "ignore";
import type { ScannedFile, ProjectConfig } from "./types.js";

export function scanFiles(projectRoot: string, config: ProjectConfig): ScannedFile[] {
  const ig = loadIgnorePatterns(projectRoot, config);
  const allFiles = walkFiles(projectRoot);
  const filtered = allFiles.filter((f) => {
    const relPath = relative(projectRoot, f);
    return !ig.ignores(relPath) && isTrackedFile(relPath);
  });

  return filtered.map((f) => {
    const relPath = relative(projectRoot, f);
    const ext = relPath.split(".").pop() || "";
    return {
      path: relPath,
      extension: `.${ext}`,
      classification: classifyFile(relPath),
      sizeBytes: statSync(f).size,
    };
  });
}

export function getAllFiles(projectRoot: string): string[] {
  return walkFiles(projectRoot);
}

function loadIgnorePatterns(projectRoot: string, config: ProjectConfig): ReturnType<typeof ignore> {
  const ig = ignore();
  ig.add(config.ignorePatterns);

  const gitignorePath = join(projectRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    } catch {
      // ignore malformed gitignore
    }
  }

  return ig;
}

/** Directories skipped early to avoid unnecessary traversal. */
const SKIP_DIRS = new Set([".git", ".hg", ".svn", ".ripplegraph"]);

function walkFiles(dir: string): string[] {
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip symlinks — prevents traversal outside the project root
      // and avoids infoleak via symlink-to-sensitive-path.
      if (entry.isSymbolicLink()) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip known-large/noisy directories early to bound IO
        if (SKIP_DIRS.has(entry.name)) continue;
        results.push(...walkFiles(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // permission denied, skip
  }

  return results;
}

const TRACKED_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".rst",
  ".css", ".scss", ".less",
  ".html", ".htm",
  ".vue", ".svelte",
];

function isTrackedFile(relPath: string): boolean {
  return TRACKED_EXTENSIONS.some((ext) => relPath.endsWith(ext));
}

function isSourceFile(relPath: string, extensions: string[]): boolean {
  return extensions.some((ext) => relPath.endsWith(ext));
}

export function classifyFile(relPath: string): "code" | "test" | "config" | "doc" {
  const lower = relPath.toLowerCase();

  if (lower.endsWith(".test.ts") || lower.endsWith(".test.tsx") ||
      lower.endsWith(".test.js") || lower.endsWith(".test.jsx") ||
      lower.endsWith(".spec.ts") || lower.endsWith(".spec.tsx") ||
      lower.endsWith(".spec.js") || lower.endsWith(".spec.jsx") ||
      relPath.includes("__tests__/") || relPath.includes("/tests/") ||
      relPath.includes("/test/") || relPath.startsWith("tests/") ||
      relPath.startsWith("test/") || relPath.startsWith("__tests__/")) {
    return "test";
  }

  if (lower.endsWith(".json") || lower.endsWith(".yaml") ||
      lower.endsWith(".yml") || lower.endsWith(".toml") ||
      lower.endsWith(".config.ts") || lower.endsWith(".config.js")) {
    return "config";
  }

  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".rst")) {
    return "doc";
  }

  return "code";
}

export function computeContentHash(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

export function loadFileHashes(projectRoot: string): Record<string, string> {
  const cachePath = join(projectRoot, ".ripplegraph", "cache", "file_hashes.json");
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  } catch {
    return {};
  }
}

export function saveFileHashes(projectRoot: string, hashes: Record<string, string>): void {
  const cacheDir = join(projectRoot, ".ripplegraph", "cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "file_hashes.json"), JSON.stringify(hashes, null, 2), "utf-8");
}
