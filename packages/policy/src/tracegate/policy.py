import yaml
import fnmatch
import os
from enum import Enum
from typing import Dict, Any, List, Optional, DefaultDict
from pydantic import BaseModel, Field, ConfigDict, ValidationError
import collections

class SessionState:
    def __init__(self):
        # Maps rule_id -> count of times it has matched
        self.rule_match_counts: DefaultDict[str, int] = collections.defaultdict(int)
        
    def increment_rule(self, rule_id: str):
        self.rule_match_counts[rule_id] += 1
        
    def get_rule_count(self, rule_id: str) -> int:
        return self.rule_match_counts[rule_id]

class RuleAction(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"

class PolicyRule(BaseModel):
    id: str
    tool: str
    match_args: Optional[Dict[str, str]] = None
    match_args_contain: Optional[Dict[str, List[str]]] = None
    match_args_path: Optional[Dict[str, str]] = None  # dotted path matching e.g. "arguments.command"
    match_args_recursive: Optional[Dict[str, List[str]]] = None  # recursive search in nested structures
    action: RuleAction
    message: Optional[str] = None
    risk: Optional[str] = None
    tags: Optional[List[str]] = None
    max_calls_per_session: Optional[int] = None
    case_sensitive: Optional[bool] = None  # per-rule override; None = use config default

class PolicyConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    version: int
    default_action: RuleAction = Field(default=RuleAction.ASK, alias="defaultAction")
    dlp_enabled: bool = Field(default=True, alias="dlpEnabled")
    max_bytes_returned: Optional[int] = Field(default=None, alias="maxBytesReturned")
    case_sensitive: bool = Field(default=True, alias="caseSensitive")
    rules: List[PolicyRule] = Field(default_factory=list)

class PolicyVerdict(BaseModel):
    action: RuleAction
    rule_id: Optional[str]
    message: str

class PolicyEngine:
    def __init__(self, config_path: str):
        self.config_path = config_path
        self.config = self._load_config()

    def _load_config(self) -> PolicyConfig:
        try:
            with open(self.config_path, "r") as f:
                data = yaml.safe_load(f)
            
            if not data:
                raise ValueError("Policy file is empty")
                
            return PolicyConfig(**data)
        except yaml.YAMLError as e:
            raise ValueError(f"Failed to parse policy YAML: {e}")
        except ValidationError as e:
            raise ValueError(f"Policy schema validation failed: {e}")
        except Exception as e:
            raise ValueError(f"Failed to load policy: {e}")

    def reload(self):
        self.config = self._load_config()

    def evaluate(self, tool_name: str, arguments: Dict[str, Any], session_state: Optional[SessionState] = None) -> PolicyVerdict:
        """
        Evaluate a tool call against the loaded policy rules.
        First matching rule wins.
        """
        for rule in self.config.rules:
            if self._matches_rule(rule, tool_name, arguments):
                # Check stateful constraints
                if rule.max_calls_per_session is not None and session_state is not None:
                    count = session_state.get_rule_count(rule.id)
                    if count >= rule.max_calls_per_session:
                        # Rule limit exceeded, block it
                        return PolicyVerdict(
                            action=RuleAction.DENY,
                            rule_id=rule.id,
                            message=f"Rule {rule.id} rate limit exceeded (max {rule.max_calls_per_session} calls per session)"
                        )
                
                # Rule matches and constraints pass
                if session_state is not None:
                    session_state.increment_rule(rule.id)
                    
                return PolicyVerdict(
                    action=rule.action,
                    rule_id=rule.id,
                    message=rule.message or f"Matched rule {rule.id}"
                )
        
        # Default action
        return PolicyVerdict(
            action=self.config.default_action,
            rule_id=None,
            message="No matching rule found. Falling back to default action."
        )

    def _matches_rule(self, rule: PolicyRule, tool_name: str, arguments: Dict[str, Any]) -> bool:
        # Determine case sensitivity for this rule
        case_sensitive = rule.case_sensitive if rule.case_sensitive is not None else self.config.case_sensitive

        # Match tool name (supports fnmatch globs like 'git_*')
        if case_sensitive:
            if not fnmatch.fnmatch(tool_name, rule.tool):
                return False
        else:
            if not fnmatch.fnmatch(tool_name.lower(), rule.tool.lower()):
                return False
            
        # Match arguments if specified (glob)
        if rule.match_args:
            for key, pattern in rule.match_args.items():
                if key not in arguments:
                    return False
                val = str(arguments[key])
                val = self._normalize_path_if_looks_like_path(key, val)
                if not self._fnmatch_case(val, pattern, case_sensitive):
                    return False
                    
        # Match arguments contain if specified (substring)
        if rule.match_args_contain:
            for key, substrings in rule.match_args_contain.items():
                if key not in arguments:
                    return False
                val = str(arguments[key])
                val = self._normalize_path_if_looks_like_path(key, val)
                if not any(self._substring_match_case(val, sub, case_sensitive) for sub in substrings):
                    return False

        # Match dotted paths e.g. "arguments.command", "content.0.text"
        if rule.match_args_path:
            for dotted_path, pattern in rule.match_args_path.items():
                value = self._get_nested_value(arguments, dotted_path)
                if value is None:
                    return False
                val_str = self._normalize_path_if_looks_like_path(dotted_path, str(value))
                if not self._fnmatch_case(val_str, pattern, case_sensitive):
                    return False

        # Recursive search in entire argument tree
        if rule.match_args_recursive:
            for key, substrings in rule.match_args_recursive.items():
                # key is a hint; we search the entire tree for any value matching any substring
                found = False
                for sub in substrings:
                    if self._recursive_search(arguments, sub, case_sensitive):
                        found = True
                        break
                if not found:
                    return False
                    
        return True

    @staticmethod
    def _fnmatch_case(value: str, pattern: str, case_sensitive: bool) -> bool:
        if case_sensitive:
            return fnmatch.fnmatch(value, pattern)
        return fnmatch.fnmatch(value.lower(), pattern.lower())

    @staticmethod
    def _substring_match_case(value: str, substring: str, case_sensitive: bool) -> bool:
        if case_sensitive:
            return substring in value
        return substring.lower() in value.lower()

    @staticmethod
    def _normalize_path_if_looks_like_path(key: str, value: str) -> str:
        """Normalize paths for keys that look like they contain paths."""
        path_like_keys = {"path", "file", "filename", "dir", "directory", "src", "dest", "target"}
        if any(plk in key.lower() for plk in path_like_keys):
            # Expand user home and normalize
            expanded = os.path.expanduser(value)
            normalized = os.path.normpath(expanded)
            return normalized
        return value

    @staticmethod
    def _get_nested_value(data: Any, dotted_path: str) -> Any:
        """Get a value from a nested dict/list using dotted path notation.
        Examples: "arguments.command", "content.0.text"
        """
        parts = dotted_path.split(".")
        current = data
        for part in parts:
            if current is None:
                return None
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list):
                try:
                    idx = int(part)
                    current = current[idx] if 0 <= idx < len(current) else None
                except (ValueError, IndexError):
                    return None
            else:
                return None
        return current

    @staticmethod
    def _recursive_search(data: Any, substring: str, case_sensitive: bool) -> bool:
        """Recursively search for a substring in any string value within a nested structure."""
        if isinstance(data, str):
            if case_sensitive:
                return substring in data
            return substring.lower() in data.lower()
        elif isinstance(data, dict):
            for v in data.values():
                if PolicyEngine._recursive_search(v, substring, case_sensitive):
                    return True
        elif isinstance(data, list):
            for item in data:
                if PolicyEngine._recursive_search(item, substring, case_sensitive):
                    return True
        return False
