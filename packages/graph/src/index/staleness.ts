import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadFileHashes, computeContentHash } from "../scanner.js";
import type { ProjectConfig } from "../types.js";

export interface IndexMetadata {
  version: string;
  indexedAt: string;
  gitCommit: string | null;
  totalFiles: number;
  totalSymbols: number;
  totalEdges: number;
}

export interface StalenessResult {
  fresh: boolean;
  reason?: string;
  metadata?: IndexMetadata;
  currentGitCommit?: string;
  recommendation?: string;
}

export function checkStaleness(
  projectRoot: string,
  config: ProjectConfig,
): StalenessResult {
  // 1. Check if .ripplegraph/graph.db exists
  const dbPath = join(projectRoot, ".ripplegraph", "graph.db");
  if (!existsSync(dbPath)) {
    return {
      fresh: false,
      reason: "No graph database found",
      recommendation: "Run `ripplegraph index` to build the knowledge graph.",
    };
  }

  // 2. Try to get git commit
  let currentGitCommit: string | null = null;
  try {
    currentGitCommit = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git repo or git not available
  }

  // 3. Try to read metadata from the config file (idempotent)
  const metadata = readIndexMetadata(projectRoot);

  if (!metadata) {
    return {
      fresh: false,
      reason: "No index metadata found",
      currentGitCommit: currentGitCommit ?? undefined,
      recommendation: "Run `ripplegraph index` to build the knowledge graph.",
    };
  }

  // 4. Check if git commit changed since index
  if (currentGitCommit && metadata.gitCommit && currentGitCommit !== metadata.gitCommit) {
    return {
      fresh: false,
      reason: "Repository has new commits since last index",
      metadata,
      currentGitCommit,
      recommendation: "Run `ripplegraph index` to update the graph with latest changes.",
    };
  }

  // 5. Quick check: compare a sample of cached file hashes
  const cachedHashes = loadFileHashes(projectRoot);
  const hashKeys = Object.keys(cachedHashes);
  if (hashKeys.length > 0) {
    let checkCount = 0;
    let mismatchCount = 0;
    for (const relPath of hashKeys) {
      if (checkCount >= 10) break; // Sample 10 files for speed
      const fullPath = join(projectRoot, relPath);
      if (existsSync(fullPath)) {
        try {
          const currentHash = computeContentHash(fullPath);
          if (currentHash !== cachedHashes[relPath]) {
            mismatchCount++;
          }
          checkCount++;
        } catch {
          // Can't read file, skip
        }
      } else {
        // File was deleted since index
        mismatchCount++;
        checkCount++;
      }
    }

    if (mismatchCount > 0) {
      return {
        fresh: false,
        reason: `${mismatchCount} of ${checkCount} sampled files have changed since last index`,
        metadata,
        currentGitCommit: currentGitCommit ?? undefined,
        recommendation: "Run `ripplegraph index` to update the graph with latest changes.",
      };
    }
  }

  return {
    fresh: true,
    metadata,
    currentGitCommit: currentGitCommit ?? undefined,
  };
}

export function readIndexMetadata(projectRoot: string): IndexMetadata | null {
  const configPath = join(projectRoot, ".ripplegraph", "config.json");
  if (!existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!raw.indexedAt) return null;

    return {
      version: raw.version || "unknown",
      indexedAt: raw.indexedAt,
      gitCommit: raw.gitCommit || null,
      totalFiles: raw.totalFiles || 0,
      totalSymbols: raw.totalSymbols || 0,
      totalEdges: raw.totalEdges || 0,
    };
  } catch {
    return null;
  }
}

export function writeIndexMetadata(
  projectRoot: string,
  metadata: IndexMetadata,
): void {
  const configPath = join(projectRoot, ".ripplegraph", "config.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // overwrite
    }
  }

  const updated = {
    ...existing,
    version: metadata.version,
    indexedAt: metadata.indexedAt,
    gitCommit: metadata.gitCommit,
    totalFiles: metadata.totalFiles,
    totalSymbols: metadata.totalSymbols,
    totalEdges: metadata.totalEdges,
  };

  writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
}
