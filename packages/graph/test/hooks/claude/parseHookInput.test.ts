import { describe, it, expect } from "vitest";
import { parseHookInput } from "../../../src/hooks/claude/parseHookInput.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../../fixtures/claude-hooks");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}

describe("parseHookInput", () => {
  describe("valid file-editing tools", () => {
    it("parses Write with absolute file_path", () => {
      const input = readFixture("write.json");
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
      if (result.kind === "file_edit") {
        expect(result.toolName).toBe("Write");
        expect(result.filePath).toBe("src/auth/service.ts");
        expect(result.cwd).toBe("/Users/alice/projects/my-app");
      }
    });

    it("parses Edit with relative file_path", () => {
      const input = readFixture("edit.json");
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
      if (result.kind === "file_edit") {
        expect(result.toolName).toBe("Edit");
        expect(result.filePath).toBe("src/utils/helpers.ts");
      }
    });

    it("parses MultiEdit with file_path", () => {
      const input = readFixture("multiedit.json");
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
      if (result.kind === "file_edit") {
        expect(result.toolName).toBe("MultiEdit");
        expect(result.filePath).toBe("src/config/settings.ts");
      }
    });
  });

  describe("unsupported tools", () => {
    it("returns unsupported for Bash tool", () => {
      const input = readFixture("bash.json");
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
      if (result.kind === "unsupported") {
        expect(result.reason).toContain("Bash");
      }
    });

    it("returns unsupported for Read tool", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "src/index.ts" },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
      if (result.kind === "unsupported") {
        expect(result.reason).toContain("Read");
      }
    });

    it("returns unsupported for Grep tool", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "TODO" },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
    });
  });

  describe("malformed input", () => {
    it("returns invalid for non-JSON input", () => {
      const input = readFixture("not-json.txt");
      const result = parseHookInput(input);

      expect(result.kind).toBe("invalid");
    });

    it("returns invalid for JSON without tool_name", () => {
      const input = readFixture("malformed.json");
      const result = parseHookInput(input);

      expect(result.kind).toBe("invalid");
    });

    it("returns invalid for null input", () => {
      const result = parseHookInput("null");
      expect(result.kind).toBe("invalid");
    });

    it("returns invalid for empty string", () => {
      const result = parseHookInput("");
      expect(result.kind).toBe("invalid");
    });

    it("returns invalid for empty object", () => {
      const result = parseHookInput("{}");
      expect(result.kind).toBe("invalid");
    });

    it("returns invalid for array input", () => {
      const result = parseHookInput("[]");
      expect(result.kind).toBe("invalid");
    });

    it("returns unsupported when file_path is outside project", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/etc/passwd" },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
      if (result.kind === "unsupported") {
        expect(result.reason).toContain("outside");
      }
    });
  });

  describe("edge cases", () => {
    it("handles payload with extra unknown fields", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "src/app.ts", content: "x", extra_field: 42 },
        cwd: "/Users/alice/projects/my-app",
        unknown_field: "should be ignored",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
    });

    it("handles missing cwd by using process.cwd", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "src/app.ts" },
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
      if (result.kind === "file_edit") {
        expect(result.filePath).toBe("src/app.ts");
      }
    });

    it("handles tool_input without file_path", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { content: "some code" },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
    });

    it("handles Write with file_path as non-string", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: 12345 },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("unsupported");
    });

    it("handles deeply nested malformed JSON gracefully", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: null,
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("invalid");
    });

    it("keeps relative path unchanged when already relative", () => {
      const input = JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "src/nested/deep/file.ts" },
        cwd: "/Users/alice/projects/my-app",
      });
      const result = parseHookInput(input);

      expect(result.kind).toBe("file_edit");
      if (result.kind === "file_edit") {
        expect(result.filePath).toBe("src/nested/deep/file.ts");
      }
    });
  });
});
