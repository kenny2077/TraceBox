# TraceBox: Product Specification

> Local black-box recorder and safety layer for AI coding agents.
> See what your agent changed, what it risked, what it touched, and how to undo it.

---

## 1. Product Identity

**Name:** TraceBox
**Tagline:** Local black-box recorder for AI coding agents.
**Subtagline:** See what your agent changed, what it risked, what it touched, and how to undo it.

**Emotional hook:**
> AI agents are getting powerful enough to change your machine, but not trustworthy enough to leave unsupervised.

**The 60-second aha moment:**
```bash
tracebox run -- claude
# agent works...
tracebox open
# See: files changed, risks, secrets touched, rollback button
```

---

## 2. Target Users

### Primary (v0.1-v0.3)
- Indie devs using Claude Code, Codex, Cursor, Gemini CLI
- AI coding power users who run agents on real repos
- TypeScript/JavaScript developers (RippleGraph limitation)

### Secondary (v0.4+)
- Small teams nervous about agent mistakes
- Security-conscious teams
- Python/Go/Rust developers (as graph support expands)

### Not Target (explicitly)
- Enterprise compliance teams (yet)
- Cloud LLM app operators (Langfuse owns this)
- Non-technical users

---

## 3. Core Jobs-to-be-Done

### Job 1: "Before my agent edits a file, tell me what will break."
**Solution:** RippleGraph pre-action risk injection.

### Job 2: "When my agent tries to run a tool, stop it if it's dangerous."
**Solution:** TraceGate runtime policy enforcement.

### Job 3: "After my agent finishes, show me exactly what changed."
**Solution:** File/git recorder + timeline UI.

### Job 4: "If my agent broke something, help me undo it."
**Solution:** Rollback engine with reverse patches + snapshot restore.

### Job 5: "Give me a receipt I can share or review."
**Solution:** TraceCanvas-style source-grounded reports.

---

## 4. User Flows

### Flow 1: First-Time Setup (60 seconds to aha)

```bash
# Install
pip install tracebox

# Initialize in project
cd ~/projects/my-app
tracebox init
# → Detects git repo, detects agent configs, creates .tracebox/

# Run agent through TraceBox
tracebox run -- claude
# → "Fix the auth bug in src/auth.ts"
# → Agent works...

# Open the report
tracebox open
# → Timeline shows:
#   - 10:42:01 Session started
#   - 10:42:03 Read src/auth.ts
#   - 10:42:05 ⚠️ HIGH risk: 6 callers, 2 tests
#   - 10:42:11 Edit src/auth.ts
#   - 10:42:18 Run git diff
#   - 10:42:23 ⚠️ npm install left-pad
#   - 10:42:30 Test recommendation: auth.test.ts not run
#   - 10:42:41 Session ended
# → Rollback available: "tracebox rollback session_abc123"
```

### Flow 2: Policy Block

```bash
# Agent tries: rm -rf /tmp/build
# TraceGate intercepts:

============================================================
  ⚠️  TraceBox: Blocked
============================================================
  Tool:    execute_command
  Risk:    CRITICAL
  Reason:  Matched destructive command pattern
  Args:    { "command": "rm -rf /tmp/build" }

  Allow once / Always allow similar / Deny
============================================================

# User presses 'n'
# → Blocked, logged, agent sees error
```

### Flow 3: Rollback

```bash
$ tracebox rollback session_abc123

This will revert:
  - Modified files: 3 (src/auth.ts, src/api.ts, package.json)
  - Created files: 2 (will be deleted: /tmp/agent-output-1, /tmp/agent-output-2)
  - Deleted files: 1 (will be restored: src/old-utils.ts)

⚠️  Cannot safely rollback:
  - Network request to https://api.stripe.com/... (irreversible)
  - npm install may have run install scripts

Proceed? [y/N/dry-run] y

✅ Rollback complete.
📄 Report: .tracebox/rollbacks/session_abc123_report.md
```

### Flow 4: PR Comment

```bash
$ tracebox pr-comment session_abc123

# Generates Markdown for GitHub PR:

## Agent Session Report (TraceBox)

**Agent:** Claude Code | **Duration:** 12m 34s | **Trust Score:** 73/100

### Files Changed
| File | Operation | Risk |
|------|-----------|------|
| src/auth.ts | Modified | HIGH (6 callers) |
| src/api.ts | Modified | MODERATE |
| package.json | Modified | LOW (dependency change) |

### ⚠️ High-Risk Actions
- Edited exported function `validateToken()` without updating callers
- Read `.env.example` (not blocked, but logged)
- Ran `npm install` without running tests after

### Recommended Tests (Not Run)
- `tests/auth/service.test.ts`

### Rollback
```bash
tracebox rollback session_abc123
```
```

