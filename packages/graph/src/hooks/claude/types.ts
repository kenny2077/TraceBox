export interface ClaudeHookPayload {
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
  session_id?: string;
  transcript_path?: string;
}

export type FileEditResult =
  | { kind: "file_edit"; toolName: string; filePath: string; cwd: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "invalid"; reason: string };

export const FILE_EDITING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
