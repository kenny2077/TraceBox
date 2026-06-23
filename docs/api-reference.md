# TraceBox API Reference

> Python module APIs for TraceBox v0.1.

---

## Ledger (`packages/ledger/ledger.py`)

Core event store. All modules write to and read from this.

```python
from ledger import Ledger

ledger = Ledger(db_path=".tracebox/ledger.db")

# Sessions
session_id = ledger.create_session(agent_name="claude", repo_path="/path/to/repo")
session = ledger.get_session(session_id)
ledger.end_session(session_id, status="completed", commit_after="abc123", trust_score=85)
sessions = ledger.list_sessions(limit=10)

# Events
timeline = ledger.get_timeline(session_id)  # Ordered by sequence
file_events = ledger.get_events_by_type(session_id, "file_change")
tool_events = ledger.get_events_by_type(session_id, "tool_call")

# Emit
ledger.emit_file_event(session_id, "src/auth.ts", "modified")
ledger.emit_tool_event(session_id, "read_file", "allow", arguments_redacted='{}')
ledger.emit_impact_event(session_id, "src/auth.ts", [...], [...])

# Query
summary = ledger.get_session_summary(session_id)
```

## Policy Engine (`packages/policy/policy_engine.py`)

Tool-call policy evaluation with presets.

```python
from policy_engine import PolicyEngine

# Presets: safe-default, strict, permissive
engine = PolicyEngine("safe-default")

# Evaluate a tool call
result = engine.evaluate("execute_command", {"command": "rm -rf /tmp"})
# Returns: {"decision": "deny", "reason": "...", "rule_id": "block-destructive", "risk": "critical"}
```

## File Recorder (`packages/recorder/recorder.py`)

Git-native file change detection.

```python
from recorder import FileRecorder

recorder = FileRecorder(repo_path="/path/to/repo", session_id="sess_...", ledger=ledger)

# Before agent runs
changes_before = recorder.capture_before()  # Hashes all files, git status

# After agent runs
changes = recorder.detect_changes()  # Diff against before state
recorder.emit_changes(changes)  # Write to ledger
```

## File Watcher (`packages/recorder/watcher.py`)

Real-time file watching with watchdog + polling fallback.

```python
from watcher import FileWatcher

# With context manager
with FileWatcher(repo_path="/path/to/repo", session_id="sess_...", ledger=ledger) as watcher:
    # Watcher runs in background
    events = watcher.get_events()  # Get pending events
    
# Manual control
watcher = FileWatcher(...)
watcher.start(callback=lambda op, path: print(f"  {op}: {path}"))
# ... do work ...
watcher.stop()
```

## Rollback Engine (`packages/rollback/rollback.py`)

Undo agent session changes.

```python
from rollback import RollbackEngine

engine = RollbackEngine(repo_path="/path/to/repo", session_id="sess_...", ledger=ledger)

# Preview
plan = engine.generate_plan(dry_run=True)
# plan["steps"] → list of changes to revert
# plan["warnings"] → issues to be aware of
# plan["irreversible"] → things that can't be rolled back

# Execute
results = engine.execute_plan(plan, dry_run=False)
report_path = engine.generate_report(plan, results)
```

## Report Generator (`packages/report/report.py`)

Session reports in Markdown, HTML, or JSON.

```python
from report import ReportGenerator

gen = ReportGenerator(session_id="sess_...", ledger=ledger)

# Generate
md = gen.generate("markdown")
html = gen.generate("html")
js = gen.generate("json")

# Save to file
path = gen.save(output_dir=".tracebox/reports", format="markdown")
```

## OTel Exporter (`packages/report/otel_export.py`)

Export sessions as OpenTelemetry GenAI spans.

```python
from otel_export import OTelExporter

exporter = OTelExporter(session_id="sess_...", ledger=ledger)

spans = exporter.export_spans()  # List of OTel span dicts
otlp_json = exporter.to_otlp_json()  # OTLP/HTTP JSON payload
path = exporter.save(output_dir=".tracebox/otel")
```

## Timeline UI (`packages/replay/timeline.py`)

Session timeline rendering in terminal and web.

```python
from timeline import TimelineUI

ui = TimelineUI(session_id="sess_...", ledger=ledger)

# Terminal output
print(ui.render_cli())  # Full timeline with risk icons
print(ui.render_summary())  # Summary stats
print(ui.render_cli(filter_type="file_change", filter_risk="high"))  # Filtered

# Web dashboard (requires fastapi + uvicorn)
# ui.serve_dashboard(host="127.0.0.1", port=8080)
```

## Session Orchestrator (`packages/core/orchestrator.py`)

High-level session lifecycle manager. Wires all modules together.

```python
from orchestrator import SessionOrchestrator, run_agent_command

# Manual control
orch = SessionOrchestrator(repo_path="/path/to/repo", agent_name="claude", policy_preset="safe-default")

session_id = orch.start_session()
orch.on_tool_call("execute_command", {"command": "git status"})  # Returns decision
orch.on_file_edit("src/auth.ts")  # Returns impact analysis
summary = orch.end_session(status="completed")
report_path = orch.generate_report()

# One-shot: run agent through TraceBox
exit_code = run_agent_command(
    command=["claude", "-p", "fix the bug"],
    repo_path="/path/to/repo",
    agent_name="claude",
    policy_preset="safe-default"
)
```

## CLI (`apps/cli/tracebox.py`)

```bash
tracebox --version
tracebox init                          # Initialize TraceBox in current repo
tracebox run -- <command>              # Run command through TraceBox
tracebox open                          # Show recent sessions and timeline
tracebox timeline <session_id>         # Show session timeline
tracebox rollback <session_id>         # Show rollback plan
tracebox export <session_id>           # Export session report
tracebox policy list                   # List available presets
tracebox policy show --preset strict   # Show preset rules
```
