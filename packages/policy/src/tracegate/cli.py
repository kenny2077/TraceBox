import typer
import asyncio
import os
from typing import List, Optional
from pathlib import Path

from tracegate import __version__

# Default log directory — stable, absolute path
DEFAULT_LOG_DIR = os.path.join(Path.home(), ".tracegate", "sessions")

app = typer.Typer(
    help="TraceGate: MCP JSON-RPC tool-call policy proxy for AI coding agents",
    add_completion=False,
)


def version_callback(value: bool):
    if value:
        typer.echo(f"tracegate {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: bool = typer.Option(
        False, "--version", "-V", callback=version_callback,
        is_eager=True, help="Show version and exit."
    ),
):
    """TraceGate: MCP JSON-RPC tool-call policy proxy for AI coding agents."""
    pass


@app.command(
    context_settings={"allow_extra_args": True, "allow_interspersed_args": False}
)
def proxy(
    ctx: typer.Context,
    policy_file: Optional[str] = typer.Option(
        None, "--policy", "-p", help="Path to policy.yaml file"
    ),
    log_dir: str = typer.Option(
        DEFAULT_LOG_DIR, "--log-dir", "-l",
        help="Directory for audit log files"
    ),
    mode: str = typer.Option(
        "stdio", "--mode", "-m",
        help="Transport mode: 'stdio' or 'sse'"
    ),
    target: Optional[str] = typer.Option(
        None, "--target", "-t",
        help="Target URL for SSE mode (e.g. http://localhost:8000)"
    ),
    host: str = typer.Option(
        "127.0.0.1", "--host",
        help="Host to bind the SSE proxy"
    ),
    port: int = typer.Option(
        8080, "--port",
        help="Port to bind the SSE proxy"
    ),
):
    """
    Run an MCP server behind the TraceGate proxy.

    Usage (stdio): tracegate proxy [OPTIONS] -- <server_command> [server_args...]
    Usage (sse):   tracegate proxy --mode sse --target http://localhost:8000
    """
    if mode == "stdio":
        command = ctx.args
        if not command:
            typer.echo(
                "Error: No server command provided.\n"
                "Usage: tracegate proxy --policy policy.yaml -- <command> [args...]",
                err=True,
            )
            raise typer.Exit(code=1)

        from tracegate.proxy import run_proxy
        asyncio.run(run_proxy(command, policy_path=policy_file, log_dir=log_dir))
        
    elif mode == "sse":
        if not target:
            typer.echo("Error: --target URL must be provided for SSE mode.", err=True)
            raise typer.Exit(code=1)
            
        try:
            from tracegate.sse import run_sse_proxy
            from rich.console import Console
            console = Console()
            console.print(f"[bold green]Starting TraceGate SSE Proxy on http://{host}:{port}[/]")
            console.print(f"[dim]Proxying to: {target}[/]")
            run_sse_proxy(target_url=target, policy_path=policy_file, log_dir=log_dir, host=host, port=port)
        except ImportError:
            typer.echo("Error: SSE proxy dependencies not found.", err=True)
            typer.echo("Install with: pip install 'tracegate[dashboard]'", err=True)
            raise typer.Exit(code=1)
            
    else:
        typer.echo(f"Error: Unknown mode '{mode}'", err=True)
        raise typer.Exit(code=1)


