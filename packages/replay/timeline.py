#!/usr/bin/env python3
"""
TraceBox Timeline UI
CLI timeline rendering and web dashboard.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


class TimelineUI:
    """Render session timeline in terminal and serve web dashboard."""

    RISK_ICONS = {
        "critical": "🔴",
        "high": "🟠",
        "medium": "🟡",
        "low": "🟢",
        None: "⚪",
    }

    TYPE_ICONS = {
        "session_start": "🚀",
        "session_end": "🏁",
        "pre_edit_risk": "⚠️",
        "file_change": "📝",
        "tool_call": "🔧",
        "secret_detected": "🔒",
        "policy_decision": "🛡️",
        "test_recommendation": "🧪",
        "rollback_step": "↩️",
        "impact_analysis": "📊",
        "network_request": "🌐",
    }

    def __init__(self, session_id: str, ledger=None):
        self.session_id = session_id
        self.ledger = ledger

    def render_cli(self, filter_type: Optional[str] = None, filter_risk: Optional[str] = None) -> str:
        """Render timeline as formatted string for terminal."""
        if not self.ledger:
            return "Error: No ledger provided"

        timeline = self.ledger.get_timeline(self.session_id)
        session = self.ledger.get_session(self.session_id)

        if not session:
            return f"Error: Session {self.session_id} not found"

        lines = [
            f"{'=' * 70}",
            "  TraceBox Session Timeline",
            f"{'=' * 70}",
            f"  Session: {session['id']}",
            f"  Agent:   {session['agent_name']}",
            f"  Repo:    {session.get('repo_path', 'N/A')}",
            f"  Status:  {session['status']}",
            f"  Trust:   {session.get('trust_score', 0)}/100",
            f"{'=' * 70}",
            "",
        ]

        for event in timeline:
            # Apply filters
            if filter_type and event["type"] != filter_type:
                continue
            if filter_risk and event.get("risk_level") != filter_risk:
                continue

            risk_icon = self.RISK_ICONS.get(event.get("risk_level"), "⚪")
            type_icon = self.TYPE_ICONS.get(event["type"], "📌")
            ts = event["ts"]
            if isinstance(ts, str):
                ts = ts.split(".")[0]  # Remove microseconds

            lines.append(
                f"  {type_icon} [{event['sequence']:>3}] {ts} | {risk_icon} {event['type']:<20} | {event.get('summary', '')}"
            )

            # Expand high-risk events
            if event.get("risk_level") in ["high", "critical"]:
                raw = event.get("raw_json")
                if raw:
                    try:
                        data = json.loads(raw)
                        for key, value in data.items():
                            if key != "path":
                                lines.append(f"         └─ {key}: {value}")
                    except json.JSONDecodeError:
                        pass

        lines.extend([
            "",
            f"{'=' * 70}",
            f"  Total events: {len(timeline)}",
            f"{'=' * 70}",
        ])

        return "\n".join(lines)

    def render_summary(self) -> str:
        """Render session summary."""
        if not self.ledger:
            return "Error: No ledger provided"

        summary = self.ledger.get_session_summary(self.session_id)
        if not summary:
            return f"Error: Session {self.session_id} not found"

        lines = [
            f"{'=' * 50}",
            "  Session Summary",
            f"{'=' * 50}",
            f"  ID:            {summary['id']}",
            f"  Agent:         {summary['agent_name']}",
            f"  Started:       {summary['started_at']}",
            f"  Ended:         {summary.get('ended_at', 'N/A')}",
            f"  Status:        {summary['status']}",
            f"  Trust Score:   {summary.get('trust_score', 0)}/100",
            f"  Events:        {summary.get('event_count', 0)}",
            f"  File Changes:  {summary.get('file_change_count', 0)}",
            f"  Tool Calls:    {summary.get('tool_call_count', 0)}",
            f"  High Risk:     {summary.get('high_risk_count', 0)}",
            f"{'=' * 50}",
        ]

        return "\n".join(lines)

    def serve_dashboard(self, host: str = "127.0.0.1", port: int = 8080):
        """Serve web dashboard using FastAPI."""
        try:
            from fastapi import FastAPI
            from fastapi.responses import HTMLResponse, JSONResponse
            import uvicorn

            app = FastAPI(title="TraceBox Dashboard")

            @app.get("/", response_class=HTMLResponse)
            def index():
                return self._generate_dashboard_html()

            @app.get("/api/session")
            def api_session():
                session = self.ledger.get_session(self.session_id) if self.ledger else None
                return JSONResponse(content=session or {"error": "not found"})

            @app.get("/api/timeline")
            def api_timeline():
                timeline = self.ledger.get_timeline(self.session_id) if self.ledger else []
                return JSONResponse(content=timeline)

            @app.get("/api/summary")
            def api_summary():
                summary = self.ledger.get_session_summary(self.session_id) if self.ledger else None
                return JSONResponse(content=summary or {"error": "not found"})

            print(f"🌐 Dashboard: http://{host}:{port}")
            uvicorn.run(app, host=host, port=port)

        except ImportError:
            print("Install fastapi and uvicorn for web dashboard:")
            print("  pip install fastapi uvicorn")
            return 1

    def _generate_dashboard_html(self) -> str:
        """Generate dashboard HTML."""
        return f"""<!DOCTYPE html>
