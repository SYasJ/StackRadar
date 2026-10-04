# Roadmap

Where StackRadar is today and where it's heading. Dates are targets, not promises. Ideas and votes are welcome as
[issues](https://github.com/SYasJ/StackRadar/issues) (add a 👍 to the ones you want most).

**Current version: 2.1.0** · [Changelog](https://github.com/SYasJ/StackRadar/blob/main/CHANGELOG.md) · [Download](https://github.com/SYasJ/StackRadar/releases/latest)

| | Version | Theme | Status |
|---|---|---|---|
| ✅ | 1.0 | See every project | Released 2026-09 |
| ✅ | 2.0 | Desktop app, agents, skills, schedules, system | Released 2026-10 |
| ✅ | 2.1 | Network Guard, rename, compressed archives | Released 2026-10 |
| 🚧 | 2.2 | Trust & reach: signed builds, package managers, CLI | Next, Q4 2026 |
| 🗺️ | 2.3 | Deeper Network Guard | Q1 2027 |
| 💡 | 3.0 | StackRadar for your agents | 2027 |

---

## ✅ Done

### 1.0: see every project
- [x] Finds every project under your home folder: purpose, run command, stack, dependencies
- [x] Leaked secrets (masked), risk flags, open ports, last run, git status
- [x] AI / IDE traces and Claude Code token usage
- [x] Reclaim space (`node_modules`, build output), runs with a live console, first lineage graph

### 2.0: the desktop app
- [x] Installable `.dmg`, `.exe` (installer + portable), `.AppImage`, `.deb`, built by GitHub Actions
- [x] Semantic versioning from one `VERSION` file, `bump_version.py`, auto-update from GitHub Releases
- [x] **System** tab: CPU per core, load, memory, swap, disks, network, heaviest processes
- [x] **Agents**: Claude Code, Codex, Hermes, OpenClaw, Paperclip, Gemini CLI, Cursor, Windsurf, Copilot, Aider, Ollama and more
- [x] **Skills**: usage counts, never-used and duplicate skills · **Schedules**: cron everywhere, with a timeline
- [x] **Duplicates** (hash-verified files, copied projects) · **Updates** (npm -g, pip, Homebrew, per project)
- [x] Lineage v2 (force / radial / flow layouts, PNG export), hints on every panel with one off switch
- [x] Security: `127.0.0.1` only, per-launch API token, Host-header check

### 2.1: Network Guard
- [x] Renamed DevRadar → StackRadar, new logo
- [x] Live connections per app with bytes ↑ / ↓, the project, the script and **the source line** behind each host
- [x] Signal radar (data out / in, blocked, waiting)
- [x] Allow / deny prompts, Low / Medium / Strict levels, per-app and global rules
- [x] Sensitive data detection (keys, tokens, PII over plain HTTP), exfiltration alerts, static code map
- [x] One-click OS firewall block (Windows Firewall, pf, nftables)
- [x] Archive = verified `.tar.gz` / `.zip` with restore
- [x] Release notes with step-by-step install for unsigned macOS / Windows builds, `SHA256SUMS.txt`, version in the window title and About box

---

## 🚧 Next: 2.2 "trust & reach" (Q4 2026)

- [ ] **Signed and notarized builds**: Apple Developer ID + notarization (no more *Open Anyway*, silent auto-update on macOS), Windows signing via Azure Trusted Signing or an OV certificate (no SmartScreen warning)
- [ ] **Package managers**: `brew install --cask stackradar`, `winget install StackRadar`, Flatpak / AUR
- [ ] **Headless CLI**: `stackradar scan --json`, `stackradar secrets`, `stackradar net` for scripts and CI
- [ ] **Scheduled scans + desktop notifications**: new secret committed, new app talking to an unknown host, disk filling up
- [ ] **Light theme** and a compact layout for small screens
- [ ] Linux `arm64` builds (Raspberry Pi, ARM laptops)

## 🗺️ Planned: 2.3 "deeper Network Guard" (Q1 2027)

- [ ] **Per-app bytes on Windows** (ETW) so non-guarded apps show ↑ / ↓ like on macOS / Linux
- [ ] **Per-app blocking without root on Linux** (cgroup / nftables per process) and an optional macOS Network Extension
- [ ] **Traffic history**: daily totals per app and host, a "first time seen" timeline
- [ ] Import / export rule sets, share a team rule file in the repo (`.stackradar/rules.json`)
- [ ] DNS view: which app looked up which domain

## 💡 Exploring: 3.0 "for your agents" (2027)

- [ ] **MCP server**: let Claude Code, Codex & co. ask StackRadar "what runs on port 3000?", "which repos use Stripe?"
- [ ] **Vulnerability scanning** of dependencies (OSV / CVE) next to "outdated"
- [ ] **Agent cost tracking**: tokens and $ per agent, per project, per day, with budgets
- [ ] Menu-bar / tray app with the guard prompts and a mini system meter
- [ ] VS Code / Cursor extension: open the current repo's StackRadar view in the editor
- [ ] Plugin API for custom scanners

---

## Known limitations (today)

| Area | Limitation | Planned fix |
|---|---|---|
| Install | Builds are unsigned: one-time *Open Anyway* (macOS) / *Run anyway* (Windows); macOS updates are a manual download | 2.2 signing |
| Network Guard | Only apps started from StackRadar can be stopped per request; other apps are monitored, or blocked by IP at the OS firewall | 2.3 |
| Network Guard | HTTPS contents are never inspected (by design): sensitive-data checks see plain HTTP and your source code | by design |
| Windows | No per-app byte counts for apps not started from StackRadar | 2.3 ETW |
| Updates | Global package updates cover npm, pip and Homebrew (not yet pnpm -g, cargo, gem) | 2.2 |

## How versions work

StackRadar uses [Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**.
- **PATCH** (2.1.**1**): bug fixes only, safe to auto-update.
- **MINOR** (2.**2**.0): new features, nothing removed.
- **MAJOR** (**3**.0.0): something you rely on changes (settings format, API), with migration notes in the changelog.

The `VERSION` file is the single source of truth; see [Releasing & versioning](Releasing-and-Versioning.md).
