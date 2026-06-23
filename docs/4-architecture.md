# TraceBox Architecture

> System architecture, data flows, tech stack, and security invariants for TraceBox v0.1.
> Updated: 2026-06-22

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Coding Agent                          │
│          (Claude Code / Codex / Cursor / Gemini)            │
└─────────────────────────┬───────────────────────────────────┘
                          │ hooks / proxy / subprocess
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    TraceBox Runtime                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Pre-action   │  │ Runtime      │  │ File/Git         │  │
│  │ Risk Engine  │  │ Policy Proxy │  │ Recorder         │  │
│  │ (RippleGraph)│  │ (TraceGate)  │  │ (new)            │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬──────────┘  │
│         │                 │                  │             │
│         ▼                 ▼                  ▼             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Shared Event Ledger (SQLite)             │  │
│  │  sessions │ events │ file_events │ tool_events │ ... │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│         ┌───────────────────┼───────────────────┐          │
│         ▼                   ▼                   ▼          │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Rollback   │    │ Timeline UI  │    │ Report Gen   │   │
│  │ Engine     │    │ (CLI/Web)    │    │ (TraceCanvas)│   │
│  └────────────┘    └──────────────┘    └──────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## File Layout

```
tracebox/
├── apps/
│   ├── cli/tracebox.py           # Unified CLI entry point
│   └── desktop-or-web/           # Future web UI
├── packages/
│   ├── tracebox/                 # pip-installable package (thin CLI wrapper)
│   ├── ledger/
│   │   ├── ledger.py             # SQLite event bus (408 lines)
│   │   └── schema.sql            # DDL with 7 tables + views
│   ├── graph/                    # RippleGraph (TypeScript/Bun)
│   │   ├── src/
│   │   │   ├── cli.ts            # CLI with analyze, init, index commands
│   │   │   ├── db.ts             # SQLite graph store (Bun or Node.js)
│   │   │   ├── parser.ts         # Tree-sitter parser
│   │   │   ├── resolver.ts       # Import resolver (bug fixed)
│   │   │   └── ...
│   │   └── dist/                 # Compiled JS output
│   ├── policy/
│   │   ├── policy_engine.py      # Policy presets + evaluation (new)
│   │   └── src/tracegate/        # Original TraceGate code (kept intact)
│   │       ├── proxy.py          # MCP stdio proxy
│   │       ├── policy.py         # Original YAML policy engine
│   │       ├── audit.py          # Audit logger
│   │       ├── dlp.py            # Secret redaction
│   │       ├── approval.py       # Human-in-the-loop
│   │       └── ...
│   ├── recorder/
│   │   ├── recorder.py           # File/git change detection
│   │   └── watcher.py            # Watchdog file watcher (new)
│   ├── rollback/
│   │   └── rollback.py           # Undo engine (new)
│   ├── report/
│   │   ├── report.py             # Report generator (Markdown/HTML/JSON)
│   │   └── otel_export.py        # OpenTelemetry export
│   ├── replay/
│   │   └── timeline.py           # Timeline UI (CLI + web dashboard)
│   └── core/
│       └── orchestrator.py       # Session orchestration (new)
├── integrations/
│   ├── claude/                   # Claude Code hooks
│   ├── codex/                    # Codex hooks
│   └── ...                       # Future: Cursor, Gemini, generic MCP
├── tests/
│   ├── e2e/test_all.py           # 4 E2E tests (session, policy, rollback, report)
│   └── fixtures/simple-ts-project/  # Controlled test repo
├── docs/
│   ├── 1-codebase-analysis.md
│   ├── 2-implementation-plan.md
│   ├── 3-product-spec.md
│   ├── 4-architecture.md         # This file
│   └── 5-improvement-plan.md     # Gap analysis + fix plan
├── references/                   # Original source repos (read-only)
├── pyproject.toml                # Python package config
└── .tracebox/                    # Runtime data (gitignored)
```

## Data Flow

### Session Lifecycle

```
1. tracebox init
   → Creates .tracebox/ directory and ledger database

2. tracebox run -- <agent_command>
   → SessionOrchestrator.start_session()
     → Ledger.create_session() → writes to sessions table
     → FileRecorder.capture_before() → git rev-parse HEAD, git status

3. Agent runs (via hooks/proxy)
   → On tool call: SessionOrchestrator.on_tool_call()
     → PolicyEngine.evaluate() → allow/deny/ask
     → Ledger.emit_tool_event() → writes to tool_events table

   → On file edit: SessionOrchestrator.on_file_edit()
     → (optional) RippleGraph.analyze() → JSON impact report
     → Ledger.emit_impact_event() → writes to impact_events table

   → File changes detected by FileRecorder/FileWatcher
     → Ledger.emit_file_event() → writes to file_events table

4. tracebox end / agent exits
   → SessionOrchestrator.end_session()
     → FileRecorder.detect_changes() → final snapshot
     → Ledger.end_session() → trust score, commit_after

5. tracebox timeline <session_id>
   → TimelineUI.render_cli() → formatted event timeline

6. tracebox rollback <session_id> [--dry-run]
   → RollbackEngine.generate_plan() → steps + warnings
   → RollbackEngine.execute_plan() → reverse patches

7. tracebox export <session_id>
   → ReportGenerator.save() → markdown/html/json report
```

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Event store | SQLite via Python sqlite3 | Zero setup, local-first, WAL mode |
| Policy engine | Python 3.10+ | Shared with TraceGate, fast iteration |
| Code graph | TypeScript/Bun (RippleGraph) | Best TS/JS parser ecosystem (tree-sitter) |
| CLI | Python argparse | Cross-platform, no deps |
| Web dashboard | FastAPI + uvicorn (optional) | On-demand, not always running |
| File watching | watchdog (Python) | Cross-platform, reliable |
| OTel export | JSON via OTLP/HTTP format | Standard GenAI observability |

## Security Invariants

1. **No cloud deps** — All data stays local. No network calls for core features.
2. **Audit trail is immutable-ish** — SQLite WAL journal, append-only event stream.
3. **DLP is best-effort** — Redacts secrets from tool call logs, but cannot erase them from model context.
4. **Rollback honesty** — Explicitly lists what CANNOT be rolled back (network requests, DB commands, npm install scripts).
5. **Policy is configurable** — Presets for safe-default/strict/permissive, not raw YAML for normal users.
6. **Session isolation** — Each agent session gets a unique sess_ ID. Events are scoped.