@app.command()
def sessions(
    log_dir: str = typer.Option(
        DEFAULT_LOG_DIR, "--log-dir", "-l",
        help="Directory containing audit log files"
    ),
):
    """
    List all recorded TraceGate sessions.
    """
    from rich.console import Console
    from rich.table import Table
    import json

    console = Console()

    if not os.path.isdir(log_dir):
        console.print(f"[yellow]No sessions found.[/] Log directory does not exist: {log_dir}")
        return

    jsonl_files = sorted(
        [f for f in os.listdir(log_dir) if f.endswith(".jsonl")],
        reverse=True,
    )

    if not jsonl_files:
        console.print(f"[yellow]No sessions found in {log_dir}[/]")
        return

    table = Table(title="TraceGate Sessions")
    table.add_column("Session ID", style="cyan")
    table.add_column("Events", justify="right")
    table.add_column("Started", style="green")
    table.add_column("File", style="dim")

    for fname in jsonl_files:
        fpath = os.path.join(log_dir, fname)
        session_id = fname.replace("session_", "").replace(".jsonl", "")
        event_count = 0
        first_timestamp = "?"
        try:
            with open(fpath, "r") as f:
                for i, line in enumerate(f):
                    if i == 0:
                        evt = json.loads(line)
                        first_timestamp = evt.get("timestamp", "?")[:19]
                    event_count += 1
        except Exception:
            first_timestamp = "error reading"

        table.add_row(session_id, str(event_count), first_timestamp, fname)

    console.print(table)


@app.command()
def replay(
    session_id: str = typer.Argument(..., help="The session ID to replay"),
    log_dir: str = typer.Option(
        DEFAULT_LOG_DIR, "--log-dir", "-l",
        help="Directory containing audit log files"
    ),
    filter_field: Optional[str] = typer.Option(
        None, "--filter", "-f",
        help="Filter events, e.g. 'risk=high' or 'decision=denied'"
    ),
):
    """
    Replay a TraceGate audit session log.
    """
    from tracegate.replay import replay_session

    replay_session(session_id, log_dir=log_dir, filter_str=filter_field)


@app.command()
def install(
    policy: Optional[str] = typer.Option(
        None, "--policy", "-p", help="Optional path to policy.yaml to enforce"
    ),
):
    """
    Auto-discover agent configs (Claude Desktop, Cursor) and inject TraceGate wrapper.
    """
    from tracegate.installer import Installer
    from rich.console import Console
    
    console = Console()
    console.print("[bold blue]TraceGate Installer[/]")
    
    installer = Installer(policy_path=policy)
    messages = installer.install()
    
    for msg in messages:
        if msg.startswith("✅"):
            console.print(f"[green]{msg}[/]")
        elif msg.startswith("❌"):
            console.print(f"[red]{msg}[/]")
        else:
            console.print(f"[yellow]{msg}[/]")


@app.command()
def uninstall():
    """
    Remove TraceGate wrappers from auto-discovered agent configs.
    """
    from tracegate.installer import Installer
    from rich.console import Console
    
    console = Console()
    console.print("[bold blue]TraceGate Uninstaller[/]")
    
    installer = Installer()
    messages = installer.uninstall()
    
    for msg in messages:
        if msg.startswith("✅"):
            console.print(f"[green]{msg}[/]")
        elif msg.startswith("❌"):
            console.print(f"[red]{msg}[/]")
        else:
            console.print(f"[yellow]{msg}[/]")


@app.command()
def init(
    template: str = typer.Option(
        "strict-local-dev", "--template", "-t",
        help="Policy template to use"
    ),
    output: str = typer.Option(
        "policy.yaml", "--output", "-o",
        help="Output file path"
    ),
    force: bool = typer.Option(
        False, "--force", "-f",
        help="Overwrite existing file"
    ),
):
    """
    Scaffold a new policy.yaml from a built-in template.
    
    Available templates: strict-local-dev, claude-filesystem, cursor-shell,
    github-mcp, fetch-browser, ci-safe
    """
    from rich.console import Console
    console = Console()
    
    import shutil
    
    # Locate template directory
    template_dir = Path(__file__).parent.parent / "examples" / "policies"
    available = [f.stem for f in template_dir.glob("*.yaml")]
    
    if template not in available:
        console.print(f"[red]Unknown template: '{template}'[/]")
        console.print(f"[yellow]Available templates:[/] {', '.join(available)}")
        raise typer.Exit(code=1)
    
    src = template_dir / f"{template}.yaml"
    dst = Path(output)
    
    if dst.exists() and not force:
        console.print(f"[red]File already exists: {dst}[/]")
        console.print("[yellow]Use --force to overwrite.[/]")
        raise typer.Exit(code=1)
    
    shutil.copy2(src, dst)
    console.print(f"[green]✅ Created {dst} from template '{template}'[/]")


