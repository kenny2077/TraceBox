import type { StalenessResult } from "../../index/staleness.js";
import type { AffectedSymbol, AffectedTest } from "../../types.js";
import type { RiskLevel } from "../../config/schema.js";
import { riskMeetsThreshold } from "../../config/schema.js";

export interface HookContextOptions {
  maxChars?: number;
  minRiskLevel?: RiskLevel;
  injectOnStale?: boolean;
  skipLowRisk?: boolean;
}

export function formatHookContext(
  filePath: string,
  callers: AffectedSymbol[],
  tests: AffectedTest[],
  staleness: StalenessResult,
  options: HookContextOptions = {},
): string {
  const maxChars = Math.min(options.maxChars ?? 2000, 9000);
  const minRiskLevel = options.minRiskLevel ?? "MODERATE";
  const injectOnStale = options.injectOnStale ?? true;
  const skipLowRisk = options.skipLowRisk ?? true;

  // Risk scoring
  const callerCount = callers.length;
  const testCount = tests.length;
  const maxCallers = 5;
  const maxTests = 5;
  const maxReadFirst = 3;

  let riskLevel: string;
  let riskReasons: string[] = [];

  if (callerCount === 0 && testCount === 0) {
    riskLevel = "LOW";
  } else if (callerCount > 20) {
    riskLevel = "CRITICAL";
    riskReasons.push(`${callerCount} callers`);
  } else if (callerCount > 5) {
    riskLevel = "HIGH";
    riskReasons.push(`${callerCount} callers`);
  } else if (callerCount >= 3) {
    riskLevel = "MODERATE";
    riskReasons.push(`${callerCount} callers`);
  } else if (callerCount > 0) {
    riskLevel = "MODERATE";
    riskReasons.push(`${callerCount} callers`);
  } else {
    riskLevel = "LOW";
  }

  if (testCount > 0) {
    riskReasons.push(`${testCount} related tests`);
  }

  // Skip if risk below threshold AND graph is fresh (or stale injection disabled)
  const belowThreshold = !riskMeetsThreshold(riskLevel, minRiskLevel);
  if (belowThreshold) {
    if (!staleness.fresh && injectOnStale) {
      // Stale graph override: inject a warning even for below-threshold risk
    } else {
      return "";
    }
  }

  // Build output
  const lines: string[] = [];
  lines.push(`RippleGraph edit-risk briefing for ${filePath}:`);
  lines.push(`Risk: ${riskLevel} (${riskReasons.join(", ") || "no risk factors"})`);

  if (riskReasons.length > 0) {
    lines.push(`Why: ${riskReasons.join(", ")}`);
  }

  // Stale warning
  if (!staleness.fresh && staleness.reason) {
    lines.push(`WARNING: Graph is stale — ${staleness.reason}`);
    if (staleness.recommendation) {
      lines.push(`  ${staleness.recommendation}`);
    }
  }

  // Read-first files (prioritize direct callers)
  const readFirst = callers
    .filter((c) => c.relation === "calls" || c.relation === "imports")
    .slice(0, maxReadFirst);

  if (readFirst.length > 0) {
    lines.push("Read first:");
    for (let i = 0; i < readFirst.length; i++) {
      const c = readFirst[i]!;
      lines.push(`  ${i + 1}. ${c.filePath || c.symbolName}`);
    }
  }

  // Likely affected symbols
  const affected = callers.slice(0, maxCallers);
  if (affected.length > 0) {
    const affectedLines: string[] = [];
    for (const a of affected) {
      const conf = a.confidence === "EXTRACTED" ? "[extracted]" : "[inferred]";
      affectedLines.push(`  - ${a.symbolName} ${conf}`);
    }
    if (affectedLines.length > 0) {
      lines.push("Likely affected:");
      lines.push(...affectedLines);
    }
  }

  // Recommended tests
  const testEntries = tests.slice(0, maxTests);
  if (testEntries.length > 0) {
    lines.push("Recommended tests:");
    for (const t of testEntries) {
      const cmd = t.testFile.endsWith(".ts") || t.testFile.endsWith(".js")
        ? `bun test -- ${t.testFile}`
        : `npm test -- ${t.testFile}`;
      lines.push(`  - ${cmd}`);
    }
  }

  // Guard rails (actionable rules)
  if (riskLevel !== "LOW") {
    const rules: string[] = [];
    if (callerCount > 0) {
      rules.push("Preserve public function signatures unless callers are updated.");
    }
    rules.push("Run recommended tests before committing.");

    if (rules.length > 0) {
      lines.push("Rules:");
      for (const r of rules) lines.push(`  - ${r}`);
    }
  }

  // Build and trim
  let result = lines.join("\n");
  if (result.length > maxChars) {
    // Truncate to maxChars at the last newline
    const cut = result.lastIndexOf("\n", maxChars);
    if (cut > 0) {
      result = result.slice(0, cut) + "\n[... truncated]";
    } else {
      result = result.slice(0, maxChars) + "\n[... truncated]";
    }
  }

  return result;
}

export function queryFileCallers(
  db: ReturnType<typeof import("../../db.js").openDb>,
  filePath: string,
): AffectedSymbol[] {
  const fileNodeId = `file:${filePath}`;
  const callers: AffectedSymbol[] = [];

  // Find symbols that are contained in this file
  const fileSymbols = db.all(
    "SELECT id FROM nodes WHERE file_path = ? AND type != 'file'",
    filePath,
  ) as Record<string, unknown>[];

  const fileIds = [fileNodeId, ...fileSymbols.map((s) => s.id as string)];

  // Find edges where any of these are the target (callers, importers)
  for (const sourceId of fileIds) {
    const edges = db.all(
      "SELECT e.*, n.name as source_name, n.file_path as source_file FROM edges e LEFT JOIN nodes n ON e.source = n.id WHERE e.target = ? AND e.type IN ('calls', 'imports', 'inherits', 'implements') LIMIT 30",
      sourceId,
    ) as Record<string, unknown>[];
    for (const e of edges) {
      callers.push({
        symbolId: e.source as string,
        symbolName: (e.source_name as string) || (e.source as string),
        filePath: (e.source_file as string) || "",
        relation: e.type as string,
        confidence: e.confidence as "EXTRACTED" | "HEURISTIC" | "INFERRED" | "UNKNOWN",
        depth: 1,
        target: e.target as string,
      } as AffectedSymbol & { target?: string });
    }
  }

  return deduplicateCallers(callers);
}

export function queryFileTests(
  db: ReturnType<typeof import("../../db.js").openDb>,
  filePath: string,
): AffectedTest[] {
  const nodeId = `file:${filePath}`;
  const testEdges = db.all(
    "SELECT e.source FROM edges e JOIN nodes n ON e.source = n.id WHERE e.target = ? AND n.type = 'test_file'",
    nodeId,
  ) as Record<string, unknown>[];

  return testEdges.map((t) => ({
    testFile: (t.source as string).replace("file:", ""),
    targetFile: filePath,
    confidence: "HEURISTIC" as const,
    source: "import_graph",
  }));
}

function deduplicateCallers(callers: (AffectedSymbol & { target?: string })[]): AffectedSymbol[] {
  const seen = new Set<string>();
  const result: AffectedSymbol[] = [];
  for (const c of callers) {
    const key = `${c.symbolId}:${c.relation}:${c.target || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}
