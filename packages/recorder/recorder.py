#!/usr/bin/env python3
"""
TraceBox File/Git Recorder
Watches file changes, captures git snapshots, hashes before/after.
"""

import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
import threading
import time


class FileRecorder:
    """Records file changes during an agent session."""

    def __init__(self, repo_path: str, session_id: str, ledger=None):
        self.repo_path = Path(repo_path).resolve()
        self.session_id = session_id
        self.ledger = ledger
        self.snapshot_dir = Path(".tracebox/snapshots") / session_id
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.before_state: Dict[str, str] = {}  # path -> hash
        self.watched_paths: Set[str] = set()
        self._lock = threading.Lock()
        self._running = False
        self._watch_thread: Optional[threading.Thread] = None

    # --- Git Operations ---

    def _git(self, *args) -> str:
        """Run git command in repo_path."""
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr}")
        return result.stdout.strip()

    def capture_before(self) -> Tuple[str, Dict[str, str]]:
        """Capture git HEAD and file hashes before session."""
        try:
            commit = self._git("rev-parse", "HEAD")
        except RuntimeError:
            commit = None

        # Get all tracked + untracked files
        try:
            status = self._git("status", "--porcelain", "-uall")
        except RuntimeError:
            status = ""

        files = {}
        for line in status.split("\n"):
            if not line:
                continue
            status_code = line[:2]
            path = line[3:].strip()
            if path:
                full_path = self.repo_path / path
                if full_path.is_file():
                    files[path] = self._hash_file(full_path)

        # Also hash all tracked files (even unchanged)
        try:
            ls_files = self._git("ls-files")
            for path in ls_files.split("\n"):
                if path:
                    full_path = self.repo_path / path
                    if full_path.is_file() and path not in files:
                        files[path] = self._hash_file(full_path)
        except RuntimeError:
            pass

        self.before_state = files
        return commit, files

    def capture_after(self) -> Tuple[str, Dict[str, str]]:
        """Capture git state after session."""
        try:
            commit = self._git("rev-parse", "HEAD")
        except RuntimeError:
            commit = None

        # Get current file hashes
        after_files = {}
        try:
            status = self._git("status", "--porcelain", "-uall")
            for line in status.split("\n"):
                if not line:
                    continue
                path = line[3:].strip()
                if path:
                    full_path = self.repo_path / path
                    if full_path.is_file():
                        after_files[path] = self._hash_file(full_path)
        except RuntimeError:
            pass

        # Tracked files
        try:
            ls_files = self._git("ls-files")
            for path in ls_files.split("\n"):
                if path:
                    full_path = self.repo_path / path
                    if full_path.is_file() and path not in after_files:
                        after_files[path] = self._hash_file(full_path)
        except RuntimeError:
            pass

        return commit, after_files

    def _hash_file(self, path: Path) -> str:
        """SHA256 hash of file contents."""
        h = hashlib.sha256()
        try:
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        except (IOError, OSError):
            return ""
        return h.hexdigest()[:16]

    def _snapshot_file(self, path: Path) -> Path:
        """Copy file to snapshot directory."""
        rel = path.relative_to(self.repo_path)
        dest = self.snapshot_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            import shutil
            shutil.copy2(path, dest)
        except (IOError, OSError):
            pass
        return dest

    def _generate_diff(self, path: Path, before_hash: Optional[str], after_hash: Optional[str]) -> Optional[str]:
        """Generate git diff for a file."""
        try:
            if before_hash and after_hash and before_hash == after_hash:
                return None
            result = subprocess.run(
                ["git", "diff", "--", str(path)],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
            )
            return result.stdout if result.stdout else None
        except Exception:
            return None

    # --- Change Detection ---

    def detect_changes(self) -> List[Dict]:
        """Detect all file changes between before and after."""
        after_commit, after_state = self.capture_after()
        changes = []

        all_paths = set(self.before_state.keys()) | set(after_state.keys())

        for path in sorted(all_paths):
            before_hash = self.before_state.get(path)
            after_hash = after_state.get(path)
            full_path = self.repo_path / path

            if before_hash and after_hash:
                if before_hash != after_hash:
                    # Modified
                    diff = self._generate_diff(full_path, before_hash, after_hash)
                    snapshot = self._snapshot_file(full_path)
                    changes.append({
                        "path": path,
                        "operation": "modified",
                        "before_hash": before_hash,
                        "after_hash": after_hash,
                        "diff": diff,
                        "snapshot": str(snapshot),
                    })
            elif before_hash and not after_hash:
                # Deleted
                changes.append({
                    "path": path,
                    "operation": "deleted",
                    "before_hash": before_hash,
                    "after_hash": None,
                    "diff": None,
                    "snapshot": None,
                })
            elif not before_hash and after_hash:
                # Created
                snapshot = self._snapshot_file(full_path)
                changes.append({
                    "path": path,
                    "operation": "created",
                    "before_hash": None,
                    "after_hash": after_hash,
                    "diff": None,
                    "snapshot": str(snapshot),
                })

        return changes

    def emit_changes(self, changes: List[Dict]):
        """Write changes to ledger."""
        if not self.ledger:
            return
        for change in changes:
            risk = "low"
            if ".env" in change["path"] or ".ssh" in change["path"] or ".aws" in change["path"]:
                risk = "critical"
            elif "package.json" in change["path"] or "Cargo.toml" in change["path"] or "requirements.txt" in change["path"]:
                risk = "medium"
            elif change["operation"] == "deleted":
                risk = "high"

            self.ledger.emit_file_event(
                session_id=self.session_id,
                path=change["path"],
                operation=change["operation"],
                before_hash=change.get("before_hash"),
                after_hash=change.get("after_hash"),
                diff_patch=change.get("diff"),
                snapshot_path=change.get("snapshot"),
                risk_level=risk,
            )

    # --- File Watcher (Polling-based for MVP) ---

    def start_watching(self, interval: float = 2.0):
        """Start polling file watcher."""
        self._running = True
        self._watch_thread = threading.Thread(target=self._watch_loop, args=(interval,), daemon=True)
        self._watch_thread.start()

    def stop_watching(self):
        """Stop file watcher."""
        self._running = False
        if self._watch_thread:
            self._watch_thread.join(timeout=5.0)

    def _watch_loop(self, interval: float):
        """Poll for file changes."""
        while self._running:
            try:
                _, current_state = self.capture_after()
                with self._lock:
                    for path, hash_val in current_state.items():
                        if path not in self.before_state:
                            self.before_state[path] = hash_val
                        elif self.before_state[path] != hash_val:
                            # Change detected during session
                            self.before_state[path] = hash_val
            except Exception:
                pass
            time.sleep(interval)

    # --- Package Detection ---

    def detect_package_changes(self, changes: List[Dict]) -> List[Dict]:
        """Detect package manager changes."""
        package_files = ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                        "Cargo.toml", "Cargo.lock", "requirements.txt", "poetry.lock",
                        "go.mod", "go.sum", "Pipfile", "Pipfile.lock"]
        package_changes = []
        for change in changes:
            if any(pf in change["path"] for pf in package_files):
                package_changes.append(change)
        return package_changes


