import { existsSync, statSync } from "node:fs";
import { join, dirname, relative, resolve as pathResolve } from "node:path";
import type { ProjectConfig } from "./types.js";

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];

export interface ResolvedImport {
  sourceFile: string;
  targetFile: string | null;
  importedNames: string[];
  isExternal: boolean;
  resolutionDetail: string;
}

export function resolveImport(
  sourcePath: string,
  importSource: string,
  projectRoot: string,
  config: ProjectConfig,
): ResolvedImport {
  // External package (no relative or alias prefix)
  if (!importSource.startsWith(".") && !importSource.startsWith("/")) {
    // Check if it matches a tsconfig path alias
    const aliasMatch = resolveAlias(importSource, config.tsconfigPaths);
    if (aliasMatch) {
      const resolved = resolveToFile(projectRoot, aliasMatch);
      return {
        sourceFile: sourcePath,
        targetFile: resolved,
        importedNames: [],
        isExternal: false,
        resolutionDetail: resolved ? `alias: ${aliasMatch}` : "alias (unresolved)",
      };
    }

    // Check npm workspace package (e.g., @myorg/mypackage)
    // For MVP, treat as external
    return {
      sourceFile: sourcePath,
      targetFile: null,
      importedNames: [],
      isExternal: true,
      resolutionDetail: "external package",
    };
  }

  // Relative import
  const sourceDir = dirname(join(projectRoot, sourcePath));
  const target = resolveImportPath(sourceDir, importSource);
  const relativeTarget = target ? relative(projectRoot, target) : null;

  return {
    sourceFile: sourcePath,
    targetFile: relativeTarget,
    importedNames: [],
    isExternal: false,
    resolutionDetail: relativeTarget ? "relative" : "unresolved relative",
  };
}

export function resolveImportPath(
  fromDir: string,
  importSource: string,
): string | null {
  const resolved = pathResolve(fromDir, importSource);

  // 1. Try exact path if it already includes a recognized extension
  if (existsSync(resolved)) {
    const stat = statSync(resolved);
    if (stat.isFile()) {
      return resolved;
    }
    if (stat.isDirectory()) {
      // Directory: try index files immediately
      for (const indexFile of INDEX_FILES) {
        const indexPath = join(resolved, indexFile);
        if (existsSync(indexPath)) {
          return indexPath;
        }
      }
    }
  }

  // 1b. Try extension-less imports (e.g., ./foo resolves to ./foo.ts)
  // This handles the case where the import doesn't have an extension
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }

  // 1b. Try extension-less imports (e.g., ./foo resolves to ./foo.ts)
  // This handles the case where the import doesn't have an extension
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }

  // 2. Try index files inside a directory that doesn't exist as a bare path
  //    (e.g. import ./foo/index resolves to foo/index.ts even if ./foo is not a dir)
  for (const indexFile of INDEX_FILES) {
    const indexPath = join(resolved, indexFile);
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

function resolveAlias(
  importSource: string,
  aliases: Record<string, string[]>,
): string | null {
  for (const [alias, targets] of Object.entries(aliases)) {
    // alias pattern: "@utils/*" → targets: ["src/utils/*"]
    const aliasPrefix = alias.replace(/\/\*$/, "/");
    if (importSource.startsWith(aliasPrefix)) {
      const remainder = importSource.slice(aliasPrefix.length);
      for (const target of targets) {
        const targetPrefix = target.replace(/\/\*$/, "/");
        return targetPrefix + remainder;
      }
    }

    // Exact alias match (no wildcard)
    const plainAlias = alias.replace(/\/\*$/, "");
    if (importSource === plainAlias) {
      for (const target of targets) {
        return target.replace(/\/\*$/, "");
      }
    }
  }
  return null;
}

function resolveToFile(projectRoot: string, relativePath: string): string | null {
  const absPath = join(projectRoot, relativePath);

  // Try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    if (existsSync(absPath + ext)) {
      return relativePath + ext;
    }
  }

  // Try index files
  for (const indexFile of INDEX_FILES) {
    if (existsSync(join(absPath, indexFile))) {
      return join(relativePath, indexFile);
    }
  }

  return null;
}
