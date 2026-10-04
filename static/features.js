/* StackRadar 2 — hints, settings & feature toggles, System / Agents / Skills / Schedules /
   Duplicates / Updates tabs, update jobs. Vanilla JS, talks only to the local server. */
"use strict";

/* ---------------- settings, hints, feature toggles ---------------- */

const SETTINGS = { hints: true, dismissed_hints: [], features: {}, lineage_layout: "force", lineage_motion: true, update_repo: "" };
// status palette (reserved for state, always paired with an icon + label)
const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

const HINTS = {
  overview: "Your whole workspace at a glance: projects, secrets, risk, live ports, AI agents, skills, schedules and wasted space. Click any card or bar to drill in.",
  hogs: "The biggest projects and top-level folders. Click a project bar to open its details drawer.",
  langs: "Disk space grouped by each project's main language.",
  alerts: "The most important things to look at first: leaked secrets, high-risk code, unexpected open ports, folders without version control.",
  ports: "Every TCP port listening on this machine right now, with the process that owns it.",
  ports_unlinked: "Listening ports that don't belong to any scanned project — usually system services or apps outside the scanned folder.",
  projects: "Every repo / app StackRadar found. Filter, sort, rate with stars, and click a row for the full details drawer.",
  purpose: "Taken from package.json / pyproject description, or the first sentence of the README.",
  tags: "Your own colour, rating, status and notes for this project. Stored only on this machine in ~/.stackradar/projects.json.",
  run: "The detected start command and why StackRadar picked it. ‘Run from StackRadar’ starts it with a live console in the Runs tab.",
  proj_ports: "Green = open right now. Amber = the port this project is expected to use (framework default, Dockerfile, compose, code) but isn't open.",
  secrets: "API keys and passwords found in config / env / code files. Values are masked — StackRadar never shows or sends the full secret.",
  risk: "A quick heuristic check (debug mode, eval, TLS disabled, unignored .env …). Not a full audit — pair it with npm audit / pip-audit.",
  lastrun: "Best-effort: running processes, log and build-artifact timestamps, and your shell history.",
  vcs: "Git branch, remote, last commit and uncommitted changes. ‘No VCS’ means this folder exists only on this machine.",
  deps: "Declared dependencies. ‘Check outdated’ compares installed vs latest; the ⬆ buttons update a package right here (needs internet).",
  ai: "IDE and AI-tool markers (Claude Code, Cursor, Codex …) and LLM token usage from local session logs.",
  docs: "Document files in the project and the natural language of its README.",
  sizeb: "Which top-level folders take the space. node_modules / venv / build output can be reclaimed in the Reclaim tab.",
  danger: "Delete goes to the Trash / Recycle Bin by default. Permanent delete needs the exact folder name typed.",
  proj_sched: "Cron jobs and timers defined inside this project: GitHub Actions, Vercel/Cloudflare crons, node-cron, Celery beat, Kubernetes CronJobs …",
  proj_skills: "Skills and slash commands used from Claude Code (or other agents) while working in this folder.",
  env: "Your toolchain: installed runtimes, global packages, Docker, shell set-up and IDEs.",
  env_system: "Operating system, host, and the IDEs/editors StackRadar found installed.",
  shell: "What your shell rc files set up: exports, aliases, PATH additions, version managers.",
  tools: "Developer tools found on your PATH with their versions. Faded = not installed.",
  globals: "Globally installed packages. Outdated ones can be updated from the Updates tab.",
  docker: "Containers, images and Docker disk usage (needs the docker CLI and a running daemon).",
  gcache: "Package-manager caches. Safe to delete — packages re-download when needed.",
  reclaim: "Free disk space safely: build caches and node_modules rebuild themselves. Virtualenvs are flagged for a second look.",
  caches: "Regenerable folders inside your projects. Safe items are pre-selected.",
  wholeproj: "Your largest projects. Deleting moves them to the Trash first.",
  runs: "Start any project, watch its live console, restart it on another port, or kill processes that belong to your projects.",
  runstart: "Uses the detected run command and injects your port (Next -p, Vite --port, Flask --port …), falling back to the PORT env var.",
  lineage: "A live map of how everything connects: projects ↔ runtimes ↔ dependencies ↔ ports ↔ secrets ↔ AI tools ↔ skills ↔ schedules. Shared nodes (like a dependency used by 3 projects) link projects together.",
  system: "Live CPU, load, memory, swap, disk and network, refreshed every 2 seconds, plus the processes using the most CPU. Processes that belong to your projects can be stopped.",
  sys_cpu: "Share of CPU time spent working (all cores). Sustained >85% means something is pegging the machine.",
  sys_load: "Load average = how many processes want CPU. Above your core count means work is queuing.",
  sys_mem: "Memory in use excluding reclaimable cache. Above 90% the OS starts swapping and everything slows down.",
  sys_disk: "Free space on the disks holding your home folder and scan roots.",
  sys_top: "Heaviest processes right now. Ones tagged with a project can be stopped from here.",
  updates: "Outdated packages, globally (npm -g, pip, Homebrew) and per project. Tick what you want and update without leaving the app — output streams live.",
  upd_global: "Checks npm -g, pip and Homebrew for newer versions. Needs internet. Nothing is updated until you click Update.",
  upd_projects: "Per-project dependency checks use the project's own node_modules or virtualenv.",
  upd_app: "Checks GitHub releases for a newer StackRadar. The desktop app can also update itself automatically.",
  agents: "Every AI coding agent found on this machine — Claude Code, Codex, Hermes, OpenClaw, Paperclip, Gemini, Cursor, Ollama … — with version, sessions, MCP servers, skills, tokens and whether it's running.",
  skills: "All installed skills, slash commands and sub-agents across every agent, how often each was actually used, and which ones are duplicated or never used.",
  sk_dupes: "The same skill name installed in more than one place. ‘identical’ copies are safe to remove; ‘different’ copies can behave differently depending on which agent loads them.",
  sk_ghost: "Skills that show up in your session logs but aren't installed in any folder StackRadar checked (built-in, removed, or plugin-provided).",
  sk_tools: "Which Claude Code tools you call the most, counted from your local transcripts.",
  schedules: "Everything that runs on a timer: cron in your repos (GitHub Actions, Vercel, node-cron, Celery …), your crontab / launchd / systemd timers / Task Scheduler, and AI-agent cron jobs (OpenClaw, Hermes …).",
  sched_play: "Type any cron expression to see it in plain English with the next 5 run times.",
  duplicates: "Identical files (same bytes, checked by hash) across your projects, and projects that look like copies of each other.",
  settings: "Turn hints and whole features on or off. Everything is saved on this machine.",
};

function hint(key) {
  const t = HINTS[key];
  if (!t) return "";
  return `<span class="hint-i" tabindex="0" role="note" aria-label="${esc(t)}" data-tip="${esc(t)}">i</span>`;
}
function tabHint(key) {
  const t = HINTS[key];
  if (!t || (SETTINGS.dismissed_hints || []).includes(key)) return "";
  return `<div class="tab-hint" data-hintkey="${esc(key)}"><span class="th-icon">💡</span><span>${esc(t)}</span>
    <button class="th-x" data-dismiss-hint="${esc(key)}" title="hide this tip">✕</button></div>`;
}
async function saveSettings(patch) {
  const j = await api("/api/settings", patch);
  if (j && j.features) Object.assign(SETTINGS, j);
  return j;
}
function applyHints() {
  document.body.classList.toggle("hints-off", !SETTINGS.hints);
  const t = $("#hintsToggle");
  if (t) t.checked = !!SETTINGS.hints;
}
function featureOn(k) { return (SETTINGS.features || {})[k] !== false; }
function applyFeatureToggles() {
  $$("#nav button[data-feature]").forEach(b => { b.hidden = !featureOn(b.dataset.feature); });
  const cur = $(`#nav button[data-tab="${S.tab}"]`);
  if (cur && cur.hidden) { S.tab = "overview"; }
}

