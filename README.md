<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kenny2077/TraceBox/main/docs/logo-dark.svg">
    <img alt="TraceBox" src="https://raw.githubusercontent.com/kenny2077/TraceBox/main/docs/logo-dark.svg" width="420">
  </picture>
</p>

<p align="center"><strong>Local black-box flight recorder for AI coding agents.</strong></p>

<p align="center">See what your agent changed, what it risked, and how to undo it — all on your machine.</p>

<p align="center">
  <a href="https://github.com/kenny2077/TraceBox/actions"><img src="https://img.shields.io/github/actions/workflow/status/kenny2077/TraceBox/ci.yml?branch=main" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://www.python.org/downloads/"><img src="https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue" alt="Python versions"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#features">Features</a> ·
  <a href="#commands">Commands</a> ·
  <a href="docs/4-architecture.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<hr>

## The Problem

AI coding agents — Claude Code, Codex, Cursor, Hermes — edit your files, run shell commands, read config files, and make network calls. They're powerful but opaque. When something breaks (and it will), you're left asking:

- *"What files did it touch?"*
- *"Which command deleted that table?"*
- *"Did it read my `.env` file?"*
- *"How do I undo all of this?"*

Existing solutions either require cloud telemetry (privacy risk), capture only LLM traces (missing filesystem effects), or are single-agent (locked to one tool). You need a local, cross-agent black box.

## The Solution

**TraceBox** is a local-first black-box recorder that sits between your agent and your filesystem. It records every tool call, file change, policy decision, and network destination into a SQLite ledger — then lets you inspect, roll back, and export the results.

**No cloud. No API keys. No telemetry.** Just `pip install tracebox` and three commands.

## Quick Start

```bash
pip install tracebox                  # one install
tracebox init                         # one-time setup per project
tracebox run -- claude -p "add auth"  # record any agent session
```

That's it. You now have a complete audit trail.

```bash
tracebox open                         # see session timeline
tracebox rollback <session-id>        # undo everything from a session
tracebox export <session-id>          # markdown, HTML, or JSON report
```

### Verify it works

```bash
tracebox doctor                       # checks system health
tracebox policy list                  # see available policy presets
```

## Demo

Here's what a recorded session looks like. Every tool call, file change, and risk assessment in one view:

```
$ tracebox timeline sess_20260623_a1b2c3

╔══════════════════════════════════════════════════════════════╗
║ SESSION  sess_20260623_a1b2c3          Trust Score: 82/100  ║
╠══════════════════════════════════════════════════════════════╣
║ 17:00:01  ▶ session_init                                    ║
║ 17:00:05  ▶ tools/list          [ALLOWED]                   ║
║ 17:00:08  ▶ read_file           [ALLOWED]   src/auth.ts     ║
║ 17:00:12  ▶ write_to_file       [ALLOWED]   src/auth.ts     ║
║ 17:00:15  ▶ execute_command     [ASKED]     npm test        ║
║ 17:00:18  ◀ test_output         PASS        12 passed       ║
║ 17:00:20  ▶ execute_command     [BLOCKED]   rm -rf /tmp/*   ║
║ 17:00:22  ▶ search_content      [ALLOWED]   TODO pattern    ║
║ 17:00:25  ◀ session_end         exit_code=0                 ║
╚══════════════════════════════════════════════════════════════╝
```

## How It Works

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

TraceBox acts as an MCP proxy: every tool call from your agent passes through TraceBox before reaching the tool executor. Policy rules are evaluated in real-time — block destructive commands, ask for approval on risky reads, or log everything. All events are stored in a local SQLite database that never leaves your machine.

## Features

### Record everything

Every tool call, file change, network destination, and policy decision is captured in chronological order. No sampling. No aggregation. The full story.

### Block what matters

Three built-in policy presets (`safe-default`, `strict`, `permissive`) plus custom YAML rules. Deny destructive commands, ask on sensitive reads, rate-limit network calls — all configurable per project.

### Detect secrets automatically

Built-in DLP engine detects and redacts API keys, tokens, private keys, and connection strings from session logs. Turn it on with one config line.

### Roll back with confidence

One-click undo for any session. TraceBox generates a rollback plan from git history and file watcher records — `git restore`, patch reversal, and file undeletion. Preview with `--dry-run` before executing.

### Understand impact

Per-session trust score (0–100) based on risks blocked, changes made, and file sensitivity. Code dependency graph shows what callers and tests are affected by each edit.

