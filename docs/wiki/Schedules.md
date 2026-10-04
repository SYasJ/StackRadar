# Schedules

![Schedules](../../media/screenshots/07-schedules.jpg)

"What runs on a timer?" StackRadar collects schedules from three places and shows them in **next-run order**, with a
countdown, a **24-hour timeline** and a plain-English description of each cron expression.

## Sources

**Inside your projects** (read-only, from code and config):

| Source | Detected from |
|---|---|
| GitHub Actions | `.github/workflows/*.yml` → `on: schedule: - cron:` (runs in UTC) |
| Vercel Cron | `vercel.json` → `crons[].schedule` |
| Cloudflare Workers / Netlify | `wrangler.toml` `crons = [...]`, `netlify.toml` `schedule = "..."` |
| node-cron / `cron` | `cron.schedule('*/15 * * * *', …)`, `new CronJob('0 8 * * 1-5', …)` |
| Celery beat | `crontab(minute=…, hour=…)` |
| APScheduler · Spring · Go cron | `CronTrigger.from_crontab(…)`, `@Scheduled(cron = …)`, `.AddFunc("…")` |
| Python `schedule` · `setInterval` | `schedule.every(10).minutes`, long-interval timers |
| Kubernetes · Serverless | `kind: CronJob` `schedule:`, `serverless.yml` `cron(…)` / `rate(…)` |

**On this machine:** your user **crontab**, macOS **launchd** agents (`~/Library/LaunchAgents`), **systemd user timers**
(`~/.config/systemd/user/*.timer` + the matching `.service`), and the Windows **Task Scheduler** (non-Microsoft tasks).

**AI-agent jobs:** OpenClaw (`~/.openclaw/cron/jobs.json`), Hermes Agent (`~/.hermes/cron/jobs.json`) and Paperclip
schedules, each with its prompt (secret-looking text redacted).

System schedules are linked to a project when their command or working directory points inside it.

## Cron playground

Type any expression (`0 9 * * 1-5`, `*/15 * * * *`, `@daily`, 6-field with seconds …) to see it in words and its next
five run times. The same parser powers the table (`/api/cron/preview?expr=…`).
