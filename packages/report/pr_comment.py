#!/usr/bin/env python3
"""
TraceBox PR Comment Generator
Generates GitHub-flavored Markdown PR comments from session data.
"""

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any


class PRCommentGenerator:
    """Generate PR-ready comments from TraceBox sessions."""

    def __init__(self, session_id: str, ledger):
        self.session_id = session_id
        self.ledger = ledger

    def generate(self) -> str:
        """Generate GitHub-flavored Markdown PR comment."""
        session = self.ledger.get_session(self.session_id)
        if not session:
            return f"*Error: Session {self.session_id} not found*"

        timeline = self.ledger.get_timeline(self.session_id)
        file_changes = self.ledger.get_events_by_type(self.session_id, "file_change")
        tool_calls = self.ledger.get_events_by_type(self.session_id, "tool_call")
        impact_events = self.ledger.get_events_by_type(self.session_id, "impact_analysis")
        secret_events = self.ledger.get_events_by_type(self.session_id, "secret_detected")
        network_events = self.ledger.get_events_by_type(self.session_id, "network_request")

        # Count risk categories
        high_risk = sum(1 for e in timeline if e.get("risk_level") in ["high", "critical"])
        low_risk = sum(1 for e in timeline if e.get("risk_level") == "low")

        trust_score = session.get("trust_score", 0)
        trust_emoji = "🟢" if trust_score >= 80 else "🟡" if trust_score >= 50 else "🔴"

        lines = []
        lines.append(f"## 🤖 Agent Session Report (TraceBox)")
        lines.append("")
        lines.append(f"**Session:** `{self.session_id}`  ")
        lines.append(f"**Agent:** {session['agent_name']} | **Trust Score:** {trust_emoji} {trust_score}/100  ")
        lines.append(f"**Duration:** {session.get('started_at', '?')} → {session.get('ended_at', '?')}  ")
        lines.append(f"**Branch:** {session.get('branch', 'N/A')}  ")
        lines.append("")
        lines.append("---")
        lines.append("")

        # Files Changed
        lines.append(f"### 📝 Files Changed ({len(file_changes)})")
        lines.append("")
        lines.append("| File | Operation | Risk |")
        lines.append("|------|-----------|------|")
        for fc in file_changes[:20]:
            raw = json.loads(fc.get("raw_json", "{}")) if fc.get("raw_json") else {}
            risk = fc.get("risk_level", "low")
            risk_icon = "🔴" if risk in ["high", "critical"] else "🟡" if risk == "medium" else "🟢"
            path = raw.get("path", fc.get("summary", "?"))
            op = raw.get("operation", "?")
            lines.append(f"| `{path}` | {op} | {risk_icon} {risk} |")
        if len(file_changes) > 20:
            lines.append(f"| ... | ({len(file_changes) - 20} more) | |")

        lines.append("")

        # High-Risk Actions
        if high_risk > 0:
            lines.append(f"### ⚠️ High-Risk Actions ({high_risk})")
            lines.append("")
            for event in timeline:
                if event.get("risk_level") in ["high", "critical"]:
                    lines.append(f"- 🔴 **{event['type']}**: {event.get('summary', '?')}")
            lines.append("")

        # Secrets Touched
        if secret_events:
            lines.append(f"### 🔒 Secrets Touched ({len(secret_events)})")
            lines.append("")
            for se in secret_events:
                raw = json.loads(se.get("raw_json", "{}")) if se.get("raw_json") else {}
                lines.append(f"- `{raw.get('secret_type', 'unknown')}` in {raw.get('path', '?')}")
            lines.append("")

        # Network Destinations
        if network_events:
            critical_net = [n for n in network_events if n.get("risk_level") == "critical"]
            if critical_net:
                lines.append(f"### 🌐 Network Destinations ({len(critical_net)} critical)")
                lines.append("")
                for ne in critical_net[:5]:
                    lines.append(f"- 🔴 {ne.get('summary', '?')}")
                lines.append("")

        # Tool Calls Summary
        denied_count = 0
        if tool_calls:
            denied_count = sum(1 for tc in tool_calls if "deny" in str(tc.get("raw_json", "")).lower())
            if denied_count > 0:
                lines.append(f"### 🛡️ Blocked Actions ({denied_count})")
                lines.append("")
                for tc in tool_calls[:5]:
                    raw = json.loads(tc.get("raw_json", "{}")) if tc.get("raw_json") else {}
                    if raw.get("decision") == "deny":
                        lines.append(f"- `{raw.get('tool_name', '?')}` — {raw.get('reason', 'policy violation')[:80]}")
                lines.append("")

        # Impact Analysis
        if impact_events:
            lines.append(f"### 📊 Impact Analysis")
            lines.append("")
            for ie in impact_events[:5]:
                raw = json.loads(ie.get("raw_json", "{}")) if ie.get("raw_json") else {}
                tests = raw.get("affected_tests", [])
                lines.append(f"- **{raw.get('target_file', '?')}**: impact score {raw.get('impact_score', 0)}")
                if tests:
                    lines.append(f"  - Recommended tests: {', '.join(tests[:3])}")
            lines.append("")

        # Summary
        lines.append("---")
        lines.append("")
        lines.append(f"**Summary:** {len(file_changes)} files changed, {high_risk} high-risk actions, "
                     f"{denied_count} blocked, trust score {trust_score}/100  ")
        lines.append("")
        lines.append(f"```bash")
        lines.append(f"# Rollback this session")
        lines.append(f"tracebox rollback {self.session_id} --dry-run")
        lines.append(f"```")
        lines.append("")
        lines.append(f"<sub>Generated by TraceBox at {datetime.now().isoformat()}</sub>")

        return "\n".join(lines)

    def to_clipboard(self) -> bool:
        """Copy to system clipboard."""
        text = self.generate()
        try:
            if sys.platform == "darwin":
                proc = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
                proc.communicate(text.encode())
                return proc.returncode == 0
            elif sys.platform == "linux":
                for cmd in ["xclip", "xsel", "wl-copy"]:
                    try:
                        proc = subprocess.Popen([cmd], stdin=subprocess.PIPE)
                        proc.communicate(text.encode())
                        if proc.returncode == 0:
                            return True
                    except FileNotFoundError:
                        continue
            return False
        except Exception:
            return False

    def save(self, output_dir: str = ".tracebox/pr-comments") -> str:
        """Save PR comment to file."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        file_path = output_path / f"{self.session_id}_pr.md"
        file_path.write_text(self.generate())
        return str(file_path)


import sys

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="TraceBox PR Comment Generator")
    parser.add_argument("session_id", help="Session ID")
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db")
    parser.add_argument("--clipboard", action="store_true", help="Copy to clipboard")
    parser.add_argument("--output", help="Output file")

    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
    from ledger import Ledger

    ledger = Ledger(args.ledger_db)
    gen = PRCommentGenerator(args.session_id, ledger)

    if args.clipboard:
        if gen.to_clipboard():
            print("Copied to clipboard")
        else:
            print("Clipboard not available, printing to stdout:")
            print(gen.generate())
    elif args.output:
        path = gen.save(args.output)
        print(f"Saved: {path}")
    else:
        print(gen.generate())
