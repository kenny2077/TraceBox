import type { ClaudeHookPayload, FileEditResult } from "./types.js";
import { FILE_EDITING_TOOLS } from "./types.js";
import { isAbsolute, resolve, relative, normalize } from "node:path";

export function parseHookInput(rawInput: string): FileEditResult {
  let payload: ClaudeHookPayload;

  try {
    payload = JSON.parse(rawInput) as ClaudeHookPayload;
  } catch {
    return { kind: "invalid", reason: "malformed JSON input" };
  }

  if (!payload || typeof payload !== "object") {
    return { kind: "invalid", reason: "payload is not an object" };
  }

  if (!payload.tool_name || typeof payload.tool_name !== "string") {
    return { kind: "invalid", reason: "missing or invalid tool_name" };
  }

  if (!FILE_EDITING_TOOLS.has(payload.tool_name)) {
    return { kind: "unsupported", reason: `tool "${payload.tool_name}" is not a file-editing tool` };
  }

  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== "object") {
    return { kind: "invalid", reason: "missing or invalid tool_input" };
  }

  const rawFilePath = toolInput.file_path;
  if (!rawFilePath || typeof rawFilePath !== "string") {
    return { kind: "unsupported", reason: `tool "${payload.tool_name}" has no file_path in tool_input` };
  }

  let filePath: string;
  const cwd = payload.cwd || process.cwd();

  try {
    if (isAbsolute(rawFilePath)) {
      filePath = relative(cwd, rawFilePath);
    } else {
      filePath = rawFilePath;
    }
  } catch {
    filePath = rawFilePath;
  }

  // Normalize to catch path traversal (e.g. src/foo/../../etc/passwd)
  // and reject any path that escapes the project root.
  const normalized = normalize(filePath);
  if (!normalized || normalized.startsWith("..") || normalized.includes("..")) {
    return { kind: "unsupported", reason: `file path "${filePath}" is outside the project directory` };
  }
  filePath = normalized;

  return {
    kind: "file_edit",
    toolName: payload.tool_name,
    filePath,
    cwd,
  };
}
