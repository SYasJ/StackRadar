#!/usr/bin/env python3
"""
Build a fake HOME folder full of realistic projects, AI-agent folders, skills,
schedules and duplicate files, so you can try (or screenshot / test) StackRadar
without pointing it at your real machine.

    python3 demo/make_demo_workspace.py /tmp/stackradar-demo
    HOME=/tmp/stackradar-demo python3 stackradar.py --root /tmp/stackradar-demo/work

All "secrets" are obviously fake and are assembled at runtime so this source file
never contains anything that looks like a real credential.
"""
import json
import os
import shutil
import subprocess
import sys
import time

HOME = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/tmp/stackradar-demo")
WORK = os.path.join(HOME, "work")


def w(rel, text, base=WORK, mtime_days=None):
    fp = os.path.join(base, rel)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    mode = "wb" if isinstance(text, bytes) else "w"
    with open(fp, mode) as f:
        f.write(text)
    if mtime_days is not None:
        t = time.time() - mtime_days * 86400
        os.utime(fp, (t, t))
    return fp


def fake(prefix, body):
    """Join pieces so scanners on GitHub don't see a key-shaped literal here."""
    return prefix + body


def git_init(rel, remote=None, msg="initial commit"):
    d = os.path.join(WORK, rel)
    env = {**os.environ, "GIT_AUTHOR_NAME": "Demo", "GIT_AUTHOR_EMAIL": "demo@example.com",
           "GIT_COMMITTER_NAME": "Demo", "GIT_COMMITTER_EMAIL": "demo@example.com", "HOME": HOME}
    run = lambda *a: subprocess.run(["git", "-C", d] + list(a), env=env, capture_output=True)
    run("init", "-q", "-b", "main")
    if remote:
        run("remote", "add", "origin", remote)
    run("add", "-A")
    run("commit", "-q", "-m", msg)


def skill(base, name, desc, extra=""):
    w(os.path.join(name, "SKILL.md"), "---\nname: %s\ndescription: %s\n---\n\n# %s\n\n%s\n" % (name, desc, name, extra or desc), base=base)


