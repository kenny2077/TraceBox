import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

describe("verify command", () => {
  it("runs all verification checks and passes", () => {
    const output = execSync(`bun ${CLI} verify`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });

    expect(output).toContain("RippleGraph Verify");
    expect(output).toContain("Project detection:");
    expect(output).toContain("Fixture setup:");
    expect(output).toContain("Graph indexing:");
    expect(output).toContain("Node count:");
    expect(output).toContain("Edge count:");
    expect(output).toContain("Symbol extraction:");
    expect(output).toContain("Import edges:");
    expect(output).toContain("Diff command:");
    expect(output).toContain("Explain command:");
    expect(output).toContain("Tests command:");
    expect(output).toContain("All verification checks passed.");
  });

  it("exits with code 0 on success", () => {
    // execSync throws on non-zero exit, so if this doesn't throw, we're good
    const output = execSync(`bun ${CLI} verify`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });

    expect(output).toContain("All verification checks passed.");
  });
});
