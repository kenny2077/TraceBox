import type { ImpactReport, AffectedSymbol, AffectedTest, RiskFactor } from "./types.js";
import type { StalenessResult } from "./index/staleness.js";

export function formatStaleWarning(staleness: StalenessResult): string {
  if (staleness.fresh) return "";

  const parts: string[] = [];
  parts.push(`\x1b[33m[STALE] ${staleness.reason}\x1b[0m`);
  if (staleness.recommendation) {
    parts.push(`\x1b[33m        ${staleness.recommendation}\x1b[0m`);
  }
  if (staleness.metadata) {
    parts.push(`        Last indexed: ${staleness.metadata.indexedAt}`);
  }
  return parts.join("\n") + "\n";
}

export function formatStaleWarningMarkdown(staleness: StalenessResult): string {
  if (staleness.fresh) return "";

  const parts: string[] = [];
  parts.push(`> ⚠️ **Warning:** ${staleness.reason}`);
  if (staleness.recommendation) {
    parts.push(`> ${staleness.recommendation}`);
  }
  if (staleness.metadata) {
    parts.push(`> Last indexed: ${staleness.metadata.indexedAt}`);
  }
  return parts.join("\n") + "\n\n";
}

export function formatStaleWarningCompact(staleness: StalenessResult): string {
  if (staleness.fresh) return "";

  const parts: string[] = [];
  parts.push(`[STALE] ${staleness.reason}`);
  if (staleness.recommendation) {
    parts.push(staleness.recommendation);
  }
  return parts.join(" — ") + "\n";
}

export function formatImpactReportTerminal(report: ImpactReport, staleness?: StalenessResult): string {
  const lines: string[] = [];
  const riskColor = report.riskLevel === "CRITICAL" ? "\x1b[31m" :
    report.riskLevel === "HIGH" ? "\x1b[33m" :
    report.riskLevel === "MODERATE" ? "\x1b[36m" : "\x1b[32m";

  if (staleness && !staleness.fresh) {
    lines.push(formatStaleWarning(staleness));
  }

  lines.push(`\n\x1b[1mRippleGraph Impact Report\x1b[0m`);
  lines.push(`Project: ${report.project}  Risk: ${riskColor}${report.riskLevel}\x1b[0m`);
  lines.push("");

  if (report.changes.changedFiles.length > 0) {
    lines.push(`Changed Files (${report.changes.changedFiles.length}):`);
    for (const f of report.changes.changedFiles) {
      lines.push(`  M ${f}`);
    }
    lines.push("");
  }

  if (report.changes.changedSymbols.modified.length > 0) {
    lines.push(`Modified Symbols (${report.changes.changedSymbols.modified.length}):`);
    for (const s of report.changes.symbolDetails.filter(d => d.changeType === "modified")) {
      lines.push(`  ~ ${s.id} (${s.name})`);
    }
  }
  if (report.changes.changedSymbols.added.length > 0) {
    lines.push(`Added Symbols (${report.changes.changedSymbols.added.length}):`);
    for (const s of report.changes.symbolDetails.filter(d => d.changeType === "added")) {
      lines.push(`  + ${s.id} (${s.name})`);
    }
  }
  if (report.changes.changedSymbols.removed.length > 0) {
    lines.push(`Removed Symbols (${report.changes.changedSymbols.removed.length}):`);
    for (const s of report.changes.symbolDetails.filter(d => d.changeType === "removed")) {
      lines.push(`  - ${s.id} (${s.name})`);
    }
  }

  if (report.impact.affectedCallers.length > 0) {
    lines.push(`Affected Callers (${report.impact.affectedCallers.length}):`);
    for (const c of report.impact.affectedCallers) {
      const confLabel = c.confidence === "EXTRACTED" ? "[extracted]" : c.confidence === "HEURISTIC" ? "[heuristic]" : `[${c.confidence.toLowerCase()}]`;
      lines.push(`  ${c.symbolName} (${c.filePath}) — ${c.relation} ${confLabel}`);
    }
    lines.push("");
  }

  if (report.impact.affectedTests.length > 0) {
    lines.push(`Affected Tests (${report.impact.affectedTests.length}):`);
    for (const t of report.impact.affectedTests) {
      lines.push(`  ${t.testFile} [${t.confidence === "EXTRACTED" ? "✓" : "~"}]`);
    }
    lines.push("");
  }

  if (report.riskFactors.length > 0) {
    lines.push("Risk Factors:");
    for (const rf of report.riskFactors) {
      const icon = rf.severity === "critical" ? "✗" : "⚠";
      lines.push(`  ${icon} ${rf.factor}`);
    }
    lines.push("");
  }

  lines.push(`Recommendation: ${report.recommendation}`);
  return lines.join("\n") + "\n";
}

