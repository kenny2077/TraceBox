import Parser from "web-tree-sitter";
import { join } from "node:path";

let _parser: Parser | null = null;
let _initialized = false;

export async function initParser(): Promise<Parser> {
  if (_parser && _initialized) return _parser;

  await Parser.init();
  const TypeScript = await Parser.Language.load(
    join(import.meta.dirname!, "../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"),
  );

  const parser = new Parser();
  parser.setLanguage(TypeScript);
  _parser = parser;
  _initialized = true;
  return parser;
}

export function getParser(): Parser {
  if (!_parser) {
    throw new Error("Parser not initialized. Call initParser() first.");
  }
  return _parser;
}

export interface ImportStatement {
  source: string;        // e.g. './utils', 'react', '@scope/pkg'
  specifiers: string[];  // imported names
  isDefault: boolean;
  isNamespace: boolean;
  isSideEffect: boolean; // import 'x' (no specifiers)
  isDynamic: boolean;    // import('x')
  isTypeOnly: boolean;
  line: number;
}

export interface ExportStatement {
  name: string;
  line: number;
  isDefault: boolean;
  isReExport: boolean;   // export { x } from 'y'
  reExportSource?: string;
}

export interface ParsedFile {
  filePath: string;
  imports: ImportStatement[];
  exports: ExportStatement[];
}

export function parseFile(filePath: string, content: string): ParsedFile {
  const parser = getParser();
  const tree = parser.parse(content);
  const root = tree.rootNode;

  const imports: ImportStatement[] = [];
  const exports: ExportStatement[] = [];

  function walkNode(node: Parser.SyntaxNode) {
    // TypeScript import statement
    if (node.type === "import_statement") {
      const imp = extractImport(node, content);
      if (imp) imports.push(imp);
      return; // don't recurse into import children
    }

    // CommonJS require
    if (node.type === "call_expression") {
      const fnNode = node.childForFieldName("function");
      if (fnNode && fnNode.text === "require") {
        const argsNode = node.childForFieldName("arguments");
        if (argsNode && argsNode.namedChildCount > 0) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.type === "string") {
            const source = firstArg.text.slice(1, -1); // strip quotes
            if (source && !source.startsWith("node:")) {
              imports.push({
                source,
                specifiers: [],
                isDefault: true,
                isNamespace: false,
                isSideEffect: false,
                isDynamic: false,
                isTypeOnly: false,
                line: fnNode.startPosition.row,
              });
            }
          }
        }
        return;
      }
    }

    // Export statements
    if (node.type === "export_statement") {
      const exp = extractExport(node, content);
      if (exp) exports.push(exp);
      return;
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) walkNode(child);
    }
  }

  walkNode(root);

  return { filePath, imports, exports };
}

function extractImport(node: Parser.SyntaxNode, content: string): ImportStatement | null {
  const sourceNode = node.childForFieldName("source");
  if (!sourceNode) return null;

  const source = sourceNode.text.slice(1, -1); // strip quotes
  if (!source) return null;

  const specifiers: string[] = [];
  let isDefault = false;
  let isNamespace = false;
  let isTypeOnly = false;
  const isSideEffect = node.namedChildCount === 0;

  // Check for 'type' modifier
  const typeNode = node.descendantsOfType("type").find(() => true);
  if (typeNode) isTypeOnly = true;

  // In tree-sitter-typescript, import_specifier / named_imports / namespace_import
  // are nested inside import_clause, not direct children of import_statement.
  // Walk import_clause children to extract specifiers and classify the import.
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "import_clause") {
      extractImportClause(child, specifiers, { isDefault: (v) => { isDefault = v; }, isNamespace: (v) => { isNamespace = v; } });
    }
  }

  return {
    source,
    specifiers,
    isDefault,
    isNamespace,
    isSideEffect,
    isDynamic: false,
    isTypeOnly,
    line: node.startPosition.row,
  };
}

/**
 * Recurse into import_clause to extract:
 * - named imports from named_imports > import_specifier
 * - namespace imports from namespace_import
 * - default import detection from direct identifier child
 *
 * Mutates specifiers array and flag callbacks in-place.
 */
function extractImportClause(
  clause: Parser.SyntaxNode,
  specifiers: string[],
  flags: { isDefault: (v: boolean) => void; isNamespace: (v: boolean) => void },
): void {
  for (let i = 0; i < clause.namedChildCount; i++) {
    const child = clause.namedChild(i);
    if (!child) continue;

    // import { named1, named2 } from 'source'
    if (child.type === "named_imports") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (spec?.type === "import_specifier" && spec?.childForFieldName?.("name")) {
          const nameNode = spec.childForFieldName("name");
          if (nameNode) specifiers.push(nameNode.text);
        }
      }
      continue;
    }

    // import * as name from 'source'
    if (child.type === "namespace_import") {
      const nameNode = child.childForFieldName?.("name") || child.namedChild(0);
      if (nameNode) {
        specifiers.push(nameNode.text);
        flags.isNamespace(true);
      }
      continue;
    }

    // import defaultName from 'source'
    // (direct identifier child of import_clause = default import)
    if (child.type === "identifier") {
      specifiers.push(child.text);
      flags.isDefault(true);
      continue;
    }
  }
}

function extractExport(node: Parser.SyntaxNode, content: string): ExportStatement | null {
  let name = "";
  let line = node.startPosition.row;
  let isDefault = false;
  let isReExport = false;
  let reExportSource: string | undefined;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    // export default function/class
    if (child.type === "function_declaration" || child.type === "class_declaration") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) name = nameNode.text;
      isDefault = true;
      break;
    }

    // export { x, y } or export { x } from 'y'
    if (child.type === "export_clause") {
      const specifiers = child.descendantsOfType("export_specifier");
      if (specifiers.length > 0) {
        name = specifiers[0]!.text;
      }
    }

    // export const/let/var/function/class name
    if (child.type === "variable_declaration" || child.type === "lexical_declaration") {
      const declNode = child.namedChild(0);
      if (declNode?.type === "variable_declarator" && declNode.childForFieldName?.("name")) {
        name = declNode.childForFieldName("name")!.text;
      }
    }

    if (child.type === "function_declaration" && child.childForFieldName?.("name")) {
      name = child.childForFieldName("name")!.text;
    }

    if (child.type === "class_declaration" && child.childForFieldName?.("name")) {
      name = child.childForFieldName("name")!.text;
    }

    // Re-export source
    if (child.type === "string") {
      isReExport = true;
      reExportSource = child.text.slice(1, -1);
    }
  }

  if (!name && !isReExport) {
    name = `export_${line}`;
  }

  return {
    name: name || `export_${line}`,
    line,
    isDefault,
    isReExport,
    reExportSource,
  };
}
