# Local API

The dashboard is a client of a small JSON API on `http://127.0.0.1:<port>`. You can script it too. Every `/api/*`
request needs the per-launch token, which is embedded in the page:

```bash
PORT=8765
TOKEN=$(curl -s localhost:$PORT/ | grep -o 'stackradar-token" content="[^"]*' | cut -d'"' -f3)
api() { curl -s -H "X-StackRadar-Token: $TOKEN" "localhost:$PORT$1" "${@:2}"; }

api /api/health
api /api/system | jq '.cpu, .memory.percent'
api /api/schedules | jq '.schedules[] | {next, human, source}'
api /api/state | jq '.projects[] | {name, key_count, risk_level}'
api /api/scan -X POST -H 'Content-Type: application/json' -d '{"roots":["~/Projects"],"max_depth":6}'
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | version + scan phase (no token needed) |
| GET | `/api/state` | full scan result: projects, env, ports, skills, agents, schedules, duplicates, runs |
| GET | `/api/scan/progress` | scan phase + counters |
| POST | `/api/scan` | `{roots:[...], max_depth}` start a scan |
| GET | `/api/system` | live CPU / memory / load / disks / network / top processes + 5-min history |
| GET | `/api/schedules` | all schedules with next-run timestamps |
| GET | `/api/cron/preview?expr=` | describe a cron expression + next 5 runs |
| GET | `/api/updates/global[?refresh=1]` | outdated npm -g / pip / brew packages |
| POST | `/api/deps/check` | `{path, force}` outdated deps for one project |
| POST | `/api/update` | `{scope:"global"\|"project", manager, packages[], path?, confirm:true}` → job id |
| GET | `/api/jobs[?id=]` | update jobs and their logs |
| POST | `/api/app/update-check` | newest StackRadar release on GitHub |
| GET/POST | `/api/settings` | hints, dismissed tips, feature toggles, lineage prefs, release source |
| GET | `/api/network` | live connections, apps, guarded traffic, events, alerts, prompts, rules, code map |
| GET | `/api/network/pending` | apps waiting for an allow / deny answer |
| POST | `/api/network/decide` | `{id, decision: allow_once\|allow_always\|deny_once\|deny_always}` |
| POST | `/api/network/rules` | `{app, host, action}` add · `{op:"delete", id}` remove |
| POST | `/api/network/level` | `{net_level: low\|medium\|strict, guard_runs}` |
| POST | `/api/network/osblock` | `{host\|ips, op: block\|unblock}` preview the command · add `execute:true, confirm:true` to run it |
| POST | `/api/archive` | `{path, confirm:true, trash_original, exclude_regen}` → job id |
| GET | `/api/archives` · POST `/api/archive/restore` | list archives · `{file, target_dir?}` restore |
| POST | `/api/meta` | `{path, color, rating, status, notes, category, tags}` your project tags |
| POST | `/api/run` · `/api/runs/stop` · `/api/runs/stop_all` | managed runs |
| GET | `/api/runs[?id=]` | runs, live logs, port panel |
| POST | `/api/kill` | `{pid, confirm:true}` (project processes only) |
| POST | `/api/actions` | `{action:"delete"\|"move"\|"rename", path, …}` |
| POST | `/api/delete/cache` | delete a cache folder |
| GET | `/api/reclaim` | reclaimable caches |
| POST | `/api/open` | reveal a path in Finder / Explorer / file manager |
| GET | `/api/scan/progress` | phase, `pct`, `eta_s`, `elapsed_s`, `detail` |
| GET | `/api/ports` · POST `/api/ports/stop` | every listening port · `{pid, port, force}` stop your own program |
| GET | `/api/tools[?refresh=1]` | CLI tools, pip / npm / brew / pipx / cargo packages, zsh plugins |
| POST | `/api/tools/latest` · `/api/tools/action` | check newest versions (job) · `{manager, name\|path, action: update\|remove, confirm:true}` |
| GET | `/api/pkg/info?manager=&name=&current=` | description, newest version, release notes since `current` |
| GET | `/api/caches` · POST `/api/caches/scan` · `/api/caches/clean` | measured caches · measure (job) · `{id}` clean with the tool's command |
| GET | `/api/disk?path=` · POST `/api/disk/delete` | folder children with sizes · `{path, confirm:<name>, permanent}` |
| POST | `/api/duplicates/rescan` | `{folders: [...]}` re-check duplicates incl. extra folders (job) |
| GET | `/api/agents/latest?id=` · `/api/agents/archived` | newest version of an agent · archived sessions |
| POST | `/api/agents/session` | `{agent, file, action: view\|handoff\|tag\|archive\|restore\|delete, tags?}` |
| POST | `/api/agents/stop` · `/api/network/stop` | `{pid, force}` stop one of your processes |
| GET | `/api/transfer/options` · POST `/api/transfer` | agents + model suggestions · `{path, agent, model}` hand a project to another agent |
| POST | `/api/terminal` | `{command, cwd, confirm:true}` open the OS terminal with a command |
| POST | `/api/skills/action` | `{action: delete\|share\|consolidate, path, agent?, keep?, confirm:true}` |
| POST | `/api/schedules/action` | `{schedule, action: pause\|resume\|reschedule\|delete, expr?, confirm:true}` |
| POST | `/api/network/app-level` · `/api/network/clear-log` | `{app, level}` per-project guard level · clear the guard log |
