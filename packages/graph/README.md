<p align="center">
<pre align="center">
 ██████╗ ██╗██████╗ ██████╗ ██╗     ███████╗ ██████╗ ██████╗  █████╗ ██████╗ ██╗  ██╗
 ██╔══██╗██║██╔══██╗██╔══██╗██║     ██╔════╝██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██║  ██║
 ██████╔╝██║██████╔╝██████╔╝██║     █████╗  ██║  ███╗██████╔╝███████║██████╔╝███████║
 ██╔══██╗██║██╔══██╗██╔═══╝ ██║     ██╔══╝  ██║   ██║██╔══██╗██╔══██║██╔══██╗██╔══██║
 ██║  ██║██║██║  ██║██║     ███████╗███████╗╚██████╔╝██║  ██║██║  ██║██████╔╝██║  ██║
 ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝
</pre>
</p>

<p align="center"><strong>Impact analysis that tells your AI agent what will break <em>before</em> it edits.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-333" alt="Version 1.0.0"></a>
  <img src="https://img.shields.io/badge/tests-311%20passing-brightgreen" alt="311 tests passing">
  <a href="#development"><img src="https://img.shields.io/badge/runtime-bun%201.2%2B-fbf0df" alt="Bun 1.2+"></a>
  <a href="#development"><img src="https://img.shields.io/badge/runtime-node%2020%2B-339933" alt="Node 20+"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#limitations">Limitations</a>
</p>

---

## The problem

AI coding agents are fast but structurally blind. When Claude Code or Codex edits `src/auth.ts`, it does not know:

- That 12 handlers across 5 files call `validateToken()`
- That the auth middleware references `refreshToken()` on every request
- That 3 test files cover this module and should be re-run
- That changing the return type will break `src/api/login.ts`

The agent makes changes that are locally correct but globally wrong. You end up reviewing for side effects as much as you would have coded manually.

## The solution

RippleGraph builds a knowledge graph of your TypeScript/JavaScript codebase, then injects a compact **edit-risk briefing** before every file edit. The agent learns what depends on the file, which tests cover it, and how risky the change is — without you having to explain the codebase first.

**No API keys. No network calls. No LLM. Pure static analysis, runs entirely on your machine.**

---

## What the agent sees

Before editing `src/auth/service.ts`, RippleGraph injects this briefing:

```
RippleGraph edit-risk briefing for src/auth/service.ts:
Risk: MODERATE (3 callers, 1 related tests)
Why: 3 callers, 1 related tests
Read first:
  1. tests/auth/service.test.ts
  2. src/auth/middleware.ts
  3. src/api/login.ts
Recommended tests:
  - bun test -- tests/auth/service.test.ts
Rules:
  - Preserve public function signatures unless callers are updated.
  - Run recommended tests before committing.
```

Without RippleGraph, the agent edits the file blindly. With RippleGraph, it knows to check callers first.

---

## Quickstart

```bash
# Install globally
npm install -g ripplegraph

# Or with Bun
bun install -g ripplegraph

# Go to your project and initialize
cd /path/to/your-project
ripplegraph init --force

# Install the hook for your agent
ripplegraph hook install claude   # Claude Code
ripplegraph hook install codex    # OpenAI Codex
```

Now edit any `.ts` file — RippleGraph injects a briefing before each edit.

**Verify it works:**

```bash
ripplegraph doctor    # Check setup health
ripplegraph verify    # Run self-test on built-in fixture
```

---

## Features

- 🔍 **Knowledge graph** — SQLite database of files, functions, classes, imports, calls, exports
- ⚡ **Edit-time injection** — Hooks into Claude Code and Codex PreToolUse events
- 🧪 **Test discovery** — Finds which test files import or call the target module
- ⚖️ **Deterministic risk scoring** — Same change = same score, every time. Based on fan-in, cross-layer impact, test coverage, and staleness
- 🛡️ **Fail-open hooks** — A broken hook returns `{}`, never blocks your agent
- 🔄 **Incremental indexing** — Re-indexes only changed files; detects staleness via git commits and file hashes
- 🩺 **Self-diagnosing** — `doctor` checks 8 health indicators; `verify` runs end-to-end smoke tests
- 📦 **Zero external dependencies** — No Docker, no cloud, no API registration

---

