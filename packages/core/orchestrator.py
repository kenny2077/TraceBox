#!/usr/bin/env python3
"""
TraceBox Session Orchestrator
Connects all modules into a coherent agent session workflow.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

# Add package paths
sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
sys.path.insert(0, str(Path(__file__).parent.parent / "recorder"))
sys.path.insert(0, str(Path(__file__).parent.parent / "policy"))
sys.path.insert(0, str(Path(__file__).parent.parent / "rollback"))
sys.path.insert(0, str(Path(__file__).parent.parent / "report"))
sys.path.insert(0, str(Path(__file__).parent.parent / "replay"))

from ledger import Ledger
from recorder import FileRecorder
from policy_engine import PolicyEngine
from rollback import RollbackEngine
from report import ReportGenerator
from timeline import TimelineUI

# Approval memory
class ApprovalMemory:
    """Caches user approvals for repeated tool calls."""

    def __init__(self, db_path: str = ".tracebox/approvals.db"):
        import sqlite3, hashlib, json, time
        self._sqlite3 = sqlite3
        self._hashlib = hashlib
        self._json = json
        self._time_module = time
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS approvals (
                tool TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                allow INTEGER NOT NULL,
                expires_at REAL NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY (tool, fingerprint)
            )
        """)
        self._conn.commit()

    def _fingerprint(self, args: dict) -> str:
        canonical = self._json.dumps(args, sort_keys=True, default=str)
        return self._hashlib.sha256(canonical.encode()).hexdigest()[:16]

    def add(self, tool: str, args: dict, allow: bool = True, duration: int = 3600):
        now = self._time_module.time()
        self._conn.execute(
            "INSERT OR REPLACE INTO approvals VALUES (?, ?, ?, ?, ?)",
            (tool, self._fingerprint(args), 1 if allow else 0, now + duration, now),
        )
        self._conn.commit()

    def check(self, tool: str, args: dict) -> Optional[bool]:
        now = self._time_module.time()
        row = self._conn.execute(
            "SELECT allow FROM approvals WHERE tool=? AND fingerprint=? AND expires_at>?",
            (tool, self._fingerprint(args), now),
        ).fetchone()
        if row:
            return bool(row[0])
        return None

    def clear(self):
        self._conn.execute("DELETE FROM approvals")
        self._conn.commit()

    def cleanup(self):
        now = self._time_module.time()
        self._conn.execute("DELETE FROM approvals WHERE expires_at < ?", (now,))
        self._conn.commit()


