# FAQ

**Why was it renamed from DevRadar?**
"DevRadar" was already used by devradar.dev (a developer tool), a popular tutorial app with hundreds of GitHub copies,
and a Chrome extension. StackRadar keeps the idea (your whole stack, on radar) with a name people can actually find.
Settings in `~/.devradar` are migrated automatically.

**Can it stop an app from sending data?**
Yes, for apps you start from StackRadar: the [Network Guard](Network-Guard.md) asks before each new destination and
blocks what you deny. Other apps are monitored, and you can block a host for every app at the OS firewall with one click
(it asks for admin rights).

**Can it see what's inside HTTPS requests?**
No, and that's on purpose: StackRadar never decrypts traffic. It inspects plain-HTTP requests fully and checks your code
for credentials sent to unexpected places.

**Is StackRadar free? Does it phone home?**
Yes, it's free, and no, it doesn't phone home. There's no telemetry. See [Security & privacy](Security-and-Privacy.md).

**Do I need Python?**
Not for the desktop app (it bundles its engine). From source you need Python 3.9+, with no packages.

**Which folders does it scan?**
Your home folder by default (depth 6). Point it anywhere with the top box or `--root`. Big dependency folders
(`node_modules`, `.venv`, `.git` …) are sized but not read.

**How does it decide something is a "project"?**
A manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` …), a VCS folder, Docker files, IDE / AI markers,
or a config file next to source code.

**Which AI agents are supported?**
Claude Code, Codex CLI, Hermes Agent, OpenClaw (Clawdbot / Moltbot), Paperclip, Gemini CLI, Cursor, Windsurf, GitHub Copilot CLI,
OpenCode, Goose, Aider, Qwen Code, Amp, Kiro, Continue, Cline / Roo, Ollama and LM Studio. See [AI agents & skills](AI-Agents-and-Skills.md).

**Where do the token counts come from?**
Claude Code's local transcripts (`~/.claude/projects`) and Codex's session logs. Other agents don't store token usage locally.

**Is the vulnerability check a real audit?**
No. It's a heuristic (debug mode, `eval`, disabled TLS, unignored `.env` …). Use `npm audit`, `pip-audit`, `cargo audit` for depth.

**Can it update my packages automatically?**
Only when you click **⬆ Update**, after a confirmation. See [Package updates](Package-Updates.md).

**Can I turn off the tips / features I don't use?**
Yes. Use the **Hints** switch and **⚙ Settings → Features**. See [Hints & settings](Hints-and-Settings.md).

**Where are my notes and tags stored?**
In `~/.stackradar/projects.json` (tags, ratings, notes) and `~/.stackradar/settings.json` (preferences).