## How it works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Source     │────▶│   Parser    │────▶│  Resolver   │
│  .ts/.tsx   │     │ tree-sitter │     │ import paths│
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
┌─────────────┐     ┌─────────────┐     ┌──────▼──────┐
│   Agent     │◀────│    Hook     │◀────│   Graph     │
│ Claude/Codex│     │  Adapters   │     │  SQLite     │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. **Scanner** discovers source files, classifies them, hashes contents for staleness detection
2. **Parser** extracts imports, exports, functions, classes, call expressions via tree-sitter
3. **Resolver** resolves import paths — relative, tsconfig aliases, index files. External packages excluded
4. **Symbol** builds cross-file call graph edges via deterministic name matching across import paths
5. **Graph** stores everything in SQLite (WAL mode): file/function/class nodes, import/call/export edges
6. **Report** produces a compact context string with risk level, caller list, test recommendations, staleness warnings
7. **Hook Adapters** normalize Claude Code and Codex payloads into a shared event model

---

## Commands

### Core workflow

```bash
ripplegraph init --force              # Initialize + build graph
ripplegraph index                     # Incremental update
ripplegraph index --force             # Full rebuild
ripplegraph doctor                    # Check project health
ripplegraph verify                    # Self-test with fixture
```

### Analysis

```bash
ripplegraph explain src/auth/service.ts     # See callers and callees
ripplegraph tests src/auth/service.ts       # Find related test files
ripplegraph diff                            # Impact of uncommitted changes
ripplegraph diff --format markdown          # PR-ready output
ripplegraph context-pack src/auth/service.ts src/api/login.ts
```

### Hook management

```bash
ripplegraph hook install claude       # Add to .claude/settings.json
ripplegraph hook install codex        # Add to .codex/hooks.json
ripplegraph hook uninstall claude     # Remove RippleGraph hook
ripplegraph hook uninstall codex      # Remove RippleGraph hook
ripplegraph hook install claude --dry # Preview without writing
```

---

## Configuration

Hook behavior lives in `.ripplegraph/config.json`:

```json
{
  "hooks": {
    "claude": {
      "enabled": true,
      "minRiskToInject": "MODERATE",
      "maxContextChars": 9000,
      "injectOnStaleGraph": true
    },
    "codex": {
      "enabled": true,
      "minRiskToInject": "MODERATE",
      "maxContextChars": 9000,
      "injectOnStaleGraph": true
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Disable all hook injections for this agent |
| `minRiskToInject` | `"MODERATE"` | Minimum risk to inject — `LOW`, `MODERATE`, `HIGH`, `CRITICAL` |
| `maxContextChars` | `9000` | Hard cap on injected context (100–9000) |
| `injectOnStaleGraph` | `true` | Inject stale-graph warnings even below risk threshold |

---

## Supported agents

| Agent | Intercepted tools | Adapter | Docs |
|-------|-------------------|---------|------|
| [Claude Code](https://claude.ai/code) | Write, Edit, MultiEdit | (default) | [docs/claude-code-hook.md](docs/claude-code-hook.md) |
| [Codex](https://github.com/openai/codex) | apply_patch, Edit, Write | `--adapter codex` | [docs/codex-hook.md](docs/codex-hook.md) |

---

## Project structure

```
src/
├── cli.ts                     # Commander CLI (all commands)
├── index.ts                   # Entry point
├── types.ts                   # Shared TypeScript types
├── config.ts                  # Project detection, config save/load
├── db.ts                      # SQLite CRUD
├── scanner.ts                 # File discovery, classification, hashing
├── parser.ts                  # Tree-sitter init, import/export extraction
├── resolver.ts                # Import path resolution
├── symbol.ts                  # Symbol extraction, call graph edges
├── graph.ts                   # Build orchestration
├── report.ts                  # Impact report formatters
├── commands/
│   ├── doctor.ts              # Health diagnostics
│   ├── verify.ts              # Self-test runner
│   └── hook/                  # contextInject, installClaude, installCodex
├── config/                    # Zod schemas, defaults, loader
├── index/staleness.ts         # Graph freshness detection
└── hooks/
    ├── adapters/              # NormalizedHookEvent, Claude & Codex adapters
    ├── claude/                # Claude hook JSON parser
    ├── codex/                 # Codex settings read/write
    └── context/               # Context string formatter
