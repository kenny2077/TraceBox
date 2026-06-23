# TraceBox Agent Integrations

One-click hooks to intercept and record AI agent tool calls.

## Supported Agents

| Agent | Hook Type | Install |
|-------|-----------|---------|
| Claude Desktop / Claude Code | MCP server injection | `./claude-code/install.sh` |
| Codex CLI (OpenAI) | MCP server injection | `./codex-cli/install.sh` |
| Cursor IDE | MCP server injection | `./cursor/install.sh` |
| Hermes Agent | Skill installation | `./hermes-agent/install.sh` |
| Generic (any MCP agent) | Manual config | See below |

## How It Works

Each integration adds a `"tracebox"` entry to the agent's MCP configuration:

```json
{
  "mcpServers": {
    "tracebox": {
      "command": "tracebox",
      "args": ["serve", "--policy", "safe-default"]
    }
  }
}
```

When the agent makes a tool call, TraceBox's MCP server:
1. Evaluates the call against the policy engine
2. Logs it to the local ledger
3. Forwards to the actual tool executor
4. Records all file changes via git diff

## Manual Integration

For any agent that supports MCP stdio servers:

```bash
# Add this to your agent's MCP config:
tracebox serve --policy safe-default
```

Then run your agent normally. TraceBox will record every tool call.

## Verification

```bash
tracebox open       # View session dashboard
tracebox doctor     # Check system health
```
