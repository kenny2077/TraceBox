import re
import json
from typing import Any, List, Tuple, Optional

# Regexes to catch common secrets in string payloads
# Each tuple: (compiled_regex, replacement_template_or_callable)
SECRET_PATTERNS: List[Tuple[Any, Any]] = [
    # AWS Access Key ID (20 uppercase alphanumeric)
    (re.compile(r'(?i)(aws_access_key_id|aws_access_key|access_key_id)[\s]*[:=][\s]*([A-Z0-9]{20})'), r'\1: [REDACTED]'),
    # AWS Secret Access Key (40 base64-ish chars)
    (re.compile(r'(?i)(aws_secret_access_key|aws_secret|secret_access_key)[\s]*[:=][\s]*([a-zA-Z0-9/+=]{40})'), r'\1: [REDACTED]'),
    # Generic API keys / tokens with key:value format (includes underscore variants)
    (re.compile(r'(?i)(api[_-]?key|apikey|bearer[_-]?token|auth[_-]?token|token|secret)[\s]*[:=][\s]*([a-zA-Z0-9_\-\.\/+=]{8,})'), r'\1: [REDACTED]'),
    # Catch "bearer_token: secret12345" and similar with underscore before colon
    (re.compile(r'(?i)(\w*(?:api[_-]?key|apikey|bearer[_-]?token|auth[_-]?token|token|secret|password)\w*)[\s]*[:=][\s]*([a-zA-Z0-9_\-\.\/+=]{8,})'), r'\1: [REDACTED]'),
    # Standalone high-entropy tokens (sk-..., ghp_..., etc.)
    (re.compile(r'\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{40,}|sl\.[a-zA-Z0-9]{20,})\b'), r'[REDACTED]'),
    # Private Keys (RSA, ED25519, EC, DSA, OpenSSH)
    (re.compile(r'-----BEGIN [A-Z ]+PRIVATE KEY-----.+?-----END [A-Z ]+PRIVATE KEY-----', re.DOTALL), r'[REDACTED PRIVATE KEY]'),
    # Generic password assignments
    (re.compile(r'(?i)(password)[\s]*[:=][\s]*([^\s\n]{8,})'), r'\1: [REDACTED]'),
]

# Keys in JSON objects to aggressively redact entirely
SENSITIVE_KEYS = [
    re.compile(r'password', re.IGNORECASE),
    re.compile(r'secret', re.IGNORECASE),
    re.compile(r'token', re.IGNORECASE),
    re.compile(r'api[_-]?key', re.IGNORECASE),
    re.compile(r'auth', re.IGNORECASE),
    re.compile(r'credential', re.IGNORECASE),
    re.compile(r'private[_-]?key', re.IGNORECASE),
    re.compile(r'access[_-]?key', re.IGNORECASE),
]


class RedactionEngine:
    """
    Scans data structures and strings for sensitive patterns and replaces them.
    Used for BOTH agent responses AND audit logs to ensure a single redaction path.
    """

    def __init__(self, custom_patterns: Optional[List[Tuple[str, str]]] = None):
        self.patterns = list(SECRET_PATTERNS)
        if custom_patterns:
            for pattern_str, repl in custom_patterns:
                self.patterns.append((re.compile(pattern_str, re.IGNORECASE), repl))

    def redact(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self._redact_dict_value(k, v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.redact(item) for item in data]
        elif isinstance(data, str):
            return self._redact_string(data)
        return data

    def _redact_dict_value(self, key: str, value: Any) -> Any:
        # If the key itself looks like a secret, redact the entire value unconditionally
        if any(p.search(key) for p in SENSITIVE_KEYS):
            return "[REDACTED]"
        # Otherwise, recurse to find secrets inside strings
        return self.redact(value)

    def _redact_string(self, text: str) -> str:
        redacted_text = text
        for pattern, repl in self.patterns:
            redacted_text = pattern.sub(repl, redacted_text)
        return redacted_text

    def redact_jsonl_event(self, event: Any) -> Any:
        """Redact an entire audit event dict, preserving structure."""
        return self.redact(event)