# --- CLI ---

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="TraceBox File Recorder")
    parser.add_argument("--repo", required=True, help="Repository path")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db", help="Ledger DB path")
    sub = parser.add_subparsers(dest="cmd")

    before_p = sub.add_parser("before", help="Capture before state")
    after_p = sub.add_parser("after", help="Capture after state and emit changes")
    watch_p = sub.add_parser("watch", help="Start watching files")
    watch_p.add_argument("--interval", type=float, default=2.0)

    args = parser.parse_args()

    # Lazy import ledger to avoid circular deps
    sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
    from ledger import Ledger

    ledger = Ledger(args.ledger_db)
    recorder = FileRecorder(args.repo, args.session_id, ledger)

    if args.cmd == "before":
        commit, files = recorder.capture_before()
        print(f"Commit: {commit}")
        print(f"Files: {len(files)}")
        for path, h in sorted(files.items())[:20]:
            print(f"  {path}: {h}")

    elif args.cmd == "after":
        changes = recorder.detect_changes()
        recorder.emit_changes(changes)
        print(f"Changes detected: {len(changes)}")
        for c in changes:
            print(f"  {c['operation']}: {c['path']}")

    elif args.cmd == "watch":
        recorder.capture_before()
        recorder.start_watching(args.interval)
        print(f"Watching {args.repo}... Press Ctrl+C to stop")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            recorder.stop_watching()
            changes = recorder.detect_changes()
            recorder.emit_changes(changes)
            print(f"\nChanges: {len(changes)}")