@app.command()
def export(
    session_id: str = typer.Argument(..., help="The session ID to export"),
    format: str = typer.Option(
        "json", "--format", "-f",
        help="Export format: json or csv"
    ),
    log_dir: str = typer.Option(
        DEFAULT_LOG_DIR, "--log-dir", "-l",
        help="Directory containing audit log files"
    ),
    output: Optional[str] = typer.Option(
        None, "--output", "-o",
        help="Output file path (default: stdout)"
    ),
):
    """
    Export a TraceGate session as JSON or CSV.
    """
    import csv
    import io
    from rich.console import Console
    console = Console()
    
    log_file = Path(log_dir) / f"session_{session_id}.jsonl"
    
    if not log_file.exists():
        console.print(f"[red]Session not found: {log_file}[/]")
        raise typer.Exit(code=1)
    
    events = []
    with open(log_file, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    
    if format == "json":
        data = json.dumps(events, indent=2, default=str)
    elif format == "csv":
        if not events:
            data = ""
        else:
            # Flatten payload into columns
            output_buffer = io.StringIO()
            fieldnames = ["timestamp", "session_id", "sequence", "event_type"]
            # Add common payload keys
            payload_keys = set()
            for e in events:
                payload_keys.update(e.get("payload", {}).keys())
            for k in sorted(payload_keys):
                fieldnames.append(f"payload_{k}")
            
            writer = csv.DictWriter(output_buffer, fieldnames=fieldnames)
            writer.writeheader()
            for e in events:
                row = {
                    "timestamp": e.get("timestamp", ""),
                    "session_id": e.get("session_id", ""),
                    "sequence": e.get("sequence", ""),
                    "event_type": e.get("event_type", ""),
                }
                for k, v in e.get("payload", {}).items():
                    row[f"payload_{k}"] = json.dumps(v, default=str)
                writer.writerow(row)
            data = output_buffer.getvalue()
    else:
        console.print(f"[red]Unknown format: '{format}'. Use 'json' or 'csv'.[/]")
        raise typer.Exit(code=1)
    
    if output:
        with open(output, "w") as f:
            f.write(data)
        console.print(f"[green]✅ Exported {len(events)} events to {output}[/]")
    else:
        typer.echo(data)


@app.command(name="check-policy")
def check_policy(
    policy: str = typer.Argument(..., help="Path to policy.yaml"),
):
    """
    Validate a policy file.
    """
    from tracegate.policy import PolicyEngine

    try:
        engine = PolicyEngine(policy)
        typer.echo(
            f"✅ Policy '{policy}' is valid. "
            f"Loaded {len(engine.config.rules)} rules. "
            f"Default action: {engine.config.default_action.value}"
        )
    except Exception as e:
        typer.echo(f"❌ Invalid policy: {e}", err=True)
        raise typer.Exit(code=1)


@app.command()
def dashboard(
    host: str = typer.Option("127.0.0.1", help="Host to bind the dashboard server"),
    port: int = typer.Option(8080, help="Port to bind the dashboard server"),
):
    """
    Launch the TraceGate Web Dashboard.
    """
    from rich.console import Console
    console = Console()
    
    try:
        from tracegate.dashboard.api import run_server
        console.print(f"[bold green]Starting TraceGate Dashboard on http://{host}:{port}[/]")
        run_server(host=host, port=port)
    except ImportError:
        console.print("[bold red]Dashboard dependencies not found.[/]")
        console.print("Please install them with: [cyan]pip install tracegate\\[dashboard][/]")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
