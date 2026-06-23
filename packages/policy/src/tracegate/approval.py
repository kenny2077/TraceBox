import sys
import asyncio
import json
import logging
import os
import hashlib
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Environment variable for non-interactive approval modes
# interactive (default) — prompt on /dev/tty
# deny-all — deny all ask rules without prompting
# allow-all — allow all ask rules without prompting (DANGEROUS, test/demo only)
APPROVAL_MODE = os.environ.get("TRACEGATE_APPROVAL_MODE", "interactive").lower()


def _compute_arg_fingerprint(arguments: Dict[str, Any]) -> str:
    """Compute a stable fingerprint of arguments for approval memory binding."""
    # Sort keys recursively for stability
    canonical = json.dumps(arguments, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def build_memory_key(rule_id: str, tool_name: str, arguments: Dict[str, Any]) -> str:
    """Build a memory key that binds to rule + tool + argument fingerprint."""
    fingerprint = _compute_arg_fingerprint(arguments)
    return f"{rule_id}:{tool_name}:{fingerprint}"


def build_memory_scope_message(rule_id: str, tool_name: str, arguments: Dict[str, Any]) -> str:
    """Build a human-readable description of what 'always' will apply to."""
    fingerprint = _compute_arg_fingerprint(arguments)
    return (
        f"Always will apply to: rule={rule_id}, tool={tool_name}, "
        f"args_fingerprint={fingerprint}"
    )


async def prompt_for_approval(
    tool_name: str,
    arguments: Dict[str, Any],
    message: str,
    timeout: int = 60,
    risk_level: Optional[str] = None,
) -> str:
    """
    Prompt the user for approval via /dev/tty.

    Opens /dev/tty directly to avoid corrupting the MCP stdio streams.
    Falls back to secure denial if /dev/tty is unavailable (CI, Docker, SSH).

    Non-interactive modes (set TRACEGATE_APPROVAL_MODE):
      - deny-all:  auto-deny every ask (safe default for headless)
      - allow-all: auto-allow every ask (DANGEROUS — test/demo only)
    """
    # Handle non-interactive modes first
    if APPROVAL_MODE == "deny-all":
        logger.warning(f"TRACEGATE_APPROVAL_MODE=deny-all: auto-denying '{tool_name}'")
        return "never"
    elif APPROVAL_MODE == "allow-all":
        logger.warning(f"TRACEGATE_APPROVAL_MODE=allow-all: auto-allowing '{tool_name}' (DANGEROUS)")
        return "always"

    # Format prompt
    risk_str = f"  Risk: {risk_level.upper()}\n" if risk_level else ""
    args_str = json.dumps(arguments, indent=2, default=str)
    if len(args_str) > 500:
        args_str = args_str[:500] + "\n  ... (truncated)"

    scope_msg = build_memory_scope_message(
        rule_id=message.split("Matched rule ")[-1].strip() if "Matched rule" in message else "unknown",
        tool_name=tool_name,
        arguments=arguments,
    )

    prompt_text = (
        f"\n{'='*60}\n"
        f"  ⚠️  TraceGate: Approval Required\n"
        f"{'='*60}\n"
        f"  Tool:    {tool_name}\n"
        f"{risk_str}"
        f"  Reason:  {message}\n"
        f"  Args:\n{_indent(args_str, 4)}\n"
        f"  {scope_msg}\n"
        f"  Allow this action? [y/N/always/never]: "
    )

    try:
        with open('/dev/tty', 'r+') as tty:
            loop = asyncio.get_running_loop()

            def _write():
                tty.write(prompt_text)
                tty.flush()

            def _read():
                return tty.readline().strip().lower()

            await loop.run_in_executor(None, _write)

            try:
                response = await asyncio.wait_for(
                    loop.run_in_executor(None, _read),
                    timeout=timeout,
                )
                if response in ('always', 'a'):
                    tty.write("  ✅ Approved (Always for this session)\n\n")
                    return 'always'
                elif response in ('never', 'n', 'no'):
                    tty.write("  ❌ Denied (Never for this session)\n\n")
                    return 'never'
                elif response in ('y', 'yes'):
                    tty.write("  ✅ Approved\n\n")
                    return 'yes'
                else:
                    tty.write("  ❌ Denied\n\n")
                    return 'no'

            except asyncio.TimeoutError:
                tty.write(f"\n  ⏰ Timeout ({timeout}s). Denying action.\n\n")
                tty.flush()
                logger.warning(f"Approval timed out for '{tool_name}'")
                return 'no'

    except OSError:
        # /dev/tty not available (CI, Docker, SSH without TTY)
        logger.warning(
            f"Cannot acquire terminal (/dev/tty). "
            f"Denying '{tool_name}' securely. "
            f"(ASK rules become DENY in headless environments)"
        )
        return 'no'


def _indent(text: str, spaces: int) -> str:
    """Indent each line of text."""
    prefix = " " * spaces
    return "\n".join(prefix + line for line in text.split("\n"))