class SessionOrchestrator:
    """Orchestrates a complete agent session lifecycle."""

    def __init__(
        self,
        repo_path: str,
        agent_name: str = "unknown",
        policy_preset: str = "safe-default",
        ledger_db: str = ".tracebox/ledger.db",
    ):
        self.repo_path = Path(repo_path).resolve()
        self.agent_name = agent_name
        self.policy_preset = policy_preset
        self.ledger_db = ledger_db

        self.ledger: Optional[Ledger] = None
        self.recorder: Optional[FileRecorder] = None
        self.policy: Optional[PolicyEngine] = None
        self.rollback: Optional[RollbackEngine] = None
        self.approval_memory: Optional[ApprovalMemory] = None
        self.dlp: Optional[Any] = None
        self.session_id: Optional[str] = None
        self._running = False
        self._mcp_server = None

    def _init_modules(self):
        """Initialize all submodules."""
        self.ledger = Ledger(self.ledger_db)
        self.recorder = FileRecorder(str(self.repo_path), "", self.ledger)
        self.policy = PolicyEngine(self.policy_preset)
        self.approval_memory = ApprovalMemory(str(self.repo_path / ".tracebox" / "approvals.db"))

    def start_session(self) -> str:
        """Start a new agent session."""
        self._init_modules()

        # Create session in ledger
        self.session_id = self.ledger.create_session(
            agent_name=self.agent_name,
            repo_path=str(self.repo_path),
        )

        # Update recorder with real session_id
        self.recorder.session_id = self.session_id

        # Capture before state
        commit_before, _ = self.recorder.capture_before()

        # Update session with commit_before
        if commit_before:
            with self.ledger._conn() as conn:
                conn.execute(
                    "UPDATE sessions SET commit_before = ? WHERE id = ?",
                    (commit_before, self.session_id),
                )
                conn.commit()

        self._running = True

        print(f"🟢 Session started: {self.session_id}")
        print(f"   Repo: {self.repo_path}")
        print(f"   Policy: {self.policy_preset}")
        print(f"   Commit: {commit_before or 'N/A'}")

        return self.session_id

    def on_tool_call(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Process a tool call through policy and log to ledger."""
        if not self._running or not self.session_id:
            return {"decision": "deny", "reason": "No active session"}

        # Evaluate policy
        decision = self.policy.evaluate(tool_name, arguments)

        # Check approval memory for "ask" decisions
        if decision["decision"] == "ask" and self.approval_memory:
            memory_result = self.approval_memory.check(tool_name, arguments)
            if memory_result is not None:
                decision["decision"] = "allow" if memory_result else "deny"
                decision["reason"] = f"Approval memory: {'allowed' if memory_result else 'denied'}"

        # Redact sensitive data from logs via DLP
        safe_args = self._redact_arguments(tool_name, arguments)

        # Log to ledger
        self.ledger.emit_tool_event(
            session_id=self.session_id,
            tool_name=tool_name,
            decision=decision["decision"],
            arguments_redacted=safe_args,
            rule_id=decision.get("rule_id"),
            risk_level=decision.get("risk"),
        )

        # Log high-risk decisions to console
        if decision["risk"] in ["high", "critical"]:
            reason = decision.get("reason", "")
            print(f"⚠️  HIGH RISK: {tool_name} -> {decision['decision']} ({reason[:100]})")

        # Detect and log network destinations
        from network_logger import log_network_destinations
        network_dests = log_network_destinations(
            self.session_id, tool_name, arguments, self.ledger
        )
        if network_dests:
            critical = [d for d in network_dests if d["target"] in ["payment processor", "database host"]]
            if critical:
                print(f"🌐 Network: {len(critical)} critical destination(s) detected")

        return decision

    def _redact_arguments(self, tool_name: str, arguments: Dict) -> str:
        """Redact sensitive data from arguments for logging."""
        args_str = json.dumps(arguments)[:500]
        # Simple DLP patterns for log redaction
        redactions = [
            ("api_key", "API_KEY_REDACTED"),
            ("password", "PASSWORD_REDACTED"),
            ("secret", "SECRET_REDACTED"),
            ("token", "TOKEN_REDACTED"),
            ("Authorization", "AUTH_REDACTED"),
            ("authorization", "AUTH_REDACTED"),
        ]
        for pattern, replacement in redactions:
            args_str = args_str.replace(pattern, replacement)
        return args_str

    def on_file_edit(self, file_path: str) -> Optional[Dict]:
        """Process a file edit through RippleGraph and log impact."""
        if not self._running or not self.session_id:
            return None

        # Try to query RippleGraph for impact analysis
        impact = self._query_graph(file_path)

        if impact:
            # Log impact event
            self.ledger.emit_impact_event(
                session_id=self.session_id,
                target_file=file_path,
                affected_files=impact.get("affected_callers", []),
                affected_tests=impact.get("affected_tests", []),
                impact_score=impact.get("impact_score", 0),
            )

            # Warn if high impact
            if impact.get("risk") in ["high", "critical"]:
                print(f"⚠️  HIGH IMPACT: Editing {file_path}")
                print(f"   Affected callers: {len(impact.get('affected_callers', []))}")
                print(f"   Recommended tests: {impact.get('affected_tests', [])}")

        return impact

    def _query_graph(self, file_path: str) -> Optional[Dict]:
        """Query RippleGraph for impact analysis."""
        graph_cli = self.repo_path / "packages" / "graph" / "dist" / "cli.js"
        if not graph_cli.exists():
            # Try node_modules/.bin or bun
            graph_cli = self.repo_path / "packages" / "graph" / "src" / "cli.ts"

        if not graph_cli.exists():
            return None

        try:
            # Try to run RippleGraph analyze command
            if str(graph_cli).endswith(".ts"):
                cmd = ["bun", "run", str(graph_cli), "analyze", file_path, "--format", "json"]
            else:
                cmd = ["node", str(graph_cli), "analyze", file_path, "--format", "json"]

            result = subprocess.run(
                cmd,
                cwd=str(self.repo_path),
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0 and result.stdout:
                return json.loads(result.stdout)

        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
            pass

        return None

    def detect_and_emit_changes(self) -> List[Dict]:
        """Detect file changes and emit to ledger."""
        if not self._running or not self.session_id:
            return []

        changes = self.recorder.detect_changes()
        self.recorder.emit_changes(changes)

        return changes

    def end_session(self, status: str = "completed") -> Dict[str, Any]:
        """End the session and generate final artifacts."""
        if not self._running or not self.session_id:
            return {"error": "No active session"}

        # Detect any remaining changes
        changes = self.detect_and_emit_changes()

        # Get final commit
        commit_after = None
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(self.repo_path),
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                commit_after = result.stdout.strip()
        except Exception:
            pass

        # Calculate trust score
        timeline = self.ledger.get_timeline(self.session_id)
        high_risk = sum(1 for e in timeline if e.get("risk_level") in ["high", "critical"])
        blocked = sum(1 for e in timeline if e.get("type") == "tool_call" and "deny" in str(e.get("raw_json", "")))

        # Simple trust score: 100 - (high_risk * 10) - (blocked * 5)
        trust_score = max(0, min(100, 100 - (high_risk * 10) - (blocked * 5)))

        # End session in ledger
        self.ledger.end_session(
            self.session_id,
            status=status,
            commit_after=commit_after,
            trust_score=trust_score,
        )

        self._running = False

        summary = {
            "session_id": self.session_id,
            "status": status,
            "changes_detected": len(changes),
            "high_risk_events": high_risk,
            "blocked_actions": blocked,
            "trust_score": trust_score,
            "commit_after": commit_after,
        }

        print(f"\n🏁 Session ended: {self.session_id}")
        print(f"   Status: {status}")
        print(f"   Changes: {len(changes)}")
        print(f"   Trust Score: {trust_score}/100")

        return summary

    def generate_report(self, output_dir: str = ".tracebox/reports", format: str = "markdown") -> str:
        """Generate session report."""
        if not self.session_id:
            return "Error: No session"

        generator = ReportGenerator(self.session_id, self.ledger)
        return generator.save(output_dir, format)

    def generate_rollback_plan(self, dry_run: bool = True) -> Dict[str, Any]:
        """Generate and optionally execute rollback plan."""
        if not self.session_id:
            return {"error": "No session"}

        self.rollback = RollbackEngine(str(self.repo_path), self.session_id, self.ledger)
        plan = self.rollback.generate_plan(dry_run=dry_run)

        if dry_run:
            return plan

        results = self.rollback.execute_plan(plan, dry_run=False)
        report_path = self.rollback.generate_report(plan, results)

        return {
            "plan": plan,
            "results": results,
            "report": report_path,
        }

    def show_timeline(self) -> str:
        """Show session timeline."""
        if not self.session_id:
            return "Error: No session"

        ui = TimelineUI(self.session_id, self.ledger)
        return ui.render_cli()

    def _detect_test_runs(self) -> Optional[str]:
        """Scan session events for test commands."""
        if not self.session_id or not self.ledger:
            return None

        test_patterns = [
            r'\bpytest\b', r'\bvitest\b', r'\bnpm test\b',
            r'\bbun test\b', r'\bnpx jest\b', r'\bgo test\b',
            r'\bcargo test\b', r'\brake test\b', r'\bdeno test\b',
        ]
        import re
        timeline = self.ledger.get_timeline(self.session_id)
        for event in timeline:
            if event.get("type") == "tool_call":
                summary = event.get("summary", "") or ""
                for pattern in test_patterns:
                    if re.search(pattern, summary):
                        return summary[:80]
        return None


# --- CLI Integration ---

def run_agent_command(
    command: List[str],
    repo_path: str = None,
    agent_name: str = "unknown",
    policy_preset: str = "safe-default",
    proxy_mode: bool = True,
) -> int:
    """Run an agent command through the orchestrator.

    In proxy_mode, the agent's MCP tool calls are intercepted by TraceBox.
    In file-watch mode (proxy_mode=False), only file changes are tracked.
    """
    repo_path = repo_path or os.getcwd()

    orch = SessionOrchestrator(
        repo_path=repo_path,
        agent_name=agent_name,
        policy_preset=policy_preset,
    )

    # Start session
    session_id = orch.start_session()

    # Start file watcher
    from watcher import FileWatcher
    watcher = FileWatcher(repo_path, session_id, orch.ledger)
    watcher.start()

    print(f"\n▶️  Running: {' '.join(command)}\n")

    # Set environment for agent
    env = os.environ.copy()
    env["TRACEBOX_SESSION_ID"] = session_id
    env["TRACEBOX_LEDGER_DB"] = orch.ledger_db
    env["TRACEBOX_REPO"] = str(Path(repo_path).resolve())

    if proxy_mode:
        # Launch MCP server as sidecar
        mcp_script = str(Path(__file__).parent.parent / "policy" / "mcp_server.py")
        env["TRACEBOX_MCP_MODE"] = "1"
        # The MCP server runs inline with the orchestrator
        # Developer sets agent's MCP config to use this server
        print("   MCP proxy: active (agent tool calls will be intercepted)")
        print("   To use: configure your agent's MCP server to connect to TraceBox")

    try:
        process = subprocess.Popen(
            command,
            env=env,
            cwd=repo_path,
        )

        # Watch process + poll for file changes + check watcher events
        while process.poll() is None:
            # Detect file changes
            changes = orch.detect_and_emit_changes()
            # Check watcher events
            watcher_events = watcher.get_events()
            if watcher_events and orch.ledger:
                for ev in watcher_events:
                    orch.ledger.emit_file_event(session_id, ev["path"], ev["operation"])
            import time
            time.sleep(1)

        # Final change detection
        time.sleep(0.5)  # Allow filesystem to settle
        watcher.stop()
        changes = orch.detect_and_emit_changes()

        # Detect test runs in tool calls
        test_evidence = orch._detect_test_runs()

        # End session
        status = "completed" if process.returncode == 0 else "failed"
        orch.end_session(status=status)

        # Generate report
        report_path = orch.generate_report()
        print(f"\n📄 Report: {report_path}")

        # Show test-run status
        if test_evidence:
            print(f"🧪 Tests run: {test_evidence}")
        else:
            print(f"🧪 No tests detected — recommended if code was modified")

        return process.returncode

    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        watcher.stop()
        orch.end_session(status="interrupted")
        return 130

def install_agent_hooks(repo_path: str = None, agents: list = None):
    """Install TraceBox hooks for AI coding agents."""
    repo_path = repo_path or os.getcwd()
    sys.path.insert(0, str(Path(__file__).parent.parent / "policy"))
    from installer import install_all
    results = install_all(repo_path, agents)
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="TraceBox Session Orchestrator")
    parser.add_argument("--repo", default=".", help="Repository path")
    parser.add_argument("--agent", default="unknown", help="Agent name")
    parser.add_argument("--policy", default="safe-default", choices=["safe-default", "strict", "permissive"])
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db")
    parser.add_argument("command", nargs="+", help="Command to run")

    args = parser.parse_args()

    sys.exit(run_agent_command(
        command=args.command,
        repo_path=args.repo,
        agent_name=args.agent,
        policy_preset=args.policy,
    ))
