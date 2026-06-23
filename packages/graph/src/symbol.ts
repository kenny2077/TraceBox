import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFile, initParser, getParser } from "./parser.js";
import { resolveImport } from "./resolver.js";
import { insertNode, insertEdge } from "./db.js";
import type { GraphNode, GraphEdge } from "./types.js";
import type { ProjectConfig } from "./types.js";

export function extractSymbols(
  db: ReturnType<typeof import("./db.js").openDb>,
  projectRoot: string,
  filePath: string,
  config?: ProjectConfig,
): { symbolCount: number; edgeCount: number; deferredEdges: GraphEdge[] } {
  const fullPath = join(projectRoot, filePath);
  if (!existsSync(fullPath)) return { symbolCount: 0, edgeCount: 0, deferredEdges: [] };
  const content = readFileSync(fullPath, "utf-8");
  const parsed = parseFile(filePath, content);

  let symbolCount = 0;
  let edgeCount = 0;
  const deferredEdges: GraphEdge[] = [];

  // Build import resolution map: importedName → resolvedFilePath
  const importMap = buildImportMap(parsed, filePath, projectRoot, config);

  // Use tree-sitter to extract functions, classes, variables from the full AST
  const parser = getParser();
  const tree = parser.parse(content);
  const root = tree.rootNode;
  const exportedNames = new Set(parsed.exports.map(e => e.name));

  function walk(node: any, parentType?: string, depth = 0) {
    if (depth > 20) return; // safety limit

    // Function declarations
    if (node.type === "function_declaration" || node.type === "method_definition") {
      const nameNode = node.childForFieldName?.("name");
      if (nameNode) {
        const name = nameNode.text;
        const exported = exportedNames.has(name);
        const fnNode: GraphNode = {
          id: `function:${filePath}:${name}`,
          type: "function",
          name,
          filePath,
          lineStart: node.startPosition.row,
          lineEnd: node.endPosition.row,
          complexity: classifyComplexity(node.endPosition.row - node.startPosition.row),
          exported,
        };
        insertNode(db, fnNode);
        symbolCount++;

        // contains edge from parent
        if (parentType === "class") {
          // will be handled after class is inserted
        } else {
          insertEdge(db, { source: `file:${filePath}`, target: fnNode.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
          edgeCount++;
        }

        if (exported) {
          insertEdge(db, { source: fnNode.id, target: `file:${filePath}`, type: "exports", confidence: "EXTRACTED", weight: 0.9 });
          edgeCount++;
        }

        // Extract within-function calls (with cross-file import awareness)
        const callEdges = extractCalls(node, fnNode, filePath, importMap);
        deferredEdges.push(...callEdges);
      }
    }

    // Class declarations
    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName?.("name");
      if (nameNode) {
        const name = nameNode.text;
        const exported = exportedNames.has(name);
        const clsNode: GraphNode = {
          id: `class:${filePath}:${name}`,
          type: "class",
          name,
          filePath,
          lineStart: node.startPosition.row,
          lineEnd: node.endPosition.row,
          complexity: classifyComplexity(node.endPosition.row - node.startPosition.row),
          exported,
        };
        insertNode(db, clsNode);
        symbolCount++;
        insertEdge(db, { source: `file:${filePath}`, target: clsNode.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
        edgeCount++;

        if (exported) {
          insertEdge(db, { source: clsNode.id, target: `file:${filePath}`, type: "exports", confidence: "EXTRACTED", weight: 0.9 });
          edgeCount++;
        }

        // Extract class methods
        const body = node.childForFieldName?.("body");
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i);
            if (child) {
              if (child.type === "method_definition" || child.type === "function_declaration") {
                const mName = child.childForFieldName?.("name")?.text;
                if (mName) {
                  const mNode: GraphNode = {
                    id: `function:${filePath}:${name}.${mName}`,
                    type: "function",
                    name: `${name}.${mName}`,
                    filePath,
                    lineStart: child.startPosition.row,
                    lineEnd: child.endPosition.row,
                    complexity: classifyComplexity(child.endPosition.row - child.startPosition.row),
                    exported,
                  };
                  insertNode(db, mNode);
                  symbolCount++;
                  insertEdge(db, { source: clsNode.id, target: mNode.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
                  edgeCount++;
                  extractCalls(child, mNode, filePath, importMap).forEach((e) => deferredEdges.push(e));
                }
              }
            }
          }
        }
      }
    }

    // Variable declarations (top-level only)
    // tree-sitter-typescript uses "variable_declaration" for var and "lexical_declaration" for const/let
    if ((node.type === "variable_declaration" || node.type === "lexical_declaration") && depth <= 2) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const decl = node.namedChild(i);
        if (decl?.type === "variable_declarator") {
          const nameNode = decl.childForFieldName?.("name");
          const valueNode = decl.childForFieldName?.("value");
          if (nameNode) {
            const name = nameNode.text;
            const exported = exportedNames.has(name);

            // Check if value is an arrow_function or function_expression
            const isArrowFunction = valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression");
            // Treat PascalCase exported arrow functions as components/functions
            const isPascalCase = /^[A-Z]/.test(name);

            if (isArrowFunction) {
              // Create a function node instead of variable
              const fnNode: GraphNode = {
                id: `function:${filePath}:${name}`,
                type: "function",
                name,
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                complexity: classifyComplexity(node.endPosition.row - node.startPosition.row),
                exported,
              };
              insertNode(db, fnNode);
              symbolCount++;
              insertEdge(db, { source: `file:${filePath}`, target: fnNode.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
              edgeCount++;

              if (exported) {
                insertEdge(db, { source: fnNode.id, target: `file:${filePath}`, type: "exports", confidence: "EXTRACTED", weight: 0.9 });
                edgeCount++;
              }

              // Extract calls within the arrow function body
              const callEdges = extractCalls(valueNode, fnNode, filePath, importMap);
              deferredEdges.push(...callEdges);
            } else {
              // Regular variable
              const varNode: GraphNode = {
                id: `variable:${filePath}:${name}`,
                type: "variable",
                name,
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                complexity: "simple",
                exported,
              };
              insertNode(db, varNode);
              symbolCount++;
              insertEdge(db, { source: `file:${filePath}`, target: varNode.id, type: "contains", confidence: "EXTRACTED", weight: 1.0 });
              edgeCount++;

              if (exported) {
                insertEdge(db, { source: varNode.id, target: `file:${filePath}`, type: "exports", confidence: "EXTRACTED", weight: 0.9 });
                edgeCount++;
              }
            }
          }
        }
      }
      return; // don't recurse deeper into variable declarations
    }

    // Recurse into children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) walk(child, node.type === "class_declaration" ? "class" : parentType, depth + 1);
    }
  }

  walk(root);
  return { symbolCount, edgeCount, deferredEdges };
}

function extractCalls(
  node: any,
  callerNode: GraphNode,
  filePath: string,
  importMap: Map<string, string>,
): GraphEdge[] {
  const builtins = new Set([
    "console", "JSON", "Math", "Date", "Object", "Array", "String", "Number", "Boolean",
    "parseInt", "parseFloat", "setTimeout", "setInterval", "clearTimeout",
    "Promise", "Map", "Set", "WeakMap", "WeakSet",
    "require", "process", "Buffer",
  ]);
  const edges: GraphEdge[] = [];

  function findCalls(n: any) {
    if (n.type === "call_expression") {
      const fnNode = n.childForFieldName?.("function");
      let calleeName: string | null = null;

      if (fnNode) {
        if (fnNode.type === "identifier") {
          calleeName = fnNode.text;
        } else if (fnNode.type === "member_expression") {
          const obj = fnNode.childForFieldName?.("object");
          const prop = fnNode.childForFieldName?.("property");
          if (obj?.type === "identifier" && !builtins.has(obj.text) && prop) {
            calleeName = `${obj.text}.${prop.text}`;
          }
        }
      }

      if (calleeName && !builtins.has(calleeName) && !calleeName.startsWith("console.")) {
        // 1. Within-file resolution (EXTRACTED confidence)
        edges.push({
          source: callerNode.id,
          target: `function:${filePath}:${calleeName}`,
          type: "calls",
          confidence: "EXTRACTED",
          weight: 0.9,
          sourceFile: filePath,
          sourceLine: n.startPosition.row,
        });

        // 2. Cross-file resolution via import map (HEURISTIC confidence)
        const resolvedFile = importMap.get(calleeName);
        if (resolvedFile && resolvedFile !== filePath) {
          edges.push({
            source: callerNode.id,
            target: `function:${resolvedFile}:${calleeName}`,
            type: "calls",
            confidence: "HEURISTIC",
            weight: 0.7,
            sourceFile: filePath,
            sourceLine: n.startPosition.row,
          });
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) findCalls(child);
    }
  }

  findCalls(node);
  return edges;
}

function classifyComplexity(lineCount: number): "simple" | "moderate" | "complex" {
  if (lineCount < 50) return "simple";
  if (lineCount < 200) return "moderate";
  return "complex";
}

/**
 * Build a map from imported variable name → resolved file path.
 *
 * Example: `import { add } from '../lib/math'` → `"add" → "lib/math.ts"`
 */
function buildImportMap(
  parsed: ReturnType<typeof parseFile>,
  sourceFile: string,
  projectRoot: string,
  config?: ProjectConfig,
): Map<string, string> {
  const map = new Map<string, string>();

  if (!config) return map;

  for (const imp of parsed.imports) {
    // Skip side-effect, type-only, and dynamic imports
    if (imp.isSideEffect || imp.isTypeOnly || imp.isDynamic) continue;

    const resolved = resolveImport(sourceFile, imp.source, projectRoot, config);
    if (!resolved.targetFile || resolved.isExternal) continue;

    // Map each imported name to the resolved file
    for (const name of imp.specifiers) {
      map.set(name, resolved.targetFile);
    }

    // Default imports: name maps to the file itself
    // (we can't resolve the specific export, but the file relationship is tracked)
    if (imp.isDefault && !imp.isNamespace) {
      // Default import: the file is the import target
      // Don't override named import mappings
    }

    // Namespace imports: can't resolve specific calls
    if (imp.isNamespace) {
      // `import * as foo from './bar'` — calls like `foo.baz()` can't be resolved to specific exports
      continue;
    }
  }

  return map;
}
