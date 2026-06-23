import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HookClaudeConfig, type HookCodexConfig, type RiskLevel } from "./schema.js";
import { DEFAULT_HOOK_CONFIG } from "./defaults.js";

export interface LoadedHookConfig {
  claude: HookClaudeConfig;
  codex: HookCodexConfig;
  valid: boolean;
  errors: string[];
}

export function loadHookConfig(projectRoot: string): LoadedHookConfig {
  const configPath = join(projectRoot, ".ripplegraph", "config.json");
  const errors: string[] = [];
  const defaults = DEFAULT_HOOK_CONFIG;

  if (!existsSync(configPath)) {
    return { claude: defaults.claude, codex: defaults.codex, valid: true, errors: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const hooks = raw.hooks;

    if (!hooks || typeof hooks !== "object") {
      return { claude: defaults.claude, codex: defaults.codex, valid: true, errors: [] };
    }

    const claude = mergeProviderConfig(hooks.claude, defaults.claude, errors, "claude");
    const codex = mergeProviderConfig(hooks.codex, defaults.codex, errors, "codex");

    return { claude, codex, valid: true, errors };
  } catch {
    return { claude: defaults.claude, codex: defaults.codex, valid: true, errors: ["could not parse config.json"] };
  }
}

function mergeProviderConfig(
  raw: unknown,
  defaults: HookClaudeConfig | HookCodexConfig,
  errors: string[],
  provider: string,
): HookClaudeConfig | HookCodexConfig {
  if (!raw || typeof raw !== "object") {
    return { ...defaults };
  }

  const obj = raw as Record<string, unknown>;

  const merged = {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : defaults.enabled,
    minRiskToInject: validateRiskLevel(obj.minRiskToInject, errors, provider) ?? defaults.minRiskToInject,
    maxContextChars: typeof obj.maxContextChars === "number" ? obj.maxContextChars : defaults.maxContextChars,
    injectOnStaleGraph: typeof obj.injectOnStaleGraph === "boolean" ? obj.injectOnStaleGraph : defaults.injectOnStaleGraph,
  };

  // Clamp maxContextChars
  if (merged.maxContextChars < 100) merged.maxContextChars = 100;
  if (merged.maxContextChars > 9000) merged.maxContextChars = 9000;

  return merged;
}

function validateRiskLevel(value: unknown, errors: string[], provider: string): RiskLevel | null {
  if (typeof value !== "string") {
    errors.push(`hooks.${provider}.minRiskToInject must be a string (got ${typeof value})`);
    return null;
  }
  const upper = value.toUpperCase();
  const valid = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
  if (!valid.includes(upper)) {
    errors.push(`hooks.${provider}.minRiskToInject: "${value}" is not valid (must be LOW, MODERATE, HIGH, or CRITICAL)`);
    return null;
  }
  return upper as RiskLevel;
}

export function getRiskLevelNumeric(level: string): number {
  const order: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
  return order[level] ?? 0;
}

export function shouldInjectForRisk(riskLevel: string, threshold: RiskLevel): boolean {
  return getRiskLevelNumeric(riskLevel) >= getRiskLevelNumeric(threshold);
}