def main():
    if os.path.exists(HOME):
        shutil.rmtree(HOME)
    os.makedirs(WORK)

    # ---------------- next-shop (Next.js, secrets ignored, vercel cron, GH action cron)
    w("next-shop/package.json", json.dumps({
        "name": "next-shop", "version": "0.4.2",
        "description": "Online store frontend built with Next.js — product catalog, cart and Stripe checkout.",
        "scripts": {"dev": "next dev", "build": "next build", "start": "next start"},
        "dependencies": {"next": "14.2.3", "react": "18.3.1", "react-dom": "18.3.1", "stripe": "15.8.0", "node-cron": "3.0.3"},
        "devDependencies": {"typescript": "5.4.5", "@types/react": "18.3.3"}}, indent=2))
    w("next-shop/README.md", "# next-shop\n\nOnline store frontend built with Next.js — product catalog, cart and Stripe checkout.\n\n```bash\nnpm install\nnpm run dev\n```\n\nThe dev server starts on http://localhost:3000.\n")
    w("next-shop/.gitignore", "node_modules/\n.next/\n.env*.local\n*.log\n")
    w("next-shop/.env.local", "# local-only keys (fake sample values)\nSTRIPE_SECRET_KEY=%s\nOPENAI_API_KEY=%s\nDATABASE_URL=%s\n" % (
        fake("sk_" + "live_", "51DemoDemoDemoDemoDemoDemo0000"), fake("sk-" + "proj-", "DemoDemoDemoDemoDemoDemoDemo0000"),
        "postgres://shopuser:" + "hunter2demo" + "@db.internal:5432/shop"))
    w("next-shop/app/page.tsx", 'import { getProductCatalog } from "../lib/catalog";\nexport default async function Home() {\n  const products = await getProductCatalog();\n  return <main>{products.map(p => <article key={p.id}>{p.name}</article>)}</main>;\n}\n')
    w("next-shop/lib/jobs.ts", "import cron from 'node-cron';\n// refresh product cache every 15 minutes\ncron.schedule('*/15 * * * *', () => refreshCatalog());\n")
    w("next-shop/vercel.json", json.dumps({"crons": [{"path": "/api/cron/abandoned-carts", "schedule": "0 9 * * 1-5"}]}, indent=2))
    w("next-shop/.github/workflows/nightly.yml", "name: Nightly e2e\non:\n  schedule:\n    - cron: '30 2 * * *'\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n")
    w("next-shop/public/hero.jpg", os.urandom(180_000))
    w("next-shop/next.config.js", "module.exports = { reactStrictMode: true };\n")
    git_init("next-shop", "git@github.com:demo/next-shop.git", "checkout flow")

    # ---------------- copy of next-shop (duplicate project)
    shutil.copytree(os.path.join(WORK, "next-shop"), os.path.join(WORK, "next-shop copy"))

    # ---------------- data-etl (Flask, high risk, celery beat schedule)
    w("data-etl/.env", "AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nS3_BUCKET=demo-etl-dumps\n" % (
        fake("AKIA", "DEMODEMODEMO0000"), fake("wJalrXUtnFEMI/", "K7MDENG/bPxRfiCYDEMOKEY")))
    w("data-etl/README.md", "# data-etl\n\nNightly ETL worker: pulls partner CSVs from S3, normalises them and feeds the warehouse.\n\n```bash\npip install -r requirements.txt\npython app.py\n```\n")
    w("data-etl/requirements.txt", "flask==3.0.3\nrequests==2.32.2\npandas==2.2.2\nboto3==1.34.12\ncelery==5.3.6\n")
    w("data-etl/app.py", 'import os, pickle, requests\nfrom flask import Flask, jsonify\n\napp = Flask(__name__)\n\n@app.route("/ingest")\ndef ingest():\n    data = requests.get("http://partner-feed.example.com/dump", timeout=30).text\n    eval(data)  # legacy\n    return "ok"\n\nif __name__ == "__main__":\n    app.run(host="0.0.0.0", port=5000, debug=True)\n')
    w("data-etl/beat.py", "from celery.schedules import crontab\nbeat_schedule = {\n  'nightly-import': {'task': 'etl.run', 'schedule': crontab(minute=14, hour=2)},\n}\n")
    w("data-etl/logs/etl.log", "2026-09-30 02:14:11 INFO run started\n2026-10-01 02:14:09 INFO run started\n")
    w("data-etl/.cursor/settings.json", '{"cursorModel":"claude-sonnet"}\n')
    w("data-etl/data/partners.csv", "id,name\n" + "\n".join("%d,partner-%d" % (i, i) for i in range(3000)))
    git_init("data-etl", None, "add ingest endpoint")

    # ---------------- vibe-portfolio (Claude Code, no VCS, project skills)
    w("vibe-portfolio/CLAUDE.md", "# Portfolio site\nBuild a minimal, warm-toned portfolio page.\n")
    w("vibe-portfolio/index.html", '<!doctype html><html><head><title>Portfolio</title></head><body><h1>Jane Doe</h1></body></html>\n')
    w("vibe-portfolio/styles.css", "body { font-family: system-ui; background: #faf7f2; }\n")
    w("vibe-portfolio/script.js", "document.title = 'Jane Doe';\n")
    w("vibe-portfolio/.vscode/settings.json", '{ "editor.formatOnSave": true }\n')
    skill(os.path.join(WORK, "vibe-portfolio", ".claude", "skills"), "brand-voice", "Write copy in the warm, friendly portfolio voice.")
    skill(os.path.join(WORK, "vibe-portfolio", ".claude", "skills"), "pdf", "Create and edit PDF files.")  # duplicate of a global skill
    w("vibe-portfolio/assets/logo.png", b"\x89PNG" + b"\x00" * 60_000)

    # ---------------- rust-api
    w("rust-api/Cargo.toml", '[package]\nname = "rust-api"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1.0"\ntokio-cron-scheduler = "0.10"\n')
    w("rust-api/src/main.rs", 'use std::net::TcpListener;\nfn main() {\n    let l = TcpListener::bind("0.0.0.0:8080").expect("bind");\n    for _s in l.incoming() { /* TODO */ }\n}\n')
    w("rust-api/assets/logo.png", b"\x89PNG" + b"\x00" * 60_000)   # same bytes as portfolio logo -> duplicate
    git_init("rust-api", "https://gitlab.com/demo/rust-api.git", "skeleton")

    # ---------------- legacy-tools (archived, big csv, duplicated dump)
    w("legacy-tools/config.ini", "[db]\nhost = 10.0.3.15\nuser = legacy\npassword = %s\n" % ("P@ssw0rd-" + "Legacy-2019"), mtime_days=900)
    w("legacy-tools/backup.sh", "#!/bin/bash\n# old cron backup script\npg_dump legacy > /var/backups/legacy_$(date +%F).sql\n", mtime_days=900)
    big = ("id,ts,region,value,note\n" + "".join("%d,2024-01-01,eu,%d,ok\n" % (i, i * 7) for i in range(160_000))).encode()
    w("legacy-tools/data/dump-2024.csv", big, mtime_days=600)
    w("legacy-tools/data/dump-2024 (1).csv", big, mtime_days=600)
    w("data-etl/data/dump-2024.csv", big)

    # ---------------- agent-ops (scheduled agents project)
    w("agent-ops/package.json", json.dumps({"name": "agent-ops", "version": "1.2.0", "description": "Runs my scheduled AI agents: morning brief, PR triage and weekly report.",
                                            "scripts": {"start": "node index.js"}, "dependencies": {"cron": "3.1.7", "@anthropic-ai/sdk": "0.30.0"}}, indent=2))
    w("agent-ops/index.js", "const { CronJob } = require('cron');\nnew CronJob('0 8 * * 1-5', () => morningBrief()).start();\nnew CronJob('0 17 * * 5', () => weeklyReport()).start();\n")
    w("agent-ops/CLAUDE.md", "# agent-ops\nScheduled agents. Keep prompts in prompts/.\n")
    skill(os.path.join(WORK, "agent-ops", ".agents", "skills"), "pr-triage", "Label and summarise new pull requests.")
    git_init("agent-ops", "git@github.com:demo/agent-ops.git", "weekly report job")

    # ---------------- phone-home (network guard demo) ----------------
    w("phone-home/README.md", "# phone-home\n\nTiny worker that calls an AI API, sends analytics and posts a report.\n\n```bash\npython3 worker.py\n```\n")
    w("phone-home/worker.py", "import os, json, time, urllib.request\n"
      "AI = 'https://api.openai.com/v1/models'\n"
      "TRACK = 'https://api.segment.io/v1/track'\n"
      "REPORT = 'http://httpbin.org/post'  # plain HTTP + api key\n"
      "def call(url, data=None, headers=None):\n"
      "    try:\n"
      "        req = urllib.request.Request(url, data=data, headers=headers or {})\n"
      "        with urllib.request.urlopen(req, timeout=15) as r:\n"
      "            print(url, '->', r.status, flush=True)\n"
      "    except Exception as e:\n"
      "        print(url, '-> blocked/failed:', e, flush=True)\n"
      "for i in range(3):\n"
      "    call(AI, headers={'Authorization': 'Bearer ' + os.environ.get('OPENAI_API_KEY', 'x')})\n"
      "    call(TRACK, data=b'{}')\n"
      "    call(REPORT, data=json.dumps({'api_key': os.environ.get('OPENAI_API_KEY', ''), 'email': 'jane@example.com'}).encode())\n"
      "    time.sleep(2)\n")
    w("phone-home/.env", "OPENAI_API_KEY=%s\n" % fake("sk-" + "proj-", "PhoneHomePhoneHomePhoneHome0000"))
    w("phone-home/.gitignore", ".env\n")
    w("phone-home/requirements.txt", "# stdlib only\n")

    # ---------------- global AI agent folders + skills ----------------
    cs = os.path.join(HOME, ".claude", "skills")
    for n, d in [("pdf", "Create and edit PDF files."), ("frontend-design", "Design distinctive production-grade frontends."),
                 ("pptx", "Build PowerPoint decks."), ("xlsx", "Work with spreadsheets."), ("deep-research", "Multi-source research reports."),
                 ("code-review", "Review a diff for bugs."), ("changelog", "Write release notes from git history.")]:
        skill(cs, n, d)
    skill(os.path.join(HOME, ".codex", "skills"), "pdf", "Create and edit PDF files.")
    skill(os.path.join(HOME, ".codex", "skills"), "changelog", "Write release notes from commits (codex flavour).")
    skill(os.path.join(HOME, ".hermes", "skills"), "web-research", "Search the web and summarise.")
    skill(os.path.join(HOME, ".hermes", "skills"), "deep-research", "Multi-source research reports.")
    skill(os.path.join(HOME, ".openclaw", "workspace", "skills"), "inbox-zero", "Triage email every morning.")
    skill(os.path.join(HOME, ".openclaw", "workspace", "skills"), "pdf", "Create and edit PDF files.")
    w(".claude/commands/ship.md", "---\ndescription: Commit, push and open a PR\n---\nShip it.\n", base=HOME)
    w(".claude/agents/test-runner.md", "---\nname: test-runner\ndescription: Runs the test suite and reports failures\n---\n", base=HOME)
    w(".claude/settings.json", json.dumps({"model": "opus", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]},
                                           "enabledPlugins": {"frontend@anthropic": True}}), base=HOME)
    w(".claude.json", json.dumps({"mcpServers": {"github": {}, "linear": {}}, "projects": {WORK + "/next-shop": {"mcpServers": {"stripe": {}}}}}), base=HOME)
    w(".codex/config.toml", 'model = "gpt-5-codex"\n[mcp_servers.filesystem]\ncommand = "npx"\n[mcp_servers.playwright]\ncommand = "npx"\n', base=HOME)
    w(".hermes/config.yaml", "model: hermes-4\nmcp_servers:\n  github:\n    command: npx\n  notion:\n    command: npx\n", base=HOME)
    w(".hermes/cron/jobs.json", json.dumps({"jobs": [{"id": "brief", "name": "Morning brief", "schedule": "0 7 * * *", "prompt": "Summarise my calendar and inbox", "enabled": True}]}), base=HOME)
    w(".openclaw/openclaw.json", json.dumps({"agents": {"defaults": {"model": "anthropic/claude"}}, "mcpServers": {"gmail": {}}}), base=HOME)
    w(".openclaw/cron/jobs.json", json.dumps({"version": 1, "jobs": [
        {"id": "a1", "name": "Inbox zero", "enabled": True, "schedule": {"kind": "cron", "expr": "0 8 * * 1-5"}, "payload": {"message": "Run inbox-zero skill"}},
        {"id": "a2", "name": "Price watch", "enabled": False, "schedule": {"kind": "every", "everyMs": 3600000}, "payload": {"message": "check prices"}}]}), base=HOME)
    w(".openclaw/agents/main/sessions/s1.jsonl", json.dumps({"type": "tool", "text": "read ~/.openclaw/workspace/skills/inbox-zero/SKILL.md"}) + "\n", base=HOME)
    w(".paperclip/config.json", json.dumps({"server": {"port": 3100}, "companies": 1}), base=HOME)
    w(".gemini/settings.json", json.dumps({"mcpServers": {"context7": {}}}), base=HOME)
    w(".codex/sessions/2026/10/01/rollout-1.jsonl",
      json.dumps({"type": "event_msg", "payload": {"type": "exec", "cmd": "cat ~/.codex/skills/changelog/SKILL.md"}}) + "\n" +
      json.dumps({"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 182000, "output_tokens": 9100}}}}) + "\n", base=HOME)

    # Claude Code transcripts: tokens + skill / slash-command usage per project
    def claude_log(proj, n_skill_calls, model="claude-opus-4-1"):
        enc = "".join(c if c.isalnum() else "-" for c in os.path.join(WORK, proj))
        lines = []
        ts = time.time() - 86400 * 2
        for i in range(12):
            lines.append({"type": "user", "cwd": os.path.join(WORK, proj), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts + i * 60)),
                          "message": {"role": "user", "content": "<command-name>/ship</command-name>" if i == 3 else "keep going"}})
            content = [{"type": "text", "text": "ok"}]
            if i < len(n_skill_calls):
                content.append({"type": "tool_use", "name": "Skill", "input": {"skill": n_skill_calls[i]}})
            else:
                content.append({"type": "tool_use", "name": "Edit", "input": {}})
            lines.append({"type": "assistant", "cwd": os.path.join(WORK, proj), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts + i * 60 + 5)),
                          "message": {"model": model, "content": content, "usage": {"input_tokens": 1800 + i * 90, "output_tokens": 420 + i * 30,
                                                                                    "cache_read_input_tokens": 12000, "cache_creation_input_tokens": 900}}})
        w(os.path.join(".claude", "projects", enc, "session-1.jsonl"), "\n".join(json.dumps(l) for l in lines) + "\n", base=HOME)
    claude_log("vibe-portfolio", ["frontend-design", "brand-voice", "frontend-design", "pdf"])
    claude_log("next-shop", ["code-review", "code-review", "changelog", "anthropic-skills:xlsx"], model="claude-sonnet-4-5")
    claude_log("agent-ops", ["deep-research", "pr-triage"])

    # user crontab-like file for display (we don't touch the real crontab)
    w(".config/systemd/user/backup.timer", "[Timer]\nOnCalendar=*-*-* 03:00:00\n", base=HOME)
    w(".config/systemd/user/backup.service", "[Service]\nWorkingDirectory=%s\nExecStart=/bin/bash backup.sh\n" % os.path.join(WORK, "legacy-tools"), base=HOME)
    # StackRadar user tags
    w(".stackradar/projects.json", json.dumps({
        os.path.join(WORK, "next-shop"): {"color": "#4d9fff", "rating": 4, "status": "active", "notes": "Main storefront. Rotate Stripe key before deploy."},
        os.path.join(WORK, "data-etl"): {"color": "#f58242", "rating": 2, "status": "fix", "notes": "eval() + debug=True. Needs a security pass."},
        os.path.join(WORK, "vibe-portfolio"): {"color": "#2dd4a7", "rating": 5, "status": "active", "notes": "Built with Claude Code."},
        os.path.join(WORK, "legacy-tools"): {"color": "#8b97ad", "rating": 1, "status": "archived", "notes": "Candidate for deletion."},
        os.path.join(WORK, "agent-ops"): {"color": "#b478ff", "rating": 4, "status": "active", "notes": "Scheduled agents."}}, indent=1), base=HOME)
    print("demo HOME ready:", HOME)
    print("run:  HOME=%s python3 stackradar.py --root %s" % (HOME, WORK))


if __name__ == "__main__":
    main()
