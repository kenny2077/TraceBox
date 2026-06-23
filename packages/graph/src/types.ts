export type ConfidenceLevel = "EXTRACTED" | "HEURISTIC" | "INFERRED" | "UNKNOWN";

export type NodeType =
  | "file"
  | "function"
  | "class"
  | "variable"
  | "type"
  | "interface"
  | "test_file"
  | "doc_file"
  | "config_file";

export type EdgeType =
  | "imports"
  | "calls"
  | "contains"
  | "exports"
  | "inherits"
  | "implements"
  | "tested_by"
  | "documents"
  | "configures"
  | "references";

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  complexity?: "simple" | "moderate" | "complex";
  exported: boolean;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  confidence: ConfidenceLevel;
  weight: number;
  sourceFile?: string;
  sourceLine?: number;
  metadata?: Record<string, unknown>;
}

export interface ScannedFile {
  path: string;
  extension: string;
  classification: "code" | "test" | "config" | "doc";
  sizeBytes: number;
}

export interface ProjectConfig {
  version: string;
  projectRoot: string;
  projectName: string;
  languages: string[];
  packageManager: string;
  testFramework: string | null;
  tsconfigPaths: Record<string, string[]>;
  ignorePatterns: string[];
  sourceExtensions: string[];
  indexedAt?: string;
  gitCommit?: string;
}

export interface SymbolChange {
  id: string;
  name: string;
  filePath: string;
  changeType: "added" | "removed" | "modified";
  oldFingerprint?: string;
  newFingerprint?: string;
}

export interface AffectedSymbol {
  symbolId: string;
  symbolName: string;
  filePath: string;
  relation: string;
  confidence: ConfidenceLevel;
  depth: number;
}

export interface AffectedTest {
  testFile: string;
  targetFile: string;
  testSymbol?: string;
  productionSymbol?: string;
  confidence: ConfidenceLevel;
  source: string;
}

export interface RiskFactor {
  factor: string;
  severity: "info" | "warning" | "critical";
  detail?: string;
}

export interface ImpactReport {
  project: string;
  timestamp: string;
  gitStatus: string;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  riskScore: number;
  changes: {
    changedFiles: string[];
    changedSymbols: {
      added: string[];
      removed: string[];
      modified: string[];
    };
    symbolDetails: SymbolChange[];
  };
  impact: {
    affectedCallers: AffectedSymbol[];
    affectedTests: AffectedTest[];
    affectedDocs: string[];
    affectedLayers: string[];
  };
  riskFactors: RiskFactor[];
  recommendation: string;
}

export interface ContextPack {
  targets: string[];
  callers: AffectedSymbol[];
  dependencies: string[];
  tests: AffectedTest[];
  layers: string[];
  riskLevel: string;
  recommendation: string;
}

export interface IndexResult {
  filesIndexed: number;
  symbolsFound: number;
  edgesCreated: number;
  buildTimeMs: number;
  newFiles: number;
  changedFiles: number;
  deletedFiles: number;
}

export type ChangeLevel = "UNCHANGED" | "ADDED" | "REMOVED" | "MODIFIED";

export interface FingerprintEntry {
  id: string;
  fingerprint: string;
  name: string;
  params?: string;
  exported: boolean;
  lineCount: number;
}