/* floating tooltip for the ⓘ hints (works for keyboard focus too) */
function setupHintTips() {
  const tip = document.createElement("div");
  tip.className = "hint-tip"; tip.hidden = true; document.body.appendChild(tip);
  const show = el => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    tip.style.maxWidth = w + "px";
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(12, Math.min(window.innerWidth - w - 12, x));
    tip.style.left = x + "px";
    const below = r.bottom + 8;
    tip.style.top = (below + 120 > window.innerHeight ? r.top - 8 - tip.offsetHeight : below) + "px";
  };
  document.addEventListener("mouseover", e => { const el = e.target.closest(".hint-i"); if (el) show(el); });
  document.addEventListener("mouseout", e => { if (e.target.closest(".hint-i")) tip.hidden = true; });
  document.addEventListener("focusin", e => { const el = e.target.closest(".hint-i"); if (el) show(el); });
  document.addEventListener("focusout", e => { if (e.target.closest(".hint-i")) tip.hidden = true; });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-dismiss-hint]");
    if (!b) return;
    const k = b.dataset.dismissHint;
    SETTINGS.dismissed_hints = [...new Set([...(SETTINGS.dismissed_hints || []), k])];
    const box = b.closest(".tab-hint"); if (box) box.remove();
    await saveSettings({ dismissed_hints: SETTINGS.dismissed_hints });
  });
}

function openSettings() {
  const F = [
    ["network", "🛡 Network Guard", "see & allow / deny what apps send to the internet"],
    ["runs", "▶ Runs", "start / stop projects with live consoles"],
    ["lineage", "✺ Lineage", "interactive connection graph"],
    ["system", "♥ System", "live CPU, memory, load & disk monitor"],
    ["updates", "⬆ Updates", "outdated packages + one-click updates"],
    ["agents", "🤖 Agents", "Claude Code, Codex, Hermes, OpenClaw, Paperclip …"],
    ["skills", "✪ Skills", "skill usage, duplicates and unused skills"],
    ["schedules", "⏰ Schedules", "cron jobs, timers and agent schedules"],
    ["duplicates", "⧉ Duplicates", "identical files and copied projects"],
    ["reclaim", "♻ Reclaim space", "delete caches and build output"],
  ];
  modal(`
    <h3>Settings ${hint("settings")}</h3>
    <div class="set-row"><div><b>Hints</b><div class="small muted">ⓘ icons on every panel and the 💡 tip at the top of each tab</div></div>
      <label class="switch"><input type="checkbox" id="setHints" ${SETTINGS.hints ? "checked" : ""}><span class="slider"></span></label></div>
    <div class="set-row"><div><b>Show dismissed tips again</b><div class="small muted">${(SETTINGS.dismissed_hints || []).length} tip(s) hidden</div></div>
      <button class="btn small" id="setResetHints">Reset</button></div>
    <h4 class="set-h">Features <span class="muted small">— switch off what you don't need</span></h4>
    ${F.map(([k, label, d]) => `<div class="set-row"><div><b>${label}</b><div class="small muted">${d}</div></div>
      <label class="switch"><input type="checkbox" data-feat="${k}" ${featureOn(k) ? "checked" : ""}><span class="slider"></span></label></div>`).join("")}
    <h4 class="set-h">App updates ${hint("upd_app")}</h4>
    <div class="set-row"><div><b>StackRadar ${esc(DR_VERSION)}</b><div class="small muted">release source: <input class="search-in" id="setRepo" value="${esc(SETTINGS.update_repo || "")}" style="width:190px"></div></div>
      <button class="btn small" id="setCheckApp">Check for updates</button></div>
    <div id="appUpdRes" class="small"></div>
    <div class="m-actions"><button class="btn primary" id="mCancel">Done</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#setHints").onchange = async e => { SETTINGS.hints = e.target.checked; applyHints(); await saveSettings({ hints: SETTINGS.hints }); };
  $("#setResetHints").onclick = async () => { SETTINGS.dismissed_hints = []; await saveSettings({ dismissed_hints: [] }); toast("tips restored", "ok"); render(); openSettings(); };
  $$("[data-feat]").forEach(cb => cb.onchange = async () => {
    SETTINGS.features[cb.dataset.feat] = cb.checked;
    await saveSettings({ features: { [cb.dataset.feat]: cb.checked } });
    applyFeatureToggles(); render();
  });
  $("#setRepo").onchange = e => saveSettings({ update_repo: e.target.value.trim() });
  $("#setCheckApp").onclick = checkAppUpdate;
}

async function checkAppUpdate() {
  const out = $("#appUpdRes") || $("#appUpdBox");
  if (window.stackradarDesktop && window.stackradarDesktop.checkForUpdates) {
    window.stackradarDesktop.checkForUpdates();
    if (out) out.innerHTML = `<div class="ok-box">The desktop app is checking for updates — it will download and offer to restart if there is one.</div>`;
    return;
  }
  if (out) out.innerHTML = `<span class="muted">asking GitHub…</span>`;
  const j = await api("/api/app/update-check", {});
  if (!out) return;
  if (!j.ok) { out.innerHTML = `<div class="warn-box">${esc(j.error || "check failed")}</div>`; return; }
  if (!j.latest) { out.innerHTML = `<div class="ok-box">You're on ${esc(j.current)}. No StackRadar releases published in ${esc(j.repo)} yet.</div>`; return; }
  out.innerHTML = j.update
    ? `<div class="warn-box" style="border-color:rgba(245,179,66,.5);background:rgba(245,179,66,.08);color:#ffe2a8">⬆ <b>StackRadar ${esc(j.latest)}</b> is available (you have ${esc(j.current)}). <a href="${esc(j.url)}" target="_blank" rel="noopener">Release notes & downloads ↗</a>
        <div class="small" style="margin-top:6px">${(j.assets || []).filter(a => /\.(dmg|exe|AppImage|zip)$/i.test(a.name || "")).map(a => `<a class="chip" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join("")}</div></div>`
    : `<div class="ok-box">✓ You're up to date (${esc(j.current)}).</div>`;
}

/* ---------------- shared bits: sparkline, ring, jobs ---------------- */

