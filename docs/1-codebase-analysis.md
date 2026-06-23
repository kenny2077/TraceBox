# TraceBox: Deep Codebase Analysis

> Analysis of RippleGraph, TraceGate, agentSight, and Pipelock for strategic merge into TraceBox — a local black-box recorder for AI coding agents.
> Date: 2026-06-22
> Analyst: AI Product Strategist

---

## Table of Contents

1. [RippleGraph Analysis](#1-ripplegraph-analysis)
2. [TraceGate Analysis](#2-tracegate-analysis)
3. [AgentSight Competitive Analysis](#3-agentsight-competitive-analysis)
4. [Pipelock Competitive Analysis](#4-pipelock-competitive-analysis)
5. [Strategic Merge Assessment](#5-strategic-merge-assessment)
6. [Architecture Decision Record](#6-architecture-decision-record)
7. [Risk Register](#7-risk-register)

---

## 1. RippleGraph Analysis

### 1.1 What It Actually Is

RippleGraph is a **pre-action risk context engine** for TypeScript/JavaScript codebases. It builds a local SQLite knowledge graph and injects compact edit-risk briefings before Claude Code or Codex edits a file.

**Core value proposition:** "Before the agent edits this file, what depends on it?"

### 1.2 Architecture Strengths

| Component | Location | Quality | Reuse for TraceBox |
|-----------|----------|---------|-------------------|
| Tree-sitter parser | `src/parser.ts` | Solid | Direct reuse as `packages/graph/` |
| Import resolver | `src/resolver.ts` | Has bugs (line 69 dead logic) | Fix and reuse |
| Symbol extractor | `src/symbol.ts` | Good for TS/JS | Direct reuse, extend for Python/Go later |
| SQLite graph store | `src/db.ts` | Clean | **Core of shared ledger** |
| Hook adapters | `src/hooks/` | Claude + Codex | Extend for Cursor, Gemini |
| Risk scorer | `src/report.ts` | Deterministic, heuristic | Enhance with runtime data |
| Staleness detector | `src/index/staleness.ts` | Git + hash based | Reuse for incremental indexing |
| CLI framework | `src/cli.ts` | Commander-based | Merge into unified CLI |

### 1.3 Test Discipline

- **311 tests** across parser, resolver, hooks, impact direction, CLI, SQLite, end-to-end smoke tests
- Vitest-based with fixture projects in `test/fixtures/repos/`
- This is **not clown-car territory** — real test coverage exists

### 1.4 Known Bugs (from AGENTS.md)

1. **CLI packaging broken** — `package.json` bin points to `dist/cli.js`, but only `dist/index.js` invokes `runCli()`
2. **Resolver exact-path bug** — `src/resolver.ts:69` has dead logic `!existsSync(resolved).valueOf()` that breaks extension-less imports
3. **Diff impact direction inverted** — `src/cli.ts:330-357` traverses outgoing dependencies instead of incoming dependents
4. **Context-pack also uses outgoing edges** instead of dependents
5. **Missing `doctor`/`verify` commands** (claimed in README but not implemented)

### 1.5 Language Limitations

- TypeScript/JavaScript only
- Python/Go/Rust parsers planned for v0.4
- No LSP-based precise call resolution (planned v0.5)
- No monorepo support (planned v0.5)
- No class method call resolution across files

### 1.6 Reuse Verdict

**Reuse: HIGH** — The graph engine, SQLite schema, hook adapters, and staleness detection are all directly reusable. The TS/JS limitation is acceptable for MVP targeting Claude Code/Codex/TypeScript devs.

---

## 2. TraceGate Analysis

### 2.1 What It Actually Is

TraceGate is a **runtime policy and action recorder**. It sits between an AI coding agent and MCP servers, evaluates every `tools/call` request against YAML policy, supports allow/deny/ask decisions, redacts secrets, logs JSONL + SQLite audit events, and has session replay/dashboard commands.

**Core value proposition:** "What tool call is the agent trying to make, should I allow it, and what happened?"

### 2.2 Architecture Strengths

| Component | Location | Quality | Reuse for TraceBox |
|-----------|----------|---------|-------------------|
| stdio proxy | `src/tracegate/proxy.py` | Solid subprocess relay | **Core runtime sensor** |
| Policy engine | `src/tracegate/policy.py` | YAML rule engine, first-match | Reuse with simplified presets |
| Risk classifier | `src/tracegate/risk.py` | Heuristic patterns | Enhance with RippleGraph data |
| DLP redaction | `src/tracegate/dlp.py` | Best-effort secret scrubbing | Reuse for secret_events |
| Approval prompt | `src/tracegate/approval.py` | /dev/tty HITL | Reuse, add Windows support later |
| Audit logger | `src/tracegate/audit.py` | JSONL + SQLite | **Core of shared ledger** |
| SQLite store | `src/tracegate/store.py` | Dashboard queries | Merge into unified schema |
| MCP models | `src/tracegate/mcp.py` | JSON-RPC 2.0 Pydantic | Reuse for protocol handling |
| Installer | `src/tracegate/installer.py` | Claude/Cursor config injection | Extend for all agents |
| Replay engine | `src/tracegate/replay.py` | Rich terminal rendering | Reuse for timeline CLI |
| Dashboard | `src/tracegate/dashboard/` | FastAPI + Chart.js | Reuse as web UI layer |

### 2.3 Honest Limitations (from README)

- **Not a sandbox** — userspace proxy, not kernel isolation
- **Cannot stop traffic that bypasses TraceGate** — agent can connect directly to MCP servers
- **Cannot erase secrets already in model context** — redaction is post-facto
- **Cannot prevent bad human approvals** — social engineering still works
- **Mutable local logs** — SQLite/JSONL can be modified by processes with shell access
- **No current MCP Streamable HTTP support** — only stdio and legacy HTTP+SSE
- **Windows approval prompts fail** — /dev/tty is Unix-specific, `ask` becomes `deny`

### 2.4 Test Discipline

- Tests cover: proxy E2E, policy, risk, DLP, audit, store, SSE, dashboard, installer, CLI, replay, security regressions
- This is **real test coverage** for a security tool

### 2.5 Reuse Verdict

**Reuse: HIGH** — The proxy, policy engine, audit logger, and dashboard are all directly reusable. The "not a sandbox" limitation is honest and acceptable for the product positioning. The missing Streamable HTTP support is a roadmap item, not a blocker.

---

## 3. AgentSight Competitive Analysis

### 3.1 What It Is

AgentSight is an **eBPF-based system-level observability framework** for AI agents. It records processes, child processes, shell commands, cwd, argv, file creates/writes/truncates/renames/deletes, network destinations, prompts, responses, tool intent, model, and token data.

**Key claim:** "No SDK, no proxy, no vendor integration. Works even when the agent is a closed-source CLI."

### 3.2 Technical Architecture

```
eBPF Programs (kernel) → JSON stdout → Rust Runners → Analyzer Chain → Output/Frontend/Files
```

- **eBPF C programs** in `bpf/` — SSL_read/SSL_write hooks via uprobes, process lifecycle via tracepoints, stdio capture
- **Rust collector** in `collector/src/` — streaming pipeline with runners, analyzers, sources, views, sinks
- **Frontend** in `frontend/` — Next.js/React visualization with timeline, process tree, log views
- **OpenTelemetry export** — `gen_ai.*` spans via OTLP/HTTP JSON

### 3.3 Why It's Dangerous to TraceBox

| AgentSight Capability | TraceBox Counter-Position |
|----------------------|---------------------------|
| System-level eBPF tracing | Developer-friendly safety/undo layer |
| Observes what happened | **Predicts what will break before edit** (RippleGraph) |
| Closed-source CLI support | Cross-agent local coding workflow |
| Kernel-level SSL interception | Repo-aware semantic impact |
| Linux-only (eBPF) | Cross-platform (macOS + Linux initially) |
| Harder for normal devs | Simple install, timeline, rollback, PR comment |

### 3.4 Why TraceBox Can Beat It

AgentSight is a **profiler**. TraceBox is a **safety net**.

- AgentSight tells you "the agent ran rm -rf /tmp"
- TraceBox tells you "the agent is about to edit src/auth/service.ts which breaks 6 callers, and here's how to undo it"

**The wedge:** Semantic code risk + rollback + developer workflow integration.

### 3.5 Competitive Verdict

**Threat Level: HIGH** — AgentSight proves the pain is real and has technical credibility. But it's system-level and Linux-only. TraceBox wins by being coding-agent-native, cross-platform, and focused on undo/safety rather than pure observation.

---

## 4. Pipelock Competitive Analysis

### 4.1 What It Is

Pipelock is an **open-source AI agent firewall** with 728+ GitHub stars. It positions itself as a security gateway for mediated HTTP, WebSocket, CONNECT, MCP, and A2A traffic.

**Key features:**
- 11-layer URL scanner (scheme, CRLF, path traversal, blocklist, DLP, SSRF, rate limit, URL length, data budget)
- 65 credential patterns + 29 injection patterns with 6-pass normalization
- Process sandbox (Landlock LSM, seccomp, network namespaces)
- Bidirectional MCP scanning
- Ed25519-signed action receipts
- Kill switch with 4 activation sources
- Security assessment tool (`pipelock assess`)

### 4.2 Why It's Dangerous to TraceGate Alone

If TraceGate remains "MCP firewall with YAML policies," it **will lose** to Pipelock.

Pipelock has:
- Enterprise features (OPA/Rego, signed audit chains, compliance reports)
- 11-layer scanning vs TraceGate's heuristic risk classifier
- Process sandboxing (kernel-level containment)
- 728+ stars and CNCF Landscape recognition
- SLSA provenance + SBOM
- OpenSSF Scorecard + Best Practices silver badge

### 4.3 Why TraceBox Can Beat It

Pipelock is a **network security gateway**. TraceBox is a **developer safety recorder**.

| Pipelock | TraceBox |
|----------|----------|
| Network egress control | Repo impact + undo |
| Enterprise security | Developer workflow |
| 11-layer URL scanner | Semantic code graph |
| Signed receipts | Rollback patches |
| Kill switch | Test recommendations |
| Compliance reports | PR-ready audit reports |

**The wedge:** Pipelock stops bad traffic. TraceBox stops bad edits and lets you undo them.

### 4.4 Competitive Verdict

**Threat Level: CRITICAL for TraceGate standalone, LOW for TraceBox** — Pipelock crushes "MCP firewall" as a category. But TraceBox is not competing in that category. It's competing in "local coding agent safety/undo," which Pipelock does not address.

---

## 5. Strategic Merge Assessment

### 5.1 Merge Scorecard

| Direction | Score | Rationale |
|-----------|-------|-----------|
| **TraceBox: agent black-box recorder** | **9/10** | Combines pre-action risk + runtime enforcement + audit + rollback + receipt UI. Real fear, real workflow. |
| RippleGraph standalone | 7/10 | Useful but too narrow. TS/JS only. No runtime awareness. |
| TraceGate standalone firewall | 6/10 | Loses to Pipelock. "MCP firewall" is a crowded category. |
| TraceCanvas standalone reports | 6/10 | Nice but separate job. Source-grounded reports != agent safety. |
| All-in-one mega-suite | 4/10 | Confused positioning. "Two tools in one CLI" = wrapper slop. |

### 5.2 What Survives, What Dies, What's Born

| Source Repo | Component | Fate in TraceBox | Rationale |
|-------------|-----------|-----------------|-----------|
| RippleGraph | Tree-sitter parser | **Reused** | Core of `packages/graph/` |
| RippleGraph | SQLite graph store | **Merged into ledger** | Unified schema with events |
| RippleGraph | Hook adapters | **Extended** | Add Cursor, Gemini, generic MCP |
| RippleGraph | Risk scorer | **Enhanced** | Add runtime tool-call data |
| RippleGraph | Staleness detector | **Reused** | Incremental indexing |
| RippleGraph | TS/JS limitation | **Accepted for MVP** | Target Claude Code/Codex devs first |
| TraceGate | stdio proxy | **Reused** | Core runtime sensor |
| TraceGate | Policy engine | **Simplified** | Ship presets, not raw YAML |
| TraceGate | Risk classifier | **Enhanced** | Add RippleGraph impact data |
| TraceGate | DLP redaction | **Reused** | Secret detection in events |
| TraceGate | Audit logger | **Merged into ledger** | Unified SQLite schema |
| TraceGate | Dashboard | **Reused** | Web UI for timeline |
| TraceGate | Replay engine | **Reused** | CLI timeline rendering |
| TraceGate | MCP models | **Reused** | JSON-RPC handling |
| TraceCanvas | Source-grounded verification | **Reused** | Receipt/report generation |
| TraceCanvas | HTML report export | **Reused** | Session receipt UI |
| TraceCanvas | CSV/XLSX/JSON parsing | **Dies** | Not relevant to agent safety |
| TraceCanvas | PNG/PDF/PPTX export | **Reused** | Report export formats |
| **New** | File/git recorder | **Born** | Watch file changes, hash before/after |
| **New** | Rollback engine | **Born** | Reverse patches, restore snapshots |
| **New** | Event ledger schema | **Born** | Unified SQLite for all events |
| **New** | OTel export | **Born** | Feed Aspire/Jaeger/Langfuse |

### 5.3 The Real Product Thesis

> **AI agents are getting powerful enough to change your machine, but not trustworthy enough to leave unsupervised.**

Cloud observability (Langfuse, AgentOps) tells app teams what their LLM app did.
**TraceBox tells local developers what an AI coding agent did to their actual machine and repo.**

That is not wrapper slop. That is a real workflow-shaped fear.

---

## 6. Architecture Decision Record

### ADR-001: Product Name

**Decision:** TraceBox

**Alternatives considered:**
- AgentFlight — strong metaphor, maybe too cute
- TraceDeck — less memorable
- RippleGate — sounds merged, not broad enough
- AgentLedger — enterprise-ish, boring

**Rationale:** Simple, memorable, black-box recorder vibe. Matches the "box" metaphor of flight recorders.

### ADR-002: Unified Event Ledger

**Decision:** Single SQLite schema as the unifying layer, not language purity.

**Schema:**

```sql
-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at DATETIME,
  ended_at DATETIME,
  agent_name TEXT,
  repo_path TEXT,
  branch TEXT,
  commit_before TEXT,
  commit_after TEXT,
  status TEXT
);

-- Generic events
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  ts DATETIME,
  sequence INTEGER,
  type TEXT,  -- 'pre_edit_risk', 'tool_call', 'file_change', 'secret_detected', etc.
  source TEXT,
  risk_level TEXT,
  summary TEXT,
  raw_json TEXT
);

-- File changes
CREATE TABLE file_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  path TEXT,
  operation TEXT,  -- 'modified', 'created', 'deleted', 'renamed'
  before_hash TEXT,
  after_hash TEXT,
  diff_patch TEXT,
  snapshot_path TEXT
);

-- Tool calls
CREATE TABLE tool_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  tool_name TEXT,
  arguments_redacted TEXT,
  decision TEXT,  -- 'allow', 'deny', 'ask'
  rule_id TEXT,
  result_preview TEXT,
  duration_ms INTEGER
);

-- Code impact
CREATE TABLE impact_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  target_file TEXT,
  affected_files_json TEXT,
  affected_tests_json TEXT,
  risk_factors_json TEXT
);

-- Secret detection
CREATE TABLE secret_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  secret_type TEXT,
  path TEXT,
  redacted_preview TEXT,
  severity TEXT
);

-- Rollback steps
CREATE TABLE rollback_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  step_type TEXT,
  command TEXT,
  patch_path TEXT,
  status TEXT,
  reversible INTEGER
);
```

**Rationale:** Everything writes to this. RippleGraph writes `impact_events`. TraceGate writes `tool_events`. The new recorder writes `file_events`. DLP writes `secret_events`. This is the integration point.

### ADR-003: Language Strategy

**Decision:** Keep RippleGraph TypeScript/Bun and TraceGate Python as subprocess modules at first. The unifying layer is the event schema, not language purity.

**Rationale:**
- Rewriting everything into one language burns months with no user value
- The event ledger schema is the real integration point
- Subprocess communication via JSON or SQLite is sufficient for MVP
- Future v0.4+ can unify languages if needed

### ADR-004: Policy UX

**Decision:** Ship policy presets, not raw YAML editing.

**Default preset (`safe-default`):**
- Ask before shell commands
- Deny destructive rm/sudo/curl|bash
- Deny .env/.ssh/.aws/.kube reads
- Ask before network fetch
- Allow git status/diff/log
- Allow project file reads
- Rate-limit repeated reads

**Rationale:** Normal users should not write YAML. Power users can edit later. The first-run experience must be 60 seconds to aha moment.

### ADR-005: Rollback Honesty

**Decision:** Explicitly list what CANNOT be rolled back.

**Cannot safely rollback:**
- Network requests to external APIs
- Database commands
- npm package install scripts that already ran
- Cloud resource changes
- Secrets that were already exposed

**Rationale:** Honesty is a feature. False confidence in rollback is worse than no rollback.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pipelock adds repo-aware features | Medium | High | Move fast on MVP, establish "undo" as the brand |
| AgentSight adds rollback/semantic analysis | Low | High | They are system-level; semantic analysis is hard |
| Langfuse/AgentOps add local coding agent mode | Medium | Medium | They are cloud-first; local-first is our wedge |
| Cursor/Claude add native undo/impact analysis | High | High | Be cross-agent, not vendor-locked |
| TS/JS-only limits market | Medium | Medium | Accept for MVP; Python/Go/Rust in v0.4 |
| Windows support gaps (TraceGate approval, file watching) | Medium | Medium | Ship macOS/Linux first; Windows in v0.3 |
| MCP Streamable HTTP not supported | Medium | Low | Legacy SSE works for most agents today |
| Rollback complexity (package installs, generated files) | High | Medium | MVP: git patch reverse + file snapshots |
| Test maintenance burden across merged repos | Medium | Medium | Keep test suites separate initially, integrate gradually |
| User confusion: "Is this RippleGraph + TraceGate + TraceCanvas?" | High | High | Clear branding: TraceBox is the product. Others are modules. |

---

*End of Analysis*
test change