---

## 5. Feature Priorities

### P0 (Must have for v0.1)
- [ ] Session creation and tracking
- [ ] Git before/after snapshot
- [ ] File diff timeline
- [ ] Tool-call logging (TraceGate)
- [ ] Pre-edit risk injection (RippleGraph)
- [ ] Markdown report export
- [ ] Rollback patch generation
- [ ] Basic policy blocks (destructive shell, sensitive paths)

### P1 (Must have for v0.2)
- [ ] Policy presets (safe-default, strict, permissive)
- [ ] Allow/deny/ask with /dev/tty prompt
- [ ] Approval memory (rule + tool + fingerprint)
- [ ] DLP redaction in responses
- [ ] Network destination logging
- [ ] Dashboard UI (local web)

### P2 (Must have for v0.3)
- [ ] VS Code/Cursor extension
- [ ] PR comment generator
- [ ] Test-run detection
- [ ] Session compare
- [ ] Agent reliability score
- [ ] Package install risk warnings
- [ ] Per-project policies

### P3 (Should have for v0.4)
- [ ] Signed audit logs (Ed25519)
- [ ] OTel export
- [ ] MCP Streamable HTTP support
- [ ] Monorepo support
- [ ] Python/Go/Rust graph parsers
- [ ] Policy learning from history
- [ ] Team mode

### P4 (Nice to have)
- [ ] Windows support
- [ ] Policy hot-reload
- [ ] Notification webhooks
- [ ] Prometheus metrics
- [ ] Plugin system for custom risk classifiers

### P5 (Explicitly out of scope)
- [ ] Cloud SaaS dashboard
- [ ] Full SIEM integration
- [ ] eBPF tracing
- [ ] Enterprise RBAC
- [ ] Generic LLM app observability
- [ ] Agent evaluation platform
- [ ] Visual node graph as main interface

---

## 6. Competitive Positioning

### Comparison Table

| Product | Main Focus | TraceBox Wedge |
|---------|-----------|----------------|
| Langfuse / AgentOps | LLM app observability | We observe local coding-agent effects on repos |
| mcp-firewall / Pipelock | MCP/network security | We combine security with repo impact + rollback |
| AgentSight | System-level tracing | We provide developer workflow, semantic code risk, undo |
| Cursor/Claude native logs | Vendor-specific agent history | We are cross-agent, local, exportable |
| Git diff | File changes only | We add intent/tool/risk/timeline context |

### Positioning Statements

**Bad:** "TraceGate is an MCP firewall." → Crushed by Pipelock.
**Bad:** "RippleGraph is a code graph for agents." → Too narrow.
**Bad:** "TraceCanvas makes AI HTML reports." → Different job.

**Good:** "TraceBox is a local safety recorder for AI coding agents. It captures what the agent changed, what tools it used, what risk it created, and how to undo it."

---

## 7. Monetization Path (Future)

**Free tier:**
- Local session timeline
- File diffs
- Rollback patch
- Basic policies
- One repo
- Local reports

**Pro tier (future):**
- Team dashboard
- Signed/tamper-evident logs
- Central policy management
- OTel/SIEM export
- Multi-repo history
- PR comments / GitHub checks

**Do not monetize before v0.3.** First prove usage.

---

## 8. Key Decisions

### Decision 1: Local-first, always
- No cloud logging
- No API keys required
- No network calls for core features
- SQLite + local filesystem only

### Decision 2: Cross-agent, not vendor-locked
- Support Claude Code, Codex, Cursor, Gemini CLI
- Generic MCP adapter for future agents
- Not a Cursor plugin or Claude extension

### Decision 3: Fail-open hooks
- Broken hook returns `{}`, never blocks agent
- Product is advisory + recording, not mandatory gate
- Policy enforcement is opt-in per session

### Decision 4: Honest limitations
- "Not a sandbox" — clearly stated
- "Cannot rollback network requests" — clearly stated
- "Mutable local logs" — clearly stated
- Honesty builds trust

---

*End of Product Specification*
