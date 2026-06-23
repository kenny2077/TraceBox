import { z } from "zod";

export const RiskLevelSchema = z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const HookClaudeConfigSchema = z.object({
  enabled: z.boolean(),
  minRiskToInject: RiskLevelSchema,
  maxContextChars: z.number().int().min(100).max(9000),
  injectOnStaleGraph: z.boolean(),
});

export type HookClaudeConfig = z.infer<typeof HookClaudeConfigSchema>;

export const HookCodexConfigSchema = z.object({
  enabled: z.boolean(),
  minRiskToInject: RiskLevelSchema,
  maxContextChars: z.number().int().min(100).max(9000),
  injectOnStaleGraph: z.boolean(),
});

export type HookCodexConfig = z.infer<typeof HookCodexConfigSchema>;

export const HookConfigSchema = z.object({
  claude: HookClaudeConfigSchema,
  codex: HookCodexConfigSchema,
});

export type HookConfig = z.infer<typeof HookConfigSchema>;

export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function riskMeetsThreshold(
  riskLevel: string,
  threshold: RiskLevel,
): boolean {
  const riskOrder = RISK_ORDER[riskLevel as RiskLevel] ?? 0;
  const thresholdOrder = RISK_ORDER[threshold];
  return riskOrder >= thresholdOrder;
}
