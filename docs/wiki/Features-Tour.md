# Feature tour

StackRadar's sidebar groups the tabs into **Workspace**, **Machine**, **AI** and **Clean-up**. Every panel has an ⓘ hint
(hover or keyboard-focus it). Any tab except Overview / Projects / Environment can be switched off in **⚙ Settings**.

## Workspace

### Overview
![Overview](../../media/screenshots/01-overview.jpg)
KPI cards (projects, total size, secrets, open ports, high risk, running now, AI/IDE traces, agents, skills, schedules,
duplicate space, system load), the top space hogs, size by language, and a prioritised **alert list**. Cards are clickable.

### Projects
![Projects](../../media/screenshots/02-projects.jpg)
A sortable, filterable table of every project: colour tag, version, status (active / needs fix / archived), language,
purpose, size, last run, ports (open = green, expected = amber), secret count, risk, VCS, AI tool, star rating.

**The details drawer** (click a row):

![Project drawer](../../media/screenshots/13-drawer.jpg)

Purpose · your tags & notes · how to run (+ ▶ run with a port) · ports · masked secrets · risk flags · last run evidence ·
git origin · dependencies with **outdated check and ⬆ update buttons** · schedules found in the code · skills used here ·
AI traces and token usage · documents · size breakdown · danger zone (delete to Trash, move, rename, show in file manager).

### Runs
Start any project from StackRadar and watch a live, Colab-style console. Restart on another port, stop one or all, and kill
processes that belong to scanned projects (system processes are never listed).

### Lineage
See [Lineage graph](Lineage-Graph.md).

## Security

### Network Guard
![Network Guard](../../media/screenshots/17-network.jpg)
Live signal radar of every app that talks to the internet, bytes ↑ / ↓, the file and line behind each connection,
allow / deny prompts and Low / Medium / Strict levels. See [Network Guard](Network-Guard.md).

## Machine

### System
![System](../../media/screenshots/04-system.jpg)
See [System monitor](System-Monitor.md).

### Environment
Installed tools and versions, global npm / pip / Homebrew packages, Docker containers / images / disk use, shell rc
analysis (exports, aliases, PATH additions, version managers) and installed IDEs.

### Updates
![Updates](../../media/screenshots/09-updates.jpg)
See [Package updates](Package-Updates.md).

## AI

### Agents
![Agents](../../media/screenshots/05-agents.jpg)
### Skills
![Skills](../../media/screenshots/06-skills.jpg)
See [AI agents & skills](AI-Agents-and-Skills.md).

### Schedules
![Schedules](../../media/screenshots/07-schedules.jpg)
See [Schedules](Schedules.md).

## Clean-up

### Duplicates
![Duplicates](../../media/screenshots/08-duplicates.jpg)
Identical files across your projects, found by size → first-64 KB hash → full SHA-1 (files ≥ 4 KB). Each group keeps the
"original" (no `copy` / `(1)` / `backup` in the name, then the shortest path) and offers **🗑 move to Trash** for the
other copies. A second panel lists **projects that look like copies**: same git remote, or names like `app copy`,
`app (1)`, `app-old`, `app-2024-05-01`.

### Archive = compress
![Archive dialog](../../media/screenshots/20-archive.jpg)
Setting a project's status to **archived** (or **🗜 Compress & archive…** in its drawer) packs it into one `.tar.gz`
(`.zip` on Windows) in `~/.stackradar/archives`. Regenerable folders (`node_modules`, `.venv`, build caches) are left
out, every file is verified in the archive, and the original can go to the Trash. **Reclaim space → Archives** lists them
with their size and space saved, and **↩ restore** unpacks one where it was (it refuses to overwrite an existing folder).

![Archives](../../media/screenshots/21-archives.jpg)

### Reclaim space
Regenerable folders (`node_modules`, `.next`, `dist`, `build`, `target`, `__pycache__` …) pre-selected for deletion,
virtualenvs flagged for a second look, global package-manager caches, and your largest projects.
