<div align="center">

<img src="static/icon.svg" width="96" alt="StackRadar logo — radar rings with a cyan sweep">

# StackRadar — your whole stack on one local screen: repos, ports, secrets, network traffic, AI agents, skills and schedules

**A 100% local developer-workspace dashboard for macOS, Windows and Linux. Free for personal use.**
Find every project on your computer, see what it is and how to run it, catch leaked API keys, **see and block what each app sends to the internet**, watch CPU / memory / load,
track Claude Code, Codex, Hermes, OpenClaw and Paperclip agents, spot unused or duplicate skills, list every cron job,
dedupe files, compress archived projects and update outdated packages in one click.

<sub>Formerly **DevRadar** (renamed in 2.1 because the old name clashed with other developer projects).</sub>

[![Latest release](https://img.shields.io/github/v/release/SYasJ/StackRadar?label=version&color=39c5e0)](https://github.com/SYasJ/StackRadar/releases/latest)
[![CI](https://github.com/SYasJ/StackRadar/actions/workflows/stackradar-ci.yml/badge.svg)](https://github.com/SYasJ/StackRadar/actions/workflows/stackradar-ci.yml)
[![License: free for personal use](https://img.shields.io/badge/license-free%20for%20personal%20use-2dd4a7)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-0b0e14)](#install)

[Download](#install) · [Watch the 56-second tour](media/video/stackradar-promo.mp4) · [Wiki](https://github.com/SYasJ/StackRadar/wiki) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

![StackRadar overview dashboard: projects, secrets, risk, ports, AI agents, skills, schedules and duplicate files](media/screenshots/01-overview.jpg)

</div>

---

## Why StackRadar?

If you vibe-code with several AI agents, your machine slowly fills up with half-finished apps, forgotten `.env` files, mystery
ports, duplicate skills and cron jobs nobody remembers. StackRadar scans the folders you choose and answers, for **every**
project it finds:

| You ask | StackRadar shows |
|---|---|
| What is this repo and how do I run it? | Purpose (README / manifest), language, framework, the exact run command and why |
| Did I leave API keys lying around? | Every secret, **masked**, with file and line. Plus `.env` files git would commit |
| Which app is sending my data, and where? | **Network Guard**: live connections per app with bytes ↑ / ↓, the **file and line** behind each one, sensitive-data alerts, and **allow / deny** prompts with **Low / Medium / Strict** levels |
| What's running and on which port? | A live **Ports** tab: every listening port, its program, project and who can reach it, with **Stop / Force kill**. ▶ Run any project from the list |
| How does it all connect? | An interactive **lineage graph**: projects ↔ runtimes ↔ dependencies ↔ ports ↔ secrets ↔ AI tools ↔ skills ↔ schedules |
| Is my machine struggling? | Live **CPU, per-core, load average, memory, swap, disk, network** and the heaviest processes |
| Which AI agents do I have? | **Claude Code, Codex CLI, Hermes Agent, OpenClaw, Paperclip, Gemini CLI, Cursor, Windsurf, Copilot CLI, OpenCode, Goose, Aider, Qwen Code, Amp, Kiro, Continue, Cline/Roo, Ollama, LM Studio**: version vs newest, every session (hand off / tag / archive / delete), tokens **by model and by CLI / IDE / app**, MCP servers, processes (stop old ones) |
| This project stalled. Can another agent finish it? | **Continue with another agent**: a brief from the last session and the command for Claude Code, Codex, Gemini CLI, Aider or OpenCode with the model you pick |
| Which skills do I actually use? | Every `SKILL.md`, slash command and sub-agent, real usage counts, never-used skills, **duplicates with every location**, delete / share / "keep one, link the rest" |
| What runs on a timer? | GitHub Actions / Vercel / node-cron / Celery crons, your crontab, launchd, systemd timers, Task Scheduler and **agent cron jobs**, with next-run countdowns, and **pause / re-time / delete** |
| Where is my disk space going? | **Disk space** drill-down, **caches** with one-click clean, **strict duplicates** (same name + size + content, kept apart from renamed copies and look-alikes), copied projects, **archive = compress** |
| What's installed and what's outdated? | **Tools & packages**: CLI tools, pip, npm, Homebrew, pipx, cargo, zsh plugins with version, newest version, last used, unused; update / remove; **what's new** in each release |
| Can I make it mine? | Light / dark / auto **themes**, presets, edit every color, import / export; categories and tags for projects; every table sorts |

Every panel has an ⓘ hint, and one switch turns them all off. Features you don't use can be hidden in Settings.

## Screenshots

| | |
|---|---|
| ![Network Guard signal radar with apps, hosts and data flowing in and out](media/screenshots/17-network.jpg) **Network Guard**: who talks to the internet | ![Allow or deny prompt showing the app, host and source line](media/screenshots/18-network-prompt.jpg) **Allow / deny** every new destination |
| ![Lineage graph with glowing project nodes and animated links](media/screenshots/03-lineage.jpg) **Lineage**: force, radial and flow layouts | ![Live system monitor with CPU ring, sparklines and top processes](media/screenshots/04-system.jpg) **System**: live CPU, memory, load and disk |
| ![AI agents grid: Claude Code, Codex, Hermes, OpenClaw, Paperclip](media/screenshots/05-agents.jpg) **Agents**: every AI coding agent on the machine | ![Skills table with usage bars and duplicate badges](media/screenshots/06-skills.jpg) **Skills**: used, unused, duplicated |
| ![Schedules timeline and next-run table with pause, edit and delete buttons](media/screenshots/07-schedules.jpg) **Schedules**: what runs at 2 a.m., pause or re-time it | ![Same-name files with different content, with image dimensions](media/screenshots/29-duplicates-lookalike.jpg) **Duplicates**: exact copies vs look-alikes |
| ![Ports tab listing every listening port with stop buttons](media/screenshots/22-ports.jpg) **Ports**: what's listening, stop it | ![Tools and packages with versions, last used and update buttons](media/screenshots/23-tools.jpg) **Tools & packages**: outdated, unused, what's new |
| ![Agent detail with sessions, models, tokens and actions](media/screenshots/27-agent-detail.jpg) **Agent sessions**: hand off, tag, archive | ![Hand-off brief with commands for Claude Code, Codex and Gemini](media/screenshots/28-handoff.jpg) **Continue with another agent** |
| ![Caches with sizes and one-click clean](media/screenshots/25-caches.jpg) **Caches**: one-click clean | ![StackRadar in the light theme](media/screenshots/31-theme-light.jpg) **Themes**: light, dark, yours |

🎬 **[Watch the 56-second promo](media/video/stackradar-promo.mp4)** (silent, 1280×720)

## Install

### Desktop app (recommended)

Download the latest release for your OS from **[GitHub Releases](https://github.com/SYasJ/StackRadar/releases/latest)** (current version: **2.2.0**):

| OS | File | Notes |
|---|---|---|
| macOS (Apple silicon + Intel) | `StackRadar-x.y.z-mac-arm64.dmg` / `-x64.dmg` | Drag to Applications. First launch: **System Settings → Privacy & Security → Open Anyway** |
| Windows 10/11 | `StackRadar-x.y.z-win-x64.exe` (installer) or `StackRadar-x.y.z-portable.exe` | SmartScreen may warn on unsigned builds: **More info → Run anyway** |
| Linux | `StackRadar-x.y.z-linux-x86_64.AppImage` or `.deb` | `chmod +x` the AppImage and run it |

The desktop app bundles its own engine (no Python needed) and **updates itself** from GitHub Releases.

> **No Apple Developer ID or Windows certificate yet**, so macOS and Windows ask you to confirm the first launch:
> - **macOS:** open StackRadar, click **Done**, then **System Settings → Privacy & Security → Open Anyway**. "Damaged"? Run
>   `xattr -dr com.apple.quarantine /Applications/StackRadar.app`. Updates show a **Download** prompt (macOS only auto-installs signed apps).
> - **Windows:** SmartScreen → **More info → Run anyway**. Updates then install by themselves.
>
> Every dialog, with checksums: **[Installing unsigned builds](docs/wiki/Installing-Unsigned-Builds.md)**. Signed builds are planned for 2.2 ([roadmap](ROADMAP.md)).

### Run from source (any OS, Python 3.9+, no dependencies)

```bash
git clone https://github.com/SYasJ/StackRadar.git && cd StackRadar
python3 stackradar.py                 # scans your home folder → http://localhost:8765
python3 stackradar.py --root ~/Projects --depth 4 --open
```

Windows: `python stackradar.py`, or double-click `StackRadar.bat`. macOS: double-click `StackRadar.command`.

## Privacy & safety

- **Nothing leaves your machine.** No telemetry, no accounts. The only network calls are ones you click (check outdated packages, update packages, check for a StackRadar update).
- The server listens on **127.0.0.1 only**, and every API call needs a per-launch token (blocks CSRF and DNS-rebinding attacks from websites).
- Secrets are **always masked** (first 4 / last 2 characters).
- The Network Guard never decrypts HTTPS, and only changes your OS firewall after you confirm a dialog that shows the exact command.
- Delete moves to the **Trash / Recycle Bin**. Permanent delete needs the folder name typed. Kill / stop only targets processes inside scanned projects.
- Package updates run your own package manager with validated package names. No shell strings.

More: [Security & privacy](docs/wiki/Security-and-Privacy.md).

## Documentation

The **[StackRadar wiki](https://github.com/SYasJ/StackRadar/wiki)** (source in [`docs/wiki`](docs/wiki/Home.md)) covers [installation](docs/wiki/Installation.md), a [feature tour](docs/wiki/Features-Tour.md),
the [Network Guard](docs/wiki/Network-Guard.md), the [lineage graph](docs/wiki/Lineage-Graph.md), [AI agents & skills](docs/wiki/AI-Agents-and-Skills.md), [schedules](docs/wiki/Schedules.md),
the [system monitor](docs/wiki/System-Monitor.md), [package updates](docs/wiki/Package-Updates.md), [hints & settings](docs/wiki/Hints-and-Settings.md),
the [desktop app & auto-update](docs/wiki/Desktop-App-and-Auto-Update.md), the [local API](docs/wiki/Local-API.md),
[releasing & versioning](docs/wiki/Releasing-and-Versioning.md), the [roadmap](ROADMAP.md), the [FAQ](docs/wiki/FAQ.md) and [troubleshooting](docs/wiki/Troubleshooting.md).
A landing page lives in [`docs/index.html`](docs/index.html) (deployed with GitHub Pages).

## Project layout

```
StackRadar/
├── stackradar.py        ← the engine: scanner + local HTTP server + actions (stdlib only)
├── index.html           ← dashboard shell
├── static/              ← app.js (core) · features.js (tabs, hints, updates) · network.js (Network Guard) · lineage.js (graph) · style.css · icon.svg
├── desktop/             ← Electron app (dmg / exe / AppImage) + auto-update
├── docs/                ← landing page (SEO) + wiki pages
├── demo/                ← fake-workspace generator + screenshot script
├── tests/               ← unit + HTTP security tests  (python3 -m unittest discover -s tests)
├── scripts/             ← bump_version.py · release_notes.py · publish_wiki.py
├── VERSION · CHANGELOG.md · ROADMAP.md
└── media/               ← screenshots, promo video
```

## License

**Free for personal, non-commercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE): personal projects,
learning, students, research, charities, schools and government are all free, and companies can evaluate it for 30 days.
**Commercial use** (at or for a company, client work, bundling or reselling) **needs a paid license**; see
[COMMERCIAL.md](COMMERCIAL.md). Copyright © 2026 Yasir Jilani.

## Maintainer & releases

StackRadar is built and maintained by [@SYasJ](https://github.com/SYasJ). Bug reports and ideas are welcome as
[issues](https://github.com/SYasJ/StackRadar/issues). Tests: `python3 -m unittest discover -s tests`. Releases are cut with
`python3 scripts/bump_version.py minor` → edit `CHANGELOG.md` → commit → push to `main`. GitHub Actions then builds and publishes the installers.
See [Releasing & versioning](docs/wiki/Releasing-and-Versioning.md).

<sub>Keywords: developer dashboard, application firewall, outbound connection monitor, per-app network monitor, little snitch alternative, data exfiltration detection, local dev environment manager, project finder, port monitor, API key scanner, secrets
detection, Claude Code token usage, AI agent manager, MCP servers, SKILL.md manager, cron job viewer, duplicate file finder,
outdated npm packages, pip updates, Homebrew, system monitor, Electron app, macOS, Windows, Linux.</sub>
