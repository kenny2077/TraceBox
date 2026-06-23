#!/bin/bash
# TraceBox Hook for Claude Desktop
# Usage: ./install.sh
#
# Adds TraceBox MCP server to Claude Desktop config,
# so all agent tool calls are intercepted and recorded.

set -e

CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
BACKUP="${CLAUDE_CONFIG}.tracebox.bak"

if [ ! -f "$CLAUDE_CONFIG" ]; then
    echo "Claude Desktop config not found at: $CLAUDE_CONFIG"
    echo "Make sure Claude Desktop is installed."
    echo ""
    echo "Alternative: run Claude Code with:"
    echo "  tracebox run -- claude"
    exit 1
fi

echo "Installing TraceBox for Claude Desktop..."

# Use tracebox CLI for installation
tracebox install --agent claude 2>/dev/null || {
    echo "tracebox CLI not found. Try: pip install tracebox"
    exit 1
}

echo ""
echo "Done! Restart Claude Desktop to activate TraceBox."
echo "All agent tool calls will now be recorded."
echo ""
echo "To verify: tracebox open (after running Claude)"
echo "To remove: tracebox uninstall --agent claude"
