#!/usr/bin/env python3
"""
TraceBox Agent Hook Integrations
Installs hooks into AI coding agents so tool calls are intercepted by TraceBox.
"""

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional, Dict, List


def _find_agent_configs() -> Dict[str, Optional[Path]]:
    """Find agent config files on the system."""
    configs = {}

    # Claude Desktop
    if sys.platform == "darwin":
        claude_path = Path.home() / "Library/Application Support/Claude/claude_desktop_config.json"
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        claude_path = Path(appdata) / "Claude/claude_desktop_config.json" if appdata else None
    else:
        claude_path = Path.home() / ".config/Claude/claude_desktop_config.json"

    if claude_path and claude_path.exists():
        configs["claude"] = claude_path

    # Cursor (local project)
    cursor_local = Path(".cursor/mcp.json")
    if cursor_local.exists():
        configs["cursor"] = cursor_local
    else:
        cursor_global = Path.home() / ".cursor/mcp.json"
        if cursor_global.exists():
            configs["cursor"] = cursor_global

    # Codex CLI — uses ~/.codex/config.json
    codex_path = Path.home() / ".codex" / "config.json"
    if codex_path.exists():
        configs["codex"] = codex_path

    # Hermes Agent — uses ~/.hermes/config.yaml
    hermes_path = Path.home() / ".hermes" / "config.yaml"
    if hermes_path.exists():
        configs["hermes"] = hermes_path

    return configs


def _tracebox_mcp_entry() -> Dict:
    """Generate TraceBox MCP server config entry."""
    return {
        "command": "tracebox",
        "args": ["serve", "--policy", "safe-default"],
        "description": "TraceBox local black-box recorder for AI coding agents"
    }


def install_all(repo_path: str = ".", agents: Optional[List[str]] = None) -> Dict[str, bool]:
    """Install TraceBox hooks for all or specified agents."""
    configs = _find_agent_configs()
    results = {}

    if agents:
        configs = {k: v for k, v in configs.items() if k in agents}

    for agent_name, config_path in configs.items():
        results[agent_name] = _install_agent_hook(agent_name, config_path)

    return results


def uninstall_all(repo_path: str = ".", agents: Optional[List[str]] = None) -> Dict[str, bool]:
    """Remove TraceBox hooks from all or specified agents."""
    configs = _find_agent_configs()
    results = {}

    if agents:
        configs = {k: v for k, v in configs.items() if k in agents}

    for agent_name, config_path in configs.items():
        results[agent_name] = _uninstall_agent_hook(agent_name, config_path)

    return results


def _install_agent_hook(agent_name: str, config_path: Path) -> bool:
    """Inject TraceBox into an agent's MCP config."""
    try:
        if agent_name == "hermes":
            return _install_hermes(config_path)

        if config_path.suffix == ".json":
            with open(config_path) as f:
                config = json.load(f)
        else:
            return False

        # Backup
        backup = Path(str(config_path) + ".tracebox.bak")
        if not backup.exists():
            shutil.copy2(config_path, backup)

        mcp_servers = config.get("mcpServers", {})
        if "tracebox" in mcp_servers:
            print(f"  [{agent_name}] TraceBox already installed")
            return True

        mcp_servers["tracebox"] = _tracebox_mcp_entry()
        config["mcpServers"] = mcp_servers

        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        print(f"  ✅ [{agent_name}] TraceBox MCP installed → {config_path}")
        return True

    except Exception as e:
        print(f"  ❌ [{agent_name}] Install failed: {e}")
        return False


def _uninstall_agent_hook(agent_name: str, config_path: Path) -> bool:
    """Remove TraceBox from an agent's MCP config."""
    try:
        if agent_name == "hermes":
            return _uninstall_hermes(config_path)

        if config_path.suffix == ".json":
            with open(config_path) as f:
                config = json.load(f)
        else:
            return False

        mcp_servers = config.get("mcpServers", {})
        if "tracebox" not in mcp_servers:
            print(f"  [{agent_name}] TraceBox not found")
            return True

        del mcp_servers["tracebox"]
        config["mcpServers"] = mcp_servers

        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        print(f"  ✅ [{agent_name}] TraceBox MCP removed")
        return True

    except Exception as e:
        print(f"  ❌ [{agent_name}] Uninstall failed: {e}")
        return False


def _install_hermes(config_path: Path) -> bool:
    """Install TraceBox skill in Hermes Agent config."""
    try:
        # Create a TraceBox skill file in ~/.hermes/skills/
        skill_dir = Path.home() / ".hermes" / "skills" / "tracebox"
        skill_dir.mkdir(parents=True, exist_ok=True)

        skill_md = skill_dir / "SKILL.md"

        # Don't overwrite existing user customization
        if skill_md.exists():
            print(f"  [hermes] TraceBox skill already exists at {skill_md}")
            print(f"  [hermes] TraceBox MCP tool registered")
            return True

        skill_content = """---
name: tracebox
description: Local black-box recorder for AI coding agents. Records all file changes, tool calls, and generates audit reports.
version: 1.0.0
author: TraceBox
license: MIT
metadata:
  hermes:
    tags: [trace, security, audit, rollback]
    related_skills: []
---

# TraceBox Agent Recorder

## Overview
TraceBox is a local black-box recorder that captures every file change, tool call, and network request your agent makes. It generates source-grounded audit reports and provides one-click rollback.

## When to Use
- When you want a record of what an AI agent changed
- When you want to roll back agent changes
- When reviewing PRs generated by AI agents
- When you need audit trails for compliance

## Commands
```bash
tracebox init              # Initialize TraceBox in current project
tracebox run -- <command>  # Run agent through TraceBox recording
tracebox open              # View session dashboard
tracebox timeline <id>     # Show session event timeline
tracebox rollback <id>     # Preview or execute rollback
tracebox export <id>       # Export session report
tracebox pr-comment <id>   # Generate PR comment from session
tracebox doctor            # Check system health
```

## Configuration
Edit `.tracebox/policy.yaml` for per-project policy overrides:
```yaml
preset: safe-default  # or: strict, permissive
custom_rules: []
```

## Common Pitfalls
1. Must run `tracebox init` once per project
2. Works best with git-initialized repos
3. For agent hooks: `tracebox install` adds TraceBox MCP to agent configs
4. Rollback requires ledger events — agent must be run with TraceBox active
"""
        skill_md.write_text(skill_content)
        print(f"  ✅ [hermes] TraceBox skill installed at {skill_md}")
        print(f"  [hermes] To enable: restart Hermes, then use `tracebox` commands")
        return True

    except Exception as e:
        print(f"  ❌ [hermes] Install failed: {e}")
        return False


def _uninstall_hermes(config_path: Path) -> bool:
    """Remove TraceBox skill from Hermes Agent."""
    try:
        skill_dir = Path.home() / ".hermes" / "skills" / "tracebox"
        if skill_dir.exists():
            shutil.rmtree(skill_dir)
            print(f"  ✅ [hermes] TraceBox skill removed")
        return True
    except Exception as e:
        print(f"  ❌ [hermes] Uninstall failed: {e}")
        return False
