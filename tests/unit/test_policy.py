"""Unit tests for TraceBox Policy Engine."""

import json
import tempfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages"))

from policy.policy_engine import PolicyEngine, PRESETS, SAFE_DEFAULT, STRICT, PERMISSIVE


class TestPolicyPresets:
    def test_all_presets_exist(self):
        assert "safe-default" in PRESETS
        assert "strict" in PRESETS
        assert "permissive" in PRESETS

    def test_safe_default_blocks_destructive(self):
        engine = PolicyEngine("safe-default")
        for cmd in ["rm -rf /", "sudo rm -rf /tmp", "mkfs /dev/sda"]:
            result = engine.evaluate("execute_command", {"command": cmd})
            assert result["decision"] == "deny", f"Should block: {cmd}"

    def test_safe_default_blocks_sensitive_reads(self):
        engine = PolicyEngine("safe-default")
        for path in [".env", ".ssh/id_rsa", ".aws/credentials", ".kube/config"]:
            result = engine.evaluate("read_file", {"path": path})
            assert result["decision"] == "deny", f"Should deny read: {path}"

    def test_safe_default_allows_project_reads(self):
        engine = PolicyEngine("safe-default")
        result = engine.evaluate("read_file", {"path": "src/main.py"})
        assert result["decision"] == "allow"

    def test_safe_default_allows_git_ops(self):
        engine = PolicyEngine("safe-default")
        for cmd in ["git status", "git diff", "git log", "git add src/file.py"]:
            result = engine.evaluate("execute_command", {"command": cmd})
            assert result["decision"] in ["allow", "ask"]

    def test_safe_default_asks_for_unknown(self):
        engine = PolicyEngine("safe-default")
        result = engine.evaluate("unknown_tool", {"arg": "value"})
        assert result["decision"] == "ask"

    def test_strict_denies_most(self):
        engine = PolicyEngine("strict")
        # Unknown tool
        result = engine.evaluate("execute_command", {"command": "echo hello"})
        assert result["decision"] == "deny"

    def test_strict_allows_git_read_only(self):
        engine = PolicyEngine("strict")
        for cmd in ["git status", "git diff", "git log"]:
            result = engine.evaluate("execute_command", {"command": cmd})
            assert result["decision"] == "allow"

    def test_permissive_allows_most(self):
        engine = PolicyEngine("permissive")
        result = engine.evaluate("read_file", {"path": "any/file.py"})
        assert result["decision"] == "allow"

    def test_permissive_blocks_destructive(self):
        engine = PolicyEngine("permissive")
        result = engine.evaluate("execute_command", {"command": "rm -rf /"})
        assert result["decision"] == "deny"

    def test_permissive_blocks_key_sensitive(self):
        engine = PolicyEngine("permissive")
        result = engine.evaluate("read_file", {"path": ".ssh/id_rsa"})
        assert result["decision"] == "deny"


class TestRateLimiting:
    def test_max_calls_per_session(self):
        engine = PolicyEngine("safe-default")
        # Read file: max 500 calls
        for _ in range(500):
            result = engine.evaluate("read_file", {"path": "src/test.ts"})
            assert result["decision"] == "allow"

        # 501st should be denied
        result = engine.evaluate("read_file", {"path": "src/test.ts"})
        assert result["decision"] == "deny"
        assert "Rate limit" in result["reason"]

    def test_git_ops_rate_limit(self):
        engine = PolicyEngine("safe-default")
        for _ in range(200):
            result = engine.evaluate("execute_command", {"command": "git status"})
            assert result["decision"] == "allow"

        result = engine.evaluate("execute_command", {"command": "git status"})
        assert result["decision"] == "deny"


class TestCustomRules:
    def test_load_custom_yaml(self):
        tmpdir = Path(tempfile.mkdtemp())
        tracebox_dir = tmpdir / ".tracebox"
        tracebox_dir.mkdir()
        policy_yaml = tracebox_dir / "policy.yaml"
        policy_yaml.write_text("""
preset: permissive
custom_rules:
  - id: block-all-fetch
    tool: fetch
    action: deny
    risk: high
""")
        engine = PolicyEngine("safe-default", repo_path=str(tmpdir))
        # Should override preset with permissive
        result = engine.evaluate("fetch", {"url": "http://example.com"})
        assert result["decision"] == "deny"
        assert result["rule_id"] == "block-all-fetch"

    def test_invalid_custom_yaml(self):
        tmpdir = Path(tempfile.mkdtemp())
        tracebox_dir = tmpdir / ".tracebox"
        tracebox_dir.mkdir()
        policy_yaml = tracebox_dir / "policy.yaml"
        policy_yaml.write_text(":invalid: yaml: :")
        # Should not crash
        engine = PolicyEngine("safe-default", repo_path=str(tmpdir))
        result = engine.evaluate("execute_command", {"command": "echo hello"})
        assert result["decision"] in ["allow", "ask", "deny"]


class TestEdgeCases:
    def test_empty_arguments(self):
        engine = PolicyEngine("safe-default")
        result = engine.evaluate("execute_command", {})
        assert result["decision"] in ["allow", "ask", "deny"]

    def test_wildcard_tool_match(self):
        engine = PolicyEngine("safe-default")
        # safe-default has no wildcard rules, so defaults to "ask"
        result = engine.evaluate("completely_unknown_tool", {"x": 1})
        assert result["decision"] == "ask"

    def test_nested_argument_matching(self):
        engine = PolicyEngine("safe-default")
        # Test matching with nested argument paths
        result = engine.evaluate("read_file", {"path": ".env"})
        assert result["decision"] == "deny"

    def test_glob_matching(self):
        engine = PolicyEngine("safe-default")
        # The "allow-project-reads" rule matches path: "*" (glob)
        result = engine.evaluate("read_file", {"path": "any/path/file.ts"})
        assert result["decision"] == "allow"

    def test_default_action_ask(self):
        engine = PolicyEngine("safe-default")
        result = engine.evaluate("fetch", {"url": "https://unknown.com"})
        assert result["decision"] == "ask"

    def test_rule_id_in_result(self):
        engine = PolicyEngine("safe-default")
        result = engine.evaluate("execute_command", {"command": "rm -rf /tmp"})
        assert result["rule_id"] is not None
        assert result["risk"] == "critical"


class TestPolicySerialization:
    def test_to_yaml(self):
        engine = PolicyEngine("safe-default")
        yaml_str = engine.to_yaml()
        assert "safe-default" not in yaml_str  # It dumps the policy, not the preset name
        assert "version" in yaml_str or "defaultAction" in yaml_str
