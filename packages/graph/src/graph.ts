import type { Database } from "./db.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IndexResult, GraphNode, GraphEdge } from "./types.js";
import { insertNode, insertEdge, deleteFileNodes, getNodeCount, getEdgeCount, setMeta } from "./db.js";
import { scanFiles, computeContentHash, loadFileHashes, saveFileHashes } from "./scanner.js";
import type { ProjectConfig } from "./types.js";
import { initParser, parseFile } from "./parser.js";
import { resolveImport } from "./resolver.js";
import { extractSymbols } from "./symbol.js";
import { writeIndexMetadata } from "./index/staleness.js";
import { execSync } from "node:child_process";

export interface IndexOptions {
  force?: boolean;
  changedOnly?: boolean;
}

export async function buildGraph(
  db: ReturnType<typeof Database>,
  projectRoot: string,
  config: ProjectConfig,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const startTime = Date.now();
  const files = scanFiles(projectRoot, config);
  const oldHashes = loadFileHashes(projectRoot);
  const newHashes: Record<string, string> = {};

  let newFileCount = 0;
  let changedFileCount = 0;
  let deletedFileCount = 0;
  let totalSymbols = 0;
  let totalEdges = 0;

  // Initialize tree-sitter parser
  await initParser();

  // Detect deleted files
  for (const oldPath of Object.keys(oldHashes)) {
    if (!files.some((f) => f.path === oldPath)) {
      deleteFileNodes(db, oldPath);
      deletedFileCount++;
    }
  }

  // Process current files — first pass: insert file nodes + parse imports/exports + extract symbols
  const parsedFiles: Map<string, { imports: { target: string; isDefault: boolean; isNamespace: boolean }[]; exportNames: string[] }> = new Map();
  const deferredEdges: GraphEdge[] = [];

  for (const file of files) {
    const fullPath = join(projectRoot, file.path);
    const hash = computeContentHash(fullPath);
    newHashes[file.path] = hash;

    if (options.changedOnly && oldHashes[file.path] === hash) {
      continue;
    }

    if (!oldHashes[file.path]) {
      newFileCount++;
    } else if (oldHashes[file.path] !== hash) {
      changedFileCount++;
      deleteFileNodes(db, file.path);
    }

    // Insert file node
    const nodeType = file.classification === "test" ? "test_file"
      : file.classification === "doc" ? "doc_file"
      : file.classification === "config" ? "config_file"
      : "file";

    insertNode(db, {
      id: `file:${file.path}`,
      type: nodeType,
      name: file.path.split("/").pop() || file.path,
      filePath: file.path,
      exported: false,
    });
    totalSymbols++;

    // Parse imports and extract symbols for JS/TS files
    if (file.extension === ".ts" || file.extension === ".tsx" ||
        file.extension === ".js" || file.extension === ".jsx" ||
        file.extension === ".mjs") {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const parsed = parseFile(file.path, content);
        const importTargets: { target: string; isDefault: boolean; isNamespace: boolean }[] = [];

        for (const imp of parsed.imports) {
          const resolved = resolveImport(file.path, imp.source, projectRoot, config);
          if (resolved.targetFile && !resolved.isExternal) {
            importTargets.push({
              target: resolved.targetFile,
              isDefault: imp.isDefault,
              isNamespace: imp.isNamespace,
            });
          }
        }

        parsedFiles.set(file.path, { imports: importTargets, exportNames: parsed.exports.map(e => e.name) });

        // Extract symbols (functions, classes, variables) with cross-file import resolution
        const { symbolCount, edgeCount, deferredEdges: fileDeferredEdges } = extractSymbols(db, projectRoot, file.path, config);
        totalSymbols += symbolCount;
        totalEdges += edgeCount;
        deferredEdges.push(...fileDeferredEdges);
      } catch {
        // Parse error — skip symbols for this file
      }
    }
  }

  // Second pass: insert import edges
  for (const [sourcePath, { imports }] of parsedFiles) {
    for (const imp of imports) {
      if (imp.isNamespace) {
        // Namespace imports: add a references edge with HEURISTIC confidence
        const edge: GraphEdge = {
          source: `file:${sourcePath}`,
          target: `file:${imp.target}`,
          type: "references",
          confidence: "HEURISTIC",
          weight: 0.6,
          sourceFile: sourcePath,
        };
        insertEdge(db, edge);
        totalEdges++;
      } else if (imp.isDefault) {
        // Default imports: add an imports edge (file-level relationship)
        const edge: GraphEdge = {
          source: `file:${sourcePath}`,
          target: `file:${imp.target}`,
          type: "imports",
          confidence: "HEURISTIC",
          weight: 0.8,
          sourceFile: sourcePath,
        };
        insertEdge(db, edge);
        totalEdges++;
      } else {
        // Named imports: EXTRACTED confidence
        const edge: GraphEdge = {
          source: `file:${sourcePath}`,
          target: `file:${imp.target}`,
          type: "imports",
          confidence: "EXTRACTED",
          weight: 0.9,
          sourceFile: sourcePath,
        };
        insertEdge(db, edge);
        totalEdges++;
      }
    }
  }

  // Third pass: insert deferred cross-file call edges (after all symbol nodes exist)
  for (const edge of deferredEdges) {
    const targetExists = db.get("SELECT 1 FROM nodes WHERE id = ?", edge.target);
    if (!targetExists) {
      // Target symbol was not indexed (possibly external or parse-skipped); drop the edge silently
      continue;
    }
    insertEdge(db, edge);
    totalEdges++;
  }

  saveFileHashes(projectRoot, newHashes);

  const buildTimeMs = Date.now() - startTime;

  setMeta(db, "version", "0.1.0");
  setMeta(db, "indexed_at", new Date().toISOString());
  setMeta(db, "total_files", String(files.length));
  setMeta(db, "total_symbols", String(totalSymbols));
  setMeta(db, "total_edges", String(totalEdges));

  // Get git commit hash
  let gitCommit: string | null = null;
  try {
    gitCommit = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    setMeta(db, "git_commit", gitCommit);
  } catch {
    // not a git repo
  }

  // Write index metadata to config.json for staleness checks
  writeIndexMetadata(projectRoot, {
    version: "0.1.0",
    indexedAt: new Date().toISOString(),
    gitCommit,
    totalFiles: files.length,
    totalSymbols,
    totalEdges,
  });

  return {
    filesIndexed: files.length,
    symbolsFound: totalSymbols,
    edgesCreated: totalEdges,
    buildTimeMs,
    newFiles: newFileCount,
    changedFiles: changedFileCount,
    deletedFiles: deletedFileCount,
  };
}
