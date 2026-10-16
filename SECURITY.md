# Security Policy

StackRadar reads sensitive things on your machine (project files, secrets, network connections, running processes), so we take security reports seriously.

## Supported versions

| Version | Supported |
|---|---|
| 2.2.x (latest) | ✅ |
| < 2.2 | ❌ Please update. The desktop app updates itself. |

## Reporting a vulnerability

**Please do not open a public issue.** Report privately via GitHub's
**[private vulnerability reporting](https://github.com/SYasJ/StackRadar/security/advisories/new)** with:

- a description of the issue and its impact
- steps or a proof of concept to reproduce it
- the affected version and OS

What to expect:

- Acknowledgement within **3 working days**.
- An assessment and fix plan within **14 days**.
- Credit in the release notes, if you'd like it, once a fix ships.

## Scope

In scope:

- The local server (`stackradar.py`): authentication token, CSRF and DNS-rebinding protection, path traversal, command injection
- Secret masking and any path where unmasked secrets could leave the machine
- Network Guard firewall changes and allow/deny prompts
- The desktop app (`desktop/`): auto-update integrity, preload / IPC exposure
- Destructive actions (delete, kill, archive) acting outside the projects you scanned

Out of scope:

- Attacks that already require full control of the user's account or machine
- Reports produced by automated scanners without a demonstrated impact

## How StackRadar protects you

The [Security & privacy](docs/wiki/Security-and-Privacy.md) wiki page has the full list: localhost-only binding, a per-launch API token, masked secrets, Trash-first deletes, no telemetry, and firewall changes only after an explicit confirmation.
