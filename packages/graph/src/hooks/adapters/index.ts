import type { HookAdapter, HookProvider } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";

/**
 * Adapter lookup table.
 * Each provider has exactly one adapter registered.
 */
const adapters: Record<HookProvider, HookAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

/**
 * Retrieve the adapter for a given provider.
 * Throws if no adapter is registered (should never happen in practice,
 * but callers should still handle gracefully).
 */
export function getAdapter(provider: HookProvider): HookAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`No hook adapter registered for provider "${provider}"`);
  }
  return adapter;
}

/**
 * Resolve an adapter from a CLI flag value.
 * Falls back to "claude" if the value is unrecognized.
 */
export function resolveAdapter(raw: string | undefined): HookAdapter {
  if (raw === "codex") {
    return getAdapter("codex");
  }
  return claudeAdapter;
}

export { claudeAdapter };
export type { HookAdapter, HookProvider };
export type { NormalizedHookEvent, NormalizedHookSource, ParseResult } from "./types.js";
