import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadHookConfig, shouldInjectForRisk, getRiskLevelNumeric } from "../../src/config/loader.js";
import { DEFAULT_HOOK_CONFIG } from "../../src/config/defaults.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadHookConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ripplegraph-hookcfg-"));
    mkdirSync(join(tmpDir, ".ripplegraph"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config.json exists", () => {
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.valid).toBe(true);
    expect(cfg.errors).toHaveLength(0);
    expect(cfg.claude.enabled).toBe(true);
    expect(cfg.claude.minRiskToInject).toBe("MODERATE");
    expect(cfg.claude.maxContextChars).toBe(9000);
    expect(cfg.claude.injectOnStaleGraph).toBe(true);
  });

  it("returns defaults when config.json has no hooks section", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({ projectName: "test" }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.valid).toBe(true);
    expect(cfg.claude.enabled).toBe(true);
  });

  it("reads hook config from config.json", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({
        hooks: {
          claude: {
            enabled: false,
            minRiskToInject: "HIGH",
            maxContextChars: 500,
            injectOnStaleGraph: false,
          },
        },
      }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.valid).toBe(true);
    expect(cfg.claude.enabled).toBe(false);
    expect(cfg.claude.minRiskToInject).toBe("HIGH");
    expect(cfg.claude.maxContextChars).toBe(500);
    expect(cfg.claude.injectOnStaleGraph).toBe(false);
  });

  it("merges partial config with defaults", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({
        hooks: {
          claude: {
            enabled: false,
          },
        },
      }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.claude.enabled).toBe(false);
    expect(cfg.claude.minRiskToInject).toBe("MODERATE");
    expect(cfg.claude.maxContextChars).toBe(9000);
    expect(cfg.claude.injectOnStaleGraph).toBe(true);
  });

  it("rejects invalid risk level and falls back to default", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({
        hooks: {
          claude: {
            enabled: true,
            minRiskToInject: "INVALID",
          },
        },
      }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.claude.minRiskToInject).toBe("MODERATE");
    expect(cfg.errors.length).toBeGreaterThan(0);
    expect(cfg.errors[0]).toContain("INVALID");
  });

  it("clamps maxContextChars below 100 to 100", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({
        hooks: {
          claude: {
            maxContextChars: 50,
          },
        },
      }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.claude.maxContextChars).toBe(100);
  });

  it("clamps maxContextChars above 9000 to 9000", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      JSON.stringify({
        hooks: {
          claude: {
            maxContextChars: 50000,
          },
        },
      }),
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.claude.maxContextChars).toBe(9000);
  });

  it("handles malformed config.json gracefully", () => {
    writeFileSync(
      join(tmpDir, ".ripplegraph", "config.json"),
      "not json",
    );
    const cfg = loadHookConfig(tmpDir);
    expect(cfg.valid).toBe(true);
    // Falls back to defaults
    expect(cfg.claude.enabled).toBe(true);
  });
});

describe("shouldInjectForRisk", () => {
  it("returns true when risk meets threshold", () => {
    expect(shouldInjectForRisk("MODERATE", "MODERATE")).toBe(true);
    expect(shouldInjectForRisk("HIGH", "MODERATE")).toBe(true);
    expect(shouldInjectForRisk("CRITICAL", "MODERATE")).toBe(true);
  });

  it("returns false when risk is below threshold", () => {
    expect(shouldInjectForRisk("LOW", "MODERATE")).toBe(false);
    expect(shouldInjectForRisk("LOW", "HIGH")).toBe(false);
    expect(shouldInjectForRisk("MODERATE", "HIGH")).toBe(false);
  });

  it("handles unknown risk levels", () => {
    expect(shouldInjectForRisk("UNKNOWN", "MODERATE")).toBe(false);
  });
});

describe("getRiskLevelNumeric", () => {
  it("maps risk levels to numbers", () => {
    expect(getRiskLevelNumeric("LOW")).toBe(0);
    expect(getRiskLevelNumeric("MODERATE")).toBe(1);
    expect(getRiskLevelNumeric("HIGH")).toBe(2);
    expect(getRiskLevelNumeric("CRITICAL")).toBe(3);
    expect(getRiskLevelNumeric("UNKNOWN")).toBe(0);
  });
});
