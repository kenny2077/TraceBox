"""
Tests for Policy Matcher v2 features:
- nested path matching (match_args_path)
- recursive search (match_args_recursive)
- case sensitivity toggle
- path normalization
"""

import pytest
from tracegate.policy import PolicyEngine, RuleAction, SessionState


def test_match_args_path_nested_dict(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-nested-env
    tool: read_file
    match_args_path:
      "file.path": ".env"
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("read_file", {"file": {"path": ".env"}})
    assert v.action == RuleAction.DENY
    assert v.rule_id == "block-nested-env"


def test_match_args_path_list_index(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-first-item
    tool: process_list
    match_args_path:
      "items.0.name": "evil"
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("process_list", {"items": [{"name": "evil"}, {"name": "good"}]})
    assert v.action == RuleAction.DENY


def test_match_args_path_no_match(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-nested-env
    tool: read_file
    match_args_path:
      "file.path": ".env"
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("read_file", {"file": {"path": "/tmp/foo"}})
    assert v.action == RuleAction.ALLOW


def test_match_args_recursive_finds_nested_value(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-rm-anywhere
    tool: execute_command
    match_args_recursive:
      command: ["rm -rf"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    # Nested deep inside arguments
    v = engine.evaluate("execute_command", {
        "wrapper": {
            "inner": {
                "command": "rm -rf /tmp"
            }
        }
    })
    assert v.action == RuleAction.DENY


def test_match_args_recursive_in_list(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-rm-anywhere
    tool: execute_command
    match_args_recursive:
      command: ["rm -rf"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("execute_command", {
        "steps": ["cd /tmp", "rm -rf *", "echo done"]
    })
    assert v.action == RuleAction.DENY


def test_case_insensitive_rule(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-rm
    tool: execute_command
    match_args_contain:
      command: ["rm -rf"]
    action: deny
    case_sensitive: false
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("execute_command", {"command": "RM -RF /tmp"})
    assert v.action == RuleAction.DENY


def test_case_insensitive_config_level(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
caseSensitive: false
rules:
  - id: block-rm
    tool: execute_command
    match_args_contain:
      command: ["rm -rf"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("execute_command", {"command": "RM -RF /tmp"})
    assert v.action == RuleAction.DENY


def test_case_sensitive_by_default(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-rm
    tool: execute_command
    match_args_contain:
      command: ["rm -rf"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("execute_command", {"command": "RM -RF /tmp"})
    assert v.action == RuleAction.ALLOW


def test_path_normalization_dotdot(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-env
    tool: read_file
    match_args:
      path: "/*/.env"
    action: deny
""")
    engine = PolicyEngine(str(policy))
    # Path normalization should resolve /tmp/../../.env to /.env
    # But fnmatch with "/*/.env" won't match "/.env" directly
    # Let's test a simpler case
    v = engine.evaluate("read_file", {"path": "/tmp/../.env"})
    # normalized to /.env — the glob "/*/.env" doesn't match "/.env"
    # This is expected behavior; users should use multiple rules or broader globs
    assert v.action == RuleAction.ALLOW


def test_path_normalization_home_expand(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: block-ssh
    tool: read_file
    match_args_contain:
      path: [".ssh/id_rsa"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("read_file", {"path": "~/.ssh/id_rsa"})
    # After normalization, ~/.ssh/id_rsa becomes /Users/.../.ssh/id_rsa
    # The substring ".ssh/id_rsa" should still match
    assert v.action == RuleAction.DENY


def test_combined_match_args_and_path(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: allow
rules:
  - id: complex-block
    tool: custom_tool
    match_args:
      target: "*.txt"
    match_args_path:
      "flags.force": "true"
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v = engine.evaluate("custom_tool", {
        "target": "data.txt",
        "flags": {"force": "true"}
    })
    assert v.action == RuleAction.DENY

    v2 = engine.evaluate("custom_tool", {
        "target": "data.csv",
        "flags": {"force": "true"}
    })
    assert v2.action == RuleAction.ALLOW


def test_backward_compatibility_existing_policy(tmp_path):
    """Existing policies without new fields should still work."""
    policy = tmp_path / "policy.yaml"
    policy.write_text("""
version: 1
defaultAction: ask
rules:
  - id: allow-safe-fetch
    tool: fetch
    match_args:
      url: "https://api.github.com/*"
    action: allow
  - id: deny-rm
    tool: execute_command
    match_args_contain:
      command: ["rm -rf"]
    action: deny
""")
    engine = PolicyEngine(str(policy))
    v1 = engine.evaluate("fetch", {"url": "https://api.github.com/repos/foo/bar"})
    assert v1.action == RuleAction.ALLOW

    v2 = engine.evaluate("execute_command", {"command": "rm -rf /tmp"})
    assert v2.action == RuleAction.DENY
