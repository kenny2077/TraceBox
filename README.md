<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kenny2077/tracebox/main/docs/logo-dark.svg">
    <img alt="TraceBox" src="https://raw.githubusercontent.com/kenny2077/tracebox/main/docs/logo-light.svg" width="400">
  </picture>
</p>

<h3 align="center">Local black-box recorder for AI coding agents</h3>

<p align="center">
  <strong>See what your agent changed, what it risked, and how to undo it — all on your machine.</strong>
  <br><br>
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#commands">Commands</a> ·
  <a href="docs/4-architecture.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://pypi.org/project/tracebox/"><img src="https://img.shields.io/pypi/v/tracebox" alt="PyPI"></a>
  <a href="https://github.com/kenny2077/tracebox/actions"><img src="https://img.shields.io/github/actions/workflow/status/kenny2077/tracebox/ci.yml" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License MIT"></a>
  <a href="https://github.com/kenny2077/tracebox"><img src="https://img.shields.io/badge/version-1.0.0-333" alt="v1.0.0"></a>
</p>

<hr>

## Why TraceBox?

AI coding agents — Claude Code, Codex, Cursor, Hermes — are powerful. They also modify your files, run shell commands, read sensitive configs, and make network calls. When something goes wrong, you need answers, not guesswork.

**TraceBox** is a local-first black-box flight recorder. It sits between your agent and your filesystem, recording every tool call, file change, policy decision, and network destination into a SQLite ledger. No cloud. No API keys. No telemetry. Just a `pip install` and a single command.

## Quick Start

```bash
pip install tracebox
cd your-project
tracebox init                            # one-time setup
tracebox run -- claude -p "add auth"    # record a session
tracebox open                            # see the timeline
```

That's it. Three commands and you have a complete audit trail of what your agent did.

## Features

| Category | Capability |
|----------|-----------|
| **Session Recording** | Every tool call, file change, and policy decision in chronological order |
| **Policy Engine** | Block destructive commands, sensitive reads, and risky operations with 3 built-in presets |
| **DLP & Redaction** | Automatic detection and redaction of secrets, tokens, and API keys in logs |
| **Network Monitoring** | Flags URLs, database connections, and API endpoints automatically |
| **Impact Analysis** | Code dependency graph shows what callers and tests are affected per edit |
| **One-Click Rollback** | Reverse patches, git restore, and file deletion for undoing agent changes |
| **Trust Scoring** | Per-session 0–100 score based on risks blocked, changes made, and sensitivity |
| **PR Comment Generator** | GitHub-flavored Markdown summaries ready for code review |
| **Agent Hooks** | One-click MCP proxy install for Claude, Codex, Cursor, and Hermes |
| **OTel Export** | Standard GenAI observability spans for Langfuse, Jaeger, and Aspire |
| **Timeline Dashboard** | CLI and web UI (`tracebox open --web`) for exploring sessions |
| **Local & Offline** | SQLite ledger on disk. No cloud dependency. No telemetry. |

## Supported Agents

| Agent | Integration | Status |
|-------|-------------|--------|
| Claude Desktop / Code | MCP server injection | `tracebox install --agent claude` |
| Codex CLI (OpenAI) | MCP server injection | `tracebox install --agent codex` |
| Cursor IDE | MCP server injection | `tracebox install --agent cursor` |
| Hermes Agent | Skill installation | `tracebox install --agent hermes` |
| Any MCP-compatible agent | Manual config | `tracebox serve` |

## Commands

```bash
tracebox init              Initialize TraceBox in current project
tracebox run -- <agent>    Run agent with recording and policy enforcement
tracebox open              Show recent sessions with timeline [--web for UI]
tracebox timeline <id>     Full session event timeline with filtering
tracebox rollback <id>     Generate and execute rollback plan (--dry-run to preview)
tracebox export <id>       Export report (markdown | html | json)
tracebox pr-comment <id>   Generate GitHub-flavored PR comment
tracebox install           Install agent hooks (--agent claude|codex|cursor|hermes)
tracebox uninstall         Remove agent hooks
tracebox serve             Run MCP server for tool call interception
tracebox policy list       Show available policy presets
tracebox doctor            Check system health and dependencies
```

## Policy Presets

TraceBox ships with three presets that balance safety and productivity:

| Preset | Behavior | Best For |
|--------|----------|----------|
| `safe-default` | Ask on unknown, deny destructive, rate-limit reads | Most developers |
| `strict` | Deny everything except git/read-only ops | CI, production, security audits |
| `permissive` | Allow everything, log only | Evaluation, demos, low-risk projects |

Override per project with `.tracebox/policy.yaml`:

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
│ (Claude /    │    │ Server         │    │ (MCP / Shell)│
│  Codex etc.) │◀───│ (policy eval)  │◀───│              │
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

## How It Compares

| Tool | Scope | TraceBox Differentiator |
|------|-------|------------------------|
| Langfuse / AgentOps | LLM app tracing | We trace local coding-agent file-system effects |
| mcp-firewall / Pipelock | MCP network security | We combine security with repo impact + rollback |
| AgentSight | System-level eBPF | We provide developer workflow + semantic code risk |
| Cursor / Claude logs | Single agent | We're cross-agent, local, and exportable |
| `git diff` | File changes only | We add intent, tool, risk, and timeline context |

## Limitations

TraceBox is honest about what it cannot do:

- **Network effects**: Cannot roll back API calls, database writes, or deployed artifacts
- **Model memory**: Secrets already in the model's context window are irrecoverable
- **Package install scripts**: `npm install` and similar may have irreversible side effects
- **Impact analysis (RippleGraph)**: Experimental — requires Bun and TypeScript projects
- **Approval prompts**: Require a TTY (macOS/Linux terminal)

## Development

```bash
git clone https://github.com/kenny2077/tracebox.git
cd tracebox
pip install -e ".[dev]"
pytest tests/unit/ tests/e2e/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT © TraceBox
