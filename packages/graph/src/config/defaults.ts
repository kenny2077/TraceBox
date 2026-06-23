import type { HookConfig } from "./schema.js";

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  claude: {
    enabled: true,
    minRiskToInject: "MODERATE",
    maxContextChars: 9000,
    injectOnStaleGraph: true,
  },
  codex: {
    enabled: true,
    minRiskToInject: "MODERATE",
    maxContextChars: 9000,
    injectOnStaleGraph: true,
  },
};
