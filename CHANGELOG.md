# Changelog

All notable changes to StackRadar. Versions follow [Semantic Versioning](https://semver.org/).
The single source of truth is the `VERSION` file (bump it with `scripts/bump_version.py`).
<!-- next -->

## [2.2.0] — 2026-10-04

The "control centre" release: everything StackRadar shows, you can now act on.

### Fixed
- **Only one project showed up** when your home folder (or the folder you scanned) looked like a project itself, e.g. a `~/.claude` folder plus one script. Your home folder is never a project now, and StackRadar keeps looking inside projects for more projects.
- **Plain git repos without a package file were missed**: the `.git` folder was filtered out before the check ran.
- **No ports on macOS**: the `lsof` reader waited for a line type that `lsof` never prints. On Linux without `ss`, the `/proc` fallback read the wrong column and merged ports.
- **No network speeds on macOS**: per-app byte counters from `nettop` were read but never turned into rates.
- The scan bar said "walking file tree" and jumped around. It now says what it's doing in plain words.

### Added
- **Scan progress with percent and time left**, plus a "still working · 12s" pill on anything that takes a moment, and percent / time left in every job window.
- **Projects**: nested projects (monorepo packages, repos inside repos) with their parent; a **stage** (ready / in progress / incomplete) with what's missing; unfinished folders (README + code, loose scripts, notebooks, static sites) are listed; your own **categories and tags**; a **▶ Run / ■ Stop** button on every row; **click any tag** (language, dependency, AI tool, stage, category) to see every project that has it.
- **Continue with another agent**: hand a stalled project (or any agent session) to Claude Code, Codex, Gemini CLI, Aider or OpenCode, with the model you choose. StackRadar writes a brief from the last session (goal, later instructions, where it stopped, open to-dos, files touched) and gives you the command, or opens it in a terminal.
- **Duplicates** are now strict: *exact* means same name, size and content (SHA-256). Same content under another name and same name with different content (with image dimensions) are listed separately, clearly marked "not duplicates". Check extra folders like `~/Pictures`.
- **Sortable tables everywhere**: click any column header, again to reverse.
- **Ports** tab: every listening port, live, with program, command, project, who can reach it (this computer / your network), owner and start time; **Stop** or **Force kill** your own programs, with the exact admin command for the rest.
- **Network Guard**: choose one project / app / repo and give it its **own security level** and rules; click any app or connection for details and actions (always allow / deny for this app or everyone, OS firewall block, stop the app); **total KB / MB sent and received** next to the live speed; flip or delete rules; clear the log.
- **Tools & packages** tab: CLI tools, Python packages, npm globals, Homebrew formulae and casks, pipx, cargo and zsh plugins with the installed version, the newest version, when you last used it (from your shell history), what uses it, what nothing uses and how old it is; **update or remove** each one; click a package for **what it does and what's new** (release notes since your version).
- **Caches** tab: npm, Yarn, pnpm, pip, uv, Homebrew, Go, Cargo, Gradle, Xcode, simulators, Playwright, browsers, Hugging Face and more, with one-click clean using the tool's own command, and Docker disk use.
- **Disk space** tab: every folder with its size, drill in, delete to the Trash or permanently. Your home folder and its standard folders can never be deleted.
- **Agents**: click an agent for its sessions (title, project, where it ran, model, tokens, size) with view, hand off, tag ("to delete"), archive / restore and delete, single or in bulk; tokens split **by model and by where it ran (CLI, IDE, desktop app, web)**; installed vs newest version with one-click update; its processes with CPU / memory and **"stop all but the newest"**; its skills and MCP servers.
- **Skills**: delete a skill, share it with another agent (linked, so there's one copy), and for duplicates see every location with its version and **"keep this, link the rest"** into the shared `~/.agents/skills` folder. "Identical" now compares every file in the skill folder.
- **Schedules**: pause, resume, change the timing and delete crontab lines, launchd agents, systemd user timers, Windows scheduled tasks and OpenClaw / Hermes jobs, and re-time cron lines in repo files. Every change keeps a backup in `~/.stackradar/backups`.
- **Lineage**: double-click a project to drill in: its folders sized, nested projects, the hosts its code talks to, the agents that worked on it; categories become nodes in the overview.
- **Themes**: light, dark or auto (follows your OS), six presets (Midnight, Dracula, Nord, High contrast, Daylight, Solarized light, Paper), edit every color, save your own presets, import and export theme files.

### Changed
- **License**: StackRadar is now free for personal, non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use needs a paid license ([COMMERCIAL.md](COMMERCIAL.md)). Help → About shows the license, and the installers ship `LICENSE.txt`.

## [2.1.0] — 2026-10-04

### Changed
- **Renamed DevRadar → StackRadar.** The old name collided with devradar.dev, hundreds of "DevRadar" tutorial repos and a Chrome extension. The app id, folders, token header and env vars changed; `~/.devradar` is migrated to `~/.stackradar` on first launch.
- **New logo**: your stack (three layers) inside a radar ring, with outgoing / incoming signal blips.

### Added
- **Network Guard** tab + 🛡 top-bar indicator: live connections per app (Linux `ss` / `/proc`, macOS `lsof` + `nettop`, Windows `netstat`) with bytes ↑ / ↓, mapped to the project, the running script and **the source line that references the host**; an animated **signal radar** (packets out in cyan, in in green, blocked red, asking amber).
- **Allow / deny prompts** for apps started from StackRadar (local egress proxy with per-run identity), **Low / Medium / Strict** levels, per-app and global rules, upstream-proxy chaining.
- **Sensitive-data detection**: secrets / PII in plain-HTTP requests (blocked on Strict), static code map of outbound hosts (credentials over HTTP, secrets to unknown hosts, tracking SDKs), exfiltration and rule-violation alerts.
- **OS firewall block** per host (Windows Firewall / macOS pf / Linux nftables) behind an explicit admin prompt.
- **Archive = compress**: archiving packs a project into a verified `.tar.gz` / `.zip` without regenerable folders, optionally trashes the original; **Archives** panel with restore.

### Fixed
- The drawer's "Ports" heading rendered broken markup.
- Deleted / archived projects disappear from the list immediately instead of after the next scan.

## [2.0.0] — 2026-10-04

### Added
- **Desktop apps**: installable `.dmg` (macOS, Apple silicon + Intel), `.exe` installer + portable build (Windows) and `.AppImage` / `.deb` (Linux), built by GitHub Actions on every `vX.Y.Z` tag, with **auto-update** from GitHub Releases.
- **System** tab: live CPU (per core), load average, memory, swap, disks, network, uptime and the heaviest processes. Processes that belong to your projects can be stopped. Mini CPU/RAM meter in the top bar.
- **Agents** tab: detects Claude Code, Codex CLI, Hermes Agent, OpenClaw (ex-Clawdbot/Moltbot), Paperclip, Gemini CLI, Cursor, Windsurf, Copilot CLI, OpenCode, Goose, Aider, Qwen Code, Amp, Kiro, Continue, Cline/Roo, Ollama and LM Studio, with version, sessions, last activity, MCP servers, skills, token totals, running processes and ports.
- **Skills** tab: every `SKILL.md`, slash command and sub-agent across agents and projects, real usage counts from session logs, never-used skills, duplicate skills (identical vs. different copies), skills used but not installed, `skills-lock.json` pins, most-used Claude Code tools.
- **Schedules** tab: cron in repos (GitHub Actions, Vercel, Cloudflare, Netlify, node-cron, `cron`, Celery beat, APScheduler, Spring `@Scheduled`, Kubernetes CronJob, serverless), user crontab, launchd, systemd timers, Windows Task Scheduler and AI-agent cron jobs (OpenClaw, Hermes). Next-run countdowns, 24-hour timeline and a cron playground.
- **Duplicates** tab: hash-verified identical files across projects (keep one, trash the rest) and projects that look like copies.
- **Updates** tab: outdated global packages (npm -g, pip, Homebrew) and per-project dependencies, updated from the app with a live log. StackRadar self-update check.
- **Hints everywhere**: an ⓘ on every panel plus a dismissible tip per tab, with one switch to turn them all off. **Feature toggles** hide tabs you don't use.
- **Lineage v2**: glowing icon nodes, gradient curved links with animated flow, force / radial / flow layouts, clickable legend filters, node search, fit-to-view, connected-node chips, 2× PNG export. Skills and schedules are now part of the graph.
- Sidebar navigation. The project drawer shows schedules, skills, per-package ⬆ update buttons and "show in file manager".

### Security
- The server binds to `127.0.0.1` by default (it was `0.0.0.0`, which exposed delete/kill to the LAN).
- Every API call requires a per-launch token injected into the page (blocks CSRF from other websites).
- A Host-header check blocks DNS-rebinding attacks.
- Package updates run as argument lists (never through a shell) with strict package-name validation.

### Fixed
- Risk level silently reset to "low" for projects with 30+ findings.
- Windows: delete now uses the Recycle Bin, stopping runs/processes uses `taskkill /T`, and the process list falls back to PowerShell where `wmic` is gone.
- Linux: Trash entries get a `.trashinfo` file so they can be restored.

## [1.0.0] — 2026-09

- First release: project discovery, purpose, run command, dependencies, secrets (masked), risk flags, ports, last run, git, AI/IDE traces + Claude Code token usage, environment, reclaim space, runs with live console, lineage graph.
