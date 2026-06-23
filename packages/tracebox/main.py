#!/usr/bin/env python3
"""
TraceBox Unified CLI
Main entry point for all TraceBox operations.
Version: 1.0.0

This module uses clean sibling-package imports for pip-installed mode.
When running from source, the wrapper in cli.py handles path setup.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Clean imports — works when installed via pip (all packages in site-packages)
from ledger.ledger import Ledger
from recorder.recorder import FileRecorder
from policy.policy_engine import PolicyEngine
from rollback.rollback import RollbackEngine
from report.report import ReportGenerator


def init_project(args):
    """Initialize TraceBox in current project."""
    tracebox_dir = Path(".tracebox")
    tracebox_dir.mkdir(exist_ok=True)

    # Create ledger
    ledger = Ledger()
    print(f"  ✅ TraceBox initialized in {os.getcwd()}")
    print(f"     Ledger: .tracebox/ledger.db")

    # Auto-install hooks
    try:
        from core.orchestrator import install_agent_hooks
        install_agent_hooks()
    except ImportError:
        pass

    return 0


def run_session(args):
    """Run agent through TraceBox."""
    try:
        from core.orchestrator import run_agent_command
        result = run_agent_command(
            command=args.command,
            repo_path=os.getcwd(),
            agent_name=args.agent or "unknown",
            policy_preset=args.policy or "safe-default",
            proxy_mode=not args.no_proxy,
        )
        return result
    except ImportError as e:
        print(f"Error: Could not load orchestrator: {e}")
        return 1


def open_dashboard(args):
    """Open session dashboard."""
    ledger = Ledger(args.ledger_db)
    sessions = ledger.list_sessions(limit=5)

    if not sessions:
        print("No sessions found. Run `tracebox run -- <command>` first.")
        return 1

    # Show session list
    print(f"Recent sessions:")
    for s in sessions:
        trust = s.get("trust_score", 0)
        trust_icon = "🟢" if trust >= 80 else "🟡" if trust >= 50 else "🔴"
        print(f"  {trust_icon} {s['id']} | {s['agent_name']} | {s['status']} | {s['started_at']}")

    # Show timeline for most recent
    latest = sessions[0]
    print(f"\nTimeline for {latest['id']}:")
    try:
        from replay.timeline import TimelineUI
        ui = TimelineUI(latest['id'], ledger)
        print(ui.render_cli())
    except ImportError:
        timeline = ledger.get_timeline(latest['id'])
        for event in timeline[:20]:
            print(f"  [{event['sequence']}] {event['type']} | {event.get('risk_level', '-')} | {event['summary'][:60] if event.get('summary') else ''}")

    # Offer web dashboard
    if args.web:
        try:
            from replay.timeline import TimelineUI
            ui = TimelineUI(latest['id'], ledger)
            print(f"\nStarting dashboard at http://{args.host}:{args.port}")
            ui.serve_dashboard(host=args.host, port=args.port)
        except ImportError as e:
            print(f"Web dashboard requires: pip install fastapi uvicorn")
            return 1

    return 0


def timeline_cmd(args):
    """Show session timeline."""
    ledger = Ledger(args.ledger_db)
    try:
        from replay.timeline import TimelineUI
        ui = TimelineUI(args.session_id, ledger)
        print(ui.render_cli(args.filter_type, args.filter_risk))
    except ImportError:
        timeline = ledger.get_timeline(args.session_id)
        for event in timeline:
            print(f"  [{event['sequence']}] {event['ts']} | {event['type']} | {event.get('risk_level', '-')} | {event.get('summary', '')[:80]}")
    return 0


def rollback_cmd(args):
    """Rollback a session."""
    ledger = Ledger(args.ledger_db)
    engine = RollbackEngine(os.getcwd(), args.session_id, ledger)
    plan = engine.generate_plan(dry_run=args.dry_run or args.preview_only)

    print(f"Rollback plan for {args.session_id}:")
    steps = plan.get("steps", [])
    warnings = plan.get("warnings", [])
    irreversible = plan.get("irreversible", [])

    print(f"  Steps: {len(steps)}")
    for s in steps:
        print(f"    {s.get('type', '?')}: {s.get('path', '?')}")

    if warnings:
        print(f"  ⚠️  Warnings:")
        for w in warnings:
            print(f"    - {w}")

    if irreversible:
        print(f"  🔴 Irreversible:")
        for i in irreversible:
            print(f"    - {i}")

    if args.dry_run or args.preview_only:
        print("\n(Dry run — no changes made)")
        return 0

    # Execute
    confirm = input(f"\nApply rollback? [y/N] ")
    if confirm.lower() != "y":
        print("Cancelled.")
        return 1

    results = engine.execute_plan(plan, dry_run=False)
    report_path = engine.generate_report(plan, results)
    print(f"Rollback complete: {report_path}")
    return 0


def export_cmd(args):
    """Export session report."""
    ledger = Ledger(args.ledger_db)
    generator = ReportGenerator(args.session_id, ledger, full=args.full)
    path = generator.save(args.output, args.format)
    print(f"Report saved: {path}")
    return 0


def pr_comment_cmd(args):
    """Generate PR comment for a session."""
    from report.pr_comment import PRCommentGenerator
    ledger = Ledger(args.ledger_db)
    gen = PRCommentGenerator(args.session_id, ledger)
    if args.clipboard:
        if gen.to_clipboard():
            print("Copied to clipboard")
        else:
            print("Clipboard not available. Output:")
            print(gen.generate())
    else:
        print(gen.generate())
    return 0


def policy_cmd(args):
    """Manage policy presets."""
    if args.action == "list":
        print("Available presets:")
        for name in ["safe-default", "strict", "permissive"]:
            print(f"  {name}")
        # Show custom rules if they exist
        custom_path = Path(".tracebox/policy.yaml")
        if custom_path.exists():
            print(f"\nCustom rules: {custom_path}")
    elif args.action == "show":
        engine = PolicyEngine(args.preset)
        print(json.dumps(engine.policy, indent=2))
    elif args.action == "eval":
        engine = PolicyEngine(args.preset)
        arguments = json.loads(args.args)
        result = engine.evaluate(args.tool, arguments)
        print(json.dumps(result, indent=2))
    return 0


def install_cmd(args):
    """Install TraceBox hooks for AI coding agents."""
    try:
        from policy.src.tracegate.installer import install_all
    except ImportError:
        try:
            from policy.src.tracegate.installer import install_all
        except ImportError:
            print("Error: installer module not found")
            return 1

    results = install_all(os.getcwd(), args.agent)
    success = sum(1 for v in results.values() if v)
    print(f"\nInstalled for {success} agent(s)")
    return 0


def uninstall_cmd(args):
    """Remove TraceBox hooks."""
    try:
        from policy.src.tracegate.installer import uninstall_all
    except ImportError:
        try:
            from policy.src.tracegate.installer import uninstall_all
        except ImportError:
            print("Error: installer module not found")
            return 1

    uninstall_all(os.getcwd(), args.agent)
    return 0


def serve_cmd(args):
    """Run TraceBox MCP server for tool call interception."""
    try:
        from policy.mcp_server import run_proxy_main
    except ImportError:
        print("Error: mcp_server module not found")
        return 1

    import asyncio
    from core.orchestrator import SessionOrchestrator

    repo = args.repo or os.getcwd()
    orch = SessionOrchestrator(
        repo_path=repo,
        agent_name=args.agent or "mcp-server",
        policy_preset=args.policy or "safe-default",
    )
    orch.start_session()

    print(f"MCP server running on stdio")
    print(f"Session: {orch.session_id}")
    print(f"Policy: {args.policy or 'safe-default'}")
    print("Configure your agent's MCP server to connect to this process")

    asyncio.run(run_proxy_main(orchestrator=orch))


def doctor_cmd(args):
    """Check system health."""
    checks = []

    # Check git
    result = subprocess.run(["git", "rev-parse", "--git-dir"], capture_output=True, text=True)
    git_ok = result.returncode == 0
    checks.append(("Git repo", "✅" if git_ok else "❌"))

    # Check ledger
    try:
        ledger = Ledger()
        checks.append(("Ledger DB", "✅"))
    except Exception:
        checks.append(("Ledger DB", "❌"))

    # Check Bun
    result = subprocess.run(["which", "bun"], capture_output=True, text=True)
    bun_ok = result.returncode == 0
    checks.append(("Bun (RippleGraph)", "✅" if bun_ok else "⚠️  missing"))

    # Check watchdog
    try:
        import watchdog
        checks.append(("Watchdog", "✅"))
    except ImportError:
        checks.append(("Watchdog", "⚠️  pip install watchdog"))

    # Check fastapi/uvicorn (dashboard)
    try:
        import fastapi
        checks.append(("FastAPI (dashboard)", "✅"))
    except ImportError:
        checks.append(("FastAPI (dashboard)", "⚠️  pip install fastapi uvicorn"))

    print("System check:")
    for name, status in checks:
        print(f"  {status} {name}")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="TraceBox — Local black-box recorder for AI coding agents",
        prog="tracebox",
    )
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db", help="Ledger database path")
    parser.add_argument("--version", action="version", version="TraceBox 1.0.0")

    sub = parser.add_subparsers(dest="cmd", help="Commands")

    # init
    init_p = sub.add_parser("init", help="Initialize TraceBox in current project")

    # run
    run_p = sub.add_parser("run", help="Run agent through TraceBox")
    run_p.add_argument("--agent", default="unknown", help="Agent name (claude, codex, etc.)")
    run_p.add_argument("--policy", default="safe-default", choices=["safe-default", "strict", "permissive"], help="Policy preset")
    run_p.add_argument("--no-proxy", action="store_true", help="File-watch mode only (no MCP interception)")
    run_p.add_argument("command", nargs=argparse.REMAINDER, help="Agent command to run")

    # open
    open_p = sub.add_parser("open", help="Open session dashboard (timeline or web UI)")
    open_p.add_argument("--web", action="store_true", help="Start web dashboard")
    open_p.add_argument("--host", default="127.0.0.1", help="Dashboard host")
    open_p.add_argument("--port", type=int, default=8080, help="Dashboard port")

    # timeline
    timeline_p = sub.add_parser("timeline", help="Show session timeline")
    timeline_p.add_argument("session_id", help="Session ID")
    timeline_p.add_argument("--filter-type", help="Filter by event type")
    timeline_p.add_argument("--filter-risk", help="Filter by risk level")

    # rollback
    rollback_p = sub.add_parser("rollback", help="Rollback a session")
    rollback_p.add_argument("session_id", help="Session ID")
    rollback_p.add_argument("--dry-run", action="store_true", help="Preview only")
    rollback_p.add_argument("--preview-only", action="store_true", help="Show plan without prompting")

    # export
    export_p = sub.add_parser("export", help="Export session report")
    export_p.add_argument("session_id", help="Session ID")
    export_p.add_argument("--format", default="markdown", choices=["markdown", "html", "json"], help="Output format")
    export_p.add_argument("--output", default=".tracebox/reports", help="Output directory")
    export_p.add_argument("--full", action="store_true", help="Export all events (no limit)")

    # pr-comment
    pr_p = sub.add_parser("pr-comment", help="Generate PR comment from session")
    pr_p.add_argument("session_id", help="Session ID")
    pr_p.add_argument("--clipboard", action="store_true", help="Copy to clipboard")

    # policy
    policy_p = sub.add_parser("policy", help="Manage policy presets")
    policy_p.add_argument("action", choices=["list", "show", "eval"])
    policy_p.add_argument("--preset", default="safe-default", help="Policy preset")
    policy_p.add_argument("--tool", help="Tool name for eval")
    policy_p.add_argument("--args", help="JSON arguments for eval")

    # install
    install_p = sub.add_parser("install", help="Install agent hooks for TraceBox interception")
    install_p.add_argument("--agent", choices=["claude", "codex", "cursor", "generic"], action="append", help="Agent to configure (omit for all)")

    # uninstall
    uninstall_p = sub.add_parser("uninstall", help="Remove TraceBox agent hooks")
    uninstall_p.add_argument("--agent", choices=["claude", "codex", "cursor", "generic"], action="append", help="Agent to uninstall")

    # serve
    serve_p = sub.add_parser("serve", help="Run TraceBox MCP server for tool call interception")
    serve_p.add_argument("--repo", default=None, help="Repository path")
    serve_p.add_argument("--agent", default="mcp-server", help="Agent name")
    serve_p.add_argument("--policy", default="safe-default", choices=["safe-default", "strict", "permissive"], help="Policy preset")

    # doctor
    doctor_p = sub.add_parser("doctor", help="Check system health")

    args = parser.parse_args()

    if not args.cmd:
        parser.print_help()
        return 1

    commands = {
        "init": init_project,
        "run": run_session,
        "open": open_dashboard,
        "timeline": timeline_cmd,
        "rollback": rollback_cmd,
        "export": export_cmd,
        "pr-comment": pr_comment_cmd,
        "policy": policy_cmd,
        "install": install_cmd,
        "uninstall": uninstall_cmd,
        "serve": serve_cmd,
        "doctor": doctor_cmd,
    }

    try:
        return commands[args.cmd](args)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