<html>
<head>
    <title>TraceBox Dashboard</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #0f0f23;
            color: #c0c0c0;
        }}
        h1 {{ color: #00ffc8; }}
        h2 {{ color: #00ffc8; border-bottom: 1px solid #333; }}
        .stats {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }}
        .stat-card {{
            background: #1a1a2e;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #333;
        }}
        .stat-value {{
            font-size: 2em;
            color: #00ffc8;
            font-weight: bold;
        }}
        .stat-label {{ color: #888; }}
        .timeline {{
            background: #1a1a2e;
            border-radius: 8px;
            padding: 20px;
            border: 1px solid #333;
        }}
        .event {{
            padding: 10px;
            border-left: 3px solid #333;
            margin-bottom: 10px;
        }}
        .event-risk-critical {{ border-left-color: #ff4444; }}
        .event-risk-high {{ border-left-color: #ff8844; }}
        .event-risk-medium {{ border-left-color: #ffcc44; }}
        .event-risk-low {{ border-left-color: #44ff88; }}
        .event-time {{ color: #888; font-size: 0.9em; }}
        .event-type {{ color: #00ffc8; font-weight: bold; }}
        .event-summary {{ margin-top: 5px; }}
    </style>
</head>
<body>
    <h1>🛡️ TraceBox Dashboard</h1>
    <p>Session: <code>{self.session_id}</code></p>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-value" id="event-count">-</div>
            <div class="stat-label">Events</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="file-count">-</div>
            <div class="stat-label">File Changes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="tool-count">-</div>
            <div class="stat-label">Tool Calls</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="risk-count">-</div>
            <div class="stat-label">High Risk</div>
        </div>
    </div>

    <h2>Timeline</h2>
    <div class="timeline" id="timeline">
        <p>Loading...</p>
    </div>

    <script>
        async function loadData() {{
            const [session, timeline, summary] = await Promise.all([
                fetch('/api/session').then(r => r.json()),
                fetch('/api/timeline').then(r => r.json()),
                fetch('/api/summary').then(r => r.json()),
            ]);

            document.getElementById('event-count').textContent = summary?.event_count || 0;
            document.getElementById('file-count').textContent = summary?.file_change_count || 0;
            document.getElementById('tool-count').textContent = summary?.tool_call_count || 0;
            document.getElementById('risk-count').textContent = summary?.high_risk_count || 0;

            const timelineEl = document.getElementById('timeline');
            timelineEl.innerHTML = '';

            timeline.forEach(event => {{
                const div = document.createElement('div');
                div.className = `event event-risk-${{event.risk_level || 'low'}}`;
                div.innerHTML = `
                    <div class="event-time">[${{event.sequence}}] ${{event.ts}}</div>
                    <div class="event-type">${{event.type}}</div>
                    <div class="event-summary">${{event.summary || ''}}</div>
                `;
                timelineEl.appendChild(div);
            }});
        }}

        loadData();
        setInterval(loadData, 5000);
    </script>
</body>
</html>"""


# --- CLI ---

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="TraceBox Timeline UI")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--ledger-db", default=".tracebox/ledger.db", help="Ledger DB path")
    parser.add_argument("--filter-type", help="Filter by event type")
    parser.add_argument("--filter-risk", help="Filter by risk level")
    parser.add_argument("--serve", action="store_true", help="Start web dashboard")
    parser.add_argument("--host", default="127.0.0.1", help="Dashboard host")
    parser.add_argument("--port", type=int, default=8080, help="Dashboard port")
    parser.add_argument("--summary", action="store_true", help="Show summary only")

    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent / "ledger"))
    from ledger import Ledger

    ledger = Ledger(args.ledger_db)
    ui = TimelineUI(args.session_id, ledger)

    if args.summary:
        print(ui.render_summary())
    elif args.serve:
        ui.serve_dashboard(args.host, args.port)
    else:
        print(ui.render_cli(args.filter_type, args.filter_risk))
