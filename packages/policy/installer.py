#!/usr/bin/env python3
"""
TraceBox Agent Installer
Installs hooks/configuration so agents route tool calls through TraceBox.
"""

import json
import os
import sys
import shutil
from pathlib import Path
from typing import Optional


def install_for_claude(repo_path: str) -> bool:
    """Install TraceBox as an MCP server for Claude Code."""
    claude_dir = Path.home() / ".claude"
    settings_path = claude_dir / "settings.json"

    # Claude Code MCP server config: TraceBox runs as stdio server
    tracebox_server = {
        "command": sys.executable or "python3",
        "args": ["-m", "packages.policy.mcp_server"],
        "env": {
            "TRACEBOX_REPO": str(Path(repo_path).resolve()),
            "TRACEBOX_LEDGER_DB": str(Path(repo_path).resolve() / ".tracebox" / "ledger.db"),
        },
    }

    claude_dir.mkdir(parents=True, exist_ok=True)

    if settings_path.exists():
        with open(settings_path) as f:
            settings = json.load(f)
    else:
        settings = {}

    # Ensure mcpServers exists
    if "mcpServers" not in settings:
        settings["mcpServers"] = {}

    settings["mcpServers"]["tracebox"] = tracebox_server

    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    print(f"  ✅ Claude Code: TraceBox MCP server installed")
    print(f"     Config: {settings_path}")
    return True


def install_for_codex(repo_path: str) -> bool:
    """Install TraceBox hook for OpenAI Codex."""
    codex_dir = Path.home() / ".codex"
    hooks_dir = codex_dir / "hooks"

    # Codex supports pre-tool hooks via AGENTS.md
    agents_md_path = Path(repo_path) / "AGENTS.md"
    tracebox_prompt = """
## TraceBox Session Recording

This session is being recorded by TraceBox. Before every tool call:
1. Check if TraceBox MCP server is available
2. Log your intent to: `.tracebox/agent-intent.log`
3. After the session, report all changes

## Safety Rules
- Do not run destructive commands (rm -rf, sudo, curl|bash) without approval
- Do not read sensitive files (.env, .ssh, .aws, credentials)
- Do not modify files outside the project directory
- Run tests after editing production code
"""

    # Write AGENTS.md for Codex
    agents_md_path.write_text(tracebox_prompt.lstrip())
    print(f"  ✅ Codex: AGENTS.md hook installed")
    print(f"     Config: {agents_md_path}")
    return True


def install_for_cursor(repo_path: str) -> bool:
    """Install TraceBox configuration for Cursor."""
    cursor_dir = Path.home() / ".cursor"
    settings_path = cursor_dir / "settings.json"

    cursor_dir.mkdir(parents=True, exist_ok=True)

    tracebox_server = {
        "command": sys.executable or "python3",
        "args": ["-m", "packages.policy.mcp_server"],
    }

    if settings_path.exists():
        with open(settings_path) as f:
            settings = json.load(f)
    else:
        settings = {}

    if "mcpServers" not in settings:
        settings["mcpServers"] = {}

    settings["mcpServers"]["tracebox"] = tracebox_server

    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    print(f"  ✅ Cursor: TraceBox MCP server installed")
    print(f"     Config: {settings_path}")
    return True


def install_generic(repo_path: str) -> bool:
    """Install generic TraceBox config."""
    tracebox_dir = Path(repo_path) / ".tracebox"
    tracebox_dir.mkdir(parents=True, exist_ok=True)

    # Write AGENTS.md for generic agents
    agents_md = tracebox_dir / "AGENTS.md"
    agents_md.write_text("""# TraceBox Agent Instructions

This project is monitored by TraceBox.

## Your obligations:
1. Log all tool calls to `.tracebox/agent-intent.log` as JSON lines
2. Do not modify files outside this project
3. Do not run destructive commands without user approval
4. Do not read sensitive configuration files (.env, .ssh, .aws)
5. Run tests after editing production code
6. Report a summary of changes when done

## File format for intent log:
{"tool": "read_file", "args": {"path": "..."}, "timestamp": "..."}
""")

    print(f"  ✅ Generic: AGENTS.md installed at {agents_md}")
    return True


def install_all(repo_path: str, agents: Optional[list] = None) -> dict:
    """Install TraceBox for all detected agents."""
    results = {}

    repo_path = str(Path(repo_path).resolve())

    if agents is None or "claude" in agents:
        results["claude"] = install_for_claude(repo_path)
    if agents is None or "codex" in agents:
        results["codex"] = install_for_codex(repo_path)
    if agents is None or "cursor" in agents:
        results["cursor"] = install_for_cursor(repo_path)
    if agents is None or "generic" in agents:
        results["generic"] = install_generic(repo_path)

    return results


def uninstall_all(repo_path: str, agents: Optional[list] = None) -> dict:
    """Remove TraceBox hooks."""
    results = {}

    agents = agents or ["claude", "codex", "cursor"]

    if "claude" in agents:
        claude_settings = Path.home() / ".claude" / "settings.json"
        if claude_settings.exists():
            with open(claude_settings) as f:
                settings = json.load(f)
            settings.get("mcpServers", {}).pop("tracebox", None)
            with open(claude_settings, "w") as f:
                json.dump(settings, f, indent=2)
            print(f"  ✅ Claude Code: TraceBox removed")
            results["claude"] = True

    if "codex" in agents:
        agents_md = Path(repo_path) / "AGENTS.md"
        if agents_md.exists():
            agents_md.unlink()
            print(f"  ✅ Codex: AGENTS.md removed")
            results["codex"] = True

    if "cursor" in agents:
        cursor_settings = Path.home() / ".cursor" / "settings.json"
        if cursor_settings.exists():
            with open(cursor_settings) as f:
                settings = json.load(f)
            settings.get("mcpServers", {}).pop("tracebox", None)
            with open(cursor_settings, "w") as f:
                json.dump(settings, f, indent=2)
            print(f"  ✅ Cursor: TraceBox removed")
            results["cursor"] = True

    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="TraceBox Agent Installer")
    parser.add_argument("action", choices=["install", "uninstall"], default="install", nargs="?")
    parser.add_argument("--repo", default=".", help="Repository path")
    parser.add_argument("--agent", choices=["claude", "codex", "cursor", "generic"], action="append", help="Agent to configure")
    args = parser.parse_args()

    if args.action == "install":
        install_all(args.repo, args.agent)
    else:
        uninstall_all(args.repo, args.agent)
