# TraceBox v1.0: Final Audit & Action Plan

> Audit date: 2026-06-23
> Status: 85% code-complete, 0% integration-complete
> All existing tests pass (13/13). Graph dist not built.

---

## EXECUTIVE SUMMARY

TraceBox v0.2 has a **fully working Python core** — ledger, recorder, policy engine, rollback, report generator, timeline UI, OTel exporter, PR comment generator, MCP server, and FileWatcher. All 13 E2E/rollback-matrix tests pass. The TypeScript RippleGraph has 311 tests but its `dist/` and `node_modules/` are not built (no Bun/Node toolchain run). The `integrations/` directory is empty. The `pyproject.toml` is modified but not wired for `pip install`.

**Gap:** everything *inside* TraceBox works. Everything that connects TraceBox to the *outside world* is missing.

---

## CODEBASE AUDIT (FULL)

### ✅ Working — Python Core Modules

| Module | File | Lines | Tests | Status |
|--------|------|-------|-------|--------|
| Ledger | `packages/ledger/ledger.py` | 418 | E2E ✅ | Thread-safe SQLite with WAL, full event schema |
| Schema | `packages/ledger/schema.sql` | 127 | — | 6 tables, 3 views, indexes |
| Recorder | `packages/recorder/recorder.py` | 329 | E2E ✅ | Git-based change detection, hashing, snapshots |
| Watcher | `packages/recorder/watcher.py` | 197 | — | watchdog + polling fallback |
| Policy Engine | `packages/policy/policy_engine.py` | 299 | E2E ✅ | 3 presets: safe-default/strict/permissive |
| Rollback | `packages/rollback/rollback.py` | 329 | 9/9 ✅ | Full matrix: modify/create/delete/env/package/large file |
| Report Gen | `packages/report/report.py` | 256 | E2E ✅ | MD/HTML/JSON, limits, source-grounded |
| OTel Export | `packages/report/otel_export.py` | 223 | — | GenAI spans to OTLP JSON |
| PR Comment | `packages/report/pr_comment.py` | 196 | — | GitHub Markdown + clipboard |
| Timeline UI | `packages/replay/timeline.py` | 315 | — | CLI render + FastAPI web dashboard |
| Network Logger | `packages/core/network_logger.py` | 77 | — | URL/host/IP/DLP detection |
| Orchestrator | `packages/core/orchestrator.py` | 519 | — | Full session lifecycle |
| MCP Server | `packages/policy/mcp_server.py` | 243 | — | JSON-RPC 2.0 proxy |
| CLI | `apps/cli/tracebox.py` | 412 | — | 12 commands: init, run, open, timeline, rollback, export, pr-comment, policy, install, uninstall, serve, doctor |

### ⚠️ TypeScript RippleGraph (not built)

| File | Status |
|------|--------|
| `packages/graph/src/db.ts` | Source present |
| `packages/graph/src/scanner.ts` | Source present |
| `packages/graph/src/resolver.ts` | Source present (known bug at line 69) |
| `packages/graph/src/cli.ts` | Source present |
| `packages/graph/dist/` | **EMPTY** — not compiled |
| `packages/graph/node_modules/` | **EMPTY** — not installed |
| 311 tests in `packages/graph/test/` | Not runnable without build |

### ❌ Empty — Integrations

| Directory | Status |
|-----------|--------|
| `integrations/claude-code/` | Does not exist |
| `integrations/codex-cli/` | Does not exist |
| `integrations/cursor/` | Does not exist |
| `integrations/hermes-agent/` | Does not exist |
| `integrations/` root | Directory exists, 0 files |

### ❌ Missing — CI/CD & Packaging

| Item | Status |
|------|--------|
| `.github/workflows/ci.yml` | Does not exist |
| `pyproject.toml` entry points | Not wired for `pip install tracebox` |
| `setup.py` or `setup.cfg` | Does not exist |
| Version tracking | Hardcoded `0.1.0` in CLI, report, OTel, MCP server |

---

## GAP ANALYSIS: WHAT'S LEFT FOR 1.0

### BLOCKING (must ship)

#### 1. RippleGraph build + integration
- [ ] Run `cd packages/graph && npm install` (or `bun install`)
- [ ] Run `npm run build` (or `bun run tsc`) to populate `dist/`
- [ ] Verify `bun run dist/index.js analyze <file>` works on fixture project
- [ ] Fix known bugs in `packages/graph/src/resolver.ts:69`
- [ ] Fix `packages/graph/src/cli.ts` impact direction bug (lines 330-357)
- [ ] Add Python-side test that exercises `orch.on_file_edit()` with real graph
- **Effort:** 3-4 hours. Risk: Network (npm install). Mitigation: Bun + npmmirror.com.

#### 2. Agent hook integrations
- [ ] `integrations/claude-code/` — Claude Code hook that calls TraceBox MCP
- [ ] `integrations/codex-cli/` — Codex CLI hook
- [ ] `integrations/cursor/` — Cursor MCP config
- [ ] `integrations/hermes-agent/` — Hermes toolset integration
- [ ] Each integration: install script + uninstall script + README
- **Effort:** 4-6 hours. Risk: Testing requires actual agent installations (user to test manually).

