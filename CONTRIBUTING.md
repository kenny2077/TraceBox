# Contributing to TraceBox

## Development Setup

```bash
git clone https://github.com/kenny2077/TraceBox.git
cd TraceBox
pip install -e ".[dev]"
```

## Running Tests

```bash
# Unit tests
pytest tests/unit/ -v

# E2E tests
python3 tests/e2e/test_all.py

# Rollback matrix
python3 tests/e2e/test_rollback_matrix.py

# All tests
pytest tests/unit/ && python3 tests/e2e/test_all.py && python3 tests/e2e/test_rollback_matrix.py
```

## Project Structure

```
tracebox/
├── packages/           # Python packages (pip-installable)
│   ├── core/           # Session orchestrator, network logger
│   ├── ledger/         # SQLite event store
│   ├── recorder/       # Git-based file change detection
│   ├── policy/         # Policy engine + TraceGate MCP proxy
│   ├── rollback/       # Git rollback engine
│   ├── report/         # Report generator + OTel export + PR comments
│   ├── replay/         # Timeline UI (CLI + web dashboard)
│   └── tracebox/       # CLI entry point + main module
├── tests/
│   ├── unit/           # Pytest unit tests
│   ├── e2e/            # End-to-end tests
│   └── fixtures/       # Test fixture repositories
├── integrations/       # Agent hook install scripts
├── docs/               # Architecture, plans, audit
└── pyproject.toml      # Build config
```

## Adding a Policy Preset

Edit `packages/policy/policy_engine.py`:
1. Add your preset dict to `PRESETS`
2. Update `DEFAULT_PRESET` if needed
3. Test: `pytest tests/unit/test_policy.py`

## Adding a CLI Command

Edit `packages/tracebox/main.py`:
1. Add function `my_cmd(args)`
2. Add argparse subparser in `main()`
3. Register in the `commands` dict
4. Test: `tracebox my-cmd`

## Code Style

- Line length: 120 chars
- Imports: standard library first, then third-party, then internal
- Type hints encouraged but not enforced
- Use `ruff` for linting: `ruff check packages/`

## Commit Convention

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `test:` test additions
- `refactor:` code restructure
- `chore:` build/tooling

## Release Process

1. Bump version in `pyproject.toml` and all Python files
2. Update `CHANGELOG.md`
3. Run all tests
4. Tag: `git tag v1.0.0 && git push origin v1.0.0`
