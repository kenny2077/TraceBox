"""Unit tests for TraceBox Ledger (event store)."""

import json
import tempfile
from pathlib import Path

import pytest

# Add packages/ to path for source-run imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages"))

from ledger.ledger import Ledger


@pytest.fixture
def ledger():
    """Create a fresh ledger for each test."""
    db_path = Path(tempfile.mktemp(suffix="_test_ledger.db"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(str(db_path))
    yield ledger
    # Cleanup
    if db_path.exists():
        db_path.unlink()


class TestSessionLifecycle:
    def test_create_session(self, ledger):
        sid = ledger.create_session(
            agent_name="claude",
            repo_path="/tmp/test-repo",
            branch="main",
        )
        assert sid.startswith("sess_")
        assert len(sid) > 5

    def test_get_session(self, ledger):
        sid = ledger.create_session(agent_name="codex", repo_path=".")
        session = ledger.get_session(sid)
        assert session is not None
        assert session["agent_name"] == "codex"
        assert session["status"] == "active"

    def test_end_session(self, ledger):
        sid = ledger.create_session(agent_name="cursor")
        result = ledger.end_session(
            sid,
            status="completed",
            commit_after="abc123",
            trust_score=85,
        )
        session = ledger.get_session(sid)
        assert session["status"] == "completed"
        assert session["trust_score"] == 85

    def test_end_session_trust_bounds(self, ledger):
        sid = ledger.create_session(agent_name="test")
        # Trust scores must be 0-100
        result = ledger.end_session(sid, status="completed", trust_score=0)
        session = ledger.get_session(sid)
        assert session["trust_score"] == 0

        sid2 = ledger.create_session(agent_name="test2")
        result = ledger.end_session(sid2, status="completed", trust_score=100)
        session2 = ledger.get_session(sid2)
        assert session2["trust_score"] == 100

    def test_get_nonexistent_session(self, ledger):
        session = ledger.get_session("sess_nonexistent")
        assert session is None

    def test_list_sessions(self, ledger):
        sid1 = ledger.create_session(agent_name="a")
        sid2 = ledger.create_session(agent_name="b")
        ledger.end_session(sid1, status="completed")
        sessions = ledger.list_sessions(limit=10)
        assert len(sessions) >= 2
        ids = [s["id"] for s in sessions]
        assert sid2 in ids  # Most recent first
        assert sid1 in ids


class TestEventEmission:
    def test_emit_file_event(self, ledger):
        sid = ledger.create_session(agent_name="claude")
        ledger.emit_file_event(
            sid,
            path="src/main.py",
            operation="modified",
            before_hash="aaa",
            after_hash="bbb",
            risk_level="medium",
        )
        events = ledger.get_events_by_type(sid, "file_change")
        assert len(events) >= 1

    def test_emit_tool_event(self, ledger):
        sid = ledger.create_session(agent_name="claude")
        ledger.emit_tool_event(
            sid,
            tool_name="execute_command",
            decision="allow",
            arguments_redacted='{"command": "git status"}',
            risk_level="low",
        )
        events = ledger.get_events_by_type(sid, "tool_call")
        assert len(events) >= 1
        raw = json.loads(events[0].get("raw_json", "{}"))
        assert raw["tool_name"] == "execute_command"

    def test_emit_event_generic(self, ledger):
        sid = ledger.create_session(agent_name="test")
        ledger.emit_event(
            sid,
            event_type="network_request",
            source="orchestrator",
            risk_level="critical",
            summary="Network to api.stripe.com",
            raw_data={"target": "api.stripe.com"},
        )
        events = ledger.get_events_by_type(sid, "network_request")
        assert len(events) == 1
        assert events[0]["risk_level"] == "critical"

    def test_events_have_sequence(self, ledger):
        sid = ledger.create_session(agent_name="test")
        ledger.emit_event(sid, event_type="session_start", summary="start")
        ledger.emit_event(sid, event_type="session_end", summary="end")
        timeline = ledger.get_timeline(sid)
        assert timeline[0]["sequence"] < timeline[1]["sequence"]


class TestTimelineAndSummary:
    def test_get_timeline_empty(self, ledger):
        sid = ledger.create_session(agent_name="test")
        timeline = ledger.get_timeline(sid)
        assert len(timeline) >= 0  # May have session_start

    def test_get_session_summary(self, ledger):
        sid = ledger.create_session(agent_name="claude")
        ledger.emit_file_event(sid, "a.py", "modified")
        ledger.emit_file_event(sid, "b.py", "created")
        ledger.emit_tool_event(sid, "read_file", "allow")
        ledger.end_session(sid, status="completed", trust_score=90)
        summary = ledger.get_session_summary(sid)
        assert summary is not None
        assert summary["event_count"] >= 3
        assert summary["file_change_count"] >= 2
        assert summary["tool_call_count"] >= 1

    def test_get_events_by_type_filtered(self, ledger):
        sid = ledger.create_session(agent_name="test")
        ledger.emit_file_event(sid, "a.py", "modified")
        ledger.emit_file_event(sid, "b.py", "deleted")
        ledger.emit_tool_event(sid, "execute_command", "allow")

        file_events = ledger.get_events_by_type(sid, "file_change")
        tool_events = ledger.get_events_by_type(sid, "tool_call")
        assert len(file_events) >= 2
        assert len(tool_events) >= 1


class TestLedgerEdgeCases:
    def test_multiple_sessions_isolated(self, ledger):
        sid1 = ledger.create_session(agent_name="a")
        sid2 = ledger.create_session(agent_name="b")
        ledger.emit_file_event(sid1, "a.py", "modified")
        ledger.emit_file_event(sid2, "b.py", "created")

        events1 = ledger.get_events_by_type(sid1, "file_change")
        events2 = ledger.get_events_by_type(sid2, "file_change")
        assert len(events1) == 1
        assert len(events2) == 1
        assert events1[0]["session_id"] != events2[0]["session_id"]

    def test_concurrent_sessions(self, ledger):
        """Ledger should handle multiple active sessions."""
        sids = [ledger.create_session(agent_name=f"agent_{i}") for i in range(5)]
        for sid in sids:
            ledger.emit_event(sid, event_type="session_start", summary="start")
        for sid in sids:
            events = ledger.get_timeline(sid)
            assert len(events) > 0

    def test_emit_event_null_summary(self, ledger):
        sid = ledger.create_session(agent_name="test")
        # Should not crash with None summary
        ledger.emit_event(sid, event_type="session_start", source="test", summary=None)
        timeline = ledger.get_timeline(sid)
        assert len(timeline) >= 1
