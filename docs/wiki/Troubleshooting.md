# Troubleshooting

| Symptom | Fix |
|---|---|
| "Port already in use" | `python3 stackradar.py --port 9000` (or `--port 0` for any free port) |
| Page shows "missing or bad X-StackRadar-Token" | The engine restarted, so its token changed. Reload the page |
| Scan is slow | Scan a narrower root and/or `--depth 4`; huge trees of `node_modules` are sized, not read |
| macOS asks for folder access | Normal privacy prompt the first time Desktop / Documents are scanned |
| Desktop app can't find `git` / `npm` / `claude` | It reads your login shell's PATH; make sure your `~/.zshrc` / `~/.bashrc` exports it, then restart the app |
| "App is damaged" / won't open (macOS) | Unsigned build: right-click → Open, or `xattr -dr com.apple.quarantine /Applications/StackRadar.app` |
| SmartScreen blocks the installer | More info → Run anyway (unsigned build) |
| Outdated check says "no checkable install found" | The project needs its own `node_modules` or virtualenv, plus internet |
| pip update fails with "externally-managed-environment" | Your OS Python is locked (PEP 668); use pipx / uv / a venv |
| No ports / processes listed | Install `ss`/`lsof` (Linux/macOS); Windows uses `netstat` + PowerShell |
| Load average shows "n/a" | Windows has no load average; CPU % is still live |
| Agents tab misses an agent | StackRadar needs its CLI on PATH or its config folder (see the table in [AI agents & skills](AI-Agents-and-Skills.md)) |
| Lineage feels sluggish | Turn **Motion** off, hide dependencies in the legend, or focus a single project |

Still stuck? Open an issue with your OS, StackRadar version (top bar) and the terminal output.
| An app ignores the Network Guard | It doesn't honour `HTTP(S)_PROXY` (e.g. Node < 24 without `NODE_USE_ENV_PROXY`, raw sockets, Java without `-Dhttps.proxyHost`). It still shows up in the monitor; use 🧱 OS block for hard blocking |
| Prompt appeared but the app already timed out | Some clients give up before you answer. Answer **Always allow**, then retry the app |
| Bytes ↑/↓ show 0 B/s on Linux | `ss` (iproute2) isn't installed; StackRadar falls back to `/proc`, which has no per-socket byte counters |
