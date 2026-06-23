#!/usr/bin/env python3
"""
TraceBox Unified Event Ledger
Shared SQLite schema and event bus for all TraceBox components.
"""

import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
import threading

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


class Ledger:
    """Thread-safe SQLite event ledger for TraceBox sessions."""

    def __init__(self, db_path: str = ".tracebox/ledger.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    @contextmanager
    def _conn(self):
        """Get thread-local connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(self.db_path))
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield self._local.conn
        except Exception:
            self._local.conn.rollback()
            raise

    def _init_db(self):
        """Initialize schema if not exists."""
        with self._conn() as conn:
            if SCHEMA_PATH.exists():
                conn.executescript(SCHEMA_PATH.read_text())
            conn.commit()

    # --- Session Management ---

    def create_session(
        self,
        agent_name: str,
        repo_path: Optional[str] = None,
        branch: Optional[str] = None,
        commit_before: Optional[str] = None,
    ) -> str:
        session_id = f"sess_{uuid.uuid4().hex[:16]}"
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO sessions (id, agent_name, repo_path, branch, commit_before)
                   VALUES (?, ?, ?, ?, ?)""",
                (session_id, agent_name, repo_path, branch, commit_before),
            )
            conn.commit()
        return session_id

    def end_session(
        self,
        session_id: str,
        status: str = "completed",
        commit_after: Optional[str] = None,
        trust_score: int = 0,
    ):
        with self._conn() as conn:
            conn.execute(
                """UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, status = ?,
                   commit_after = ?, trust_score = ? WHERE id = ?""",
                (status, commit_after, trust_score, session_id),
            )
            conn.commit()

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            return dict(row) if row else None

    def list_sessions(self, repo_path: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if repo_path:
                rows = conn.execute(
                    "SELECT * FROM sessions WHERE repo_path = ? ORDER BY started_at DESC LIMIT ?",
                    (repo_path, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [dict(r) for r in rows]

    # --- Event Emission ---

    def emit_event(
        self,
        session_id: str,
        event_type: str,
        source: Optional[str] = None,
        risk_level: Optional[str] = None,
        summary: Optional[str] = None,
        raw_data: Optional[Dict] = None,
    ) -> str:
        event_id = f"evt_{uuid.uuid4().hex[:16]}"
        with self._conn() as conn:
            # Get next sequence number for this session
            row = conn.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            sequence = row[0] if row else 1

            conn.execute(
                """INSERT INTO events (id, session_id, sequence, type, source, risk_level, summary, raw_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    event_id,
                    session_id,
                    sequence,
                    event_type,
                    source,
                    risk_level,
                    summary,
                    json.dumps(raw_data) if raw_data else None,
                ),
            )
            conn.commit()
        return event_id

    def get_timeline(self, session_id: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM events WHERE session_id = ? ORDER BY sequence""",
                (session_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_events_by_type(self, session_id: str, event_type: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE session_id = ? AND type = ? ORDER BY sequence",
                (session_id, event_type),
            ).fetchall()
            return [dict(r) for r in rows]

    # --- Specialized Event Writers ---

    def emit_file_event(
        self,
        session_id: str,
        path: str,
        operation: str,
        before_hash: Optional[str] = None,
        after_hash: Optional[str] = None,
        diff_patch: Optional[str] = None,
        snapshot_path: Optional[str] = None,
        risk_level: Optional[str] = None,
    ) -> str:
        event_id = self.emit_event(
            session_id=session_id,
            event_type="file_change",
            source="recorder",
            risk_level=risk_level,
            summary=f"{operation}: {path}",
            raw_data={"path": path, "operation": operation},
        )
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO file_events (event_id, path, operation, before_hash, after_hash, diff_patch, snapshot_path)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (event_id, path, operation, before_hash, after_hash, diff_patch, snapshot_path),
            )
            conn.commit()
        return event_id

    def emit_tool_event(
        self,
        session_id: str,
        tool_name: str,
        decision: str,
        arguments_redacted: Optional[str] = None,
        rule_id: Optional[str] = None,
        result_preview: Optional[str] = None,
        duration_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        risk_level: Optional[str] = None,
    ) -> str:
        event_id = self.emit_event(
            session_id=session_id,
            event_type="tool_call",
            source="policy",
            risk_level=risk_level,
            summary=f"{tool_name} -> {decision}",
            raw_data={"tool_name": tool_name, "decision": decision},
        )
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO tool_events (event_id, tool_name, arguments_redacted, decision, rule_id, result_preview, duration_ms, error_message)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (event_id, tool_name, arguments_redacted, decision, rule_id, result_preview, duration_ms, error_message),
            )
            conn.commit()
        return event_id

    def emit_impact_event(
        self,
        session_id: str,
        target_file: str,
        affected_files: Optional[List[str]] = None,
        affected_tests: Optional[List[str]] = None,
        risk_factors: Optional[List[str]] = None,
        impact_score: int = 0,
    ) -> str:
        event_id = self.emit_event(
            session_id=session_id,
            event_type="impact_analysis",
            source="graph",
            risk_level="high" if impact_score >= 70 else "medium" if impact_score >= 40 else "low",
            summary=f"Impact on {target_file}: score {impact_score}",
            raw_data={"target_file": target_file, "impact_score": impact_score},
        )
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO impact_events (event_id, target_file, affected_files_json, affected_tests_json, risk_factors_json, impact_score)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    event_id,
                    target_file,
                    json.dumps(affected_files) if affected_files else None,
                    json.dumps(affected_tests) if affected_tests else None,
                    json.dumps(risk_factors) if risk_factors else None,
                    impact_score,
                ),
            )
            conn.commit()
        return event_id

    def emit_secret_event(
        self,
        session_id: str,
        secret_type: str,
        path: Optional[str] = None,
        redacted_preview: Optional[str] = None,
        severity: str = "high",
    ) -> str:
        event_id = self.emit_event(
            session_id=session_id,
            event_type="secret_detected",
            source="dlp",
            risk_level=severity,
            summary=f"Secret detected: {secret_type} in {path}",
            raw_data={"secret_type": secret_type, "path": path},
        )
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO secret_events (event_id, secret_type, path, redacted_preview, severity)
                   VALUES (?, ?, ?, ?, ?)""",
                (event_id, secret_type, path, redacted_preview, severity),
            )
            conn.commit()
        return event_id

    # --- Rollback ---

    def add_rollback_step(
        self,
        session_id: str,
        step_type: str,
        target_path: Optional[str] = None,
        command: Optional[str] = None,
        patch_path: Optional[str] = None,
        reversible: bool = True,
    ) -> str:
        step_id = f"rb_{uuid.uuid4().hex[:16]}"
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO rollback_steps (id, session_id, step_type, target_path, command, patch_path, reversible)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (step_id, session_id, step_type, target_path, command, patch_path, int(reversible)),
            )
            conn.commit()
        return step_id

    def get_rollback_plan(self, session_id: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM rollback_steps WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_rollback_step(self, step_id: str, status: str, error_message: Optional[str] = None):
        with self._conn() as conn:
            conn.execute(
                "UPDATE rollback_steps SET status = ?, error_message = ? WHERE id = ?",
                (status, error_message, step_id),
            )
            conn.commit()

    # --- Queries ---

    def get_session_summary(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT 
                    s.id, s.agent_name, s.started_at, s.ended_at, s.status, s.trust_score,
                    COUNT(DISTINCT e.id) as event_count,
                    COUNT(DISTINCT fe.event_id) as file_change_count,
                    COUNT(DISTINCT te.event_id) as tool_call_count,
                    COUNT(DISTINCT CASE WHEN e.risk_level IN ('high', 'critical') THEN e.id END) as high_risk_count
                FROM sessions s
                LEFT JOIN events e ON s.id = e.session_id
                LEFT JOIN file_events fe ON e.id = fe.event_id
                LEFT JOIN tool_events te ON e.id = te.event_id
                WHERE s.id = ?
                GROUP BY s.id""", (session_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_high_risk_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM high_risk_events LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]


# --- CLI ---

if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="TraceBox Ledger CLI")
    parser.add_argument("--db", default=".tracebox/ledger.db", help="Database path")
    sub = parser.add_subparsers(dest="cmd")

    # init
    init_p = sub.add_parser("init", help="Initialize ledger database")

    # session
    session_p = sub.add_parser("session", help="Session operations")
    session_p.add_argument("action", choices=["create", "end", "list", "get"])
    session_p.add_argument("--id")
    session_p.add_argument("--agent", default="unknown")
    session_p.add_argument("--repo")
    session_p.add_argument("--branch")
    session_p.add_argument("--commit")
    session_p.add_argument("--status", default="completed")
    session_p.add_argument("--trust-score", type=int, default=0)

    # event
    event_p = sub.add_parser("event", help="Event operations")
    event_p.add_argument("action", choices=["emit", "timeline", "list"])
    event_p.add_argument("--session-id", required=True)
    event_p.add_argument("--type")
    event_p.add_argument("--source")
    event_p.add_argument("--risk")
    event_p.add_argument("--summary")

    # query
    query_p = sub.add_parser("query", help="Query operations")
    query_p.add_argument("action", choices=["summary", "high-risk"])
    query_p.add_argument("--session-id")

    args = parser.parse_args()
    ledger = Ledger(args.db)

    if args.cmd == "init":
        print(f"Ledger initialized at {args.db}")

    elif args.cmd == "session":
        if args.action == "create":
            sid = ledger.create_session(args.agent, args.repo, args.branch, args.commit)
            print(sid)
        elif args.action == "end":
            ledger.end_session(args.id, args.status, trust_score=args.trust_score)
            print(f"Session {args.id} ended")
        elif args.action == "list":
            sessions = ledger.list_sessions(args.repo)
            for s in sessions:
                print(f"{s['id']} | {s['agent_name']} | {s['status']} | {s['started_at']}")
        elif args.action == "get":
            s = ledger.get_session(args.id)
            print(json.dumps(s, indent=2, default=str))

    elif args.cmd == "event":
        if args.action == "emit":
            eid = ledger.emit_event(args.session_id, args.type, args.source, args.risk, args.summary)
            print(eid)
        elif args.action == "timeline":
            events = ledger.get_timeline(args.session_id)
            for e in events:
                print(f"[{e['sequence']}] {e['ts']} | {e['type']} | {e['risk_level'] or '-'} | {e['summary']}")
        elif args.action == "list":
            events = ledger.get_events_by_type(args.session_id, args.type)
            for e in events:
                print(json.dumps(e, indent=2, default=str))

    elif args.cmd == "query":
        if args.action == "summary":
            s = ledger.get_session_summary(args.session_id)
            print(json.dumps(s, indent=2, default=str))
        elif args.action == "high-risk":
            events = ledger.get_high_risk_events()
            for e in events:
                print(f"{e['ts']} | {e['type']} | {e['risk_level']} | {e['summary']}")
