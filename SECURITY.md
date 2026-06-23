# Security Policy

## Reporting a Vulnerability

TraceBox takes security seriously. If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer directly. We will respond within 48 hours with an acknowledgment and a timeline for resolution.

### What to Include

- A clear description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations you've identified

### Disclosure Timeline

1. You report the vulnerability privately
2. We acknowledge receipt within 48 hours
3. We investigate and develop a fix (typically within 7 days)
4. We release a patch and publish a security advisory
5. Credit is given to the reporter (unless you prefer to remain anonymous)

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Model

TraceBox is a local-first tool. It never sends your data to the cloud. However, there are still security considerations:

### What TraceBox Does

- Records file changes, tool calls, and policy decisions into a local SQLite database
- Detects secrets and API keys in agent tool output using pattern matching
- Redacts sensitive data from session logs when DLP is enabled
- Enforces policy rules to block or approve agent actions

### What TraceBox Does NOT Do

- Send telemetry, analytics, or usage data anywhere
- Require API keys or internet access
- Execute code from untrusted sources
- Modify files without explicit user approval (when policy is configured)

### Attack Surface

The primary security concerns for TraceBox are:

| Concern | Mitigation |
|---------|-----------|
| **Local database access** | SQLite database is stored in `.tracebox/` with standard filesystem permissions. Anyone with filesystem access can read it — treat it like `.git`. |
| **Policy bypass** | If an attacker can modify `.tracebox/policy.yaml`, they can relax restrictions. Protect your project config. |
| **Session log exfiltration** | Logs contain tool arguments which may include secrets. Use DLP redaction (`dlp_enabled: true` in policy) and never commit `.tracebox/` to version control. |
| **MCP proxy trust** | TraceGate acts as a man-in-the-middle for MCP tool calls. An attacker with process-level access could intercept or modify tool calls. |

### DLP (Data Loss Prevention)

When DLP is enabled in your policy configuration, TraceBox automatically detects and redacts:

- API keys (AWS, GitHub, OpenAI, Stripe, etc.)
- Private keys (SSH, PGP)
- JWT tokens
- Connection strings with credentials
- OAuth tokens

DLP uses regex-based pattern matching and runs locally — no network calls.

## Security Best Practices

1. **Never commit `.tracebox/`** — Add it to `.gitignore`
2. **Enable DLP** — Set `dlp_enabled: true` in your policy.yaml
3. **Use strict policies** — Default to `safe-default` or `strict` preset
4. **Review sessions** — Run `tracebox open` after each agent session
5. **Rotate exposed secrets** — If a secret appears in a session log, rotate it immediately

## Acknowledgments

We appreciate the security research community's contributions to making TraceBox safer. Past contributors will be listed in our security advisories.
