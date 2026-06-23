# Changelog

All notable changes to TraceBox.

## [1.0.0] — 2026-06-23

### Added
- Complete Python core: Ledger, Recorder, Policy Engine, Rollback Engine, Report Generator, Timeline UI, OTel Exporter, PR Comment Generator, MCP Server, File Watcher, Session Orchestrator
- 12 CLI commands: `init`, `run`, `open`, `timeline`, `rollback`, `export`, `pr-comment`, `policy`, `install`, `uninstall`, `serve`, `doctor`
- 3 policy presets: `safe-default`, `strict`, `permissive`
- Custom YAML policy rules per project
- 3 report formats: Markdown, HTML, JSON
- OTel GenAI span export (OTLP JSON)
- GitHub-flavored PR comment generation
- Session timeline UI (CLI + web dashboard via FastAPI)
- Agent hook installer: Claude Desktop, Codex CLI, Cursor, Hermes Agent
- 9-scenario rollback matrix with git-based undo
- File watcher with watchdog + polling fallback
- Network destination logger
- DLP/secret detection
- pip-installable package (`pip install tracebox`)
- Unit test suite (Ledger, Policy, Recorder, Report)
- CI/CD pipeline (GitHub Actions)

### Changed
- Version bumped from 0.1.0 to 1.0.0
- Package structure refactored for pip installability
- All version strings unified to 1.0.0
- Development status: Alpha → Production/Stable

### Known Limitations
- RippleGraph (TypeScript impact analysis) has unresolved DB exports; runs only from source
- VSCode extension not yet implemented
- Package restore in rollback not yet implemented
- Streamable HTTP MCP support not yet implemented
