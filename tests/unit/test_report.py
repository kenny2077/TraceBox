"""Unit tests for TraceBox Report Generator."""

import json
import tempfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages"))

from ledger.ledger import Ledger
from report.report import ReportGenerator


def _create_session_with_data(ledger: Ledger, agent_name="test-agent") -> str:
    """Create a session with test events."""
    sid = ledger.create_session(agent_name=agent_name, repo_path="/tmp/test")
    ledger.emit_file_event(sid, "src/main.py", "modified", risk_level="low")
    ledger.emit_file_event(sid, "src/auth.ts", "modified", risk_level="high")
    ledger.emit_tool_event(sid, "read_file", "allow", arguments_redacted='{"path":"test.ts"}')
    ledger.emit_tool_event(sid, "execute_command", "deny", arguments_redacted='{"command":"rm -rf"}')
    ledger.end_session(sid, status="completed", trust_score=75)
    return sid


class TestReportMarkdown:
    def test_generate_markdown(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        md = gen.generate("markdown")
        assert "# TraceBox Session Report" in md
        assert "Files Changed" in md
        assert "Tool Calls" in md
        assert "Trust Score" in md

    def test_markdown_has_verification(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        md = gen.generate("markdown")
        assert "Verification" in md
        assert "Source keys" in md


class TestReportHTML:
    def test_generate_html(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        html = gen.generate("html")
        assert "<!DOCTYPE html>" in html
        assert "<title>TraceBox Report</title>" in html
        assert "</html>" in html


class TestReportJSON:
    def test_generate_json(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        json_str = gen.generate("json")
        report = json.loads(json_str)
        assert report["session"]["id"] == sid
        assert "summary" in report
        assert "timeline" in report
        assert report["tb_version"] == "1.0.0"


class TestReportLimits:
    def test_limited_report(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = ledger.create_session(agent_name="bulk")
        for i in range(200):
            ledger.emit_file_event(sid, f"file_{i}.ts", "modified")
        ledger.end_session(sid, status="completed")

        gen = ReportGenerator(sid, ledger)  # limited by default
        md = gen.generate("markdown")
        # Should not crash with large data
        assert len(md) > 0

    def test_full_report(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        sid = ledger.create_session(agent_name="full")
        for i in range(10):
            ledger.emit_file_event(sid, f"file_{i}.ts", "modified")
        ledger.end_session(sid, status="completed")

        gen = ReportGenerator(sid, ledger, full=True)
        md = gen.generate("markdown")
        assert len(md) > 0
        # Full report should include all 10 files
        for i in range(10):
            assert f"file_{i}.ts" in md


class TestReportSaving:
    def test_save_markdown(self):
        tmpdir = Path(tempfile.mkdtemp())
        db_path = tmpdir / "test.db"
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        path = gen.save(str(tmpdir / "reports"), "markdown")
        assert Path(path).exists()
        assert Path(path).suffix == ".md"

    def test_save_json(self):
        tmpdir = Path(tempfile.mkdtemp())
        db_path = tmpdir / "test.db"
        ledger = Ledger(str(db_path))
        sid = _create_session_with_data(ledger)
        gen = ReportGenerator(sid, ledger)
        path = gen.save(str(tmpdir / "reports"), "json")
        assert Path(path).exists()
        content = Path(path).read_text()
        report = json.loads(content)
        assert report["session"]["id"] == sid


class TestEdgeCases:
    def test_no_ledger(self):
        gen = ReportGenerator("sess_test", None)
        result = gen.generate("markdown")
        assert "Error" in result or "No ledger" in result

    def test_session_not_found(self):
        db_path = Path(tempfile.mktemp(suffix="_test.db"))
        ledger = Ledger(str(db_path))
        gen = ReportGenerator("sess_nonexistent", ledger)
        result = gen.generate("markdown")
        assert "not found" in result.lower()
