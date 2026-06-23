#!/usr/bin/env python3
"""
TraceBox OpenTelemetry Export
Export session events as OTel GenAI spans.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any


class OTelExporter:
    """Export TraceBox sessions as OpenTelemetry GenAI spans."""

    def __init__(self, session_id: str, ledger=None):
        self.session_id = session_id
        self.ledger = ledger

    def export_spans(self) -> List[Dict[str, Any]]:
        """Generate OTel-compatible spans from session events."""
        if not self.ledger:
            return []

        session = self.ledger.get_session(self.session_id)
        timeline = self.ledger.get_timeline(self.session_id)

        if not session:
            return []

        spans = []
        trace_id = self._generate_trace_id()

        # Root span: session
        session_span = {
            "trace_id": trace_id,
            "span_id": self._generate_span_id(),
            "parent_span_id": None,
            "name": f"agent_session.{session['agent_name']}",
            "start_time": self._to_timestamp(session["started_at"]),
            "end_time": self._to_timestamp(session.get("ended_at") or session["started_at"]),
            "attributes": {
                "gen_ai.system": session["agent_name"],
                "gen_ai.operation.name": "agent_session",
                "session.id": session["id"],
                "session.repo": session.get("repo_path", ""),
                "session.branch": session.get("branch", ""),
                "session.trust_score": session.get("trust_score", 0),
            },
            "status": {"code": 1} if session["status"] == "completed" else {"code": 2},
        }
        spans.append(session_span)

        # Child spans: events
        for event in timeline:
            span = self._event_to_span(event, trace_id, session_span["span_id"])
            if span:
                spans.append(span)

        return spans

    def _event_to_span(self, event: Dict, trace_id: str, parent_span_id: str) -> Optional[Dict]:
        """Convert a ledger event to an OTel span."""
        event_type = event["type"]
        
        # Map event types to GenAI span names
        span_name_map = {
            "tool_call": "gen_ai.tool.use",
            "file_change": "file.operation",
            "pre_edit_risk": "risk.analysis",
            "impact_analysis": "impact.analysis",
            "secret_detected": "security.detection",
            "network_request": "network.request",
        }

        span_name = span_name_map.get(event_type, f"agent.{event_type}")

        # Parse raw JSON for attributes
        attributes = {}
        if event.get("raw_json"):
            try:
                raw = json.loads(event["raw_json"])
                for key, value in raw.items():
                    # OTel attribute naming convention
                    attr_key = f"tracebox.{event_type}.{key}"
                    if isinstance(value, (str, int, float, bool)):
                        attributes[attr_key] = value
                    elif isinstance(value, list):
                        attributes[attr_key] = json.dumps(value)
            except json.JSONDecodeError:
                pass

        # Add standard attributes
        attributes.update({
            "gen_ai.operation.name": span_name,
            "event.sequence": event["sequence"],
            "event.source": event.get("source", ""),
            "event.risk_level": event.get("risk_level", ""),
        })

        # Tool-specific GenAI attributes
        if event_type == "tool_call":
            raw = json.loads(event.get("raw_json", "{}")) if event.get("raw_json") else {}
            attributes.update({
                "gen_ai.tool.name": raw.get("tool_name", ""),
                "gen_ai.tool.call.id": f"{self.session_id}_{event['sequence']}",
            })
            if raw.get("decision") == "deny":
                attributes["gen_ai.response.finish_reason"] = "blocked"

        return {
            "trace_id": trace_id,
            "span_id": self._generate_span_id(),
            "parent_span_id": parent_span_id,
            "name": span_name,
            "start_time": self._to_timestamp(event["ts"]),
            "end_time": self._to_timestamp(event["ts"]),  # Instant events
            "attributes": attributes,
            "status": {"code": 1 if event.get("risk_level") not in ["high", "critical"] else 2},
        }

    def _generate_trace_id(self) -> str:
        """Generate 16-byte hex trace ID."""
        import random
        return f"{random.getrandbits(64):016x}{random.getrandbits(64):016x}"

    def _generate_span_id(self) -> str:
        """Generate 8-byte hex span ID."""
        import random
        return f"{random.getrandbits(64):016x}"

    def _to_timestamp(self, dt_str: str) -> int:
        """Convert datetime string to nanoseconds since epoch."""
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1_000_000_000)
        except (ValueError, AttributeError):
            return int(datetime.now().timestamp() * 1_000_000_000)

    def to_otlp_json(self) -> str:
        """Export as OTLP/HTTP JSON payload."""
        spans = self.export_spans()
        
        resource_spans = [{
            "resource": {
                "attributes": [
                    {"key": "service.name", "value": {"stringValue": "tracebox"}},
                    {"key": "service.version", "value": {"stringValue": "0.1.0"}},
                ]
            },
            "scopeSpans": [{
                "scope": {
                    "name": "tracebox.agent",
                    "version": "0.1.0",
                },
                "spans": [
                    {
                        "traceId": s["trace_id"],
                        "spanId": s["span_id"],
                        "parentSpanId": s.get("parent_span_id") or "",
                        "name": s["name"],
                        "startTimeUnixNano": str(s["start_time"]),
                        "endTimeUnixNano": str(s["end_time"]),
                        "attributes": [
                            {"key": k, "value": self._to_otlp_value(v)}
                            for k, v in s["attributes"].items()
                        ],
                        "status": s["status"],
                    }
                    for s in spans
                ],
            }],
        }]

        return json.dumps({"resourceSpans": resource_spans}, indent=2)

    def _to_otlp_value(self, value: Any) -> Dict:
        """Convert Python value to OTLP AnyValue."""
        if isinstance(value, bool):
            return {"boolValue": value}
        elif isinstance(value, int):
            return {"intValue": str(value)}
        elif isinstance(value, float):
            return {"doubleValue": value}
        else:
            return {"stringValue": str(value)}

    def save(self, output_dir: str = ".tracebox/otel") -> str:
        """Save OTLP JSON to file."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        content = self.to_otlp_json()
        file_path = output_path / f"{self.session_id}_otel.json"
        file_path.write_text(content)
        return str(file_path)


# --- CLI ---

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="TraceBox OTel Export")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db", help="Ledger DB path")
    parser.add_argument("--output", help="Output directory")
    parser.add_argument("--endpoint", help="OTLP endpoint (future: auto-send)")

    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
    from ledger import Ledger

    ledger = Ledger(args.ledger_db)
    exporter = OTelExporter(args.session_id, ledger)

    if args.output:
        path = exporter.save(args.output)
        print(f"OTel export saved: {path}")
    else:
        print(exporter.to_otlp_json())