### Export anywhere

Generate GitHub-flavored PR comments, Markdown reports, HTML pages, or JSON exports. Standard OpenTelemetry spans for Langfuse, Jaeger, and Aspire.

### Works with your tools

One-command hooks for Claude Desktop, Codex CLI, Cursor IDE, and Hermes Agent. Any MCP-compatible agent works via `tracebox serve`.

## Supported Agents

| Agent | Integration | Command |
|-------|-------------|---------|
| Claude Desktop / Code | MCP server injection | `tracebox install --agent claude` |
| Codex CLI (OpenAI) | MCP server injection | `tracebox install --agent codex` |
| Cursor IDE | MCP server injection | `tracebox install --agent cursor` |
| Hermes Agent | Skill installation | `tracebox install --agent hermes` |
| Any MCP-compatible agent | Manual config | `tracebox serve` |

## Commands

### Core workflow

| Command | What it does |
|---------|-------------|
| `tracebox init` | Initialize TraceBox in current project |
| `tracebox run -- <agent>` | Run agent with recording and policy enforcement |
| `tracebox open` | Show recent sessions with timeline (`--web` for browser UI) |

### Inspection

| Command | What it does |
|---------|-------------|
| `tracebox timeline <id>` | Full session event timeline with filtering |
| `tracebox rollback <id>` | Generate and execute rollback plan (`--dry-run` to preview) |
| `tracebox export <id>` | Export report (`markdown`, `html`, or `json`) |
| `tracebox pr-comment <id>` | Generate GitHub-flavored PR comment |

### Setup & maintenance

| Command | What it does |
|---------|-------------|
| `tracebox install` | Install agent hooks (`--agent claude\|codex\|cursor\|hermes`) |
| `tracebox uninstall` | Remove agent hooks |
| `tracebox serve` | Run MCP server for tool call interception |
| `tracebox policy list` | Show available policy presets |
| `tracebox doctor` | Check system health and dependencies |

## Policy Configuration

TraceBox ships with three presets. Override per project with `.tracebox/policy.yaml`:

| Preset | Behavior | Best For |
|--------|----------|----------|
| `safe-default` | Ask on unknown, deny destructive, rate-limit reads | Most developers |
| `strict` | Deny everything except git/read-only ops | CI, production, security audits |
| `permissive` | Allow everything, log only | Evaluation, demos, low-risk projects |

```yaml
# .tracebox/policy.yaml
preset: safe-default

# Enable DLP (secret redaction)
dlp_enabled: true

# Custom rules override or extend the preset
custom_rules:
  - id: allow-yarn
    tool: execute_command
    match_args_contain:
      command: ["yarn"]
    action: allow

  - id: block-force-push
    tool: execute_command
    match_args_contain:
      command: ["git", "push", "--force"]
    action: deny
```

## How It Compares

| Tool | Scope | TraceBox Differentiator |
|------|-------|------------------------|
| Langfuse / AgentOps | LLM app tracing | We trace local coding-agent filesystem effects |
| mcp-firewall / Pipelock | MCP network security | We combine security with repo impact + rollback |
| AgentSight | System-level eBPF | We provide developer workflow + semantic code risk |
| Cursor / Claude logs | Single agent | We're cross-agent, local, and exportable |
| `git diff` | File changes only | We add intent, tool, risk, and timeline context |

## Limitations

TraceBox is honest about what it cannot do:

| What it does | What it does NOT do |
|-------------|-------------------|
| Record all local file changes | Roll back API calls, database writes, or deployed artifacts |
| Detect secrets in agent output | Recover secrets already in the model's context window |
| Undo git-tracked file changes | Undo `npm install` or package manager side effects |
| Block tool calls via policy | Prevent the agent from reading files outside the workspace |
| Export to OTel, Markdown, JSON, HTML | Provide a hosted dashboard (local-only by design) |

## Development

```bash
git clone https://github.com/kenny2077/TraceBox.git
cd TraceBox
pip install -e ".[dev]"
pytest tests/unit/ tests/e2e/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Project Status

TraceBox is **v1.0.0 — Production/Stable**. The core recorder, policy engine, rollback, and report generator are complete and tested across Python 3.10–3.12. See [CHANGELOG.md](CHANGELOG.md) for details.

## License

MIT © 2026 Kenny. See [LICENSE](LICENSE) for full text.
