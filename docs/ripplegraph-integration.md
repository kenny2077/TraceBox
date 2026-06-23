# RippleGraph Integration

> Code impact analysis via static graph. Requires Bun runtime.

## Status

RippleGraph is an optional TraceBox component. It provides **pre-action risk analysis**: before your agent edits a file, RippleGraph tells you what depends on it.

## Prerequisites

- **Bun** runtime (required — Node.js has an ESM compatibility issue with `better-sqlite3`)
- TypeScript/JavaScript project (Python/Rust/Go support is planned)

Install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

## How It Works

```
Agent wants to edit src/auth/service.ts
  ↓
TraceBox calls: bun run packages/graph/dist/index.js analyze src/auth/service.ts
  ↓
RippleGraph returns:
  {
    "file": "src/auth/service.ts",
    "risk": "high",
    "impact_score": 60,
    "affected_callers": ["src/api/login.ts", "src/auth/middleware.ts"],
    "affected_tests": ["tests/auth/service.test.ts"],
    "symbol_count": 5
  }
  ↓
TraceBox stores this as an impact event in the ledger
  ↓
Timeline shows: ⚠️ HIGH IMPACT: Editing src/auth/service.ts (6 callers, 2 tests)
```

## Manual Usage

```bash
# Build the graph first
cd packages/graph
npm install               # or: bun install
npm run build             # or: bun run tsc

# Edit a file, then run index to update graph
bun run dist/index.js index

# Analyze a file
bun run dist/index.js analyze src/auth.ts --project .

# JSON output
bun run dist/index.js analyze src/auth.ts --project . --format json
```

## Integration with TraceBox

The orchestrator automatically calls RippleGraph when `on_file_edit()` is triggered. If Bun is not available, it gracefully skips impact analysis.

```python
from orchestrator import SessionOrchestrator

orch = SessionOrchestrator(repo_path=".", agent_name="claude")
orch.start_session()
impact = orch.on_file_edit("src/auth.ts")
# Returns None if Bun isn't available or graph isn't built
```

## Troubleshooting

### `ReferenceError: require is not defined`

RippleGraph uses `better-sqlite3` with `require()` in ESM context. This is a known issue when running with Node.js. **Use Bun instead.**

### Graph database is empty

You need to run `bun run dist/index.js index` first to populate the graph. The `analyze` command only queries existing data.

### File not found in graph

If you get `{"error": "File not found in graph", "file": "..."}`:
1. Make sure you ran `index` first
2. The file may use unusual imports that RippleGraph doesn't resolve
3. Check that the project path is correct with `--project .`

## Future

- [ ] Python/Go/Rust parser support
- [ ] Monorepo-aware resolution
- [ ] LSP-based precise call resolution
- [ ] Direct SQLite querying from Python (no subprocess)
