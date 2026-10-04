# Installation

## Option 1: desktop app

Grab the newest build from **[GitHub Releases](https://github.com/SYasJ/StackRadar/releases)**.

### macOS (`.dmg`)
1. Download `StackRadar-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel).
2. Open it and drag **StackRadar** to **Applications**.
3. First launch of an unsigned build: right-click the app → **Open** → **Open**. (Signed builds open normally. See [Releasing](Releasing-and-Versioning.md#code-signing).)
4. macOS may ask for access to Desktop / Documents the first time StackRadar scans them. That is the normal folder-privacy prompt.

### Windows (`.exe`)
- **Installer**: `StackRadar-<version>-win-x64.exe`. Choose a folder; it creates Start-menu and desktop shortcuts and supports auto-update.
- **Portable**: `StackRadar-<version>-portable.exe` runs without installing (no auto-update).
- Unsigned builds trigger SmartScreen: **More info → Run anyway**.

### Linux (`.AppImage` / `.deb`)
```bash
chmod +x StackRadar-<version>-linux-x86_64.AppImage
./StackRadar-<version>-linux-x86_64.AppImage
# or
sudo apt install ./StackRadar-<version>-linux-amd64.deb
```

The desktop app ships its own frozen engine, so you **don't need Python**. It starts the engine on a random free
`127.0.0.1` port, opens the dashboard in its own window and [keeps itself updated](Desktop-App-and-Auto-Update.md).

## Option 2: run from source

Requirements: **Python 3.9+**. No packages to install; StackRadar uses only the standard library.

```bash
git clone https://github.com/SYasJ/StackRadar.git
cd StackRadar
python3 stackradar.py            # macOS / Linux
python stackradar.py             # Windows
# open http://localhost:8765
```

Double-click launchers: `StackRadar.command` (macOS) and `StackRadar.bat` (Windows).

### Command-line options

| Flag | Default | Meaning |
|---|---|---|
| `--root PATH` | your home folder | Folder to scan. Repeat for several |
| `--depth N` | `6` | How deep to look for projects |
| `--port N` | `8765` | Port for the dashboard (`0` = pick a free one) |
| `--host ADDR` | `127.0.0.1` | Bind address. `0.0.0.0` exposes the UI to your LAN (not recommended) |
| `--open` | off | Open the dashboard in your browser |
| `--no-scan` | off | Start without scanning; press **Scan** in the UI |
| `--version` | | Print the version |

## Optional tools StackRadar uses when present

`git` (VCS details), `docker` (containers), `npm` / `pnpm` / `yarn` / `bun`, `pip`, `brew` (package checks and updates),
`ss` / `lsof` / `netstat` (ports), `crontab`, and the agent CLIs (`claude`, `codex`, `hermes`, `openclaw`, `paperclipai` …).
Missing tools are skipped gracefully.