#### 3. `pip install` package
- [ ] Add `[project.scripts]` to `pyproject.toml`: `tracebox = "apps.cli.tracebox:main"`
- [ ] Add proper `[project]` metadata (version, description, classifiers)
- [ ] Add all Python dependencies to `pyproject.toml`
- [ ] Bump version to `1.0.0` in all hardcoded strings (CLI, report, OTel, MCP, orchestrator)
- [ ] Test: `pip install -e .` then `tracebox --version`
- **Effort:** 1-2 hours.

#### 4. Test coverage for Python core
- [ ] Unit tests for `Ledger` (session CRUD, event emission, queries)
- [ ] Unit tests for `FileRecorder` (capture_before, detect_changes, hashing)
- [ ] Unit tests for `PolicyEngine` (all 3 presets, custom YAML loading, edge cases)
- [ ] Unit tests for `RollbackEngine` (already done via matrix, but add edge cases)
- [ ] Unit tests for `ReportGenerator` (MD/HTML/JSON output, limits)
- [ ] Test runner: `pytest` with coverage reporting
- [ ] Target: 80% coverage on `packages/`
- **Effort:** 4-5 hours.

### IMPORTANT (should ship)

#### 5. CI/CD pipeline
- [ ] `.github/workflows/ci.yml` — lint + test + build
- [ ] Python lint: `ruff` or `flake8`
- [ ] Test: `python3 tests/e2e/test_all.py` and `pytest`
- [ ] TypeScript: `npm test` for graph package (if Bun available)
- **Effort:** 1-2 hours.

#### 6. Documentation polish
- [ ] Update `README.md` — accurate v1.0 install/usage
- [ ] Update `CONTRIBUTING.md` — dev setup steps
- [ ] `CHANGELOG.md` — v0.1 → v1.0 changes
- [ ] `docs/` consistency check — remove stale docs
- **Effort:** 2 hours.

#### 7. Integrations filled with real scripts
- [ ] Each integration has: `install.sh`, `uninstall.sh`, `README.md`
- [ ] Install scripts modify agent config files (Claude Code, Codex, Cursor, Hermes)
- [ ] Uninstall scripts revert cleanly
- [ ] Test manually with each agent
- **Effort:** 3-4 hours (overlaps with #2).

### NICE TO HAVE (if time permits)

#### 8. Package restore in rollback
- [ ] Detect `npm install` / `pip install` / `cargo add` tool calls
- [ ] Generate `package.json.before` snapshot
- [ ] Rollback: restore `package.json` + run `npm install` to revert
- **Effort:** 2-3 hours.

#### 9. Streamable HTTP MCP support
- [ ] Implement SSE client in `packages/policy/src/tracegate/sse.py`
- [ ] Handle `text/event-stream` responses
- [ ] Test with Ollama MCP server or similar
- **Effort:** 3-4 hours.

#### 10. Benchmarking suite
- [ ] Session lifecycle time: create → 100 file changes → end
- [ ] Policy evaluation throughput: 1000 tool calls/second
- [ ] Rollback plan generation on large repos
- [ ] Report generation with 1000+ events
- **Effort:** 2-3 hours.

#### 11. VSCode extension skeleton
- [ ] Basic extension that shows TraceBox sidebar
- [ ] Session history view
- [ ] Trust score badge
- **Effort:** 5-8 hours (likely post-1.0).

---

## REVISED 1.0 ROADMAP

### Week 0: Build & Package (Day 1)
1. Build RippleGraph
2. Wire pyproject.toml for `pip install`
3. Bump version to 1.0.0 everywhere
4. Verify `tracebox --version` works after pip install

### Week 1: Integrations (Days 2-3)
5. Claude Code hook + install script
6. Codex CLI hook + install script
7. Cursor MCP config
8. Hermes Agent toolset/plugin
9. Integration test plan (user to run manually)

### Week 1-2: Tests (Days 4-6)
10. Unit tests for Ledger
11. Unit tests for Recorder/Watcher
12. Unit tests for Policy Engine
13. Unit tests for Rollback/Report
14. pytest + coverage config
15. CI workflow file

### Week 2: Polish (Day 7)
16. README/CHANGELOG/CONTRIBUTING
17. Docs cleanup
18. Final E2E test with real agent (user)
19. Tag v1.0.0

### Post-1.0 (Week 3+)
- Package restore (nice-to-have #8)
- Streamable HTTP (#9)
- Benchmarking (#10)
- VSCode extension (#11)

---

## RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| npm install fails (China VPN) | HIGH | Blocks RippleGraph | Use npmmirror.com mirror; Bun as fallback |
| Agent hooks untestable without agents installed | HIGH | Delays integration testing | User tests manually; we write scripts only |
| Graph known bugs cause false negatives | MEDIUM | Undermines trust score | Fix resolver.ts:69 + cli.ts:330-357 before ship |
| Policy defaults too strict for real use | LOW | User frustration | "permissive" preset as safety valve |
| Large file snapshots fill disk | LOW | Disk space | Already implemented: >10MB files skipped |

---

## DECISION REQUIRED

The user must decide on one issue:

**RippleGraph shipping strategy:**
- **Option A:** Bundle RippleGraph into v1.0 with built dist + npm install in setup. TraceBox won't start without it. 
- **Option B:** Keep RippleGraph as optional (`--with-graph` flag). Gracefully degrade (already implemented). Include build instructions in README.
- **RECOMMENDATION: Option B** — RippleGraph adds friction (Bun dependency, China VPN issues). Ship core TraceBox first, make graph opt-in.

---

*Audit complete. Plan ready for approval.*
