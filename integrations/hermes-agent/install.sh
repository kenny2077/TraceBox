#!/bin/bash
# TraceBox Integration for Hermes Agent
# Usage: ./install.sh
#
# Installs TraceBox skill and MCP server config for Hermes Agent.

set -e

HERMES_CONFIG="$HOME/.hermes/config.yaml"

echo "Installing TraceBox for Hermes Agent..."

# Use the built-in Hermes installer
tracebox install --agent hermes 2>/dev/null || {
    echo "Installing TraceBox skill manually..."
    mkdir -p "$HOME/.hermes/skills/tracebox"
    cat > "$HOME/.hermes/skills/tracebox/SKILL.md" << 'SKILLEOF'
---
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
TraceBox records every file change, tool call, and network request an agent makes. Source-grounded audit reports, one-click rollback.

## Commands
```bash
tracebox init              # Initialize TraceBox
tracebox run -- <command>  # Run agent through TraceBox
tracebox open              # View session dashboard
tracebox timeline <id>     # Show session event timeline
tracebox rollback <id>     # Preview/execute rollback
tracebox export <id>       # Export session report
tracebox pr-comment <id>   # Generate PR comment
tracebox doctor            # Check system health
```

## Quickstart
1. `tracebox init` in your project
2. `tracebox run -- <your-agent-command>` 
3. `tracebox open` to see what happened
SKILLEOF
}

echo ""
echo "Done! Hermes Agent will now have TraceBox commands available."
echo ""
echo "To verify: restart Hermes and try 'tracebox doctor'"
echo "To remove: tracebox uninstall --agent hermes"