function sparkline(values, opts) {
  const o = Object.assign({ w: 300, h: 64, max: 100, color: "#3987e5", unit: "%", id: "" }, opts || {});
  const v = values.map(x => (x == null || isNaN(x) ? null : x));
  const n = v.length;
  if (n < 2) return `<div class="spark-empty muted small">collecting samples…</div>`;
  const max = Math.max(o.max, ...v.filter(x => x != null));
  const X = i => (i / (n - 1)) * o.w, Y = x => o.h - 2 - (x / max) * (o.h - 6);
  let d = "", started = false;
  v.forEach((x, i) => { if (x == null) { started = false; return; } d += (started ? "L" : "M") + X(i).toFixed(1) + " " + Y(x).toFixed(1) + " "; started = true; });
  const first = v.findIndex(x => x != null), last = n - 1 - [...v].reverse().findIndex(x => x != null);
  const area = d + `L${X(last).toFixed(1)} ${o.h} L${X(first).toFixed(1)} ${o.h} Z`;
  return `<svg class="spark" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" data-spark="${esc(o.id)}" data-max="${max}" data-unit="${esc(o.unit)}">
    <line x1="0" x2="${o.w}" y1="${Y(max / 2)}" y2="${Y(max / 2)}" class="spark-grid"/>
    <path d="${area}" fill="${o.color}" opacity=".13"/>
    <path d="${d}" fill="none" stroke="${o.color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <line class="spark-x" x1="0" x2="0" y1="0" y2="${o.h}" visibility="hidden"/>
  </svg>`;
}
// crosshair + readout on every sparkline
function wireSparks(root, series) {
  $$("svg.spark", root).forEach(svg => {
    const key = svg.dataset.spark, data = series[key];
    if (!data) return;
    const wrap = svg.parentElement;
    let tip = wrap.querySelector(".spark-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "spark-tip"; tip.hidden = true; wrap.appendChild(tip); }
    const line = svg.querySelector(".spark-x");
    svg.onpointermove = e => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (data.v.length - 1));
      if (i < 0 || i >= data.v.length) return;
      const x = (i / (data.v.length - 1)) * 300;
      line.setAttribute("x1", x); line.setAttribute("x2", x); line.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = "";
      const b = document.createElement("b"); b.textContent = data.v[i] == null ? "—" : data.fmt(data.v[i]);
      const s = document.createElement("span"); s.className = "muted"; s.textContent = " · " + data.label + " · " + fmtAgo(data.t[i]);
      tip.append(b, s);
      tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left - 60)) + "px";
    };
    svg.onpointerleave = () => { tip.hidden = true; line.setAttribute("visibility", "hidden"); };
  });
}
function ring(pct, color, big, sub) {
  const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return `<svg viewBox="0 0 84 84" class="ring" role="img" aria-label="${esc(big)} ${esc(sub || "")}">
    <circle cx="42" cy="42" r="${r}" class="ring-bg"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text x="42" y="44" text-anchor="middle" class="ring-big">${esc(big)}</text>
    <text x="42" y="58" text-anchor="middle" class="ring-sub">${esc(sub || "")}</text></svg>`;
}
function levelOf(pct, warn, crit) {
  if (pct == null) return { c: "var(--gray)", icon: "·", label: "n/a" };
  if (pct >= crit) return { c: STATUS.critical, icon: "▲", label: "critical" };
  if (pct >= warn) return { c: STATUS.warning, icon: "●", label: "busy" };
  return { c: STATUS.good, icon: "✓", label: "ok" };
}
function fmtRate(b) { return b == null ? "—" : fmtBytes(b) + "/s"; }
function fmtDur(s) {
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? d + "d " : "") + (h ? h + "h " : "") + m + "m";
}

const JOBS = { poll: null };
async function updatePackages(req, project) {
  const list = (req.packages || []).length ? req.packages.join(", ") : "everything outdated";
  modal(`<h3>Update packages?</h3>
    <div class="small">${req.scope === "project" ? `In <b>${esc((project || {}).name || req.path)}</b>` : "Globally"} via <b>${esc(req.manager)}</b>:</div>
    <div class="cmd-box"><span class="mono">${esc(list)}</span></div>
    <div class="small muted">Updates can introduce breaking changes. Commit your work first if this is a project.</div>
    <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn ok" id="mGo">⬆ Update</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mGo").onclick = async () => {
    const j = await api("/api/update", Object.assign({ confirm: true }, req));
    if (!j.ok) { toast(esc(j.error || "update failed to start"), "err"); return; }
    showJob(j.id, () => {
      if (req.scope === "project" && project) { delete S.depHealth[project.path]; if (S.sel === project) openDrawer(project); }
      if (S.tab === "updates") renderUpdates(true);
    });
  };
}
function showJob(id, onDone, title) {
  modal(`<h3>${esc(title || "Running update…")} <span id="jobBadge" class="badge b-blue">running</span></h3>
    <div class="np-bar" id="jobProg" style="margin:6px 0"><div style="width:0%"></div></div>
    <div class="cmd-box"><span class="mono" id="jobCmd"></span></div>
    <div class="console" id="jobConsole" style="height:280px"></div>
    <div class="m-actions"><button class="btn" id="mCancel">Close</button></div>`);
  $("#mCancel").onclick = () => { clearInterval(JOBS.poll); closeModal(); };
  clearInterval(JOBS.poll);
  const tick = async () => {
    const j = await api("/api/jobs?id=" + encodeURIComponent(id));
    if (!$("#jobConsole")) { clearInterval(JOBS.poll); return; }
    $("#jobCmd").textContent = j.cmd || "";
    const pb = $("#jobProg div"); if (pb) pb.style.width = (j.status === "running" ? (j.progress || 8) : 100) + "%";
    const c = $("#jobConsole");
    const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 30;
    c.innerHTML = consoleHtml(j.logs || "");
    if (atBottom) c.scrollTop = c.scrollHeight;
    if (j.status !== "running") {
      clearInterval(JOBS.poll);
      const b = $("#jobBadge");
      b.className = "badge " + (j.status === "done" ? "b-green" : "b-red");
      b.textContent = j.status === "done" ? "✓ done" : "✗ failed (exit " + j.exit_code + ")";
      toast(j.status === "done" ? "finished" : "failed — see the log", j.status === "done" ? "ok" : "err");
      if (onDone) onDone(j);
    }
  };
  tick(); JOBS.poll = setInterval(tick, 1000);
}

/* ---------------- top bar live system mini ---------------- */

const SYS = { data: null, poll: null };
async function pollSystem() {
  try { SYS.data = await api("/api/system"); } catch (_) { return; }
  renderSysMini();
  if (S.tab === "system") renderSystem();
}
function renderSysMini() {
  const d = SYS.data; const el = $("#sysMini");
  if (!d || !el || !featureOn("system")) { if (el) el.innerHTML = ""; return; }
  const cpu = levelOf(d.cpu, 60, 85), mem = levelOf((d.memory || {}).percent, 75, 90);
  el.innerHTML = `<span title="CPU"><i style="background:${cpu.c}"></i>CPU ${d.cpu == null ? "—" : Math.round(d.cpu) + "%"}</span>
    <span title="memory"><i style="background:${mem.c}"></i>RAM ${(d.memory || {}).percent == null ? "—" : Math.round(d.memory.percent) + "%"}</span>
    ${d.load ? `<span title="load average (1 min) / cores">load ${d.load[0]}/${d.cpu_count}</span>` : ""}`;
}
function onTabChange(tab) {
  if (tab === "system") { pollSystem(); }
}

/* ---------------- System tab ---------------- */

function renderSystem() {
  const el = $("#tab-system");
  const d = SYS.data;
  if (!d) { el.innerHTML = `<div class="empty small">reading system sensors…</div>`; pollSystem(); return; }
  const m = d.memory || {}, hist = d.history || [];
  const cpuL = levelOf(d.cpu, 60, 85), memL = levelOf(m.percent, 75, 90);
  const loadPct = d.load ? 100 * d.load[0] / d.cpu_count : null, loadL = levelOf(loadPct, 100, 150);
  const swapPct = m.swap_total ? 100 * m.swap_used / m.swap_total : null;
  const pressure = { ok: ["✓ healthy", STATUS.good], elevated: ["● busy", STATUS.warning], high: ["▲ under pressure", STATUS.critical] }[d.pressure] || ["?", "var(--gray)"];
  const series = {
    cpu: { v: hist.map(h => h.cpu), t: hist.map(h => h.t), label: "CPU", fmt: x => x.toFixed(1) + "%" },
    mem: { v: hist.map(h => h.mem), t: hist.map(h => h.t), label: "memory", fmt: x => x.toFixed(1) + "%" },
    load: { v: hist.map(h => h.load1), t: hist.map(h => h.t), label: "load (1 min)", fmt: x => x.toFixed(2) },
    net: { v: hist.map(h => (h.rx == null ? null : (h.rx + (h.tx || 0)))), t: hist.map(h => h.t), label: "network in+out", fmt: x => fmtRate(x) },
  };
  const cores = (d.cores || []).map((c, i) => {
    const L = levelOf(c, 60, 85);
    return `<div class="core" title="core ${i}: ${c}%"><div class="core-bar" style="height:${Math.max(3, c)}%;background:${L.c}"></div><span>${i}</span></div>`;
  }).join("");
  const top = (d.top || []).map(p => `<tr>
      <td class="mono">${p.pid}</td><td><b>${esc(p.name)}</b>${p.self ? " " + badge("StackRadar", "b-blue") : ""}${p.project ? " " + badge("📦 " + p.project, "b-purple") : ""}</td>
      <td class="mono" style="text-align:right">${p.cpu == null ? "—" : p.cpu.toFixed(1) + "%"}</td>
      <td class="mono" style="text-align:right">${fmtBytes(p.rss)}</td>
      <td style="text-align:right">${p.project && !p.self ? `<button class="btn danger small" data-killpid="${p.pid}" data-kname="${esc(p.name)}">stop</button>` : ""}</td></tr>`).join("");
  const disks = (d.disks || []).map(k => {
    const L = levelOf(k.percent, 80, 92);
    return `<div class="disk-row"><div class="disk-top"><span class="mono small">${esc(k.path)}</span><span class="small"><b>${fmtBytes(k.free)}</b> free of ${fmtBytes(k.total)}</span></div>
      <div class="hog-bar-wrap"><div class="hog-bar" style="width:${k.percent || 0}%;background:${L.c}"></div></div>
      <div class="small muted">${L.icon} ${k.percent}% used · ${L.label}</div></div>`;
  }).join("");

  el.innerHTML = `
  <h2 class="tab-title">System performance &amp; load ${hint("system")} <span class="badge" style="color:${pressure[1]};border-color:${pressure[1]}">${pressure[0]}</span>
    <span class="muted small">${esc(d.platform)} · up ${fmtDur(d.uptime)} · ${d.cpu_count} cores · refreshes every 2 s</span></h2>
  ${tabHint("system")}
  <div class="grid sys-grid">
    <div class="panel sys-card"><h3>CPU ${hint("sys_cpu")}</h3>
      <div class="sys-row">${ring(d.cpu, cpuL.c, d.cpu == null ? "—" : Math.round(d.cpu) + "%", cpuL.icon + " " + cpuL.label)}
        <div class="spark-wrap">${sparkline(series.cpu.v, { color: "#3987e5", id: "cpu" })}<div class="small muted">last ${Math.round(hist.length * 2 / 60)} min</div></div></div>
      ${cores ? `<div class="cores">${cores}</div>` : ""}
    </div>
    <div class="panel sys-card"><h3>Memory ${hint("sys_mem")}</h3>
      <div class="sys-row">${ring(m.percent, memL.c, m.percent == null ? "—" : Math.round(m.percent) + "%", memL.icon + " " + memL.label)}
        <div class="spark-wrap">${sparkline(series.mem.v, { color: "#9085e9", id: "mem" })}
        <div class="small"><b>${fmtBytes(m.used)}</b> used of ${fmtBytes(m.total)} · ${fmtBytes(m.available)} available</div>
        ${m.swap_total ? `<div class="small muted">swap ${fmtBytes(m.swap_used)} / ${fmtBytes(m.swap_total)} (${Math.round(swapPct)}%)</div>` : `<div class="small muted">no swap</div>`}</div></div>
    </div>
    <div class="panel sys-card"><h3>Load average ${hint("sys_load")}</h3>
      <div class="sys-row">${ring(Math.min(100, loadPct || 0), loadL.c, d.load ? d.load[0].toFixed(2) : "n/a", d.load ? "of " + d.cpu_count + " cores" : "not on Windows")}
        <div class="spark-wrap">${sparkline(series.load.v, { color: "#d95926", id: "load", max: d.cpu_count, unit: "" })}
        ${d.load ? `<div class="small mono">1 min ${d.load[0]} · 5 min ${d.load[1]} · 15 min ${d.load[2]}</div>` : ""}</div></div>
    </div>
    <div class="panel sys-card"><h3>Network</h3>
      <div class="kv"><div class="k">in</div><div class="mono">${fmtRate((d.net || {}).rx)}</div><div class="k">out</div><div class="mono">${fmtRate((d.net || {}).tx)}</div></div>
      <div class="spark-wrap" style="margin-top:8px">${sparkline(series.net.v, { color: "#199e70", id: "net", max: 1024, unit: "B/s" })}</div>
      <div class="small muted">StackRadar itself: pid ${d.self.pid}${d.self.rss_peak ? " · peak " + fmtBytes(d.self.rss_peak) : ""}</div>
    </div>
  </div>
  <div class="grid" style="grid-template-columns: 1.5fr 1fr">
    <div class="panel"><h3>Top processes ${hint("sys_top")} <span class="count">${d.platform.startsWith("Windows") ? "by memory" : "by CPU"}</span></h3>
      <table><tr><th>pid</th><th>process</th><th style="text-align:right">CPU</th><th style="text-align:right">memory</th><th></th></tr>${top || `<tr><td colspan="5" class="muted">no data</td></tr>`}</table></div>
    <div class="panel"><h3>Disks ${hint("sys_disk")}</h3>${disks || '<div class="muted small">no data</div>'}</div>
  </div>`;
  wireSparks(el, series);
  $$("[data-killpid]", el).forEach(b => b.onclick = () => {
    modal(`<h3>Stop ${esc(b.dataset.kname)} (pid ${b.dataset.killpid})?</h3><div class="small">It belongs to one of your scanned projects. StackRadar sends a polite stop signal (SIGTERM / taskkill).</div>
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Stop process</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      const j = await api("/api/kill", { pid: parseInt(b.dataset.killpid, 10), confirm: true });
      closeModal(); toast(j.ok ? "stopped pid " + b.dataset.killpid : esc(j.error || "failed"), j.ok ? "ok" : "err");
      pollSystem();
    };
  });
}

