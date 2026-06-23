#!/bin/bash
# TraceBox Hook for Cursor
# Usage: ./install.sh
#
# Adds TraceBox MCP server to Cursor's MCP config.

set -e

CURSOR_CONFIG_DIR=".cursor"
CURSOR_CONFIG="$CURSOR_CONFIG_DIR/mcp.json"

echo "Installing TraceBox for Cursor..."

mkdir -p "$CURSOR_CONFIG_DIR"

if [ -f "$CURSOR_CONFIG" ]; then
    cp "$CURSOR_CONFIG" "${CURSOR_CONFIG}.tracebox.bak"
    python3 -c "
import json
with open('$CURSOR_CONFIG') as f:
    config = json.load(f)
mcp = config.get('mcpServers', {})
mcp['tracebox'] = {
    'command': 'tracebox',
    'args': ['serve', '--policy', 'safe-default']
}
config['mcpServers'] = mcp
with open('$CURSOR_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
print('Cursor MCP config updated')
"
else
    cat > "$CURSOR_CONFIG" << 'EOF'
{
  "mcpServers": {
    "tracebox": {
      "command": "tracebox",
      "args": ["serve", "--policy", "safe-default"],
      "description": "TraceBox local recorder for AI coding agents"
    }
  }
}
EOF
    echo "Cursor MCP config created"
fi

echo ""
echo "Done! Restart Cursor to activate TraceBox."
echo ""
echo "To verify: tracebox open"
echo "To remove: tracebox uninstall --agent cursor"
