# TraceBox: Improvement Plan v0.2

> Based on gap analysis of current v0.1 implementation. 11 unfinished items identified.
> Date: 2026-06-22

---

## Summary of Gaps Found

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | TraceGate proxy imports broken (`from tracegate` package doesn't exist) | **CRITICAL** | Policy enforcement can't run |
| 2 | Policy engine doesn't write to unified ledger | **HIGH** | No audit trail of decisions |
| 3 | File recorder uses polling only (no watchdog) | **MEDIUM** | May miss rapid file changes |
| 4 | No E2E tests | **HIGH** | Can't verify system works end-to-end |
| 5 | No test fixtures | **HIGH** | No controlled test environments |
| 6 | RippleGraph not built (deps not installed) | **HIGH** | Graph analysis unavailable |
| 7 | No Python package setup (pyproject.toml) | **MEDIUM** | Can't pip install TraceBox |
| 8 | TraceGate tests import broken package | **MEDIUM** | Test suite won't run |
| 9 | Report JSON is 2.8MB (unbounded) | **LOW** | Performance issue at scale |
| 10 | No orchestration layer connecting modules | **HIGH** | Modules work in isolation only |
| 11 | CLI doesn't integrate policy into agent flow | **HIGH** | `tracebox run -- claude` doesn't actually enforce policy |

---

## Improvement Plan

### Phase A: Fix Broken Imports (Critical)

**Goal:** Make TraceGate code runnable in the new monorepo structure.

**Problem:** All TraceGate code imports from `tracegate.*` package, but we moved it to `packages/policy/src/` without the package structure.

**Solution:** Create a proper Python package structure.

```
packages/policy/
  pyproject.toml          # Update to new package name
  src/
    tracegate/            # Keep original package name for compatibility
      __init__.py
      proxy.py
      policy.py
      audit.py
      ...
    tracebox_policy/       # New unified policy layer
      __init__.py
      policy_engine.py     # Move our new policy_engine.py here
      integration.py       # Bridge between tracegate and ledger
```

**Tasks:**
- [ ] Restructure `packages/policy/src/` to keep `tracegate/` as a subpackage
- [ ] Fix all `from tracegate.` imports to work with new path
- [ ] Update `pyproject.toml` to include both `tracegate` and `tracebox_policy` packages
- [ ] Verify proxy.py can be imported without errors
- [ ] Run original TraceGate tests to ensure they still pass

**Time:** 1-2 days

---

### Phase B: Build Orchestration Layer (High)

**Goal:** Create a `SessionOrchestrator` that connects all modules into a coherent workflow.

**Current state:** Each module works in isolation. User must manually:
1. Call ledger to create session
2. Call recorder to capture before state
3. Call policy engine to evaluate each tool call
4. Call recorder to capture after state
5. Call ledger to emit events
6. Call report generator to create report

**Target state:** Single `SessionOrchestrator` handles the entire lifecycle.

```python
class SessionOrchestrator:
    def __init__(self, repo_path, agent_name, policy_preset="safe-default"):
        self.ledger = Ledger()
        self.recorder = FileRecorder(repo_path)
        self.policy = PolicyEngine(policy_preset)
        self.rollback = RollbackEngine(repo_path)
        
    def start_session(self):
        self.session_id = self.ledger.create_session(agent_name, repo_path)
        self.recorder.capture_before()
        
    def on_tool_call(self, tool_name, arguments):
        # 1. Evaluate policy
        decision = self.policy.evaluate(tool_name, arguments)
        
        # 2. Log to ledger
        self.ledger.emit_tool_event(self.session_id, tool_name, decision["decision"])
        
        # 3. Return decision to caller
        return decision
        
    def on_file_edit(self, file_path):
        # 1. Query RippleGraph for impact
        impact = self._query_graph(file_path)
        
        # 2. Log to ledger
        self.ledger.emit_impact_event(self.session_id, file_path, ...)
        
        # 3. Return risk warning
        return impact
        
    def end_session(self):
        changes = self.recorder.detect_changes()
        self.recorder.emit_changes(changes)
        self.ledger.end_session(self.session_id)
        
    def generate_report(self):
        return ReportGenerator(self.session_id, self.ledger).save()
        
    def rollback(self, dry_run=True):
        plan = self.rollback.generate_plan()
        return self.rollback.execute_plan(plan, dry_run)
```

**Tasks:**
- [ ] Create `packages/core/orchestrator.py`
- [ ] Implement `SessionOrchestrator` class
- [ ] Wire policy decisions into ledger automatically
- [ ] Wire file changes into ledger automatically
- [ ] Update CLI to use orchestrator instead of manual module calls
- [ ] Add `tracebox run -- claude` to actually start orchestrator, run agent, end session

**Time:** 2-3 days

---

### Phase C: Fix RippleGraph Build (High)

**Goal:** Make RippleGraph actually buildable and runnable.

**Problem:** `bun install` timed out (likely due to slow network/VPN in China). No `node_modules/`, no `dist/`.

**Solution:** Use npm with Chinese mirror or pre-install dependencies.

**Tasks:**
- [ ] Create `.npmrc` with `registry=https://registry.npmmirror.com` for China
- [ ] Add `package-lock.json` if it exists, or generate one
- [ ] Try `npm install` instead of `bun install` (more reliable behind VPN)
- [ ] Build with `npx tsc` or `npm run build`
- [ ] Verify `dist/cli.js` exists and can run `analyze` command
- [ ] Test with fixture repo: `node dist/cli.js analyze src/auth.ts --project test/fixtures/simple-project`

**Time:** 1 day

---

### Phase D: Add Real File Watching (Medium)

**Goal:** Replace polling with `watchdog` for reliable file change detection.

**Current:** `time.sleep(2)` polling loop

**Target:** `watchdog.Observer` with event handlers

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class TraceBoxEventHandler(FileSystemEventHandler):
    def __init__(self, session_id, ledger):
        self.session_id = session_id
        self.ledger = ledger
        
    def on_modified(self, event):
        if not event.is_directory:
            self.ledger.emit_file_event(self.session_id, event.src_path, "modified")
            
    def on_created(self, event):
        if not event.is_directory:
            self.ledger.emit_file_event(self.session_id, event.src_path, "created")
```

**Tasks:**
- [ ] Add `watchdog` to dependencies
- [ ] Implement `watchdog`-based watcher in `FileRecorder`
- [ ] Keep polling as fallback for systems without watchdog
- [ ] Test with rapid file changes (100 files in 1 second)

**Time:** 1 day

---

### Phase E: Write E2E Tests and Fixtures (High)

**Goal:** Prove the system works end-to-end.

**Fixture repo structure:**
```
tests/fixtures/simple-ts-project/
  src/
    auth.ts
    api.ts
    utils.ts
  tests/
    auth.test.ts
  package.json
  tsconfig.json
```

**E2E test scenarios:**
1. `test_session_lifecycle.py`: init → run → detect changes → generate report
2. `test_policy_blocks.py`: attempt destructive command → verify blocked → verify ledger entry
3. `test_rollback.py`: make changes → rollback → verify files restored
4. `test_graph_integration.py`: edit file → verify impact analysis in ledger

**Tasks:**
- [ ] Create `tests/fixtures/simple-ts-project/` with known dependency graph
- [ ] Write `tests/e2e/test_session_lifecycle.py`
- [ ] Write `tests/e2e/test_policy_blocks.py`
- [ ] Write `tests/e2e/test_rollback.py`
- [ ] Write `tests/e2e/test_report_generation.py`
- [ ] Add pytest configuration and CI script

**Time:** 2-3 days

---

### Phase F: Python Package Setup (Medium)

**Goal:** Make TraceBox installable via `pip`.

**Root `pyproject.toml`:**
```toml
[project]
name = "tracebox"
version = "0.1.0"
description = "Local black-box recorder for AI coding agents"
requires-python = ">=3.11"
dependencies = [
    "watchdog>=3.0",
    "fastapi>=0.100",
    "uvicorn>=0.23",
    # tracegate deps from packages/policy/pyproject.toml
]

[project.scripts]
tracebox = "tracebox.cli:main"

[tool.setuptools.packages.find]
where = ["packages"]
```

**Tasks:**
- [ ] Create root `pyproject.toml`
- [ ] Add `__init__.py` to all packages to make them proper Python modules
- [ ] Create `packages/tracebox/` as main package with CLI entry point
- [ ] Test `pip install -e .` works
- [ ] Verify `tracebox --version` works after install

**Time:** 1 day

---

### Phase G: Report Pagination and Limits (Low)

**Goal:** Fix 2.8MB JSON reports.

**Solution:** Add limits and summarization.

```python
class ReportGenerator:
    MAX_EVENTS = 1000
    MAX_FILE_CHANGES = 100
    MAX_TIMELINE_EVENTS = 500
    
    def generate(self, format="markdown"):
        # ... get events with limits
        timeline = self.ledger.get_timeline(self.session_id)[:self.MAX_TIMELINE_EVENTS]
        file_changes = self.ledger.get_events_by_type(self.session_id, "file_change")[:self.MAX_FILE_CHANGES]
        # ... rest of generation
```

**Tasks:**
- [ ] Add limits to report generator
- [ ] Add summary statistics instead of full event lists for large sessions
- [ ] Add `--full` flag to override limits when needed
- [ ] Test with 3000+ event session

**Time:** 0.5 day

---

### Phase H: Update Documentation (Medium)

**Goal:** Docs should match actual implementation.

**Current gaps:**
- Architecture doc doesn't mention `ledger.py`, `orchestrator.py`
- No mention of how modules actually connect
- No API reference for the Python modules

**Tasks:**
- [ ] Update `docs/4-architecture.md` with actual file paths and module names
- [ ] Add `docs/api-reference.md` with Python module APIs
- [ ] Add `docs/development.md` with build instructions
- [ ] Add `docs/testing.md` with how to run tests
- [ ] Update README with actual install/run instructions

**Time:** 1 day

---

## Total Timeline

| Phase | Time | Priority |
|-------|------|----------|
| A: Fix imports | 1-2 days | P0 |
| B: Orchestration | 2-3 days | P0 |
| C: RippleGraph build | 1 day | P0 |
| D: File watching | 1 day | P1 |
| E: E2E tests | 2-3 days | P0 |
| F: Python package | 1 day | P1 |
| G: Report limits | 0.5 day | P2 |
| H: Docs update | 1 day | P1 |
| **Total** | **~10 days** | |

---

## Success Criteria for v0.2

- [ ] `tracebox init` works in any git repo
- [ ] `tracebox run -- echo "hello"` creates session, records changes, ends session
- [ ] `tracebox timeline <session>` shows events with risk levels
- [ ] `tracebox rollback <session> --dry-run` shows plan without errors
- [ ] `tracebox export <session>` generates <100KB report
- [ ] Policy blocks `rm -rf /` and logs to ledger
- [ ] RippleGraph `analyze` command returns JSON for TS files
- [ ] All E2E tests pass
- [ ] `pip install -e .` works

---

*End of Improvement Plan*
