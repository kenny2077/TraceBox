#!/bin/bash
# TraceBox Hook for Codex CLI
# Usage: ./install.sh
#
# Adds TraceBox MCP configuration to Codex CLI,
# so all agent tool calls are intercepted and recorded.

set -e

CODEX_CONFIG="$HOME/.codex/config.json"

echo "Installing TraceBox for Codex CLI..."

# Create .codex directory if needed
mkdir -p "$HOME/.codex"

# Create or update config
if [ -f "$CODEX_CONFIG" ]; then
    cp "$CODEX_CONFIG" "${CODEX_CONFIG}.tracebox.bak"
    python3 -c "
import json
with open('$CODEX_CONFIG') as f:
    config = json.load(f)
mcp = config.get('mcpServers', {})
mcp['tracebox'] = {
    'command': 'tracebox',
    'args': ['serve', '--policy', 'safe-default']
}
config['mcpServers'] = mcp
with open('$CODEX_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
print('Codex config updated')
"
else
    cat > "$CODEX_CONFIG" << 'EOF'
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
    echo "Codex config created"
fi

echo ""
echo "Done! Run Codex CLI and TraceBox will record all actions."
echo ""
echo "Test: codex 'list files' && tracebox open"
echo "Remove: tracebox uninstall --agent codex"