export function formatImpactReportMarkdown(report: ImpactReport, staleness?: StalenessResult): string {
  const lines: string[] = [];
  lines.push(`# RippleGraph Impact Report`);
  lines.push("");

  if (staleness && !staleness.fresh) {
    lines.push(formatStaleWarningMarkdown(staleness));
  }

  lines.push(`**Project:** ${report.project}  **Risk:** ${report.riskLevel}  **Timestamp:** ${report.timestamp}`);
  lines.push("");

  if (report.changes.changedFiles.length > 0) {
    lines.push("## Changed Files");
    for (const f of report.changes.changedFiles) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (report.impact.affectedCallers.length > 0) {
    lines.push("## Affected Callers");
    for (const c of report.impact.affectedCallers) {
      const confLabel = c.confidence === "EXTRACTED" ? "[extracted]" : c.confidence === "HEURISTIC" ? "[heuristic]" : `[${c.confidence.toLowerCase()}]`;
      lines.push(`- **${c.symbolName}** (\`${c.filePath}\`) — ${c.relation} ${confLabel}`);
    }
    lines.push("");
  }

  if (report.impact.affectedTests.length > 0) {
    lines.push("## Affected Tests");
    for (const t of report.impact.affectedTests) lines.push(`- \`${t.testFile}\` ${t.confidence === "EXTRACTED" ? "[✓]" : "[~]"}`);
    lines.push("");
  }

  if (report.riskFactors.length > 0) {
    lines.push("## Risk Factors");
    for (const rf of report.riskFactors) lines.push(`- ${rf.factor}`);
    lines.push("");
  }

  lines.push(`**Recommendation:** ${report.recommendation}`);
  return lines.join("\n") + "\n";
}

export function formatContextPackMarkdown(
  targets: string[],
  callers: AffectedSymbol[],
  tests: AffectedTest[],
  recommendation: string,
  maxTokens = 2000,
  staleness?: StalenessResult,
): string {
  const lines: string[] = [];
  lines.push("# RippleGraph Context Pack\n");

  if (staleness && !staleness.fresh) {
    lines.push(formatStaleWarningCompact(staleness));
    lines.push("");
  }

  lines.push("## Targets");
  for (const t of targets) lines.push(`- \`${t}\``);
  lines.push("");

  if (callers.length > 0) {
    lines.push(`## Callers (${callers.length})`);
    for (const c of callers) {
      const confLabel = c.confidence === "EXTRACTED" ? "[extracted]" : c.confidence === "HEURISTIC" ? "[heuristic]" : `[${c.confidence.toLowerCase()}]`;
      lines.push(`- **${c.symbolName}** (\`${c.filePath}\`) — ${c.relation} ${confLabel}`);
    }
    lines.push("");
  }

  if (tests.length > 0) {
    lines.push(`## Tests (${tests.length})`);
    for (const t of tests) lines.push(`- \`${t.testFile}\` [${t.confidence === "EXTRACTED" ? "✓" : "~"}]`);
    lines.push("");
  }

  lines.push(`**Recommendation:** ${recommendation}`);

  let result = lines.join("\n");
  // Token budget trimming (simple: char/3)
  const estimatedTokens = result.length / 3;
  if (estimatedTokens > maxTokens) {
    const targetLen = maxTokens * 3;
    result = result.slice(0, targetLen) + "\n... (truncated to token budget)";
  }

  return result;
}
