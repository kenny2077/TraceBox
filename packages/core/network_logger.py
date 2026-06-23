"""
TraceBox Network Destination Logger
Detects and logs network destinations in tool calls.
"""

import re
from typing import Dict, List, Any, Optional


def detect_network_destinations(tool_name: str, arguments: Dict[str, Any]) -> List[Dict[str, str]]:
    """Detect network destinations from tool call arguments."""
    destinations = []
    args_str = str(arguments)

    # URL patterns
    urls = re.findall(r'https?://[^\s"\'<>\[\]{}|]+', args_str)
    for url in urls:
        # Truncate long URLs, strip query params for safety
        clean = url.split("?")[0] if "?" in url else url
        if len(clean) > 120:
            clean = clean[:120] + "..."
        destinations.append({"type": "url", "target": clean, "severity": "medium"})

    # Host:port patterns
    hosts = re.findall(r'([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.[a-zA-Z]{2,}):(\d{2,5})', args_str)
    for host, port in hosts:
        destinations.append({"type": "host:port", "target": f"{host}:{port}", "severity": "medium"})

    # IP address patterns
    ips = re.findall(r'\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})\b', args_str)
    for ip, port in ips:
        destinations.append({"type": "ip:port", "target": f"{ip}:{port}", "severity": "high"})

    # Specific dangerous patterns
    sensitive_patterns = [
        (r'stripe\.com', "payment processor", "high"),
        (r'api\.github\.com', "GitHub API", "medium"),
        (r'api\.slack\.com', "Slack API", "medium"),
        (r'amazonaws\.com', "AWS endpoint", "high"),
        (r'googleapis\.com', "Google API", "medium"),
        (r'database\.', "database host", "critical"),
        (r'mongodb', "MongoDB connection", "critical"),
        (r'postgres', "PostgreSQL", "critical"),
        (r'mysql', "MySQL", "critical"),
        (r'redis', "Redis", "critical"),
    ]
    for pattern, label, severity in sensitive_patterns:
        if re.search(pattern, args_str, re.IGNORECASE):
            destinations.append({"type": "sensitive", "target": label, "severity": severity})

    # Deduplicate
    seen = set()
    unique = []
    for d in destinations:
        key = (d["type"], d["target"])
        if key not in seen:
            seen.add(key)
            unique.append(d)

    return unique


def log_network_destinations(session_id: str, tool_name: str, arguments: Dict, ledger) -> List[Dict]:
    """Detect and log network destinations to ledger."""
    destinations = detect_network_destinations(tool_name, arguments)

    for dest in destinations:
        ledger.emit_event(
            session_id=session_id,
            type="network_request",
            source="orchestrator",
            risk_level=dest["severity"],
            summary=f"Network: {dest['target']} ({dest['type']})",
            raw_json=dest,
        )

    return destinations
