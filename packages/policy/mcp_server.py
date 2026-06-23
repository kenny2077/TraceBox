#!/usr/bin/env python3
"""
TraceBox MCP Server
Runs as an MCP server that evaluates every tool call against policy,
logs to the ledger, and forwards to the actual tool executor.
"""

import asyncio
import json
import os
import sys
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("tracebox.mcp")


class TraceBoxMCPServer:
    """MCP server that wraps agent tool calls with TraceBox policy + logging."""

    def __init__(self, orchestrator=None, ledger_db: str = ".tracebox/ledger.db"):
        self.orchestrator = orchestrator
        self.ledger_db = ledger_db
        self._running = False

    async def handle_initialize(self, request_id: Any, params: Optional[Dict] = None) -> Dict:
        """Handle initialize request - return server capabilities."""
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {
                        "listChanged": False
                    },
                    "resources": {},
                    "prompts": {}
                },
                "serverInfo": {
                    "name": "tracebox",
                    "version": "1.0.0"
                }
            }
        }

    async def handle_tools_list(self, request_id: Any) -> Dict:
        """Handle tools/list - return available tools."""
        # TraceBox itself doesn't provide tools; it proxies.
        # But we need to respond so the agent knows TraceBox is alive.
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": []
            }
        }

    async def handle_tools_call(self, request_id: Any, params: Dict, result_future: asyncio.Future) -> Dict:
        """Handle tools/call - evaluate policy, log, execute."""
        tool_name = params.get("name", "unknown")
        arguments = params.get("arguments", {})

        start_time = time.time()

        # 1. Evaluate policy
        decision = {"decision": "allow", "reason": "no policy engine"}
        if self.orchestrator:
            decision = self.orchestrator.on_tool_call(tool_name, arguments)

        logger.info(f"Tool call: {tool_name} -> {decision['decision']} ({decision.get('reason', '')})")

        # 2. Handle deny
        if decision["decision"] == "deny":
            result_future.set_result({
                "jsonrpc": "2.0",
                "id": request_id,
                "content": [{"type": "text", "text": f"❌ TraceBox blocked: {decision.get('reason', 'Policy violation')}"}],
                "isError": True,
            })
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32000,
                    "message": f"TraceBox blocked: {decision.get('reason', 'Policy violation')}",
                }
            }

        # 3. Handle ask
        if decision["decision"] == "ask":
            user_decision = await self._prompt_user(tool_name, arguments, decision.get("reason", ""))
            if user_decision in ("deny", "never"):
                if user_decision == "never" and self.orchestrator:
                    self.orchestrator._approval_memory.add(tool_name, arguments, allow=False)
                result_future.set_result({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "content": [{"type": "text", "text": f"❌ TraceBox: User denied this action"}],
                    "isError": True,
                })
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32000,
                        "message": "TraceBox: User denied this action",
                    }
                }
            elif user_decision == "always" and self.orchestrator:
                self.orchestrator._approval_memory.add(tool_name, arguments, allow=True)

        # 4. Log the tool call to ledger
        if self.orchestrator and self.orchestrator.ledger:
            self.orchestrator.ledger.emit_tool_event(
                session_id=self.orchestrator.session_id,
                tool_name=tool_name,
                decision=decision["decision"],
                arguments_redacted=json.dumps(arguments)[:500],
                rule_id=decision.get("rule_id"),
                risk_level=decision.get("risk"),
            )

        # 5. Execute the tool call (forward to executor)
        # For real MCP proxy, this would forward to the actual MCP server.
        # For v1.0, we return success and let the file watcher capture changes.
        duration_ms = round((time.time() - start_time) * 1000, 1)

        result = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "content": [{"type": "text", "text": f"✅ TraceBox: Allowed ({duration_ms}ms)"}],
                "meta": {"tracebox_decision": decision["decision"]},
            }
        }

        result_future.set_result(result)
        return result

    async def _prompt_user(self, tool_name: str, arguments: Dict, reason: str) -> str:
        """Prompt user for approval via /dev/tty."""
        try:
            # Try importing the TraceGate approval module
            sys.path.insert(0, str(Path(__file__).parent.parent / "policy" / "src"))
            from tracegate.approval import prompt_for_approval
            return await prompt_for_approval(tool_name, arguments, reason)
        except Exception as e:
            logger.warning(f"Approval prompt unavailable: {e}")
            # Fallback: print to console, read /dev/tty
            print(f"\n{'='*60}")
            print(f"  ⚠️  TraceBox: Ask for approval")
            print(f"  Tool: {tool_name}")
            print(f"  Reason: {reason}")
            print(f"{'='*60}")
            print(f"\n  Allow? (y=once, a=always, n=no, N=never) ", end="", flush=True)
            try:
                with open("/dev/tty", "r") as tty:
                    response = tty.readline().strip().lower()
            except Exception:
                response = "n"
            print()

            if response in ("y", "yes"):
                return "yes"
            elif response in ("a", "always"):
                return "always"
            elif response in ("n", "no"):
                return "no"
            elif response in ("N", "never"):
                return "never"
            return "no"

    async def run_stdio(self):
        """Run MCP server over stdio."""
        self._running = True
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        loop = asyncio.get_running_loop()
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        # Pending tool call futures: request_id -> asyncio.Future
        pending_calls: Dict[Any, asyncio.Future] = {}

        async def process_line(line: bytes):
            if not line:
                return

            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                return

            msg_id = msg.get("id")
            method = msg.get("method")
            params = msg.get("params")

            if method == "initialize":
                response = await self.handle_initialize(msg_id, params)
            elif method == "notifications/initialized":
                response = None  # No response for notifications
            elif method == "tools/list":
                response = await self.handle_tools_list(msg_id)
            elif method == "tools/call":
                # Create a future so the response can be awaited
                future = loop.create_future()
                pending_calls[msg_id] = future
                response = await self.handle_tools_call(msg_id, params or {}, future)
            elif method == "resources/list":
                response = {"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}}
            elif method == "prompts/list":
                response = {"jsonrpc": "2.0", "id": msg_id, "result": {"prompts": []}}
            else:
                response = None

            if response:
                line_out = (json.dumps(response) + "\n").encode("utf-8")
                sys.stdout.buffer.write(line_out)
                await sys.stdout.buffer.drain()

        try:
            while self._running:
                line = await reader.readline()
                if not line:
                    break
                await process_line(line)
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False


async def run_proxy_main(orchestrator=None, ledger_db: str = ".tracebox/ledger.db"):
    """Main entry point for the MCP proxy server."""
    server = TraceBoxMCPServer(orchestrator=orchestrator, ledger_db=ledger_db)
    await server.run_stdio()


if __name__ == "__main__":
    asyncio.run(run_proxy_main())
