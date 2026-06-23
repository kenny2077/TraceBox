export type HookProvider = "claude" | "codex";

/**
 * A provider-neutral hook event that downstream code consumes.
 * Both Claude and Codex (and future) adapters produce this shape.
 */
export interface NormalizedHookEvent {
  /** Which provider sent this event */
  provider: HookProvider;
  /** Hook event name (e.g. "PreToolUse") */
  eventName: string;
  /** Tool name as reported by the provider */
  toolName: string;
  /** Working directory from the hook payload */
  cwd: string;
  /**
   * Files targeted by this tool invocation.
   * Claude: single-element array from tool_input.file_path.
   * Codex: may be empty (project-level) or extracted from patch headers.
   */
  targetFiles: string[];
  /** The raw, unmodified hook payload for debugging */
  raw: unknown;
  /** Metadata about how this event was parsed */
  source: NormalizedHookSource;
}

export interface NormalizedHookSource {
  /** Which adapter parsed this */
  adapter: HookProvider;
  /**
   * How confidently file paths were extracted.
   * "extracted" — direct from tool_input.file_path (Claude Write/Edit)
   * "heuristic" — inferred from content (Codex patch headers, etc.)
   * "unknown" — no file path available (Codex apply_patch without patch content)
   */
  confidence: "extracted" | "heuristic" | "unknown";
  /** Human-readable notes about parsing decisions */
  notes?: string[];
}

/** Valid parse outcomes */
export type ParseResult =
  | { kind: "event"; event: NormalizedHookEvent }
  | { kind: "unsupported"; reason: string }
  | { kind: "invalid"; reason: string };

/**
 * Every hook adapter must implement this interface.
 */
export interface HookAdapter {
  /** Provider identifier */
  readonly provider: HookProvider;

  /**
   * Parse raw stdin JSON into a normalized event.
   * Must be fail-safe: malformed input → { kind: "invalid" }.
   */
  parse(rawInput: string): ParseResult;

  /**
   * Format a context string into the provider's expected hook response shape.
   * Returns a JSON-serializable object (for stdout) or a string.
   */
  formatResponse(context: string): unknown;
}
