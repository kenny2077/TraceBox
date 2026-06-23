"""Unit tests for TraceBox File Recorder."""

import subprocess
import tempfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages"))

from ledger.ledger import Ledger
from recorder.recorder import FileRecorder


class TestFileRecorder:
    def test_capture_before(self):
        """Capture git state and file hashes."""
        tmpdir = Path(tempfile.mkdtemp())
        file = tmpdir / "test.py"
        file.write_text("print('hello')")

        # Init git
        import subprocess
        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=tmpdir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "init"],
            cwd=tmpdir, capture_output=True,
            env={**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
                 "GIT_AUTHOR_EMAIL": "test@test.com",
                 "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"},
        )

        recorder = FileRecorder(str(tmpdir), "sess_test")
        commit, files = recorder.capture_before()

        assert commit is not None
        assert len(files) > 0
        assert "test.py" in files

    def test_detect_changes(self):
        """Detect file changes between before and after."""
        tmpdir = Path(tempfile.mkdtemp())
        file = tmpdir / "main.py"
        file.write_text("v1")

        import subprocess
        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=tmpdir, capture_output=True)
        env = {**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
               "GIT_AUTHOR_EMAIL": "test@test.com",
               "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
        subprocess.run(["git", "commit", "-m", "init"], cwd=tmpdir, capture_output=True, env=env)

        recorder = FileRecorder(str(tmpdir), "sess_test")
        recorder.capture_before()

        # Make a change
        file.write_text("v2")
        subprocess.run(["git", "add", "main.py"], cwd=tmpdir, capture_output=True)

        changes = recorder.detect_changes()
        assert len(changes) >= 1
        assert changes[0]["path"] == "main.py"
        assert changes[0]["operation"] == "modified"

    def test_file_creation_detection(self):
        """Detect newly created files."""
        tmpdir = Path(tempfile.mkdtemp())
        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        env = {**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
               "GIT_AUTHOR_EMAIL": "test@test.com",
               "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
        subprocess.run(["git", "commit", "--allow-empty", "-m", "init"], cwd=tmpdir, capture_output=True, env=env)

        recorder = FileRecorder(str(tmpdir), "sess_test")
        recorder.capture_before()

        # Create new file
        (tmpdir / "new_file.py").write_text("print('new')")
        subprocess.run(["git", "add", "new_file.py"], cwd=tmpdir, capture_output=True)

        changes = recorder.detect_changes()
        created = [c for c in changes if c["operation"] == "created"]
        assert len(created) >= 1
        assert created[0]["path"] == "new_file.py"

    def test_emit_changes_to_ledger(self):
        """Emit changes to ledger."""
        tmpdir = Path(tempfile.mkdtemp())
        db_path = tmpdir / ".tracebox" / "test.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        env = {**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
               "GIT_AUTHOR_EMAIL": "test@test.com",
               "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
        subprocess.run(["git", "commit", "--allow-empty", "-m", "init"], cwd=tmpdir, capture_output=True, env=env)

        ledger = Ledger(str(db_path))
        sid = ledger.create_session(agent_name="test", repo_path=str(tmpdir))
        recorder = FileRecorder(str(tmpdir), sid, ledger)
        recorder.capture_before()

        # Create + add file
        (tmpdir / "test.py").write_text("hello")
        subprocess.run(["git", "add", "test.py"], cwd=tmpdir, capture_output=True)

        changes = recorder.detect_changes()
        recorder.emit_changes(changes)

        events = ledger.get_events_by_type(sid, "file_change")
        assert len(events) > 0

    def test_risk_calculation(self):
        """Sensitive files get higher risk."""
        tmpdir = Path(tempfile.mkdtemp())
        db_path = tmpdir / ".tracebox" / "test.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        env = {**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
               "GIT_AUTHOR_EMAIL": "test@test.com",
               "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
        subprocess.run(["git", "commit", "--allow-empty", "-m", "init"], cwd=tmpdir, capture_output=True, env=env)

        ledger = Ledger(str(db_path))
        sid = ledger.create_session(agent_name="test", repo_path=str(tmpdir))
        recorder = FileRecorder(str(tmpdir), sid, ledger)
        recorder.capture_before()

        # Create a .env file
        env_file = tmpdir / ".env"
        env_file.write_text("SECRET=xxx")
        subprocess.run(["git", "add", ".env"], cwd=tmpdir, capture_output=True)

        changes = recorder.detect_changes()
        recorder.emit_changes(changes)

        events = ledger.get_events_by_type(sid, "file_change")
        for e in events:
            if ".env" in str(e.get("summary", "")):
                assert e.get("risk_level") == "critical"

    def test_package_change_detection(self):
        """Detect package manager file changes."""
        tmpdir = Path(tempfile.mkdtemp())
        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=tmpdir, capture_output=True)
        env = {**__import__("os").environ, "GIT_AUTHOR_NAME": "test",
               "GIT_AUTHOR_EMAIL": "test@test.com",
               "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
        subprocess.run(["git", "commit", "--allow-empty", "-m", "init"], cwd=tmpdir, capture_output=True, env=env)

        recorder = FileRecorder(str(tmpdir), "sess_test")
        recorder.capture_before()

        # Create package.json
        (tmpdir / "package.json").write_text('{"name":"test"}')
        subprocess.run(["git", "add", "package.json"], cwd=tmpdir, capture_output=True)

        changes = recorder.detect_changes()
        pkg = recorder.detect_package_changes(changes)
        assert len(pkg) >= 1


class TestRecorderEdgeCases:
    def test_non_git_repo(self):
        """Should handle non-git directories gracefully."""
        tmpdir = Path(tempfile.mkdtemp())
        # Don't init git
        recorder = FileRecorder(str(tmpdir), "sess_test")
        commit, files = recorder.capture_before()
        # Should not crash, commit may be None
        assert isinstance(files, dict)

    def test_empty_repo(self):
        """Should handle empty git repo."""
        tmpdir = Path(tempfile.mkdtemp())
        subprocess.run(["git", "init"], cwd=tmpdir, capture_output=True)
        recorder = FileRecorder(str(tmpdir), "sess_test")
        commit, files = recorder.capture_before()
        assert isinstance(files, dict)
