#!/usr/bin/env python3
"""
TraceBox Policy Engine
Simplified policy presets + TraceGate proxy integration.
"""

import json
import sys
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Any

# --- Policy Presets ---

SAFE_DEFAULT = {
    "version": 1,
    "defaultAction": "ask",
    "dlpEnabled": True,
    "rules": [
        {
            "id": "block-destructive",
            "tool": "execute_command",
            "match_args_contain": {
                "command": ["rm -rf", "rm -r /", "sudo", "| bash", "| sh", "| zsh", "mkfs", "dd if=/dev/zero"]
            },
            "action": "deny",
            "risk": "critical",
            "message": "Destructive command blocked by policy"
        },
        {
            "id": "block-sensitive-reads",
            "tool": "read_file",
            "match_args_contain": {
                "path": [".env", ".ssh", ".aws", ".kube", "id_rsa", "credentials", ".docker"]
            },
            "action": "deny",
            "risk": "high",
            "message": "Reading sensitive files is blocked"
        },
        {
            "id": "allow-git-ops",
            "tool": "execute_command",
            "match_args_contain": {
                "command": ["git status", "git diff", "git log", "git add", "git commit", "git push"]
            },
            "action": "allow",
            "max_calls_per_session": 200
        },
        {
            "id": "allow-project-reads",
            "tool": "read_file",
            "match_args": {
                "path": "*"
            },
            "action": "allow",
            "max_calls_per_session": 500
        },
        {
            "id": "ask-network",
            "tool": "fetch",
            "action": "ask",
            "risk": "medium"
        },
        {
            "id": "ask-shell",
            "tool": "execute_command",
            "action": "ask",
            "risk": "high"
        }
    ]
}

STRICT = {
    "version": 1,
    "defaultAction": "deny",
    "dlpEnabled": True,
    "rules": [
        {
            "id": "allow-git-only",
            "tool": "execute_command",
            "match_args_contain": {
                "command": ["git status", "git diff", "git log"]
            },
            "action": "allow",
            "max_calls_per_session": 50
        },
        {
            "id": "allow-read-only",
            "tool": "read_file",
            "action": "allow",
            "max_calls_per_session": 100
        }
    ]
}

PERMISSIVE = {
    "version": 1,
    "defaultAction": "allow",
    "dlpEnabled": True,
    "rules": [
        {
            "id": "block-destructive",
            "tool": "execute_command",
            "match_args_contain": {
                "command": ["rm -rf /", "sudo rm -rf /"]
            },
            "action": "deny",
            "risk": "critical"
        },
        {
            "id": "block-sensitive",
            "tool": "read_file",
            "match_args_contain": {
                "path": [".ssh/id_rsa", ".aws/credentials"]
            },
            "action": "deny"
        }
    ]
}

PRESETS = {
    "safe-default": SAFE_DEFAULT,
    "strict": STRICT,
    "permissive": PERMISSIVE,
}

# --- Policy Engine ---

