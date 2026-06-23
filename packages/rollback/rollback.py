#!/usr/bin/env python3
"""
TraceBox Rollback Engine
Reverse patches, restore snapshots, delete created files.
"""

import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class RollbackEngine:
    """Undo agent session changes."""

    def __init__(self, repo_path: str, session_id: str, ledger=None):
        self.repo_path = Path(repo_path).resolve()
        self.session_id = session_id
        self.ledger = ledger
        self.snapshot_dir = Path(".tracebox/snapshots") / session_id
        self.report_dir = Path(".tracebox/rollbacks")
        self.report_dir.mkdir(parents=True, exist_ok=True)

    def _git(self, *args) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 and "not a git repository" not in result.stderr:
            raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr}")
        return result.stdout.strip()

    def generate_plan(self, dry_run: bool = False) -> Dict:
        """Generate rollback plan from file_events."""
        if not self.ledger:
            return {"error": "No ledger provided"}

        # Get file changes from ledger
        file_changes = self.ledger.get_events_by_type(self.session_id, "file_change")
        
        plan = {
            "session_id": self.session_id,
            "generated_at": datetime.now().isoformat(),
            "steps": [],
            "warnings": [],
            "irreversible": [],
        }

        modified_files = []
        created_files = []
        deleted_files = []

        for event in file_changes:
            raw = json.loads(event.get("raw_json", "{}")) if event.get("raw_json") else {}
            path = raw.get("path", "")
            operation = raw.get("operation", "")
            
            if operation == "modified":
                modified_files.append(path)
            elif operation == "created":
                created_files.append(path)
            elif operation == "deleted":
                deleted_files.append(path)

        # 1. Reverse patches for modified files
        for path in modified_files:
            # Skip files outside the repo
            full_path = Path(path) if os.path.isabs(path) else (self.repo_path / path)
            if not str(full_path).startswith(str(self.repo_path)):
                plan["warnings"].append(f"Skipping file outside repo: {path}")
                continue

            # Check for sensitive files (.env, credentials, etc.)
            sensitive_patterns = [".env", "credentials", "id_rsa", "secret"]
            if any(sp in path.lower() for sp in sensitive_patterns):
                plan["warnings"].append(f"Sensitive file modified: {path}. Manual review recommended.")

            # Try git-based rollback first
            try:
                result = subprocess.run(
                    ["git", "diff", "HEAD", "--", path],
                    cwd=self.repo_path,
                    capture_output=True,
                    text=True,
                )
                if result.stdout:
                    patch_path = self.report_dir / f"{self.session_id}_{path.replace('/', '_')}.patch"
                    patch_path.write_text(result.stdout)
                    plan["steps"].append({
                        "type": "reverse_patch",
                        "path": path,
                        "patch": str(patch_path),
                        "reversible": True,
                    })
                else:
                    plan["warnings"].append(f"No git diff available for modified file: {path}")
            except Exception as e:
                plan["warnings"].append(f"Could not generate patch for {path}: {e}")

        # 2. Delete created files
        for path in created_files:
            full_path = Path(path) if os.path.isabs(path) else (self.repo_path / path)
            if not str(full_path).startswith(str(self.repo_path)):
                plan["warnings"].append(f"Skipping file outside repo: {path}")
                continue
            plan["steps"].append({
                "type": "delete_created",
                "path": path,
                "reversible": False,  # Can't undelete without snapshot
                "note": "File will be deleted. Restore from snapshot if needed.",
            })

        # 3. Restore deleted files from snapshot or git
        for path in deleted_files:
            full_path = Path(path) if os.path.isabs(path) else (self.repo_path / path)
            if not str(full_path).startswith(str(self.repo_path)):
                plan["warnings"].append(f"Skipping file outside repo: {path}")
                continue

            # Try git checkout first (fast)
            snapshot = self.snapshot_dir / path
            if snapshot.exists():
                plan["steps"].append({
                    "type": "restore_deleted",
                    "path": path,
                    "snapshot": str(snapshot),
                    "reversible": True,
                })
            else:
                # Check if file existed in git HEAD
                try:
                    result = subprocess.run(
                        ["git", "show", f"HEAD:{path}"],
                        cwd=self.repo_path,
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode == 0:
                        plan["steps"].append({
                            "type": "git_restore_deleted",
                            "path": path,
                            "reversible": True,
                            "note": "Will restore from git HEAD",
                        })
                    else:
                        plan["warnings"].append(f"No snapshot or git history for deleted file: {path}")
                except Exception as e:
                    plan["warnings"].append(f"Error checking git history for {path}: {e}")

        # 4. Check for irreversible actions
        tool_events = self.ledger.get_events_by_type(self.session_id, "tool_call")
        for event in tool_events:
            raw = json.loads(event.get("raw_json", "{}")) if event.get("raw_json") else {}
            tool_name = raw.get("tool_name", "")
            if tool_name in ["fetch", "execute_command"]:
                plan["irreversible"].append({
                    "type": "network_or_shell",
                    "tool": tool_name,
                    "note": "Cannot rollback network requests or shell commands",
                })

        # Check for package changes
        package_files = ["package.json", "package-lock.json", "yarn.lock", "Cargo.toml", "go.mod"]
        for path in modified_files + created_files:
            if any(pf in path for pf in package_files):
                plan["irreversible"].append({
                    "type": "package_change",
                    "path": path,
                    "note": "Package changes may have side effects (install scripts, etc.)",
                })

        return plan

    def execute_plan(self, plan: Dict, dry_run: bool = True) -> Dict:
        """Execute rollback plan."""
        results = {
            "dry_run": dry_run,
            "executed": [],
            "failed": [],
            "skipped": [],
        }

        if dry_run:
            results["skipped"].append("Dry run - no changes made")
            return results

        for step in plan.get("steps", []):
            try:
                if step["type"] == "reverse_patch":
                    # Apply reverse patch
                    patch_path = Path(step["patch"])
                    if patch_path.exists():
                        result = subprocess.run(
                            ["git", "apply", "-R", str(patch_path)],
                            cwd=self.repo_path,
                            capture_output=True,
                            text=True,
                        )
                        if result.returncode == 0:
                            results["executed"].append(f"Reversed patch for {step['path']}")
                        else:
                            results["failed"].append(f"Failed to reverse patch {step['path']}: {result.stderr}")
                    else:
                        results["failed"].append(f"Patch not found: {step['patch']}")

                elif step["type"] == "delete_created":
                    path = self.repo_path / step["path"]
                    if path.exists():
                        if path.is_file():
                            path.unlink()
                        else:
                            shutil.rmtree(path)
                        results["executed"].append(f"Deleted created file: {step['path']}")

                elif step["type"] == "restore_deleted":
                    snapshot = Path(step["snapshot"])
                    target = self.repo_path / step["path"]
                    if snapshot.exists():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(snapshot, target)
                        results["executed"].append(f"Restored deleted file: {step['path']}")
                    else:
                        results["failed"].append(f"Snapshot not found: {step['snapshot']}")

                elif step["type"] == "git_restore_deleted":
                    target = self.repo_path / step["path"]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    result = subprocess.run(
                        ["git", "show", f"HEAD:{step['path']}"],
                        cwd=self.repo_path,
                        capture_output=True, text=True,
                    )
                    if result.returncode == 0:
                        target.write_text(result.stdout)
                        results["executed"].append(f"Restored deleted file from git: {step['path']}")
                    else:
                        results["failed"].append(f"Could not restore from git: {step['path']}")

            except Exception as e:
                results["failed"].append(f"Error on {step['type']} {step.get('path', '')}: {e}")

        return results

    def generate_report(self, plan: Dict, results: Dict) -> str:
        """Generate rollback report."""
        report_lines = [
            f"# TraceBox Rollback Report",
            f"",
            f"**Session:** {self.session_id}",
            f"**Generated:** {datetime.now().isoformat()}",
            f"**Repository:** {self.repo_path}",
            f"",
            f"## Plan",
            f"",
        ]

        for step in plan.get("steps", []):
            icon = "✅" if step.get("reversible") else "⚠️"
            report_lines.append(f"{icon} **{step['type']}**: {step.get('path', '')}")
            if step.get("note"):
                report_lines.append(f"   {step['note']}")

        if plan.get("warnings"):
            report_lines.extend(["", "## Warnings", ""])
            for warning in plan["warnings"]:
                report_lines.append(f"⚠️ {warning}")

        if plan.get("irreversible"):
            report_lines.extend(["", "## Cannot Rollback", ""])
            for item in plan["irreversible"]:
                report_lines.append(f"❌ **{item['type']}**: {item['note']}")

        report_lines.extend(["", "## Execution", ""])
        if results.get("dry_run"):
            report_lines.append("*Dry run - no changes made*")
        else:
            for executed in results.get("executed", []):
                report_lines.append(f"✅ {executed}")
            for failed in results.get("failed", []):
                report_lines.append(f"❌ {failed}")

        report_text = "\n".join(report_lines)
        
        report_path = self.report_dir / f"{self.session_id}_report.md"
        report_path.write_text(report_text)
        
        return str(report_path)


# --- CLI ---

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="TraceBox Rollback Engine")
    parser.add_argument("--repo", required=True, help="Repository path")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db", help="Ledger DB path")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    sub = parser.add_subparsers(dest="cmd")

    plan_p = sub.add_parser("plan", help="Generate rollback plan")
    exec_p = sub.add_parser("execute", help="Execute rollback plan")

    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
    from ledger import Ledger

    ledger = Ledger(args.ledger_db)
    engine = RollbackEngine(args.repo, args.session_id, ledger)

    if args.cmd == "plan":
        plan = engine.generate_plan(dry_run=args.dry_run)
        print(json.dumps(plan, indent=2))
    elif args.cmd == "execute":
        plan = engine.generate_plan(dry_run=False)
        results = engine.execute_plan(plan, dry_run=args.dry_run)
        report_path = engine.generate_report(plan, results)
        print(f"Rollback {'preview' if args.dry_run else 'complete'}: {report_path}")
    else:
        parser.print_help()