test/
├── fixtures/repos/            # Controlled test environments
├── analysis/                  # Symbol extraction, cross-file calls
├── commands/                  # Doctor, verify, hook tests
├── impact/                    # Diff direction tests
├── resolver.test.ts           # Import resolution (15 cases)
└── hooks/                     # Context formatting, adapters, parsers
```

---

## Development

### Requirements

| Runtime | Version | Notes |
|---------|---------|-------|
| [Bun](https://bun.sh) | 1.2+ | Recommended — tree-sitter WASM and SQLite perform best |
| [Node.js](https://nodejs.org) | 20+ | Alternative — `vitest run` works via npm |

### Commands

```bash
bun install          # Install dependencies
bun run build        # TypeScript compilation (tsc)
bun test             # Run full test suite (311 tests)
bun run lint         # Type-check (tsc --noEmit)
```

### Testing

Tests cover: config detection, file scanning, SQLite CRUD, CLI integration, staleness detection, hook config validation, Claude/Codex parser correctness, context formatting, install/uninstall, provider-agnostic event normalization, cross-file call resolution, import resolution, impact direction, symbol extraction, and end-to-end hook smoke tests.

> Tests use [Vitest](https://vitest.dev). Fixture projects in `test/fixtures/` provide controlled test environments.

---

## ⚠️ Limitations

RippleGraph is opinionated about scope. Here's what it does and does not do:

| What it does | What it does NOT do (yet) |
|--------------|---------------------------|
| TypeScript/JavaScript import and call graph extraction | Python, Go, Rust parsers (planned for v0.4) |
| Named import resolution with tsconfig path aliases | Deep barrel-file re-export traversal (partial: follows `export { x } from './y'`) |
| Default and namespace import tracking (file-level edges) | LSP-based precise call resolution (planned for v0.5) |
| Exported function/class/const-arrow-function detection | Class method call resolution across files |
| Single-project workspaces | Monorepo support with cross-package resolution (planned for v0.5) |
| Deterministic risk scoring (fan-in, cross-layer, test coverage, staleness) | AI-generated fix suggestions |
| Claude Code and Codex PreToolUse hooks | Cursor, Copilot, or other agent hooks (planned for v0.4) |
| Local SQLite graph — no network | Real-time file watching (re-index manually or via CI) |

### Known edge cases

- **Dynamic imports** (`import('foo')`) are tracked as file-level references but not resolved to specific symbols.
- **Re-exports** (`export { x } from './y'`) are detected as exports but the transitive target is not traversed.
- **Method calls** like `obj.method()` are not resolved across files — only bare function calls like `foo()` are.
- **Type-only imports** (`import type { ... }`) are ignored intentionally.
- **Global functions** (undeclared identifiers) are treated as unresolved and skipped.

> See [Security](SECURITY.md) for what RippleGraph deliberately does not do (network access, secrets handling, dynamic code execution).

---

## 🔒 Security

RippleGraph runs entirely on your machine:

- **No network access** — zero outbound requests
- **No secrets** — no API keys, tokens, or credentials
- **Parameterized SQL** — all queries use `?` placeholders
- **Path traversal hardened** — adapters reject `..` and absolute-path escapes
- **Fail-open hooks** — hook errors return `{}`, never block the agent
- **Symlink-safe** — file scanner skips symlinks
- **Static analysis only** — tree-sitter parses code; no `eval()`, no runtime instrumentation

Full details: [SECURITY.md](SECURITY.md)

---

## 🗺️ Roadmap

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

| Version | Status | Focus |
|---------|--------|-------|
| 0.1 | ✅ Shipped | CLI: init, index, diff, explain, context-pack |
| 0.2 | ✅ Shipped | Claude Code PreToolUse hook, risk thresholds, per-agent config |
| 0.3 | ✅ Shipped | Codex hook adapter, cross-file call resolution, shared event model |
| **1.0** | ✅ **Current** | **Resolver correctness, impact direction fix, arrow functions, doctor/verify, deterministic risk scoring** |
| 0.4 | 🚧 Next | MCP server, Python/Go/Rust support, Cursor/Copilot hooks |
| 0.5 | 📋 Planned | LSP-based call resolution, monorepo support, deep barrel-file traversal |

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style, and PR guidelines.

---

## Acknowledgements

RippleGraph's design was informed by studying three excellent projects:

- [**Understand-Anything**](https://github.com/Understand-Anything/Understand-Anything) — knowledge-graph dashboards for codebases
- [**Graphify**](https://github.com/graphify-8/graphify) — confidence-tagged, multi-language graph extraction at scale
- [**Serena**](https://github.com/oraios/serena) — LSP-level precision in an agent-first MCP design

RippleGraph fills the gap none of them address: **automatic, edit-time context injection** — the layer between static analysis and agent safety.

---

## License

MIT © 2026 — see [LICENSE](LICENSE).
