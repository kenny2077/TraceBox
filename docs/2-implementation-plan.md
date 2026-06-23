# TraceBox: Implementation Plan

> From analysis to MVP. Phased build plan for merging RippleGraph + TraceGate + TraceCanvas ideas into TraceBox.
> Date: 2026-06-22

---

## Table of Contents

1. [Phase 0: Monorepo Scaffold](#phase-0-monorepo-scaffold)
2. [Phase 1: Shared Event Ledger](#phase-1-shared-event-ledger)
3. [Phase 2: File/Git Recorder](#phase-2-filegit-recorder)
4. [Phase 3: Integrate RippleGraph](#phase-3-integrate-ripplegraph)
5. [Phase 4: Integrate TraceGate](#phase-4-integrate-tracegate)
6. [Phase 5: Timeline UI](#phase-5-timeline-ui)
7. [Phase 6: Rollback Engine](#phase-6-rollback-engine)
8. [Phase 7: Agent Report Export](#phase-7-agent-report-export)
9. [Phase 8: OpenTelemetry Export](#phase-8-opentelemetry-export)
10. [MVP v0.1 Definition](#mvp-v01-definition)
11. [MVP v0.2 Definition](#mvp-v02-definition)
12. [MVP v0.3 Definition](#mvp-v03-definition)
13. [MVP v0.4 Definition](#mvp-v04-definition)
14. [What NOT to Build](#what-not-to-build)
15. [Success Metrics](#success-metrics)

---

## Phase 0: Monorepo Scaffold

**Goal:** Create one parent repo. Stop building three products.

### Directory Structure

```
tracebox/
  apps/
    cli/                          # Unified CLI entry point
    desktop-or-web/               # Future: Electron or local web UI
  packages/
    ledger/                       # Shared SQLite schema + event bus
    graph/                        # RippleGraph TS code (subprocess module)
    policy/                       # TraceGate policy engine (Python subprocess)
    recorder/                     # File/git change watcher (new)
    replay/                       # Session replay engine
    rollback/                     # Undo engine (new)
    report/                       # Receipt/report generation (TraceCanvas ideas)
    adapters/                     # Agent hook adapters
  integrations/
    claude/                       # Claude Code hook
    codex/                        # OpenAI Codex hook
    cursor/                       # Cursor agent hook (future)
    gemini/                       # Gemini CLI hook (future)
    mcp/                          # Generic MCP adapter
  docs/
    threat-model.md
    product-spec.md
    architecture.md
    api-reference.md
  tests/
    e2e/                          # End-to-end smoke tests
    fixtures/                     # Controlled test repos
  examples/
    demo.sh                       # One-command demo
```

### Tasks

- [ ] Create `tracebox/` repo structure
- [ ] Move RippleGraph code into `packages/graph/` (keep TS/Bun)
- [ ] Move TraceGate code into `packages/policy/` (keep Python)
- [ ] Create `packages/ledger/` with unified SQLite schema
- [ ] Set up cross-language build (Bun + Python venv)
- [ ] Write root README with product positioning
- [ ] Archive old repos with forwarding links

**Time estimate:** 2-3 days
**Dependencies:** None

---

## Phase 1: Shared Event Ledger

**Goal:** Everything writes to one SQLite schema. This is the foundation.

### Schema (see `docs/1-codebase-analysis.md` ADR-002 for full SQL)

Key tables:
- `sessions` — agent session metadata
- `events` — generic event stream with type, risk_level, summary
- `file_events` — file changes with before/after hashes and diff patches
- `tool_events` — MCP tool calls with decision and redacted args
- `impact_events` — RippleGraph semantic impact data
- `secret_events` — DLP secret detections
- `rollback_steps` — undo plan for each session

### Tasks

- [ ] Implement `packages/ledger/` in Python (shared with TraceGate)
- [ ] Create schema migration system (Alembic or simple versioned SQL)
- [ ] Write event bus: `tracebox event emit <type> <json>`
- [ ] Write event query: `tracebox event list <session_id>`
- [ ] Port RippleGraph's `db.ts` to write `impact_events` instead of its own schema
- [ ] Port TraceGate's `store.py` to write `tool_events` instead of its own schema
- [ ] Add WAL mode, proper indexing
- [ ] Write tests: event CRUD, session lifecycle, query performance

**Time estimate:** 3-5 days
**Dependencies:** Phase 0

---

## Phase 2: File/Git Recorder

**Goal:** Capture what the agent actually changed on disk. This is the missing piece.

### Implementation Options

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Git diff only | Easy | Misses untracked temp/destructive actions | **Partial** |
| chokidar/watchdog file watcher | Practical | Can miss very fast changes | **Partial** |
| fs wrapper hooks | Precise for agent-mediated tools | Bypassable if agent uses direct syscalls | **Future** |
| eBPF/FSEvents | Powerful | Much harder, Linux-only | **v0.4+** |

**MVP decision:** Git diff + file watcher + TraceGate tool call log.

### Tasks

- [ ] Before session: `git status --porcelain`, `git rev-parse HEAD`
- [ ] During session: chokidar/watchdog watcher on repo root
- [ ] After session: `git diff`, compare to before snapshot
- [ ] Hash before/after for modified files
- [ ] Snapshot modified files to `.tracebox/snapshots/<session_id>/`
- [ ] Detect created/deleted/renamed files
- [ ] Detect package manager changes (package.json, package-lock.json, etc.)
- [ ] Detect lockfile changes
- [ ] Detect .env, credentials, SSH, cloud config touches
- [ ] Write `file_events` to ledger
- [ ] Tests: fixture repo with controlled changes

**Time estimate:** 4-6 days
**Dependencies:** Phase 1

---

## Phase 3: Integrate RippleGraph

**Goal:** Pre-action risk context. "Before the agent edits this file, what depends on it?"

### Integration Flow

```
Claude/Codex/Cursor edit hook
  ↓
TraceBox asks RippleGraph (via subprocess or IPC):
  - What depends on this file?
  - What tests cover this file?
  - What symbols are exported?
  - Is graph stale?
  - What risk level?
  ↓
Inject concise warning into agent context
  ↓
Also store warning in event ledger as impact_event
```

### Tasks

- [ ] Fix RippleGraph known bugs (resolver line 69, diff direction, context-pack)
- [ ] Add `doctor` and `verify` commands (currently missing)
- [ ] Create RippleGraph subprocess wrapper: `tracebox graph analyze <file>`
- [ ] Output JSON instead of human-readable string for machine parsing
- [ ] Add `packages/graph/` API: `getImpact(file)`, `getTests(file)`, `getRisk(file)`
- [ ] Hook into agent adapters: before edit, query graph, inject context
- [ ] Write `impact_events` to ledger
- [ ] Add staleness check: warn if graph is >N commits behind
- [ ] Tests: fixture repos with known impact graphs

**Event example:**
```json
{
  "type": "pre_edit_risk",
  "target_file": "src/auth/service.ts",
  "risk": "high",
  "affected_callers": ["src/api/login.ts", "src/auth/middleware.ts"],
  "recommended_tests": ["tests/auth/service.test.ts"]
}
```

**Time estimate:** 5-7 days
**Dependencies:** Phase 1, RippleGraph bug fixes

---

## Phase 4: Integrate TraceGate

**Goal:** Runtime tool-call enforcement. "This tool call is risky; allow/deny/ask."

### Integration Flow

```
Agent → MCP tool call
  ↓
TraceBox proxy (TraceGate code)
  ↓
Policy preset evaluation
  ↓
Decision: allow / deny / ask
  ↓
Log to ledger as tool_event
  ↓
If ask: prompt user on /dev/tty
  ↓
If approved: relay to MCP server
  ↓
Capture response, redact secrets, log result
```

### Tasks

- [ ] Port TraceGate proxy into `packages/policy/`
- [ ] Simplify UX: ship presets instead of raw YAML
  - `safe-default` preset (see ADR-004 in analysis doc)
  - `strict` preset
  - `permissive` preset
- [ ] Add `tracebox policy set <preset>` command
- [ ] Add `tracebox policy edit` for power users (opens YAML in $EDITOR)
- [ ] Integrate policy decisions into unified ledger
- [ ] Add risk classification from RippleGraph data (e.g., editing high-impact file = higher tool call risk)
- [ ] Tests: proxy E2E, policy matching, approval flow, redaction

**Time estimate:** 4-6 days
**Dependencies:** Phase 1

---

## Phase 5: Timeline UI

**Goal:** Human-readable session timeline. This is where the product feels real.

### Timeline Design

```
10:42:01  Session started: Claude Code
10:42:03  Read file: src/auth/service.ts
10:42:05  ⚠️ RippleGraph warning: HIGH risk, 6 callers, 2 tests
10:42:11  Edit file: src/auth/service.ts
10:42:18  Tool call: git diff
10:42:23  ⚠️ Tool call: npm install left-pad (package change)
10:42:30  Test recommendation: auth/service.test.ts not run
10:42:41  Session ended
```

Each event expands to:
- Raw JSON
- Redacted args
- File diff
- Risk reason
- Affected tests
- Rollback availability

### Tasks

- [ ] CLI timeline: `tracebox timeline <session_id>` (Rich/terminal-based)
- [ ] Web dashboard: `tracebox dashboard` (FastAPI + vanilla JS, reuse TraceGate dashboard)
- [ ] Event filtering: by risk, by type, by tool, by file
- [ ] Expandable event detail view
- [ ] Color coding: green=safe, yellow=warning, red=critical
- [ ] Tests: render fixture events, filter correctness

**Time estimate:** 5-7 days
**Dependencies:** Phase 1-4

---

## Phase 6: Rollback Engine

**Goal:** Undo what the agent did. This is the killer feature.

### Rollback Flow

```bash
$ tracebox rollback <session_id>

1. Show what will be reverted:
   - Modified files: 3
   - Created files: 2 (will be deleted)
   - Deleted files: 1 (will be restored from snapshot)
   - Package changes: npm install left-pad

2. ⚠️ Cannot safely rollback:
   - Network request to https://api.stripe.com/...
   - npm package may have run install scripts

3. Apply reverse patch for modified files
4. Delete created files
5. Restore deleted files from snapshot
6. Generate rollback_report.md
```

### Tasks

- [ ] Generate reverse git patch for modified files
- [ ] Restore deleted files from `.tracebox/snapshots/`
- [ ] Delete created files (with confirmation for non-empty dirs)
- [ ] Detect package manager changes and warn
- [ ] Detect irreversible external actions (network, DB, cloud)
- [ ] Create `rollback_steps` in ledger with status tracking
- [ ] Add `tracebox rollback --dry-run` to preview
- [ ] Add `tracebox rollback --force` to skip confirmation
- [ ] Generate rollback report (Markdown)
- [ ] Tests: fixture repo with controlled changes, verify rollback correctness

**Critical honesty:** Cannot safely rollback:
- Network requests
- Database commands
- npm install scripts
- Cloud resource changes
- Secrets already exposed

**Time estimate:** 5-7 days
**Dependencies:** Phase 2

---

## Phase 7: Agent Report Export

**Goal:** Source-grounded session receipts. TraceCanvas ideas applied to agent safety.

### Report Structure

```
tracebox-report/
  session.md              # Human-readable summary
  timeline.json           # Machine-readable events
  file-diffs/             # Per-file diff patches
  rollback.patch          # Combined reverse patch
  risk-summary.html       # Visual risk dashboard
  policy-decisions.csv    # All allow/deny/ask decisions
  recommended-tests.md    # Tests that should have run
```

### Report Sections

1. Session summary (agent, duration, files touched, risk score)
2. Files changed (with before/after hashes)
3. High-risk actions (with reasoning)
4. Secrets touched (with redaction)
5. Network destinations
6. Policy decisions (allow/deny/ask with rule IDs)
7. RippleGraph impact (affected callers, tests)
8. Tests recommended vs tests actually run
9. Rollback plan (reversible + irreversible)
10. Final trust score (0-100)

### Tasks

- [ ] Implement `tracebox export <session_id>` command
- [ ] Markdown export (default)
- [ ] HTML export (with CSS, reuse TraceCanvas verification styles)
- [ ] JSON export (for programmatic consumption)
- [ ] PDF export (future, via pandoc or weasyprint)
- [ ] Source-grounded verification: every claim has a `tb-src` annotation
- [ ] Tests: verify report completeness, source-key presence

**Time estimate:** 4-5 days
**Dependencies:** Phase 5-6

---

## Phase 8: OpenTelemetry Export

**Goal:** Feed into standard observability tools. Credibility move.

### OTel GenAI Conventions

- `gen_ai.system` — agent name (claude, codex, etc.)
- `gen_ai.request.model` — model identifier
- `gen_ai.usage.input_tokens` — prompt tokens
- `gen_ai.usage.output_tokens` — response tokens
- `gen_ai.tool.name` — tool call name
- `gen_ai.tool.call.id` — unique call ID
- `gen_ai.response.finish_reason` — stop/length/etc.

### Tasks

- [ ] Add `tracebox export-otel <session_id>` command
- [ ] Map session events to OTel spans
- [ ] Support OTLP/HTTP JSON export
- [ ] Configurable endpoint (default: localhost:4318)
- [ ] Content capture: off by default (sensitive), opt-in
- [ ] Tests: verify span structure, attribute correctness

**Time estimate:** 3-4 days
**Dependencies:** Phase 1

---

## MVP v0.1 Definition

**Theme:** "Show me what my agent did"

**Command:**
```bash
tracebox run -- codex
tracebox open
```

**Features:**
- [ ] Session creation and tracking
- [ ] Git before/after snapshot
- [ ] File diff timeline
- [ ] TraceGate MCP tool-call logging
- [ ] RippleGraph pre-edit risk events
- [ ] Recommended tests
- [ ] Markdown report export
- [ ] Rollback patch generation

**What it proves:** After an agent session, the user can see exactly what changed and start undoing it.

**Time to v0.1:** 4-6 weeks (Phases 0-5 + 7)

---

## MVP v0.2 Definition

**Theme:** "Stop obviously dangerous actions"

**Features:**
- [ ] Policy presets (safe-default, strict, permissive)
- [ ] Allow/deny/ask decisions with /dev/tty prompt
- [ ] Sensitive path blocklist (.env, .ssh, .aws)
- [ ] Destructive shell detection (rm -rf, sudo, curl|bash)
- [ ] Approval memory (rule + tool + fingerprint)
- [ ] DLP preview in approval prompt
- [ ] Network destination logging

**What it proves:** The product can prevent common agent accidents.

**Time to v0.2:** +2-3 weeks (Phase 4 enhancements)

---

## MVP v0.3 Definition

**Theme:** "Make it useful every day"

**Features:**
- [ ] VS Code/Cursor extension or local web UI
- [ ] PR comment generator ("This agent session changed X, risk Y")
- [ ] Test-run detection (did the agent run tests after editing?)
- [ ] Session compare (diff between two agent sessions)
- [ ] "Agent reliability score" per session
- [ ] Package install risk (npm install without lockfile change)
- [ ] Per-project policies (.tracebox/policy.yaml)

**What it proves:** Developers use it as part of their normal workflow.

**Time to v0.3:** +3-4 weeks

---

## MVP v0.4 Definition

**Theme:** "Become serious"

**Features:**
- [ ] Signed audit log (Ed25519 checkpoints)
- [ ] OTel export (Jaeger, Aspire, Langfuse integration)
- [ ] MCP Streamable HTTP transport support
- [ ] Monorepo support (cross-package resolution)
- [ ] Python/Rust/Go graph parsers
- [ ] Policy learning from history (suggest rules based on past sessions)
- [ ] Team mode (shared policy repo, team dashboard)

**What it proves:** Enterprise-ready features without losing the developer-friendly core.

**Time to v0.4:** +6-8 weeks

---

## What NOT to Build

| Feature | Why Not | When Maybe |
|---------|---------|------------|
| Compliance reports | Nerd furniture, not sticky | v0.4+ if enterprise asks |
| Cloud SaaS dashboard | Violates local-first positioning | Never (or separate product) |
| Full SIEM integration | Too enterprise, too early | v0.4+ |
| eBPF tracing | AgentSight already does this; we win on workflow | Never (different category) |
| Enterprise RBAC | Too early, kills indie adoption | v0.5+ |
| Generic LLM app observability | Langfuse/AgentOps own this | Never |
| Agent evaluation platform | Different product category | Never |
| TraceCanvas template marketplace | Not relevant to safety | Never |
| Visual node graph as main interface | Spaghetti, timeline is better | Maybe as secondary view |

---

## Success Metrics

### v0.1 Success
- [ ] Can record a Claude Code session and show file diff timeline
- [ ] Can generate rollback patch for >90% of file changes
- [ ] Can inject RippleGraph risk warning before file edit
- [ ] Can block `rm -rf /` via policy
- [ ] Demo completes in <60 seconds from install

### v0.2 Success
- [ ] >50% of dangerous tool calls blocked or asked
- [ ] No false positives on normal git/file operations
- [ ] Approval prompt works on macOS and Linux

### v0.3 Success
- [ ] Users run it on >50% of agent sessions
- [ ] PR comment generator used on real projects
- [ ] Positive feedback on "reliability score"

### v0.4 Success
- [ ] OTel export used by >10 teams
- [ ] Signed audit logs verified externally
- [ ] Multi-language graph support (Python + TS)

---

## Total Timeline Estimate

| Phase | Weeks | Cumulative |
|-------|-------|-----------|
| Phase 0: Scaffold | 0.5 | 0.5 |
| Phase 1: Ledger | 0.75 | 1.25 |
| Phase 2: Recorder | 1.0 | 2.25 |
| Phase 3: RippleGraph | 1.25 | 3.5 |
| Phase 4: TraceGate | 1.0 | 4.5 |
| Phase 5: Timeline UI | 1.25 | 5.75 |
| Phase 6: Rollback | 1.25 | 7.0 |
| Phase 7: Reports | 1.0 | 8.0 |
| Phase 8: OTel | 0.75 | 8.75 |
| Buffer/polish | 1.25 | 10.0 |

**MVP v0.1: ~6 weeks**
**MVP v0.2: ~8 weeks**
**MVP v0.3: ~12 weeks**
**MVP v0.4: ~18-20 weeks**

---

*End of Implementation Plan*