/* ---------------- Agents tab ---------------- */

const AGENT_CATALOG = ["Claude Code", "Codex CLI", "Hermes Agent", "OpenClaw", "Paperclip", "Gemini CLI", "Cursor", "Windsurf",
  "GitHub Copilot CLI", "OpenCode", "Goose", "Aider", "Qwen Code", "Amp", "Kiro", "Continue", "Cline / Roo (VS Code)", "Ollama (local LLMs)", "LM Studio"];
const AGENT_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

function renderAgents() {
  const A = S.data.agents || [];
  const found = new Set(A.map(a => a.name));
  const running = A.filter(a => a.status === "running").length;
  const mcp = new Set(A.flatMap(a => a.mcp || []));
  const tokIn = A.reduce((s, a) => s + (a.tokens_in || 0), 0), tokOut = A.reduce((s, a) => s + (a.tokens_out || 0), 0);
  const cards = A.map((a, i) => {
    const col = AGENT_COLORS[i % AGENT_COLORS.length];
    const st = { running: ["● running", "b-green"], installed: ["installed", "b-blue"] }[a.status] || ["config only", "b-gray"];
    return `<div class="agent-card" style="--ac:${col}">
      <div class="agent-head"><div class="agent-logo">${esc(a.name.slice(0, 1))}</div>
        <div><div class="agent-name">${esc(a.name)}</div><div class="small muted">${esc(a.vendor)}${a.version ? " · " + esc(a.version) : ""}</div></div>
        <span class="badge ${st[1]}" style="margin-left:auto">${st[0]}</span></div>
      <div class="agent-stats">
        <div><b>${a.sessions || 0}</b><span>sessions</span></div>
        <div><b>${a.skills || 0}</b><span>skills</span></div>
        <div><b>${(a.mcp || []).length}</b><span>MCP</span></div>
        <div><b>${fmtBytes(a.size)}</b><span>on disk</span></div>
      </div>
      ${a.tokens_in != null ? `<div class="small" style="margin:6px 0">tokens <span class="mono">${(a.tokens_in || 0).toLocaleString()}</span> in · <span class="mono">${(a.tokens_out || 0).toLocaleString()}</span> out</div>` : ""}
      <div class="small muted">last active ${fmtAgo(a.last_active)}</div>
      ${(a.mcp || []).length ? `<div class="pill-row">${a.mcp.map(m => `<span class="chip" title="MCP server">${esc(m)}</span>`).join("")}</div>` : ""}
      ${(a.notes || []).map(n => `<div class="small" style="color:var(--purple)">• ${esc(n)}</div>`).join("")}
      ${(a.running || []).length ? `<div class="small" style="margin-top:6px"><b>processes</b>${a.running.slice(0, 3).map(r => `<div class="mono small muted ellipsis" title="${esc(r.cmd)}">pid ${r.pid} · ${esc(r.cmd)}</div>`).join("")}</div>` : ""}
      ${(a.ports || []).length ? `<div class="small">ports ${a.ports.map(p => `<b class="mono">:${p}</b>`).join(" ")}</div>` : ""}
      <div class="agent-foot">
        ${(a.dirs || []).slice(0, 1).map(d => `<button class="btn small" data-reveal="${esc(d)}" title="${esc(d)}">📂 ${esc(d.split(/[\\/]/).slice(-1)[0])}</button>`).join("")}
        <a class="btn small" href="${esc(a.url)}" target="_blank" rel="noopener">homepage ↗</a>
      </div>
    </div>`;
  }).join("");
  const missing = AGENT_CATALOG.filter(n => !found.has(n));
  $("#tab-agents").innerHTML = `
  <h2 class="tab-title">AI agents on this machine ${hint("agents")}</h2>
  ${tabHint("agents")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Agents found</div><div class="v" style="color:var(--purple)">${A.length}</div><div class="s">of ${AGENT_CATALOG.length} StackRadar knows</div></div>
    <div class="card"><div class="k">Running now</div><div class="v" style="color:${running ? "var(--green)" : "var(--gray)"}">${running}</div><div class="s">process or port detected</div></div>
    <div class="card"><div class="k">MCP servers</div><div class="v" style="color:var(--cyan)">${mcp.size}</div><div class="s">${esc([...mcp].slice(0, 4).join(", ")) || "none configured"}</div></div>
    <div class="card"><div class="k">Tokens (logged)</div><div class="v" style="color:var(--amber)">${fmtNum(tokIn + tokOut)}</div><div class="s">${fmtNum(tokIn)} in · ${fmtNum(tokOut)} out</div></div>
    <div class="card"><div class="k">Skills installed</div><div class="v">${((S.data.skills || {}).summary || {}).installed || 0}</div><div class="s">see the Skills tab</div></div>
  </div>
  <div class="agent-grid">${cards || `<div class="empty">No AI agents detected.</div>`}</div>
  <div class="panel" style="margin-top:14px"><h3>Also checked — not found here</h3>
    <div class="pill-row">${missing.map(n => `<span class="badge b-gray">${esc(n)}</span>`).join("") || '<span class="muted small">everything StackRadar knows about is installed 🎉</span>'}</div>
    <div class="small muted" style="margin-top:6px">Detection looks for the CLI on your PATH and the agent's config folder (e.g. ~/.claude, ~/.codex, ~/.hermes, ~/.openclaw, ~/.paperclip). Nothing is sent anywhere.</div>
  </div>`;
  $$("#tab-agents [data-reveal]").forEach(b => b.onclick = () => revealPath(b.dataset.reveal));
}
function fmtNum(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

/* ---------------- Skills tab ---------------- */

const SK = { q: "", agent: "", filter: "" };
function renderSkills() {
  const K = S.data.skills || {}, all = K.skills || [], sum = K.summary || {};
  const agents = [...new Set(all.map(s => s.agent))].sort();
  const dupNames = new Set((K.duplicates || []).map(d => d.name.toLowerCase()));
  let rows = all.filter(s => {
    if (SK.q && !(s.name + " " + s.description + " " + s.path).toLowerCase().includes(SK.q.toLowerCase())) return false;
    if (SK.agent && s.agent !== SK.agent) return false;
    if (SK.filter === "unused" && s.uses) return false;
    if (SK.filter === "used" && !s.uses) return false;
    if (SK.filter === "dupes" && !dupNames.has(s.name.toLowerCase())) return false;
    if (SK.filter === "project" && s.scope !== "project") return false;
    return true;
  });
  const maxUse = Math.max(1, ...all.map(s => s.uses || 0));
  const table = rows.slice(0, 400).map(s => `<tr>
    <td><b>${esc(s.name)}</b> ${dupNames.has(s.name.toLowerCase()) ? badge("duplicate", "b-amber") : ""} ${s.kind !== "skill" ? badge(s.kind, "b-gray") : ""}
      <div class="sub">${esc(s.description.slice(0, 140))}</div></td>
    <td>${badge(s.agent, "b-purple")}${s.plugin ? `<div class="sub">plugin: ${esc(s.plugin)}</div>` : ""}</td>
    <td>${s.scope === "project" ? badge("📦 " + (s.project || "project"), "b-blue") : '<span class="muted small">global</span>'}</td>
    <td style="min-width:130px"><div class="use-bar"><div style="width:${100 * (s.uses || 0) / maxUse}%"></div></div>
      <span class="mono small">${s.uses || 0}×</span> ${s.used_via && s.used_via.length ? `<span class="muted small">via ${esc(s.used_via.join(", "))}</span>` : ""}</td>
    <td class="small">${s.last_used ? fmtAgo(s.last_used) : '<span class="muted">never</span>'}${s.used_in && s.used_in.length ? `<div class="sub">in ${esc(s.used_in.join(", "))}</div>` : ""}</td>
    <td class="mono small" style="text-align:right">${fmtBytes(s.size)}</td>
    <td><button class="btn small" data-reveal="${esc(s.folder)}" title="${esc(s.path)}">📂</button></td></tr>`).join("");
  const dupes = (K.duplicates || []).map(d => `<div class="dup-row">
      <div><b>${esc(d.name)}</b> × ${d.count} ${d.identical ? badge("identical copies", "b-green") : badge("different versions", "b-amber")}
        <span class="muted small">${esc(d.agents.join(" · "))}${d.wasted ? " · " + fmtBytes(d.wasted) + " redundant" : ""}</span></div>
      ${d.paths.map(p => `<div class="mono small muted path-line"><span>${esc(p)}</span><button class="mini-btn" data-reveal="${esc(p)}">📂</button></div>`).join("")}</div>`).join("");
  const ghost = (K.ghost || []).map(g => `<span class="chip" title="${esc(g.via.join(", "))} · last ${fmtAgo(g.last)}">${esc(g.name)} · ${g.uses}×</span>`).join("");
  const tools = Object.entries(((K.claude_totals || {}).tools) || {});
  const maxT = Math.max(1, ...tools.map(t => t[1]));
  const toolBars = tools.slice(0, 12).map(([n, c]) => `<div class="hog-row" style="cursor:default" title="${esc(n)}: ${c} calls">
      <div class="hog-label" style="flex:0 0 150px">${esc(n)}</div><div class="hog-bar-wrap"><div class="hog-bar" style="width:${100 * c / maxT}%;background:#3987e5"></div></div><div class="hog-size">${c}</div></div>`).join("");
  const locks = (K.locks || []);
  $("#tab-skills").innerHTML = `
  <h2 class="tab-title">Skills — installed, used, duplicated ${hint("skills")}</h2>
  ${tabHint("skills")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card clickable-card" data-skf=""><div class="k">Installed</div><div class="v">${sum.installed || 0}</div><div class="s">skills · commands · sub-agents</div></div>
    <div class="card clickable-card" data-skf="used"><div class="k">Used</div><div class="v" style="color:var(--green)">${sum.used || 0}</div><div class="s">${sum.total_uses || 0} total invocations</div></div>
    <div class="card clickable-card" data-skf="unused"><div class="k">Never used</div><div class="v" style="color:${sum.unused ? "var(--amber)" : "var(--green)"}">${sum.unused || 0}</div><div class="s">candidates to remove</div></div>
    <div class="card clickable-card" data-skf="dupes"><div class="k">Duplicate names</div><div class="v" style="color:${sum.duplicate_names ? "var(--red)" : "var(--green)"}">${sum.duplicate_names || 0}</div><div class="s">same skill in 2+ places</div></div>
    <div class="card"><div class="k">Used but not installed</div><div class="v">${(K.ghost || []).length}</div><div class="s">built-in / plugin / removed</div></div>
  </div>
  <div class="filterbar">
    <input id="skQ" placeholder="search skills…" value="${esc(SK.q)}">
    <select id="skAgent"><option value="">all agents</option>${agents.map(a => `<option ${SK.agent === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
    <select id="skF">${[["", "everything"], ["used", "used"], ["unused", "never used"], ["dupes", "duplicates"], ["project", "project-level only"]].map(x => `<option value="${x[0]}" ${SK.filter === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}</select>
    <span class="muted small">${rows.length} shown</span>
  </div>
  <div class="panel" style="padding:6px 8px"><table>
    <tr><th>skill</th><th>agent</th><th>scope</th><th>uses</th><th>last used</th><th style="text-align:right">size</th><th></th></tr>
    ${table || `<tr><td colspan="7" class="muted">no skills match</td></tr>`}</table></div>
  <div class="grid" style="grid-template-columns: 1.3fr 1fr">
    <div class="panel"><h3>Duplicate skills ${hint("sk_dupes")} <span class="count">${(K.duplicates || []).length}</span></h3>${dupes || '<div class="ok-box small">no duplicates 🎉</div>'}</div>
    <div>
      <div class="panel"><h3>Most-used Claude Code tools ${hint("sk_tools")}</h3>${toolBars || '<div class="muted small">no transcripts found</div>'}</div>
      <div class="panel"><h3>Used but not installed ${hint("sk_ghost")}</h3>${ghost || '<span class="muted small">none</span>'}</div>
      ${locks.length ? `<div class="panel"><h3>skills-lock.json pins <span class="count">${locks.length}</span></h3>${locks.slice(0, 40).map(l => `<span class="chip" title="${esc(l.source || "")} · ${esc(l.hash)}">${esc(l.project)}/${esc(l.name)}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
  $("#skQ").oninput = e => { SK.q = e.target.value; renderSkills(); const i = $("#skQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $("#skAgent").onchange = e => { SK.agent = e.target.value; renderSkills(); };
  $("#skF").onchange = e => { SK.filter = e.target.value; renderSkills(); };
  $$("#tab-skills [data-skf]").forEach(c => c.onclick = () => { SK.filter = c.dataset.skf; renderSkills(); });
  $$("#tab-skills [data-reveal]").forEach(b => b.onclick = () => revealPath(b.dataset.reveal));
}
function projectSkillsPanel(p) {
  const K = (S.data && S.data.skills) || {};
  const used = (K.skills || []).filter(s => (s.used_in || []).includes(p.name));
  const local = (K.skills || []).filter(s => s.scope === "project" && s.project === p.name);
  if (!used.length && !local.length) return "";
  const seen = new Set();
  const u = used.filter(s => !seen.has(s.name) && seen.add(s.name));
  return `<div class="panel"><h3>Skills ${hint("proj_skills")} <span class="count">${local.length} installed here · ${u.length} used here</span></h3>
    ${local.length ? `<div class="small muted">installed in this project:</div><div class="pill-row">${local.map(s => badge("✪ " + s.name, "b-purple")).join("")}</div>` : ""}
    ${u.length ? `<div class="small muted" style="margin-top:6px">used while working here:</div><div class="pill-row">${u.map(s => `<span class="chip">${esc(s.name)} · ${s.uses}×</span>`).join("")}</div>` : ""}
  </div>`;
}

/* ---------------- Schedules tab ---------------- */

const SCH = { data: null, q: "" };
async function renderSchedules() {
  const el = $("#tab-schedules");
  if (!SCH.data) el.innerHTML = `<div class="empty small">reading schedules…</div>`;
  SCH.data = await api("/api/schedules");
  const rows = SCH.data.schedules || [];
  const now = Date.now() / 1000;
  const proj = rows.filter(r => r.scope === "project").length, sys = rows.length - proj;
  const agent = rows.filter(r => /cron$/.test(r.source || "") && /OpenClaw|Hermes|Paperclip/.test(r.source)).length;
  // 24 h timeline (hour ticks, dots placed by time-of-next-run)
  const in24 = rows.filter(r => r.next && r.next - now < 86400);
  const dots = in24.map((r, i) => {
    const x = 100 * (r.next - now) / 86400;
    return `<div class="tl-dot" style="left:${x}%;top:${14 + (i % 4) * 16}px" title="${esc(r.name || r.source)} — ${esc(r.human)} — ${new Date(r.next * 1000).toLocaleString()}"></div>`;
  }).join("");
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => {
    const t = new Date((now + h * 3600) * 1000);
    return `<div class="tl-tick" style="left:${100 * h / 24}%"><span>${h === 0 ? "now" : t.getHours().toString().padStart(2, "0") + ":00"}</span></div>`;
  }).join("");
  const q = SCH.q.toLowerCase();
  const list = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const table = list.map(r => `<tr class="${r.enabled === false ? "archived-row" : ""}">
    <td style="white-space:nowrap">${r.next ? `<b>${esc(fmtIn(r.next))}</b><div class="sub">${new Date(r.next * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>` : `<span class="muted">${esc(r.next_label || "—")}</span>`}</td>
    <td><b>${esc(r.human || "")}</b>${r.expr ? `<div class="sub mono">${esc(r.expr)}</div>` : ""}</td>
    <td>${badge(r.source || r.kind, r.scope === "project" ? "b-cyan" : (/cron$/.test(r.source || "") ? "b-purple" : "b-gray"))}${r.enabled === false ? " " + badge("disabled", "b-gray") : ""}</td>
    <td>${r.project ? `<a href="#" data-openproj="${esc(r.project.path)}">📦 ${esc(r.project.name)}</a>` : '<span class="muted small">—</span>'}</td>
    <td class="small"><span class="mono ellipsis" title="${esc(r.command || "")}">${esc((r.command || r.name || "").slice(0, 90))}</span>${r.file ? `<div class="sub">${esc(r.file)}</div>` : ""}</td></tr>`).join("");
  el.innerHTML = `
  <h2 class="tab-title">Schedules — what runs on a timer ${hint("schedules")}</h2>
  ${tabHint("schedules")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Schedules found</div><div class="v">${rows.length}</div><div class="s">${proj} in repos · ${sys} on this machine</div></div>
    <div class="card"><div class="k">Next 24 hours</div><div class="v" style="color:var(--cyan)">${SCH.data.next_24h || 0}</div><div class="s">runs coming up</div></div>
    <div class="card"><div class="k">Next run</div><div class="v" style="font-size:17px">${rows[0] && rows[0].next ? esc(fmtIn(rows[0].next)) : "—"}</div><div class="s ellipsis">${rows[0] ? esc(rows[0].human + " · " + (rows[0].project ? rows[0].project.name : rows[0].source)) : ""}</div></div>
    <div class="card"><div class="k">AI-agent jobs</div><div class="v" style="color:var(--purple)">${agent}</div><div class="s">OpenClaw · Hermes · Paperclip</div></div>
  </div>
  <div class="panel"><h3>Next 24 hours</h3><div class="timeline">${ticks}${dots}</div></div>
  <div class="grid" style="grid-template-columns: 1fr 340px">
    <div class="panel" style="padding:6px 8px">
      <div class="filterbar" style="margin:6px"><input id="schQ" placeholder="filter schedules…" value="${esc(SCH.q)}"></div>
      <table><tr><th>next run</th><th>when</th><th>source</th><th>project</th><th>what</th></tr>${table || `<tr><td colspan="5" class="muted">No schedules found. StackRadar looks at GitHub Actions, vercel.json, wrangler/netlify, node-cron, Celery beat, Kubernetes CronJobs, your crontab, launchd, systemd timers, Task Scheduler and agent cron files.</td></tr>`}</table></div>
    <div class="panel"><h3>Cron playground ${hint("sched_play")}</h3>
      <input class="search-in" id="cronIn" value="0 9 * * 1-5" style="width:100%" aria-label="cron expression">
      <div id="cronOut" class="small" style="margin-top:8px"></div>
      <div class="small muted" style="margin-top:8px">minute · hour · day · month · weekday — also @daily, @hourly …</div></div>
  </div>`;
  $("#schQ").oninput = e => { SCH.q = e.target.value; renderSchedules().then(() => { const i = $("#schQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
  $$("#tab-schedules [data-openproj]").forEach(a => a.onclick = e => {
    e.preventDefault(); const p = (S.data.projects || []).find(x => x.path === a.dataset.openproj); if (p) openDrawer(p);
  });
  const cron = async () => {
    const j = await api("/api/cron/preview?expr=" + encodeURIComponent($("#cronIn").value));
    $("#cronOut").innerHTML = j.valid ? `<b>${esc(j.human)}</b><div class="muted">${(j.next || []).map(t => new Date(t * 1000).toLocaleString()).join("<br>")}</div>`
      : `<span class="sev-high">not a valid cron expression</span>`;
  };
  $("#cronIn").oninput = cron; cron();
}

/* ---------------- Duplicates tab ---------------- */

function renderDuplicates() {
  const D = S.data.duplicates || {};
  const groups = D.groups || [];
  const cross = groups.filter(g => g.cross_project).length;
  const gHtml = groups.slice(0, 150).map((g, gi) => `<div class="dup-row">
      <div class="dup-head"><b>${esc(g.name)}</b> <span class="muted small">${fmtBytes(g.size)} × ${g.count}</span>
        ${g.cross_project ? badge("across projects", "b-blue") : badge("same project", "b-gray")}
        <span class="spacer"></span><b class="mono" style="color:var(--amber)">${fmtBytes(g.wasted)}</b><span class="muted small">&nbsp;redundant</span></div>
      ${g.files.map((f, i) => `<div class="path-line small"><span class="badge b-purple">${esc(f.project)}</span><span class="mono muted ellipsis" title="${esc(f.path)}">${esc(f.path)}</span>
        ${i === 0 ? '<span class="badge b-green">keep</span>' : `<button class="mini-btn" data-trash="${esc(f.path)}" title="move this copy to the Trash">🗑</button>`}
        <button class="mini-btn" data-reveal="${esc(f.path)}" title="show in file manager">📂</button></div>`).join("")}
    </div>`).join("");
  const pHtml = (D.projects || []).map(d => `<div class="dup-row"><div><b>${esc(d.reason)}</b> <span class="mono small muted">${esc(d.key)}</span></div>
      ${d.projects.map(p => `<div class="path-line small"><a href="#" data-openproj="${esc(p.path)}">📦 ${esc(p.name)}</a><span class="mono muted ellipsis">${esc(p.path)}</span><span class="mono small">${fmtBytes(p.size)}</span></div>`).join("")}</div>`).join("");
  $("#tab-duplicates").innerHTML = `
  <h2 class="tab-title">Duplicate files &amp; copied projects ${hint("duplicates")}</h2>
  ${tabHint("duplicates")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Redundant space</div><div class="v" style="color:var(--amber)">${fmtBytes(D.wasted_total || 0)}</div><div class="s">extra copies beyond the first</div></div>
    <div class="card"><div class="k">Duplicate groups</div><div class="v">${D.group_count || 0}</div><div class="s">files ≥ ${fmtBytes(D.min_size || 4096)}, hash-verified</div></div>
    <div class="card"><div class="k">Across projects</div><div class="v" style="color:var(--blue)">${cross}</div><div class="s">same file in different repos</div></div>
    <div class="card"><div class="k">Copied projects</div><div class="v" style="color:${(D.projects || []).length ? "var(--red)" : "var(--green)"}">${(D.projects || []).length}</div><div class="s">same remote or “copy”-style names</div></div>
  </div>
  <div class="grid" style="grid-template-columns: 1.6fr 1fr">
    <div class="panel"><h3>Identical files <span class="count">largest waste first</span></h3>${gHtml || '<div class="ok-box">No duplicate files found 🎉</div>'}</div>
    <div class="panel"><h3>Projects that look like copies</h3>${pHtml || '<div class="ok-box small">none</div>'}
      <div class="small muted" style="margin-top:8px">Duplicate skills are listed in the Skills tab.</div></div>
  </div>`;
  const tab = $("#tab-duplicates");
  $$("[data-reveal]", tab).forEach(b => b.onclick = () => revealPath(b.dataset.reveal));
  $$("[data-openproj]", tab).forEach(a => a.onclick = e => { e.preventDefault(); const p = (S.data.projects || []).find(x => x.path === a.dataset.openproj); if (p) openDrawer(p); });
  $$("[data-trash]", tab).forEach(b => b.onclick = async () => {
    const path = b.dataset.trash, name = path.split(/[\\/]/).pop();
    const j = await api("/api/actions", { action: "delete", path, confirm: name, force: false });
    if (j.ok) { toast("moved to trash — freed " + fmtBytes(j.freed), "ok"); b.closest(".path-line").classList.add("gone"); b.remove(); }
    else toast(esc(j.error || "failed"), "err");
  });
}

/* ---------------- Updates tab ---------------- */

const UPD = { global: null, loading: false, sel: new Set() };
async function renderUpdates(refresh) {
  const el = $("#tab-updates");
  const P = S.data.projects || [];
  const projRows = P.filter(p => (p.dependencies || []).length).map(p => {
    const h = S.depHealth[p.path];
    const old = h ? (h.items || []).filter(it => it.current && it.latest && String(it.current) !== String(it.latest)) : [];
    return `<tr><td><b>${esc(p.name)}</b><div class="sub">${p.dep_count} deps · ${esc(depManager(p) === "node" ? "Node" : "Python")}</div></td>
      <td>${h ? (old.length ? badge(old.length + " outdated", "b-red") : badge("up to date", "b-green")) + `<div class="sub">${esc(h.method)}</div>` : '<span class="muted small">not checked</span>'}</td>
      <td class="small">${old.slice(0, 6).map(o => `<span class="dep-chip dep-old">${esc(o.name)} ${esc(o.current)} → <b>${esc(o.latest)}</b></span>`).join("")}${old.length > 6 ? ` +${old.length - 6}` : ""}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn small" data-pcheck="${esc(p.path)}">⟳ check</button>
        ${old.length ? `<button class="btn ok small" data-pupd="${esc(p.path)}">⬆ update ${old.length}</button>` : ""}</td></tr>`;
  }).join("");
  const g = UPD.global;
  const mgrs = g ? Object.entries(g.managers || {}) : [];
  const gHtml = !g ? `<div class="muted small">${UPD.loading ? "checking npm -g, pip and Homebrew… (can take a minute)" : "Click “Check global packages” to look for newer versions."}</div>` :
    (mgrs.length ? mgrs.map(([k, m]) => `<div class="upd-mgr"><div class="upd-mgr-head"><b>${esc(m.label)}</b> ${m.items.length ? badge(m.items.length + " outdated", "b-red") : badge("up to date", "b-green")}
        <span class="spacer"></span>${m.items.length ? `<button class="btn small" data-gsel="${k}">select all</button><button class="btn ok small" data-gupd="${k}">⬆ update selected</button>` : ""}</div>
        ${m.note && m.items.length ? `<div class="small muted">${esc(m.note)}</div>` : ""}
        ${m.items.map(it => `<label class="upd-item"><input type="checkbox" data-gpkg="${k}|${esc(it.name)}" ${UPD.sel.has(k + "|" + it.name) ? "checked" : ""}>
          <span class="mono">${esc(it.name)}</span> <span class="muted mono small">${esc(it.current || "?")}</span> <span class="dep-arrow">→</span> <b class="mono small">${esc(it.latest || "?")}</b></label>`).join("")}</div>`).join("")
      : `<div class="muted small">no package managers found (npm / pip / brew)</div>`);
  const totalOld = mgrs.reduce((a, [, m]) => a + m.items.length, 0);
  el.innerHTML = `
  <h2 class="tab-title">Updates — outdated packages, global &amp; per app ${hint("updates")}</h2>
  ${tabHint("updates")}
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="panel"><h3>Global packages ${hint("upd_global")} ${g ? `<span class="count">checked ${fmtAgo(g.checked_at)} · ${totalOld} outdated</span>` : ""}</h3>
      <div class="run-bar" style="margin-top:0"><button class="btn primary" id="gCheck" ${UPD.loading ? "disabled" : ""}>⟳ Check global packages</button></div>
      <div style="margin-top:10px">${gHtml}</div></div>
    <div class="panel"><h3>StackRadar app ${hint("upd_app")}</h3>
      <div class="kv"><div class="k">installed</div><div><b>${esc(DR_VERSION)}</b></div><div class="k">release source</div><div class="mono small">${esc(SETTINGS.update_repo || "")}</div></div>
      <div class="run-bar"><button class="btn" id="appCheck">Check for StackRadar updates</button></div><div id="appUpdBox" class="small"></div></div>
  </div>
  <div class="panel"><h3>Per-project dependencies ${hint("upd_projects")}</h3>
    <div class="run-bar" style="margin-top:0"><button class="btn" id="pCheckAll">⟳ Check all projects</button><span class="run-note">uses each project's node_modules / venv — needs internet</span></div>
    <table style="margin-top:8px"><tr><th>project</th><th>status</th><th>outdated</th><th></th></tr>${projRows || `<tr><td colspan="4" class="muted">no projects with dependency manifests</td></tr>`}</table></div>`;
  $("#gCheck").onclick = async () => {
    UPD.loading = true; renderUpdates();
    UPD.global = await api("/api/updates/global?refresh=1");
    UPD.loading = false; renderUpdates(); updateNavBadges();
  };
  $("#appCheck").onclick = checkAppUpdate;
  $$("[data-gpkg]", el).forEach(cb => cb.onchange = () => cb.checked ? UPD.sel.add(cb.dataset.gpkg) : UPD.sel.delete(cb.dataset.gpkg));
  $$("[data-gsel]", el).forEach(b => b.onclick = () => { (g.managers[b.dataset.gsel].items || []).forEach(it => UPD.sel.add(b.dataset.gsel + "|" + it.name)); renderUpdates(); });
  $$("[data-gupd]", el).forEach(b => b.onclick = () => {
    const k = b.dataset.gupd;
    const names = [...UPD.sel].filter(x => x.startsWith(k + "|")).map(x => x.slice(k.length + 1));
    if (!names.length) return toast("tick at least one package", "err");
    updatePackages({ scope: "global", manager: k, packages: names });
  });
  const checkProj = async path => {
    const j = await api("/api/deps/check", { path, force: true });
    if (j.ok) S.depHealth[path] = j; else toast(esc(j.error || "check failed"), "err");
  };
  $$("[data-pcheck]", el).forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = "checking…"; await checkProj(b.dataset.pcheck); renderUpdates(); });
  $$("[data-pupd]", el).forEach(b => b.onclick = () => {
    const p = P.find(x => x.path === b.dataset.pupd), h = S.depHealth[p.path] || {};
    const names = (h.items || []).filter(it => it.current && it.latest && String(it.current) !== String(it.latest)).map(it => it.name);
    updatePackages({ scope: "project", manager: depManager(p), path: p.path, packages: names }, p);
  });
  $("#pCheckAll").onclick = async () => {
    const btn = $("#pCheckAll"); btn.disabled = true;
    const ps = P.filter(p => (p.dependencies || []).length);
    for (let i = 0; i < ps.length; i++) { btn.textContent = `checking ${i + 1}/${ps.length}…`; await checkProj(ps[i].path); }
    renderUpdates();
  };
}

/* ---------------- overview extras + nav badges ---------------- */

function overviewExtras() {
  const d = S.data || {};
  const K = d.skills || {}, D = d.duplicates || {}, A = d.agents || [];
  const sched = (d.projects || []).reduce((a, p) => a + (p.schedules || []).length, 0) + (d.system_schedules || []).length;
  const sys = SYS.data;
  const card = (feat, tab, k, v, s, color) => featureOn(feat) ? `<div class="card clickable-card" data-goto="${tab}"><div class="k">${k}</div><div class="v" style="color:${color}">${v}</div><div class="s">${s}</div></div>` : "";
  const html = [
    card("agents", "agents", "AI agents", A.length, esc(A.slice(0, 3).map(a => a.name).join(" · ") || "none found"), "var(--purple)"),
    card("skills", "skills", "Skills", ((K.summary || {}).installed || 0), `${(K.summary || {}).unused || 0} unused · ${(K.summary || {}).duplicate_names || 0} duplicated`, "var(--text)"),
    card("schedules", "schedules", "Schedules", sched, "cron jobs, timers & agent jobs", "var(--cyan)"),
    card("duplicates", "duplicates", "Duplicate files", fmtBytes(D.wasted_total || 0), `${D.group_count || 0} groups · ${(D.projects || []).length} copied projects`, "var(--amber)"),
    card("system", "system", "System load", sys && sys.cpu != null ? Math.round(sys.cpu) + "% CPU" : "—", sys ? `${Math.round((sys.memory || {}).percent || 0)}% RAM · load ${sys.load ? sys.load[0] : "n/a"}` : "live monitor", "var(--green)"),
  ].join("");
  return html ? `<div class="grid cards" style="margin-bottom:14px">${html}</div>` : "";
}
function updateNavBadges() {
  const d = S.data || {};
  const set = (id, v, cls) => { const e = $(id); if (e) { e.textContent = v || ""; e.className = "nbadge " + (cls || ""); e.hidden = !v; } };
  set("#nbAgents", (d.agents || []).length);
  set("#nbSkills", ((d.skills || {}).summary || {}).duplicate_names ? "!" + d.skills.summary.duplicate_names : ((d.skills || {}).summary || {}).installed, ((d.skills || {}).summary || {}).duplicate_names ? "warn" : "");
  set("#nbSched", (d.projects || []).reduce((a, p) => a + (p.schedules || []).length, 0) + (d.system_schedules || []).length);
  set("#nbDupes", ((d.duplicates || {}).group_count) || "", "warn");
  const out = UPD.global ? Object.values(UPD.global.managers || {}).reduce((a, m) => a + m.items.length, 0) : 0;
  set("#nbUpdates", out || "", "warn");
}

/* ---------------- init ---------------- */

Object.assign(RENDERERS, {
  system: renderSystem, agents: renderAgents, skills: renderSkills, schedules: renderSchedules,
  duplicates: renderDuplicates, updates: () => renderUpdates(false),
});

async function featuresInit() {
  setupHintTips();
  try { Object.assign(SETTINGS, await api("/api/settings")); } catch (_) {}
  applyHints(); applyFeatureToggles();
  if (S.data) render();
  $("#hintsToggle").onchange = async e => { SETTINGS.hints = e.target.checked; applyHints(); await saveSettings({ hints: SETTINGS.hints }); };
  $("#settingsBtn").onclick = openSettings;
  $("#sysMini").onclick = () => { S.tab = "system"; render(); };
  $("#sideToggle").onclick = () => {
    document.body.classList.toggle("side-collapsed");
    try { localStorage.setItem("stackradar.side", document.body.classList.contains("side-collapsed") ? "1" : "0"); } catch (_) {}
  };
  try { if (localStorage.getItem("stackradar.side") === "1") document.body.classList.add("side-collapsed"); } catch (_) {}
  document.addEventListener("click", e => {
    const c = e.target.closest("[data-goto]");
    if (c) { S.tab = c.dataset.goto; render(); }
  });
  pollSystem();
  SYS.poll = setInterval(pollSystem, 2000);
  if (window.stackradarDesktop && window.stackradarDesktop.onUpdateStatus) {
    window.stackradarDesktop.onUpdateStatus(msg => toast(esc(msg), "ok"));
  }
}