class PolicyEngine:
    def __init__(self, preset: str = "safe-default", repo_path: str = None):
        self.policy = PRESETS.get(preset, SAFE_DEFAULT).copy()
        self.session_counts: Dict[str, int] = {}
        self.approvals: Dict[str, Any] = {}

        # Load per-project overrides from .tracebox/policy.yaml
        if repo_path:
            self._load_custom_rules(repo_path)

    def _load_custom_rules(self, repo_path: str):
        """Load custom rules from .tracebox/policy.yaml."""
        custom_path = Path(repo_path) / ".tracebox" / "policy.yaml"
        if not custom_path.exists():
            return

        import yaml
        try:
            with open(custom_path) as f:
                custom = yaml.safe_load(f)
        except Exception as e:
            print(f"  ⚠️  Failed to load custom policy: {e}")
            return

        if not isinstance(custom, dict):
            return

        # Override preset if specified
        if "preset" in custom and custom["preset"] in PRESETS:
            self.policy = PRESETS[custom["preset"]].copy()

        # Merge custom rules (appended after preset rules)
        custom_rules = custom.get("custom_rules", [])
        if custom_rules:
            existing = self.policy.get("rules", [])
            self.policy["rules"] = existing + custom_rules
            print(f"  📋 Loaded {len(custom_rules)} custom rule(s) from .tracebox/policy.yaml")

    def evaluate(self, tool_name: str, arguments: Dict) -> Dict[str, Any]:
        """Evaluate a tool call against policy."""
        for rule in self.policy.get("rules", []):
            if not self._match_tool(rule, tool_name):
                continue
            if not self._match_args(rule, arguments):
                continue
            
            # Check rate limit
            rule_id = rule["id"]
            max_calls = rule.get("max_calls_per_session")
            if max_calls:
                current = self.session_counts.get(rule_id, 0)
                if current >= max_calls:
                    return {
                        "decision": "deny",
                        "reason": f"Rate limit exceeded for rule {rule_id}",
                        "rule_id": rule_id,
                        "risk": rule.get("risk", "medium")
                    }
                self.session_counts[rule_id] = current + 1
            
            return {
                "decision": rule["action"],
                "reason": rule.get("message", f"Matched rule {rule_id}"),
                "rule_id": rule_id,
                "risk": rule.get("risk", "medium")
            }
        
        # Default action
        default = self.policy.get("defaultAction", "ask")
        return {
            "decision": default,
            "reason": "No matching rule",
            "rule_id": None,
            "risk": "medium" if default == "ask" else "low"
        }

    def _match_tool(self, rule: Dict, tool_name: str) -> bool:
        rule_tool = rule.get("tool", "*")
        if rule_tool == "*":
            return True
        # Simple glob matching
        pattern = rule_tool.replace("*", ".*")
        return bool(re.match(f"^{pattern}$", tool_name))

    def _match_args(self, rule: Dict, arguments: Dict) -> bool:
        # match_args: exact glob matching
        match_args = rule.get("match_args", {})
        for key, pattern in match_args.items():
            value = self._get_nested(arguments, key)
            if value is None:
                return False
            if not self._glob_match(str(value), pattern):
                return False
        
        # match_args_contain: substring matching
        match_contain = rule.get("match_args_contain", {})
        for key, substrings in match_contain.items():
            value = self._get_nested(arguments, key)
            if value is None:
                return False
            str_value = str(value)
            if not any(sub in str_value for sub in substrings):
                return False
        
        return True

    def _get_nested(self, obj: Dict, path: str) -> Any:
        parts = path.split(".")
        current = obj
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current

    def _glob_match(self, value: str, pattern: str) -> bool:
        """Simple glob matching."""
        regex = pattern.replace("*", ".*").replace("?", ".")
        return bool(re.match(f"^{regex}$", value))

    def to_yaml(self) -> str:
        """Export policy as YAML."""
        import yaml
        return yaml.dump(self.policy, default_flow_style=False)


# --- CLI ---

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="TraceBox Policy Engine")
    sub = parser.add_subparsers(dest="cmd")

    preset_p = sub.add_parser("preset", help="Show or set policy preset")
    preset_p.add_argument("name", nargs="?", choices=list(PRESETS.keys()), help="Preset name")
    preset_p.add_argument("--output", choices=["yaml", "json"], default="yaml")

    eval_p = sub.add_parser("eval", help="Evaluate a tool call")
    eval_p.add_argument("--tool", required=True, help="Tool name")
    eval_p.add_argument("--args", required=True, help="JSON arguments")
    eval_p.add_argument("--preset", default="safe-default", choices=list(PRESETS.keys()))

    args = parser.parse_args()

    if args.cmd == "preset":
        if args.name:
            policy = PRESETS[args.name]
            if args.output == "json":
                print(json.dumps(policy, indent=2))
            else:
                try:
                    import yaml
                    print(yaml.dump(policy, default_flow_style=False))
                except ImportError:
                    print("# Install PyYAML for YAML output")
                    print(json.dumps(policy, indent=2))
        else:
            print("Available presets:")
            for name in PRESETS:
                print(f"  {name}")

    elif args.cmd == "eval":
        engine = PolicyEngine(args.preset)
        arguments = json.loads(args.args)
        result = engine.evaluate(args.tool, arguments)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()
