<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kenny2077/tracebox/main/docs/logo-dark.svg">
    <img alt="TraceBox" src="https://raw.githubusercontent.com/kenny2077/tracebox/main/docs/logo-light.svg" width="400">
  </picture>
</p>

<h3 align="center">Local black-box recorder for AI coding agents</h3>

<p align="center">
  See what your agent changed, what it risked, what it touched, and how to undo it.
  <br>
  <a href="#quick-start"><strong>Quick Start »</strong></a>
  <a href="#commands"><strong>Commands »</strong></a>
  <a href="docs/4-architecture.md"><strong>Architecture »</strong></a>
</p>

<p align="center">
  <a href="https://pypi.org/project/tracebox/"><img src="https://img.shields.io/pypi/v/tracebox" alt="PyPI"></a>
  <a href="https://github.com/kenny2077/tracebox/actions"><img src="https://img.shields.io/github/actions/workflow/status/kenny2077/tracebox/ci.yml" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://github.com/kenny2077/tracebox"><img src="https://img.shields.io/github/stars/kenny2077/tracebox" alt="Stars"></a>
</p>

---

AI coding agents (Claude Code, Codex, Cursor, Gemini CLI) can change your files, run commands, read secrets, and call external APIs. When something breaks, you need answers fast.

TraceBox records every agent session into a local SQLite ledger and gives you **timeline**, **risk analysis**, **rollback**, and **exportable reports** — with no cloud dependencies, no API keys, and no setup beyond a single CLI command.

## Quick Start

```bash
pip install tracebox
cd ~/projects/my-app
tracebox init
tracebox run -- claude -p "refactor the auth module"
tracebox open
```

That's it. After `tracebox open`, you see every tool call, file change, policy decision, and risk level — plus a one-command rollback.

## The 60-Second Demo

```bash
$ tracebox run -- claude -p "add rate limiting"

▶️  Running: claude -p "add rate limiting"
🟢 Session started: sess_abc123
   Policy: safe-default

⚠️  HIGH RISK: execute_command -> deny
   (Destructive command blocked by policy: rm -rf /tmp)
🌐 Network: 1 critical destination detected (stripe.com)

🏁 Session ended: sess_abc123
   Changes: 3 files modified
   Trust Score: 73/100
📄 Report: .tracebox/reports/sess_abc123_report.md

$ tracebox open

Timeline for sess_abc123:
[1]  file_read        | src/auth/service.ts
[2]  impact_analysis  | 🔴 HIGH: 6 callers, 2 tests
[3]  file_change      | modified: src/auth/service.ts
[4]  tool_call        | execute_command: git diff
[5]  tool_call        | ⚠️ npm install express-rate-limit (package change)
[6]  file_change      | modified: package.json
[7]  tool_call        | 🛡️ DENIED: rm -rf /tmp (critical)

$ tracebox rollback sess_abc123 --dry-run
Rollback plan:
  - Reverse patch: src/auth/service.ts ✅
  - Reverse patch: package.json ⚠️ (package change detected)
  Rollback: tracebox rollback sess_abc123
```

## Features

| Feature | Description |
|---------|-------------|
| **📋 Session Timeline** | Every tool call, file edit, and policy decision in chronological order |
| **🛡️ Policy Engine** | Block destructive commands, sensitive file reads, and risky operations |
| **🔒 DLP Redaction** | Secrets, API keys, and tokens are automatically redacted from logs |
| **🌐 Network Detection** | URLs, database connections, and API endpoints are flagged automatically |
| **📊 Impact Analysis** | RippleGraph tells you what callers and tests are affected before each edit |
| **↩️ Rollback** | Reverse patches, git restore, and file deletion for undoing agent changes |
| **📄 PR Comments** | GitHub-flavored Markdown summaries for code review |
| **📈 Trust Score** | 0-100 score per session based on risks, blocks, and changes |
| **🔌 Agent Hooks** | Install MCP proxy for Claude Code, Codex, and Cursor interception |
| **📡 OTel Export** | Standard GenAI observability spans for Langfuse, Jaeger, Aspire |

## Commands

```bash
tracebox init              Initialize TraceBox in current project
tracebox run -- <agent>    Run agent with recording and policy enforcement
tracebox open              Show recent sessions with timeline
tracebox timeline <id>     Full session event timeline
tracebox rollback <id>     Rollback plan (--dry-run to preview)
tracebox export <id>       Export report (markdown/html/json)
tracebox pr-comment <id>   Generate GitHub-flavored PR comment
tracebox install           Install agent hooks (Claude, Codex, Cursor)
tracebox serve             Run MCP server for tool call interception
tracebox policy list       Show available policy presets
tracebox doctor            Check system health and dependencies
```

## Policy Presets

| Preset | Default | Use Case |
|--------|---------|----------|
| `safe-default` | Ask on unknown, deny destructive | Most developers |
| `strict` | Deny everything except git/read | CI / production | 
| `permissive` | Allow everything, just log | Evaluation only |

Customize per project with `.tracebox/policy.yaml`:

```yaml
preset: safe-default
custom_rules:
  - id: allow-yarn
    tool: execute_command
    match_args_contain:
      command: ["yarn"]
    action: allow
```

## Architecture

```
┌──────────────┐    ┌────────────────┐    ┌──────────────┐
│ AI Agent     │───▶│ TraceBox MCP   │───▶│ Tool Executor│
│ (Claude/     │    │ Server         │    │ (MCP/Shell)  │
│  Codex/etc.) │◀───│ (policy eval)  │◀───│              │
└──────────────┘    └───────┬────────┘    └──────────────┘
                            │
                     ┌──────▼──────┐
                     │ SQLite      │
                     │ Ledger      │
                     │ (events,    │
                     │  sessions,  │
                     │  rollbacks) │
                     └─────────────┘
```

Data never leaves your machine. No cloud, no API keys, no telemetry.

## Comparison

| Product | Focus | TraceBox Advantage |
|---------|-------|--------------------|
| Langfuse / AgentOps | LLM app tracing | We trace local coding-agent effects on repos |
| mcp-firewall / Pipelock | MCP network security | We combine security with repo impact + rollback |
| AgentSight | System-level eBPF tracing | We provide developer workflow + semantic code risk + undo |
| Cursor / Claude logs | Vendor-specific agent history | We are cross-agent, local, and exportable |
| Git diff | File changes only | We add intent, tool, risk, and timeline context |

## Limitations

TraceBox is honest about what it cannot do:
- **RippleGraph impact analysis** requires [Bun](https://bun.sh) for TypeScript projects
- **Rollback** cannot reverse network requests, database commands, or npm install scripts
- **Secrets** already loaded into model context are irretrievable (only redacted from logs)
- **Approval prompts** require `/dev/tty` (macOS/Linux)

## Development

```bash
git clone https://github.com/kenny2077/tracebox.git
cd tracebox
pip install -e .
pytest tests/e2e/
```

## License

MIT
