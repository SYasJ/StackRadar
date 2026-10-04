/* StackRadar — frontend (vanilla JS, no dependencies, no network calls except to the local server) */
"use strict";

/* every request carries the per-launch token (blocks CSRF from other sites) */
const DR_TOKEN = (document.querySelector('meta[name="stackradar-token"]') || {}).content || "";
const DR_VERSION = (document.querySelector('meta[name="stackradar-version"]') || {}).content || "";
const _nativeFetch = window.fetch.bind(window);
window.fetch = (url, opts) => {
  opts = Object.assign({}, opts || {});
  opts.headers = Object.assign({}, opts.headers || {}, { "X-StackRadar-Token": DR_TOKEN });
  return _nativeFetch(url, opts);
};
async function api(url, body) {
  const r = await fetch(url, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let j = {};
  try { j = await r.json(); } catch (_) { j = { ok: false, error: "bad response (" + r.status + ")" }; }
  if (!r.ok && j.ok === undefined) j.ok = false;
  return j;
}

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

const S = {
  data: null,
  tab: "overview",
  q: "", fLang: "", fRisk: "", fSrc: "", fStatus: "",
  sort: { k: "size", d: -1 },
  sel: null,
  line: "all",
  reclaimSel: new Set(),
  pollTimer: null,
  runPoll: null,
  visibleRun: null,
  depHealth: {},   // path -> {items, method, checked_at}
};
const SWATCH_COLORS = ["#f4536e", "#f58242", "#f5b342", "#2dd4a7", "#39c5e0", "#4d9fff", "#b478ff", "#ff6fb3"];
const STATUS_META = {
  active:   { label: "active", cls: "b-green" },
  fix:      { label: "needs fix", cls: "b-amber" },
  archived: { label: "archived", cls: "b-gray" },
};
function metaOf(p){ return (p && p.meta) || { color: null, rating: 0, notes: "", status: "active" }; }
function colorOf(p){
  const m = metaOf(p);
  return m.color || ("hsl(" + hue(p.primary_language || p.name) + ",60%,55%)");
}
function starsHtml(p, big){
  const r = metaOf(p).rating || 0;
  let s = "";
  for (let i = 1; i <= 5; i++)
    s += `<span class="star ${i <= r ? "on" : ""}" data-star="${i}" data-path="${esc(p.path)}" style="${big ? "font-size:20px" : ""}">${i <= r ? "★" : "☆"}</span>`;
  return `<span class="stars">${s}</span>`;
}
async function saveMeta(p, patch){
  try {
    const r = await fetch("/api/meta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ path: p.path }, patch)),
    });
    const j = await r.json();
    if (j.ok && p) p.meta = j.meta;
    return j;
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function fmtBytes(n) {
  if (n == null || isNaN(n)) return "?";
  n = Number(n);
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
}
function fmtAgo(ts) {
  if (!ts) return "unknown";
  const d = Date.now() / 1000 - ts;
  if (d < 90) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  if (d < 86400 * 30) return Math.floor(d / 86400) + " days ago";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function hue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function badge(text, cls) { return `<span class="badge ${cls}">${esc(text)}</span>`; }
function langBadge(lang) {
  if (!lang) return badge("?", "b-gray");
  return `<span class="badge" style="color:hsl(${hue(lang)},70%,75%);border-color:hsl(${hue(lang)},60%,45%);background:hsl(${hue(lang)},60%,20%)">${esc(lang)}</span>`;
}
function riskBadge(level) {
  const m = { high: ["high risk", "b-red"], medium: ["medium", "b-amber"], low: ["low", "b-green"] };
  const x = m[level] || m.low;
  return badge(x[0], x[1]);
}
function srcInfo(p) {
  if (p.vibe) return badge("vibe-coded", "b-purple");
  if (p.git && p.git.vcs === "Git" && p.git.remote_host) return badge("git · " + p.git.remote_host, "b-blue");
  if (p.git && p.git.vcs === "Git") return badge("git · local", "b-blue");
  if (p.git && p.git.vcs) return badge(p.git.vcs, "b-gray");
  return badge("no VCS", "b-gray");
}
function aiBadge(p) {
  if (p.llm && p.llm.length) return badge("⚡ " + p.llm[0].tool, "b-amber");
  if (p.ai_names && p.ai_names.length) return badge("🧠 " + p.ai_names[0], "b-purple");
  return null;
}
function toast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast " + (type || "");
  t.innerHTML = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 3800);
  setTimeout(() => t.remove(), 4400);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast("copied to clipboard", "ok"); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("copied", "ok"); } catch (_) {}
    ta.remove();
  }
}
function cmdBox(cmd) {
  return `<div class="cmd-box"><span class="mono">${esc(cmd || "?")}</span><span class="copy" data-copy="${esc(cmd)}" title="copy">⧉</span></div>`;
}

/* ---------------- data ---------------- */

async function loadState() {
  const r = await fetch("/api/state");
  S.data = await r.json();
  render();
  updateScanStatus(S.data.scan || {});
  if (S.data.scan && S.data.scan.running) startPolling();
  document.title = `StackRadar — ${ (S.data.projects || []).length } projects`;
  if (window.updateNavBadges) updateNavBadges();
}
function startPolling() {
  if (S.pollTimer) return;
  S.pollTimer = setInterval(async () => {
    const r = await fetch("/api/scan/progress");
    const p = await r.json();
    updateScanStatus(p);
    if (!p.running) {
      clearInterval(S.pollTimer); S.pollTimer = null;
      if (p.phase === "done") { loadState(); toast("scan complete", "ok"); }
    }
  }, 700);
}
function updateScanStatus(p) {
  const wrap = $("#scanBarWrap"), bar = $("#scanBar"), txt = $("#scanText");
  if (!p) return;
  if (p.running) {
    wrap.hidden = false;
    let pct = 15;
    const pr = p.progress || {};
    if (p.phase === "walking file tree") pct = 12 + 20 * (pr.dirs % 17) / 17; // indeterminate-ish
    else if (p.phase === "analyzing projects") pct = 35 + 55 * ((pr.projects_done || 0) / Math.max(1, pr.projects_total));
    else if (p.phase === "scanning environment") pct = 92;
    else if (p.phase === "checking ports & processes") pct = 97;
    else if (p.phase === "done") pct = 100;
    bar.style.width = pct + "%";
    txt.textContent = (p.phase || "…") + `  ·  dirs ${pr.dirs || 0} · projects ${pr.projects_done || 0}/${pr.projects_total || 0}`;
    $("#scanBtn").disabled = true;
  } else {
    $("#scanBtn").disabled = false;
    if (p.phase === "done") {
      wrap.hidden = true;
      txt.textContent = `last scan ${p.finished ? fmtAgo(p.finished) : ""} · ${(p.roots || []).join(", ")} · ${(p.finished - p.started).toFixed(1)}s`;
    } else if (p.error) {
      wrap.hidden = true;
      txt.textContent = "scan error: " + p.error;
    } else if (p.phase === "idle") {
      wrap.hidden = true;
      txt.textContent = "";
    }
  }
}
async function doScan() {
  const root = $("#rootInput").value.trim() || "~";
  const max_depth = parseInt($("#depthSel").value, 10);
  toast("scanning " + esc(root) + " …");
  const r = await fetch("/api/scan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roots: [root], max_depth }),
  });
  const j = await r.json();
  if (!r.ok) { toast(esc(j.error || "scan failed"), "err"); return; }
  startPolling();
}
function exportJSON() {
  if (!S.data) return toast("nothing to export yet", "err");
  const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stackradar-scan-" + new Date().toISOString().slice(0, 16) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- routing ---------------- */

// features.js / lineage.js register more renderers here
const RENDERERS = {
  overview: () => renderOverview(), projects: () => renderProjects(), runs: () => renderRuns(),
  lineage: () => renderLineage(), env: () => renderEnv(), reclaim: () => renderReclaim(),
};

function render() {
  if (!S.data) return;
  if (S.data.empty) {
    $("#tab-overview").innerHTML = `<div class="empty">No scan yet.<br><br>
      Type a folder into the box at the top (e.g. <code>~/</code> or <code>~/Projects</code>) and press <b>Scan</b>.<br>
      StackRadar runs 100% locally — nothing leaves your machine.</div>`;
    return;
  }
  if (window.applyFeatureToggles) applyFeatureToggles();
  const fn = RENDERERS[S.tab];
  if (fn) fn();
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.tab));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + S.tab));
  if (S.tab === "runs") startRunPolling(); else stopRunPolling();
  if (window.onTabChange) onTabChange(S.tab);
  try { localStorage.setItem("stackradar.tab", S.tab); } catch (_) {}
}

/* ---------------- overview ---------------- */

function renderOverview() {
  const d = S.data, P = d.projects || [];
  const totalSize = P.reduce((a, p) => a + (p.size || 0), 0);
  const keysTotal = P.reduce((a, p) => a + (p.key_count || 0), 0);
  const highRisk = P.filter(p => p.risk_level === "high").length;
  const pp0 = d.port_panel || {};
  const liveNames = [...new Set([...((pp0.killable || []).map(k => k.project)), ...((d.runs || []).filter(r => r.status === "running").map(r => r.project))])].filter(Boolean);
  const aiMade = P.filter(p => (p.llm || []).length > 0 || (p.ai_names || []).length > 0);
  const vcs = P.filter(p => p.git && p.git.vcs).length;
  const vibe = P.filter(p => p.vibe).length;

  const cards = `
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Projects found</div><div class="v">${P.length}</div><div class="s">${vcs} with VCS · ${vibe} vibe-coded</div></div>
    <div class="card"><div class="k">Total size</div><div class="v">${fmtBytes(totalSize)}</div><div class="s">of ${esc((d.roots || []).join(", "))}</div></div>
    <div class="card"><div class="k">Secrets detected</div><div class="v" style="color:${keysTotal ? "var(--red)" : "var(--green)"}">${keysTotal}</div><div class="s">masked in UI — see each project</div></div>
    <div class="card"><div class="k">Open ports</div><div class="v" style="color:var(--cyan)">${(pp0.listening_count != null ? pp0.listening_count : (d.listeners || []).length)}</div><div class="s">${pp0.apps_running || 0} apps running · ${((pp0.killable) || []).length} killable in Runs</div></div>
    <div class="card"><div class="k">High risk</div><div class="v" style="color:${highRisk ? "var(--red)" : "var(--green)"}">${highRisk}</div><div class="s">heuristic vulnerability flags</div></div>
    <div class="card"><div class="k">Running now</div><div class="v" style="color:${liveNames.length ? "var(--green)" : "var(--gray)"}">${liveNames.length}</div><div class="s">${liveNames.map(esc).join(", ") || "nothing"}</div></div>
    <div class="card"><div class="k">AI / IDE traces</div><div class="v" style="color:var(--purple)">${aiMade.length}</div><div class="s">Claude Code · Cursor · VS Code · …</div></div>
  </div>`;

  // top space hogs (projects + big top-level dirs)
  const hogs = [];
  P.slice().sort((a, b) => b.size - a.size).slice(0, 8).forEach(p => hogs.push({ label: "📦 " + p.name, sub: p.path, size: p.size, proj: p, c: "var(--blue)" }));
  ((d.tree || {}).top_dirs || []).slice(0, 5).forEach(t => {
    if (P.some(p => p.path === t.path)) return;
    hogs.push({ label: "📁 " + t.name, sub: t.path, size: t.size, proj: null, c: "var(--gray)" });
  });
  hogs.sort((a, b) => b.size - a.size);
  const maxH = Math.max(1, ...hogs.map(h => h.size));
  const hogHtml = hogs.length ? hogs.map(h => `
    <div class="hog-row" data-idx="${P.indexOf(h.proj)}">
      <div class="hog-label" title="${esc(h.sub)}">${esc(h.label)}</div>
      <div class="hog-bar-wrap"><div class="hog-bar" style="width:${Math.max(2, 100 * h.size / maxH)}%;background:${h.c}"></div></div>
      <div class="hog-size">${fmtBytes(h.size)}</div>
    </div>`).join("") : `<div class="empty small">no data</div>`;

  // language donut
  const langTot = {};
  P.forEach(p => { if (p.primary_language) langTot[p.primary_language] = (langTot[p.primary_language] || 0) + (p.size || 0); });
  const langItems = Object.entries(langTot).sort((a, b) => b[1] - a[1]).slice(0, 9);
  const donut = donutSVG(langItems.map((x, i) => ({ label: x[0], value: x[1], color: `hsl(${hue(x[0])},65%,60%)` })));

  // alerts
  const alerts = [];
  P.forEach(p => {
    if ((p.key_count || 0) > 0) alerts.push({ c: "b-red", html: `<b>${esc(p.key_count)} secret${p.key_count > 1 ? "s" : ""}</b> in <b>${esc(p.name)}</b> — ${esc((p.keys || [])[0] ? p.keys[0].type : "…")}${(p.keys || []).length > 1 ? " +" + (p.keys.length - 1) : ""}` });
    if (p.risk_level === "high") alerts.push({ c: "b-red", html: `high risk score in <b>${esc(p.name)}</b> — ${esc((p.risk_flags || [])[0] ? p.risk_flags[0].label : "see details")}` });
    if ((p.running || []).length) alerts.push({ c: "b-green", html: `<b>${esc(p.name)}</b> is running now (pid ${(p.running[0] || {}).pid}) — port${(p.open_ports || []).length ? " " + p.open_ports.map(o => o.port).join(", ") : ""}` });
    (p.open_ports || []).forEach(o => {
      if (!(p.expected_ports || []).some(e => e.port === o.port))
        alerts.push({ c: "b-cyan", html: `port <b>${o.port}</b> open from <b>${esc(p.name)}</b> (not in its expected ports)` });
    });
    if (!(p.git || {}).vcs) alerts.push({ c: "b-gray", html: `<b>${esc(p.name)}</b> has no version control` });
    if ((p.llm || []).length) {
      const l = p.llm[0];
      alerts.push({ c: "b-amber", html: `<b>${esc(p.name)}</b> built with ${esc(l.tool)} · ${esc(l.model || "unknown model")} · ${Math.round((l.tokens_in || 0) / 1000)}k tokens in / ${Math.round((l.tokens_out || 0) / 1000)}k out` });
    }
  });
  alerts.sort((a, b) => (a.c === "b-red" ? -1 : 1) - (b.c === "b-red" ? -1 : 1));
  const alertHtml = alerts.length ? alerts.slice(0, 14).map(a => `<div class="key-row"><span class="badge ${a.c}" style="flex:0 0 84px;justify-content:center">alert</span><span>${a.html}</span></div>`).join("") : `<div class="ok-box">No alerts. Clean workspace.</div>`;

  $("#tab-overview").innerHTML = tabHint("overview") + cards + (window.overviewExtras ? overviewExtras() : "") + `
  <div class="grid" style="grid-template-columns: 1.2fr .8fr 1.2fr">
    <div class="panel"><h3>Top space hogs ${hint("hogs")} <span class="hint">click a project to open it</span></h3>${hogHtml}</div>
    <div class="panel"><h3>Size by language ${hint("langs")}</h3>${donut}
      <div class="small muted" style="margin-top:8px">${langItems.map(x => `<span class="chip">${esc(x[0])} ${fmtBytes(x[1])}</span>`).join("")}</div>
    </div>
    <div class="panel"><h3>Alerts ${hint("alerts")} <span class="count">secrets · risk · ports · VCS · AI</span></h3>${alertHtml}</div>
  </div>
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="panel"><h3>Open ports on this machine ${hint("ports")} <span class="count">${(d.listeners || []).length} listening</span></h3>
      ${portsTable(d.listeners || [], true)}
    </div>
    <div class="panel"><h3>Ports not linked to any project ${hint("ports_unlinked")}</h3>
      ${portsTable(d.global_ports || [], false) || `<div class="ok-box small">none — every open port belongs to a project above</div>`}
    </div>
  </div>`;

  $$("#tab-overview .hog-row").forEach(row => row.onclick = () => {
    const i = parseInt(row.dataset.idx, 10);
    if (i >= 0 && P[i]) openDrawer(P[i]);
  });
}

function portsTable(list, withLink) {
  if (!list.length) return `<div class="ok-box small">nothing listening</div>`;
  return `<table><tr><th>port</th><th>process</th>${withLink ? "<th>pid</th>" : ""}</tr>
    ${list.slice(0, 25).map(l => `<tr><td><span class="dot open"></span> <b class="mono">${l.port}</b></td>
    <td>${esc(l.proc || "?")}</td>${withLink ? `<td class="muted mono">${l.pid || "?"}</td>` : ""}</tr>`).join("")}
  </table>`;
}

function donutSVG(items) {
  const total = items.reduce((a, x) => a + x.value, 0) || 1;
  const cx = 105, cy = 105, r = 92;
  let a = -Math.PI / 2;
  let paths = "";
  items.forEach(it => {
    const frac = it.value / total;
    const a2 = a + frac * Math.PI * 2;
    if (frac > 0.999) {
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${it.color}"></circle>`;
    } else {
      const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a);
      const x1 = cx + r * Math.cos(a2), y1 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      paths += `<path d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z" fill="${it.color}" stroke="#0b0e14" stroke-width="2">
        <title>${esc(it.label)}: ${fmtBytes(it.value)} (${Math.round(frac * 100)}%)</title></path>`;
    }
    a = a2;
  });
  paths += `<circle cx="${cx}" cy="${cy}" r="52" fill="#121826"></circle>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#e8ecf5" font-size="15" font-weight="700">${fmtBytes(total)}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#8b97ad" font-size="10">total</text>`;
  return `<svg viewBox="0 0 210 210" style="width:100%;max-width:230px;display:block;margin:0 auto">${paths}</svg>`;
}

/* ---------------- projects table ---------------- */

function renderProjects() {
  const P = S.data.projects || [];
  const langs = [...new Set(P.map(p => p.primary_language).filter(Boolean))].sort();
  const filter = p => {
    const q = S.q.toLowerCase();
    if (q && !(p.name + " " + (p.purpose || "") + " " + (p.path || "") + " " + (p.primary_language || "") + " " + (metaOf(p).notes || "")).toLowerCase().includes(q)) return false;
    if (S.fLang && p.primary_language !== S.fLang) return false;
    if (S.fRisk && p.risk_level !== S.fRisk) return false;
    if (S.fSrc === "git" && !(p.git && p.git.vcs)) return false;
    if (S.fSrc === "local" && (p.git && p.git.vcs)) return false;
    if (S.fSrc === "ai" && !((p.llm || []).length || (p.ai_names || []).length)) return false;
    if (S.fSrc === "keys" && !(p.key_count > 0)) return false;
    if (S.fSrc === "running" && !(p.running || []).length) return false;
    if (S.fStatus && metaOf(p).status !== S.fStatus) return false;
    return true;
  };
  let rows = P.filter(filter);
  const k = S.sort.k, dir = S.sort.d;
  const val = p => ({
    name: p.name, size: p.size || 0, last: p.last_run_ts || 0,
    keys: p.key_count || 0, risk: { high: 3, medium: 2, low: 1 }[p.risk_level] || 0,
    lang: p.primary_language || "",
  }[k] || 0);
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);

  const th = (key, label) => `<th data-sort="${key}">${label}${S.sort.k === key ? (S.sort.d > 0 ? " ▲" : " ▼") : ""}</th>`;
  $("#tab-projects").innerHTML = `
  <h2 class="tab-title">Projects &amp; repos <span class="muted small">(${rows.length} of ${P.length})</span> ${hint("projects")}</h2>
  ${tabHint("projects")}
  <div class="filterbar">
    <input id="pSearch" placeholder="search name, purpose, path, notes…" value="${esc(S.q)}">
    <select id="pLang"><option value="">all languages</option>${langs.map(l => `<option ${S.fLang === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <select id="pRisk"><option value="">any risk</option>${["high", "medium", "low"].map(r => `<option ${S.fRisk === r ? "selected" : ""}>${r}</option>`).join("")}</select>
    <select id="pStatus"><option value="">any status</option>
      ${[["active", "🟢 active"], ["fix", "🟠 needs fix"], ["archived", "⚪ archived"]].map(x => `<option value="${x[0]}" ${S.fStatus === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}
    </select>
    <select id="pSrc"><option value="">all sources</option>
      ${[["git", "has git/VCS"], ["local", "no VCS"], ["ai", "AI / IDE traces"], ["keys", "has secrets"], ["running", "running now"]].map(x => `<option value="${x[0]}" ${S.fSrc === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}
    </select>
    <span class="spacer"></span>
    <span class="hint small">click a row for details · click stars to rate</span>
  </div>
  <div class="panel" style="padding:6px 8px">
  <table>
    <tr>${th("name", "Name")}${th("lang", "Lang")}<th>Purpose</th>${th("size", "Size")}${th("last", "Last run")}<th>Ports</th>${th("keys", "Keys")}${th("risk", "Risk")}<th>VCS</th><th>AI</th><th>Rating</th></tr>
    ${rows.map(p => {
      const m = metaOf(p);
      const st = STATUS_META[m.status] || STATUS_META.active;
      const rowCls = m.status === "archived" ? "archived-row" : m.status === "fix" ? "fix-row" : "";
      return `<tr class="clickable ${rowCls}" data-path="${esc(p.path)}">
      <td><span class="dot" style="background:${colorOf(p)};margin-right:7px"></span><b style="color:${m.color || "var(--text)"}">${esc(p.name)}</b>${p.vibe ? " " + badge("vibe", "b-purple") : ""}
        <div class="sub path">${esc(p.path)}</div>
        <div style="margin-top:4px">${p.version ? badge("v" + p.version, "b-blue") : ""} ${badge(st.label, st.cls)}</div></td>
      <td>${langBadge(p.primary_language)}</td>
      <td class="small" style="max-width:300px">${esc((p.purpose || "").slice(0, 120))}</td>
      <td class="mono" style="white-space:nowrap">${fmtBytes(p.size)}</td>
      <td style="white-space:nowrap">${(p.running || []).length ? badge("running", "b-green") : `<span class="${(p.last_run_ts && Date.now() / 1000 - p.last_run_ts < 604800) ? "" : "muted"}">${esc(p.last_run_label || fmtAgo(p.last_run_ts))}</span>`}</td>
      <td>${portCell(p)}</td>
      <td>${p.key_count ? badge(p.key_count + (p.key_count === 1 ? " key" : " keys"), "b-red") : '<span class="badge b-green">clean</span>'}</td>
      <td>${riskBadge(p.risk_level)}</td>
      <td>${srcInfo(p)}</td>
      <td>${aiBadge(p) || '<span class="muted small">—</span>'}</td>
      <td style="white-space:nowrap">${starsHtml(p)}</td>
    </tr>`;
    }).join("")}
  </table></div>`;

  $("#pSearch").oninput = e => { S.q = e.target.value; renderProjects(); const el = $("#pSearch"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
  $("#pLang").onchange = e => { S.fLang = e.target.value; renderProjects(); };
  $("#pRisk").onchange = e => { S.fRisk = e.target.value; renderProjects(); };
  $("#pStatus").onchange = e => { S.fStatus = e.target.value; renderProjects(); };
  $("#pSrc").onchange = e => { S.fSrc = e.target.value; renderProjects(); };
  $$("#tab-projects th[data-sort]").forEach(t => t.onclick = () => {
    const key = t.dataset.sort;
    if (S.sort.k === key) S.sort.d *= -1; else S.sort = { k: key, d: -1 };
    renderProjects();
  });
  $$("#tab-projects .star").forEach(st => st.onclick = async e => {
    e.stopPropagation();
    const path = st.dataset.path;
    const p = P.find(x => x.path === path);
    if (!p) return;
    const rating = parseInt(st.dataset.star, 10);
    await saveMeta(p, { rating: metaOf(p).rating === rating ? 0 : rating });
    renderProjects();
  });
  $$("#tab-projects tr.clickable").forEach(tr => tr.onclick = () => {
    const p = (S.data.projects || []).find(x => x.path === tr.dataset.path);
    if (p) openDrawer(p);
  });
}
function portCell(p) {
  const open = p.open_ports || [], exp = p.expected_ports || [];
  const bits = [];
  open.forEach(o => bits.push(`<span title="open now (pid ${o.pid})"><span class="dot open"></span> ${o.port}</span>`));
  exp.filter(e => !open.some(o => o.port === e.port)).slice(0, 3).forEach(e =>
    bits.push(`<span title="expected from ${esc(e.source)}"><span class="dot exp"></span> ${e.port}</span>`));
  if (!bits.length) return '<span class="muted small">—</span>';
  return `<span style="display:inline-flex;gap:8px">${bits.join("")}</span>`;
}

/* ---------------- drawer (project detail) ---------------- */

function openDrawer(p) {
  S.sel = p;
  const d = S.data;
  const git = p.git || {};
  const run = p.run || {};
  const exp = p.expected_ports || [], open = p.open_ports || [];
  const allPorts = [];
  open.forEach(o => allPorts.push({ port: o.port, status: "open", meta: `pid ${o.pid} · ${o.proc || ""}`, src: "detected live" }));
  exp.forEach(e => { if (!open.some(o => o.port === e.port)) allPorts.push({ port: e.port, status: "expected", meta: "", src: e.source || "" }); });

  const deps = (p.dependencies || []);
  const health = S.depHealth[p.path];
  const hmap = {};
  if (health) (health.items || []).forEach(it => { hmap[String(it.name).toLowerCase()] = it; });
  let outN = 0, oldN = 0;
  const depChips = deps.slice(0, 40).map(dep => {
    const h = hmap[String(dep.name).toLowerCase()];
    if (h && h.current && h.latest && String(h.current) !== String(h.latest)) {
      oldN++;
      return `<span class="dep-chip dep-old" title="installed ${esc(h.current)} · latest ${esc(h.latest)}">${esc(dep.name)} <span class="mono" style="opacity:.7">${esc(h.current)}</span> <span class="dep-arrow">→</span> <b>${esc(h.latest)}</b>
        <button class="mini-btn" data-upd-dep="${esc(dep.name)}" title="update ${esc(dep.name)} to ${esc(h.latest)} in this project">⬆</button></span>`;
    }
    if (h && h.current) { outN++; }
    if (dep.kind === "dev") return `<span class="dep-chip dep-dev" title="${esc(dep.from)}">${esc(dep.name)}${dep.version ? " " + esc(dep.version) : ""}</span>`;
    if (h && h.current) return `<span class="dep-chip dep-ok" title="up to date">${esc(dep.name)} <span class="mono" style="opacity:.7">${esc(h.current)}</span> ✓</span>`;
    return `<span class="chip" title="${esc(dep.from)}">${esc(dep.name)}${dep.version ? "@" + esc(dep.version) : ""}</span>`;
  }).join("");
  if (health && (outN || oldN)) health.stale = outN + " up to date · " + oldN + " outdated (of the " + deps.length + " declared)";

  const llmHtml = (p.llm || []).map(l => `
    <div class="panel" style="margin:8px 0;background:rgba(245,179,66,.05);border-color:rgba(245,179,66,.3)">
      <div class="kv">
        <div class="k">Tool</div><div>${esc(l.tool)} ${l.model ? "· <b>" + esc(l.model) + "</b>" : ""}</div>
        <div class="k">Sessions</div><div>${l.sessions || 0} · ${l.msgs || 0} messages · last ${fmtAgo(l.last)}</div>
        <div class="k">Tokens in / out</div><div>
          <div class="token-bar">
            <div style="width:${100 * (l.tokens_in || 0) / Math.max(1, (l.tokens_in || 0) + (l.tokens_out || 0))}%;background:var(--blue)"></div>
            <div style="width:${100 * (l.tokens_out || 0) / Math.max(1, (l.tokens_in || 0) + (l.tokens_out || 0))}%;background:var(--purple)"></div>
          </div>
          <span class="mono small" style="color:var(--blue)">${(l.tokens_in || 0).toLocaleString()} in</span>
          <span class="mono small" style="color:var(--purple)">${(l.tokens_out || 0).toLocaleString()} out</span>
          ${l.cache_read ? `<span class="muted small">· ${(l.cache_read).toLocaleString()} cache reads</span>` : ""}
        </div>
      </div>
    </div>`).join("");

  const portRows = allPorts.map(x => {
    const status = x.status === "open"
      ? '<span class="dot open"></span> open ' + (x.meta ? '<span class="muted small">(' + esc(x.meta) + ')</span>' : '')
      : '<span class="dot exp"></span> expected, not open';
    return '<tr><td><b class="mono">' + x.port + '</b></td><td>' + status + '</td><td class="small muted">' + esc(x.src) + '</td></tr>';
  }).join("");
  const docChips = (p.documents || []).map(x => `<span class="chip" title="${esc(x[1])}">${esc(x[0])} × ${x[2]}</span>`).join("");

  const breakdown = (p.size_breakdown || []).slice(0, 8);
  const maxB = Math.max(1, ...breakdown.map(b => b.size));

  $("#drawerBody").innerHTML = `
  <div class="drawer-head">
    <div class="pill-row">
      ${srcInfo(p)}
      ${p.version ? badge("v" + p.version, "b-blue") : ""}
      ${langBadge(p.primary_language)}
      ${riskBadge(p.risk_level)}
      ${badge(STATUS_META[metaOf(p).status].label, STATUS_META[metaOf(p).status].cls)}
      ${p.key_count ? badge(p.key_count + " secrets", "b-red") : badge("no secrets", "b-green")}
      ${(p.running || []).length ? badge("running now", "b-green") : badge("stopped", "b-gray")}
      ${aiBadge(p) || ""}
    </div>
    <h2>${esc(p.name)}</h2>
    <div class="path">${esc(p.path)}</div>
    <div class="small muted" style="margin-top:6px">${fmtBytes(p.size)} · ${p.files_scanned || 0} files scanned · doc language: ${esc(p.doc_language || "n/a")}</div>
  </div>
  <div class="drawer-body">

    <div class="panel" style="margin-top:14px"><h3>Purpose ${hint("purpose")}</h3>
      <div class="small">${esc(p.purpose || "unknown")}</div>
      ${p.pkg_name ? `<div class="small muted" style="margin-top:4px">package: <code>${esc(p.pkg_name)}</code>${p.pkg_version ? " v" + esc(p.pkg_version) : ""}</div>` : ""}
    </div>

    <div class="panel"><h3>Your tags ${hint("tags")} <span class="hint">color · rating · status · notes — saved on this machine</span></h3>
      <div class="swatches">
        <span class="swatch none ${metaOf(p).color ? "" : "sel"}" data-color="" title="auto (by language)"></span>
        ${SWATCH_COLORS.map(c => `<span class="swatch ${metaOf(p).color === c ? "sel" : ""}" data-color="${c}" style="background:${c}" title="${c}"></span>`).join("")}
      </div>
      <div class="kv">
        <div class="k">Rating</div><div>${starsHtml(p, true)}</div>
        <div class="k">Status</div><div>
          <select class="sel-inline" id="statusSel">
            <option value="active" ${metaOf(p).status === "active" ? "selected" : ""}>🟢 active</option>
            <option value="fix" ${metaOf(p).status === "fix" ? "selected" : ""}>🟠 needs fix</option>
            <option value="archived" ${metaOf(p).status === "archived" ? "selected" : ""}>⚪ archived</option>
          </select>
        </div>
      </div>
      <label class="small muted" style="display:block;margin-top:10px">Notes (autosave)</label>
      <textarea id="notesArea" class="notes-area" placeholder="e.g. uses the old DB password — rotate it. Talks to S3 via AWS key."> ${esc(metaOf(p).notes || "")}</textarea>
    </div>

    <div class="panel"><h3>How to run ${hint("run")} <span class="hint">${esc(run.why || "")}</span></h3>
      ${cmdBox(run.command)}
      ${(run.readme_cmds || []).length > 1 ? `<div class="small muted">other commands found in README:</div>${run.readme_cmds.slice(1, 5).map(c => cmdBox(c)).join("")}` : ""}
      ${run.pkg_manager ? `<div class="small muted" style="margin-top:6px">package manager: <b>${esc(run.pkg_manager)}</b></div>` : ""}
      ${(run.compose_images || []).length ? `<div class="small muted">container images: ${run.compose_images.map(i => `<code>${esc(i)}</code>`).join(" ")}</div>` : ""}
      <div class="run-bar" style="margin-top:10px">
        <button class="btn primary" id="actRun">▶ Run from StackRadar</button>
        <span class="small muted">port</span>
        <input type="text" class="port-input" id="runPort" value="${((p.expected_ports || [])[0] || {}).port || 8000}">
        <span class="run-note">port is applied on the fly — manage live runs in the <b>Runs</b> tab</span>
      </div>
    </div>

    <div class="panel"><h3>Ports ${hint("proj_ports")} <span class="count">open now vs what it should use</span></h3>
      ${allPorts.length ? '<table><tr><th>port</th><th>status</th><th>source</th></tr>' + portRows + '</table>' : '<div class="ok-box small">no ports detected — check the code if this is a server</div>'}
    </div>

    <div class="panel"><h3>API keys &amp; secrets ${hint("secrets")} <span class="count">values are masked on purpose</span></h3>
      ${p.keys && p.keys.length ? p.keys.map(k => `
        <div class="key-row">
          <span class="sev-tag sev-${k.severity}">${k.severity}</span>
          <span>${esc(k.type)}</span>
          <span class="masked">${esc(k.masked)}</span>
          <span class="muted small" style="margin-left:auto">${esc(k.file)}:${k.line}</span>
        </div>`).join("")
      : `<div class="ok-box">No secrets detected in config/env/code files.</div>`}
      ${(p.git || {}).vcs && p.key_count ? `<div class="warn-box">Tip: if this repo is pushed anywhere, treat these keys as compromised and rotate them.</div>` : ""}
    </div>

    <div class="panel"><h3>Risk &amp; vulnerability flags ${hint("risk")} <span class="count">heuristic, score ${p.risk_score ?? "?"} (${esc(p.risk_level || "low")})</span></h3>
      ${p.risk_flags && p.risk_flags.length ? p.risk_flags.map(f => `
        <div class="risk-row"><span class="sev-tag sev-${f.severity}">${f.severity}</span><span>${esc(f.label)}</span><span class="muted small" style="margin-left:auto">${esc(f.file)}</span></div>`).join("")
      : `<div class="ok-box small">No risky patterns detected.</div>`}
      ${p.todos ? `<div class="small muted" style="margin-top:6px">${p.todos} TODO/FIXME markers in code</div>` : ""}
    </div>

    <div class="panel"><h3>When was it last run ${hint("lastrun")}</h3>
      <div class="kv">
        <div class="k">Status</div><div>${(p.running || []).length ? badge("running now", "b-green") : esc(p.last_run_label || "no evidence of runs")}</div>
        <div class="k">Last activity</div><div>${fmtAgo(p.last_run_ts)} <span class="muted small">(file mtime / logs / history)</span></div>
      </div>
      ${(p.running || []).length ? `<div class="small" style="margin-top:8px"><b>live processes:</b></div>` + p.running.map(r => `<div class="cmd-box" style="margin:4px 0"><span class="mono">pid ${r.pid} · ${esc(r.cmd)}</span></div>`).join("") : ""}
      ${(p.history_hits || []).length ? `<div class="small muted" style="margin-top:8px">shell history mentions (${(p.history_hits[0] || {}).src || ""}):</div>` + p.history_hits.slice(-5).map(h => `<div class="small muted mono" style="padding:2px 0">${h.ts ? fmtAgo(h.ts) + " · " : ""}${esc(h.cmd)}</div>`).join("") : ""}
    </div>

    <div class="panel"><h3>Version control &amp; origin ${hint("vcs")}</h3>
      ${git.vcs ? `<div class="kv">
        <div class="k">VCS</div><div>${esc(git.vcs)} ${git.branch ? "· branch <b>" + esc(git.branch) + "</b>" : ""}</div>
        <div class="k">Remote</div><div>${git.remote ? `<code>${esc(git.remote)}</code>` : '<span class="muted">local repo, no remote</span>'}</div>
        ${git.remote_host ? `<div class="k">Downloaded from</div><div><a href="https://${esc(git.remote_host)}" target="_blank" rel="noopener">${esc(git.remote_host)}</a></div>` : ""}
        ${git.last_commit ? `<div class="k">Last commit</div><div>${esc(git.last_subject || "")} <span class="muted small">— ${esc(git.last_author || "")} · ${git.last_date ? fmtAgo(git.last_date) : ""}</span></div>` : ""}
        <div class="k">Commits</div><div>${git.commit_count != null ? git.commit_count.toLocaleString() : "?"} ${git.dirty_files ? `· <span class="sev-medium">${git.dirty_files} uncommitted changes</span>` : "· clean"}</div>
      </div>` : `<div class="warn-box">No version control. This folder is only on this machine — if it matters, <code>git init</code> or push it somewhere.</div>`}
    </div>

    <div class="panel"><h3>Dependencies &amp; versions ${hint("deps")} <span class="count">${p.dep_count || 0} declared</span></h3>
      <div class="run-bar" style="margin-top:0">
        <button class="btn" id="btnDepCheck">⟳ Check outdated versions</button>
        ${S.depHealth[p.path] ? `<span class="dep-summary">${esc(S.depHealth[p.path].method)} · checked ${fmtAgo(S.depHealth[p.path].checked_at)}${S.depHealth[p.path].stale ? " · " + esc(S.depHealth[p.path].stale) : ""}</span>` : `<span class="muted small">compares installed versions with the latest — needs node_modules or a venv + internet</span>`}
      </div>
      <div style="margin-top:6px">${depChips || `<span class="muted small">no dependency manifest found</span>`}</div>
      ${oldN ? `<div class="run-bar"><button class="btn ok" id="btnUpdAll">⬆ Update all ${oldN} outdated</button><span class="run-note">runs your package manager in this folder — output streams live</span></div>` : ""}
      <div class="small" style="margin-top:8px">
        ${p.dep_count > 40 ? `<span class="muted">…and ${p.dep_count - 40} more</span>` : ""}
        ${p.installed_node_modules != null ? ` · <b>node_modules:</b> ${p.installed_node_modules} packages installed` : ""}
        ${p.venv ? ` · <b>venv:</b> ${esc(p.venv)} — ${p.venv_packages} packages installed` : ""}
      </div>
    </div>

    <div class="panel"><h3>Created with / AI traces ${hint("ai")} <span class="count">IDE &amp; LLM markers</span></h3>
      ${(p.ai_tools || []).length ? `<div class="pill-row">${p.ai_tools.map(t => `<span class="badge b-purple" title="marker: ${esc(t.marker)}">${esc(t.tool)}</span>`).join("")}</div>` : '<div class="small muted">no IDE or AI tool markers in this folder</div>'}
      ${llmHtml || `<div class="small muted" style="margin-top:6px">No LLM usage logs found for this project${p.ai_tools && p.ai_tools.length ? " (tool markers present but no token logs)" : ""}.</div>`}
    </div>

    ${(p.schedules || []).length ? `<div class="panel"><h3>Schedules ${hint("proj_sched")} <span class="count">${p.schedules.length} found in code/config</span></h3>
      ${p.schedules.map(sc => `<div class="key-row"><span class="badge b-cyan" style="flex:0 0 auto">${esc(sc.kind)}</span><b>${esc(sc.human)}</b>
        <span class="mono small muted">${esc(sc.expr || "")}</span><span class="muted small" style="margin-left:auto">${esc(sc.file)}${sc.next ? " · next " + esc(fmtIn(sc.next)) : ""}</span></div>`).join("")}
    </div>` : ""}

    ${window.projectSkillsPanel ? projectSkillsPanel(p) : ""}

    <div class="panel"><h3>Documents ${hint("docs")}</h3>
      ${docChips || '<span class="muted small">no document files</span>'}
      <div class="small muted" style="margin-top:6px">doc natural language: <b>${esc(p.doc_language || "n/a")}</b></div>
    </div>

    <div class="panel"><h3>Size breakdown ${hint("sizeb")} <span class="count">${fmtBytes(p.size)} total</span></h3>
      ${breakdown.map(b => `
        <div class="hog-row" style="cursor:default">
          <div class="hog-label" style="flex:0 0 130px">${b.dir ? "📁" : "📄"} ${esc(b.name)}</div>
          <div class="hog-bar-wrap"><div class="hog-bar" style="width:${Math.max(1, 100 * b.size / maxB)}%;background:var(--blue)"></div></div>
          <div class="hog-size">${fmtBytes(b.size)}</div>
        </div>`).join("")}
    </div>

    <div class="panel"><h3>Danger zone ${hint("danger")}</h3>
      <div class="small muted" style="margin-bottom:4px">Delete, move or rename <code>${esc(p.name)}</code> (${fmtBytes(p.size)}):</div>
      <div class="action-row">
        <button class="btn danger" id="actDelete">🗑 Delete</button>
        <button class="btn" id="actMove">➜ Move…</button>
        <button class="btn" id="actRename">✎ Rename…</button>
        <button class="btn" id="actReveal">📂 Show in file manager</button>
        <button class="btn" id="actArchive">🗜 Compress &amp; archive…</button>
      </div>
    </div>
  </div>`;

  // ---- your tags wiring
  $$("#drawer .swatch").forEach(sw => sw.onclick = async () => {
    await saveMeta(p, { color: sw.dataset.color || null });
    openDrawer(p); if (S.tab === "projects") renderProjects();
  });
  $$("#drawer .stars .star").forEach(st => st.onclick = async () => {
    const rating = parseInt(st.dataset.star, 10);
    await saveMeta(p, { rating: metaOf(p).rating === rating ? 0 : rating });
    openDrawer(p); if (S.tab === "projects") renderProjects();
  });
  $("#statusSel").onchange = async e => {
    if (e.target.value === "archived" && metaOf(p).status !== "archived") { e.target.value = metaOf(p).status; return archiveModal(p); }
    await saveMeta(p, { status: e.target.value });
    openDrawer(p); if (S.tab === "projects") renderProjects();
  };
  let notesTimer = null;
  $("#notesArea").oninput = e => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => saveMeta(p, { notes: e.target.value }), 600);
  };
  // ---- run from drawer
  $("#actRun").onclick = async () => {
    const port = parseInt($("#runPort").value, 10) || 0;
    const btn = $("#actRun"); btn.disabled = true; btn.textContent = "starting…";
    const r = await fetch("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p.path, port }),
    });
    const j = await r.json();
    if (j.ok) {
      toast("started <b>" + esc(p.name) + "</b> · pid " + j.pid + " · port " + (port || "default") + " — live in Runs tab", "ok");
      S.visibleRun = j.id; S.tab = "runs"; render();
    } else {
      toast(esc(j.error || "run failed"), "err");
      btn.disabled = false; btn.textContent = "▶ Run from StackRadar";
    }
  };
  // ---- dependency check
  $("#btnDepCheck").onclick = async () => {
    const btn = $("#btnDepCheck"); btn.disabled = true; btn.textContent = "checking… (may take a minute)";
    const r = await fetch("/api/deps/check", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p.path, force: true }),
    });
    const j = await r.json();
    if (j.ok) { S.depHealth[p.path] = j; openDrawer(p); toast("version check done", "ok"); }
    else { toast(esc(j.error || "check failed"), "err"); btn.disabled = false; btn.textContent = "⟳ Check outdated versions"; }
  };

  $("#drawer").classList.add("open");
  $$("#drawer [data-copy]").forEach(b => b.onclick = e => { e.stopPropagation(); copyText(b.dataset.copy); });
  $("#actDelete").onclick = () => openDeleteModal(p);
  $("#actMove").onclick = () => openMoveModal(p);
  $("#actRename").onclick = () => openRenameModal(p);
  $("#actReveal").onclick = () => revealPath(p.path);
  $("#actArchive").onclick = () => archiveModal(p);
  $$("#drawer [data-upd-dep]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    updatePackages({ scope: "project", manager: depManager(p), path: p.path, packages: [b.dataset.updDep] }, p);
  });
  const ua = $("#btnUpdAll");
  if (ua) ua.onclick = () => {
    const h = S.depHealth[p.path] || {};
    const names = (h.items || []).filter(it => it.current && it.latest && String(it.current) !== String(it.latest)).map(it => it.name);
    updatePackages({ scope: "project", manager: depManager(p), path: p.path, packages: names }, p);
  };
}
function depManager(p) {
  return (p.dependencies || []).some(d => d.from === "package.json") ? "node" : "pip";
}
function fmtIn(ts) {
  if (!ts) return "—";
  const d = ts - Date.now() / 1000;
  if (d < 0) return "now";
  if (d < 3600) return "in " + Math.max(1, Math.round(d / 60)) + " min";
  if (d < 86400) return "in " + Math.floor(d / 3600) + " h " + Math.round((d % 3600) / 60) + " min";
  const days = Math.round(d / 86400);
  return "in " + days + (days === 1 ? " day" : " days");
}
async function revealPath(path) {
  const j = await api("/api/open", { path });
  if (!j.ok) toast(esc(j.error || "could not open"), "err");
}
function closeDrawer() { $("#drawer").classList.remove("open"); S.sel = null; }

/* ---------------- modals & actions ---------------- */

function modal(html) {
  $("#modalBox").innerHTML = html;
  $("#modalBack").hidden = false;
}
function closeModal() { $("#modalBack").hidden = true; $("#modalBox").innerHTML = ""; }

function openDeleteModal(p) {
  const warnings = [];
  if (p.key_count) warnings.push(`contains <b>${p.key_count}</b> detected secret(s) — rotate any keys you may have exposed`);
  if ((p.running || []).length) warnings.push(`processes are running from this folder right now (pid ${(p.running[0] || {}).pid})`);
  if ((p.git || {}).remote) warnings.push(`repo remote: ${esc(p.git.remote)} — this only deletes your local copy`);
  if (!(p.git || {}).vcs) warnings.push(`no version control — deletion is <b>final for this copy</b>`);
  modal(`
    <h3>Delete <code>${esc(p.name)}</code>?</h3>
    <div class="path">${esc(p.path)}</div>
    <div class="small" style="margin:8px 0">Size: <b>${fmtBytes(p.size)}</b> — reclaiming that space.</div>
    ${warnings.map(w => `<div class="warn-box" style="margin:6px 0">⚠ ${w}</div>`).join("")}
    <label class="small muted">Type the exact folder name to confirm: <b>${esc(p.name)}</b></label>
    <input type="text" id="delConfirm" autocomplete="off" spellcheck="false">
    <div class="m-actions">
      <button class="btn" id="mCancel">Cancel</button>
      <button class="btn" id="mTrash">Move to Trash</button>
      <button class="btn danger" id="mForce">Delete permanently</button>
    </div>`);
  $("#mCancel").onclick = closeModal;
  const name = p.name;
  const go = async force => {
    const ok = $("#delConfirm").value === name;
    if (!ok) { toast("type the exact name to confirm", "err"); return; }
    const r = await fetch("/api/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", path: p.path, confirm: name, force }),
    });
    const j = await r.json();
    if (j.ok) {
      closeModal(); closeDrawer();
      toast(`✅ ${esc(j.method)} — freed <b>${fmtBytes(j.freed)}</b>`, "ok");
      loadState();
    } else toast(esc(j.error || "delete failed"), "err");
  };
  $("#mTrash").onclick = () => go(false);
  $("#mForce").onclick = () => go(true);
  $("#delConfirm").onkeydown = e => { if (e.key === "Enter") go(false); };
}

async function openMoveModal(p) {
  let dirs = [];
  try {
    const r = await fetch("/api/presets");
    dirs = (await r.json()).dirs || [];
  } catch (_) {}
  modal(`
    <h3>Move <code>${esc(p.name)}</code> to…</h3>
    <label class="small muted">Destination folder</label>
    <input type="text" id="mvTarget" list="dirList" value="${esc(dirs[0] || "")}">
    <datalist id="dirList">${dirs.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
    <label class="small muted">New name (optional)</label>
    <input type="text" id="mvName" value="${esc(p.name)}">
    <div class="m-actions">
      <button class="btn" id="mCancel">Cancel</button>
      <button class="btn primary" id="mGo">Move</button>
    </div>`);
  $("#mCancel").onclick = closeModal;
  $("#mGo").onclick = async () => {
    const r = await fetch("/api/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", path: p.path, target_dir: $("#mvTarget").value, new_name: $("#mvName").value }),
    });
    const j = await r.json();
    if (j.ok) { closeModal(); closeDrawer(); toast("moved to " + esc(j.moved_to), "ok"); loadState(); }
    else toast(esc(j.error || "move failed"), "err");
  };
}

function openRenameModal(p) {
  modal(`
    <h3>Rename <code>${esc(p.name)}</code></h3>
    <div class="path">${esc(p.path)}</div>
    <input type="text" id="rnName" value="${esc(p.name)}">
    <div class="small muted">Allowed: letters, digits, dot, dash, underscore, space.</div>
    <div class="m-actions">
      <button class="btn" id="mCancel">Cancel</button>
      <button class="btn primary" id="mGo">Rename</button>
    </div>`);
  $("#mCancel").onclick = closeModal;
  $("#mGo").onclick = async () => {
    const r = await fetch("/api/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", path: p.path, new_name: $("#rnName").value }),
    });
    const j = await r.json();
    if (j.ok) { closeModal(); closeDrawer(); toast("renamed to " + esc(j.new_path), "ok"); loadState(); }
    else toast(esc(j.error || "rename failed"), "err");
  };
  $("#rnName").onkeydown = e => { if (e.key === "Enter") $("#mGo").click(); };
}

/* ---------------- environment tab ---------------- */

function renderEnv() {
  const e = (S.data || {}).env || {};
  const tools = e.tools || {};
  const gl = e.globals || {};
  const shell = e.shell || {};
  const rc = shell.rc || [];

  const toolCards = Object.entries(tools).map(([name, t]) =>
    `<div class="tool"><span><span class="dot open" style="margin-right:6px"></span><b>${esc(name)}</b></span><span class="ver" title="${esc(t.version)}">${esc((t.version || "").slice(0, 34))}</span></div>`).join("");
  const missing = ["node", "python3", "npm", "git", "pip3", "brew", "docker", "cargo", "go", "ruby", "pnpm", "yarn", "bun", "uv", "make"]
    .filter(t => !tools[t]).map(t => `<div class="tool missing"><span>${esc(t)}</span><span class="ver">not installed</span></div>`).join("");

  const rcHtml = rc.length ? rc.map(f => `
    <div class="rc-file">
      <span class="fname">~/${esc(f.file.replace("~/", ""))}</span>
      ${f.notes.length ? `<div class="small" style="color:var(--purple)">${f.notes.map(esc).join(" · ")}</div>` : ""}
      ${f.exports.length ? `<div class="small">exports: <span class="mono muted">${esc(f.exports.slice(0, 18).join(" ") || "")}${f.exports.length > 18 ? "…" : ""}</span></div>` : ""}
      ${f.aliases.length ? `<div class="small">aliases: <span class="mono muted">${esc(f.aliases.slice(0, 15).join(" ") || "")}${f.aliases.length > 15 ? "…" : ""}</span></div>` : ""}
      ${f.path_adds.length ? `<div class="small">PATH adds: <span class="mono muted">${esc(f.path_adds.join(" ") || "")}</span></div>` : ""}
      ${f.sources.length ? `<div class="small muted">sources: ${esc(f.sources.join(" ; "))}</div>` : ""}
    </div>`).join("") : '<div class="muted small">no shell rc files found</div>';

  const pyPkgs = gl.python_packages || [];
  const nodePkgs = gl.node_globals || [];
  const brewPkgs = gl.brew || [];
  const curEnv = shell.current_env || {};

  const dockerHtml = !e.docker ? `<div class="muted small">docker is not installed (or not in PATH)</div>` :
    (e.docker.ok ? `
      <div class="small" style="margin-bottom:8px">server <b>${esc(e.docker.server_version || "?")}</b></div>
      <h4 class="small muted" style="margin:8px 0 4px">containers (${(e.docker.containers || []).length})</h4>
      ${(e.docker.containers || []).length ? `<table><tr><th>name</th><th>image</th><th>status</th><th>ports</th></tr>
        ${e.docker.containers.map(c => `<tr><td class="mono small">${esc(c[1] || "?")}</td><td class="small">${esc(c[2] || "?")}</td><td class="small muted">${esc(c[3] || "")}</td><td class="small mono muted">${esc(c[4] || "")}</td></tr>`).join("")}</table>` : '<div class="muted small">none</div>'}
      <h4 class="small muted" style="margin:10px 0 4px">images (${(e.docker.images || []).length})</h4>
      <div class="small mono muted">${(e.docker.images || []).map(i => esc(i.join(" "))).join("<br>") || "none"}</div>
      ${e.docker.system_df ? `<pre class="small muted" style="background:var(--bg2);padding:8px;border-radius:8px;overflow-x:auto">${esc(e.docker.system_df)}</pre>` : ""}
    ` : `<div class="warn-box small">docker installed but daemon not reachable</div>`);

  $("#tab-env").innerHTML = `
  <h2 class="tab-title">Environment &amp; global packages ${hint("env")}</h2>
  ${tabHint("env")}
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="panel"><h3>System ${hint("env_system")}</h3>
      <div class="kv">
        <div class="k">OS</div><div>${esc(e.os || "?")}</div>
        <div class="k">Host</div><div>${esc(e.hostname || "?")} · ${esc(e.arch || "")}</div>
        <div class="k">Python (running this app)</div><div class="mono">${esc(e.python || "")}</div>
        <div class="k">IDEs / editors found</div><div>${(e.ide_installed || []).map(i => `<span class="badge b-purple">${esc(i)}</span>`).join(" ") || '<span class="muted">none detected</span>'}</div>
      </div>
    </div>
    <div class="panel"><h3>Terminal environment ${hint("shell")} <span class="hint">what your shell sets up</span></h3>
      <div class="kv" style="margin-bottom:6px">
        <div class="k">Default shell</div><div><b>${esc(shell.shell_name || "?")}</b> <span class="muted mono small">${esc(shell.shell || "")}</span></div>
        ${Object.entries(curEnv).map(([k, v]) => `<div class="k">${esc(k)}</div><div class="mono small">${esc(v)}</div>`).join("")}
        <div class="k">PATH entries</div><div class="small muted">${(shell.path_entries || []).length} entries, first: <span class="mono">${esc((shell.path_entries || []).slice(0, 3).join(" : "))}</span></div>
      </div>
      ${rcHtml}
    </div>
  </div>
  <div class="panel"><h3>Installed tools ${hint("tools")} <span class="count">version-checked</span></h3>
    <div class="tool-grid">${toolCards}${missing}</div>
  </div>
  <div class="grid" style="grid-template-columns: 1fr 1fr 1fr">
    <div class="panel"><h3>Node global (npm -g) ${hint("globals")} <span class="count">${nodePkgs.length}</span></h3>
      <div class="small">${nodePkgs.length ? nodePkgs.map(n => `<span class="chip">${esc(n.name)}@${esc(n.version || "?")}</span>`).join("") : '<span class="muted">none</span>'}</div>
    </div>
    <div class="panel"><h3>Python packages (pip) ${hint("globals")} <span class="count">${pyPkgs.length}</span></h3>
      <input class="search-in" id="pySearch" placeholder="filter…">
      <div class="pkg-list small" id="pyList" style="margin-top:8px">${pyPkgs.slice(0, 200).map(p => `<div class="chip-row" data-name="${esc(p.name)}">${esc(p.name)} <span class="muted">@${esc(p.version || "?")}</span></div>`).join("") || '<span class="muted">none found</span>'}</div>
    </div>
    <div class="panel"><h3>Homebrew ${hint("globals")} <span class="count">${brewPkgs.length}</span></h3>
      <div class="small">${brewPkgs.length ? brewPkgs.map(b => `<span class="chip">${esc(b.name)}@${esc(b.version || "?")}</span>`).join("") : '<span class="muted">brew not installed or empty</span>'}</div>
    </div>
  </div>
  <div class="grid" style="grid-template-columns: 1.4fr 1fr">
    <div class="panel"><h3>Docker ${hint("docker")} <span class="hint">containers · images · disk</span></h3>${dockerHtml}</div>
    <div class="panel"><h3>Global caches (reclaimable) ${hint("gcache")}</h3>
      ${(e.global_caches || []).length ? (e.global_caches).map(c => `<div class="key-row"><span class="mono small" style="flex:1">${esc(c.path)}</span><b class="mono small">${fmtBytes(c.size)}</b></div>`).join("") : '<div class="muted small">none above 1 MB</div>'}
    </div>
  </div>`;

  const pySearch = $("#pySearch");
  if (pySearch) pySearch.oninput = () => {
    const q = pySearch.value.toLowerCase();
    $$("#pyList .chip-row").forEach(r => { r.style.display = r.dataset.name.toLowerCase().includes(q) ? "" : "none"; });
  };
}

/* ---------------- reclaim tab ---------------- */

async function renderReclaim() {
  const el = $("#tab-reclaim");
  el.innerHTML = `<div class="empty small">computing reclaimable space…</div>`;
  let items = [], gcache = [];
  try {
    const r = await fetch("/api/reclaim");
    const j = await r.json();
    items = j.items || []; gcache = j.global_caches || [];
  } catch (_) {}
  const P = S.data.projects || [];
  const sel = S.reclaimSel;
  items.forEach(i => { if (i.safe && !sel.has(i.path)) sel.add(i.path); });
  const totalSel = items.filter(i => sel.has(i.path)).reduce((a, i) => a + i.size, 0);
  const totalAll = items.reduce((a, i) => a + i.size, 0);

  el.innerHTML = `
  <h2 class="tab-title">Reclaim space ${hint("reclaim")}</h2>
  ${tabHint("reclaim")}
  <div class="reclaim-total">
    <div>selected: <span class="big">${fmtBytes(totalSel)}</span> <span class="muted small">of ${fmtBytes(totalAll)} reclaimable caches</span></div>
    <button class="btn" id="selAll">select all</button>
    <button class="btn" id="selNone">select none</button>
    <span class="spacer"></span>
    <button class="btn danger" id="delSel">🗑 Delete selected</button>
  </div>
  <div class="panel"><h3>Project caches &amp; build artifacts ${hint("caches")} <span class="hint">safe items pre-selected — caches rebuild themselves</span></h3>
    <table><tr><th></th><th>project</th><th>folder</th><th>safety</th><th style="text-align:right">size</th></tr>
    ${items.slice(0, 80).map(i => `<tr>
      <td><input type="checkbox" data-path="${esc(i.path)}" ${sel.has(i.path) ? "checked" : ""}></td>
      <td>${esc(i.project)}</td><td class="mono small">${esc(i.name)}</td>
      <td>${i.safe ? badge("safe to delete", "b-green") : badge("virtualenv — check first", "b-amber")}</td>
      <td class="mono" style="text-align:right">${fmtBytes(i.size)}</td></tr>`).join("")}
    </table>
    ${!items.length ? '<div class="ok-box small">no sizable caches found in scanned projects</div>' : ""}
  </div>
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="panel"><h3>Global caches ${hint("gcache")}</h3>
      ${gcache.map(c => `<div class="key-row" style="align-items:center">
        <span class="mono small" style="flex:1">${esc(c.path)}</span><b class="mono small">${fmtBytes(c.size)}</b>
        <button class="btn danger small" data-gc="${esc(c.path)}">delete</button></div>`).join("") || '<div class="muted small">none</div>'}
      <div class="small muted" style="margin-top:6px">These are package-manager caches (npm/pip/cargo). Deleting is safe — packages re-download when needed.</div>
    </div>
    <div class="panel"><h3>Whole projects ${hint("wholeproj")} <span class="hint">use the Projects tab for details first</span></h3>
      <table><tr><th>project</th><th style="text-align:right">size</th><th></th></tr>
      ${P.slice().sort((a, b) => b.size - a.size).slice(0, 12).map(p => `<tr>
        <td><b>${esc(p.name)}</b><div class="sub path">${esc(p.path)}</div></td>
        <td class="mono" style="text-align:right">${fmtBytes(p.size)}</td>
        <td style="text-align:right"><button class="btn danger small" data-delproj="${esc(p.path)}">delete</button></td></tr>`).join("")}
      </table>
    </div>
  </div>`;

  $$("#tab-reclaim input[type=checkbox]").forEach(cb => cb.onchange = () => {
    cb.checked ? sel.add(cb.dataset.path) : sel.delete(cb.dataset.path);
    renderReclaimTotals();
  });
  $("#selAll").onclick = () => { items.forEach(i => sel.add(i.path)); renderReclaim(); };
  $("#selNone").onclick = () => { sel.clear(); renderReclaim(); };
  $("#delSel").onclick = async () => {
    const chosen = items.filter(i => sel.has(i.path));
    if (!chosen.length) return toast("nothing selected", "err");
    const total = chosen.reduce((a, i) => a + i.size, 0);
    modal(`
      <h3>Delete ${chosen.length} cache folder(s)?</h3>
      <div class="small">Reclaims <b>${fmtBytes(total)}</b>. These are regenerable caches (node_modules, build outputs, etc.).</div>
      <div class="small mono muted" style="max-height:140px;overflow:auto;margin-top:8px">${chosen.map(i => esc(i.project + "/" + i.name)).join("<br>")}</div>
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Delete</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      closeModal();
      let freed = 0, n = 0;
      for (const i of chosen) {
        const r = await fetch("/api/delete/cache", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: i.path, confirm: "yes" }),
        });
        const j = await r.json();
        if (j.ok) { freed += j.freed || 0; n++; }
      }
      toast(`deleted ${n} folders — freed <b>${fmtBytes(freed)}</b>`, "ok");
      loadState(); renderReclaim();
    };
  };
  $$("[data-gc]").forEach(b => b.onclick = () => {
    const path = b.dataset.gc;
    modal(`
      <h3>Delete cache <code>${esc(path.split("/").slice(-2).join("/"))}</code>?</h3>
      <div class="small">Package-manager cache — packages re-download when needed. This is safe but will slow the next install.</div>
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Delete</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      closeModal();
      const r = await fetch("/api/delete/cache", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, confirm: "yes" }),
      });
      const j = await r.json();
      if (j.ok) { toast("freed " + fmtBytes(j.freed), "ok"); renderReclaim(); }
      else toast(esc(j.error || "failed"), "err");
    };
  });
  if (window.archivesPanelHtml) { el.insertAdjacentHTML("beforeend", await archivesPanelHtml()); wireArchives(el); }
  $$("[data-delproj]").forEach(b => b.onclick = () => {
    const p = P.find(x => x.path === b.dataset.delproj);
    if (p) openDeleteModal(p);
  });
}
function renderReclaimTotals() {
  // light update: re-render tab (cheap enough)
  if (S.tab === "reclaim") renderReclaim();
}

/* ---------------- runs tab ---------------- */

function runStatusInfo(r) {
  if (r.status === "running") return { dot: "open", label: "running", cls: "b-green" };
  if (r.status === "stopped") return { dot: "closed", label: "stopped", cls: "b-gray" };
  if (r.status === "exited") return { dot: "closed", label: "exited clean (0)", cls: "b-green" };
  return { dot: "closed", label: "died (exit " + r.exit_code + ")", cls: "b-red" };
}
function consoleHtml(logs) {
  const txt = logs || "";
  if (!txt) return '<span class="muted">⏳ waiting for first output…</span>';
  return esc(txt).split("\n").map(l =>
    /error|fail|exception|traceback|cannot|refused|panic|fatal/i.test(l) ? `<span class="err-line">${l}</span>` : l
  ).join("\n");
}
function renderRuns() {
  const el = $("#tab-runs");
  const P = S.data.projects || [];
  const runs = S.data.runs || [];
  const pp = S.data.port_panel || {};

  let body = "";
  if (!runs.length) {
    body = `<div class="panel"><div class="muted small">No runs yet. Start one above — it opens here as a tab with a live console (Colab-style). Stopped/crashed runs stay listed so you can read the log.</div></div>`;
  } else {
    const vis = S.visibleRun && runs.some(r => r.id === S.visibleRun) ? S.visibleRun : runs[0].id;
    S.visibleRun = vis;
    const cur = runs.find(r => r.id === vis);
    const si = runStatusInfo(cur);
    body = `
    <div class="run-tabs">
      ${runs.map(r => { const x = runStatusInfo(r);
        return `<div class="run-tab ${r.id === vis ? "active" : ""}" data-run="${r.id}">
          <span class="dot ${x.dot}"></span> ${r.guarded ? "🛡 " : ""}${esc(r.project)} <span class="tport">:${r.port || "?"}</span> ${badge(x.label, x.cls)}
        </div>`; }).join("")}
    </div>
    <div class="cell">
      <div class="cell-cmd"><span class="prompt">▶ $</span><span>${esc(cur.cmd)}</span>
        <span class="spacer"></span>
        <span class="muted small mono">pid ${cur.pid} · since ${fmtAgo(cur.started)}</span>
      </div>
      ${cur.note && cur.note !== "No port override." ? `<div class="run-note" style="padding:6px 14px;border-bottom:1px dashed rgba(34,48,73,.5)">${esc(cur.note)}</div>` : ""}
      <div class="console" id="runConsole"></div>
    </div>
    <div class="run-bar">
      ${cur.status === "running"
        ? `<button class="btn danger" id="btnStopRun" data-run="${cur.id}">■ Stop</button>`
        : `<span class="badge ${si.cls}">${si.label}</span>`}
      <button class="btn" id="btnRestartRun" data-run="${cur.id}">↻ Restart on port…</button>
      <span class="run-note">live · output refreshes automatically while this tab is open</span>
    </div>`;
  }

  el.innerHTML = `
  <h2 class="tab-title">Runs — start, watch &amp; stop apps from here ${hint("runs")}</h2>
  ${tabHint("runs")}
  <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin-bottom:14px">
    <div class="card"><div class="k">Apps running</div><div class="v" style="color:var(--green)">${pp.apps_running || 0}</div><div class="s">inside scanned projects</div></div>
    <div class="card"><div class="k">Managed by StackRadar</div><div class="v">${pp.managed_running || 0}</div><div class="s">started from this UI</div></div>
    <div class="card"><div class="k">Ports in use</div><div class="v" style="color:var(--cyan)">${pp.listening_count || 0}</div><div class="s">${(pp.killable || []).length} killable below</div></div>
    <div class="card"><div class="k">Runs finished</div><div class="v">${runs.filter(r => r.status !== "running").length}</div><div class="s">stopped or crashed — logs kept</div></div>
  </div>
  <div class="panel"><h3>Start a project ${hint("runstart")}</h3>
    <div class="run-bar" style="margin-top:0">
      <select id="runProjSel" class="sel-inline" style="max-width:420px">
        ${P.map(p => `<option value="${esc(p.path)}">${esc(p.name)} — ${esc((p.run || {}).why || "no run command")}</option>`).join("")}
      </select>
      <span class="small muted">port</span>
      <input type="text" class="port-input" id="runPortNew" value="8000">
      <button class="btn primary" id="btnStartRun">▶ Run</button>
    </div>
    <div class="small muted" style="margin-top:6px">Uses the project's detected run command; the port is injected framework-aware (Next -p, Vite --port, Flask --port, http.server …). Falls back to the PORT env var.</div>
  </div>
  ${body}
  <div class="grid" style="grid-template-columns: 1.2fr 1fr">
    <div class="panel"><h3>Processes you can kill <span class="hint">only processes linked to scanned projects — system daemons are never listed</span></h3>
      <div style="margin-bottom:8px"><button class="btn danger" id="killAllBtn">■ Kill all StackRadar-managed runs</button></div>
      ${(pp.killable || []).length ? `<table><tr><th>port</th><th>process</th><th>pid</th><th>project</th><th></th></tr>
        ${pp.killable.map(k => `<tr>
          <td class="mono">${k.port || "—"}</td>
          <td class="small mono" style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.proc)}">${esc(k.proc || "?")}</td>
          <td class="mono">${k.pid}</td>
          <td>${esc(k.project || "")}${k.managed ? " " + badge("managed", "b-purple") : ""}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn danger small" data-kill="${k.pid}">kill</button></td>
        </tr>`).join("")}
      </table>` : `<div class="ok-box small">nothing killable right now</div>`}
    </div>
    <div class="panel"><h3>All listening ports on this machine</h3>${portsTable(S.data.listeners || [], false)}</div>
  </div>`;

  // wiring
  const sel = $("#runProjSel");
  if (sel) sel.onchange = () => {
    const p = P.find(x => x.path === sel.value);
    if (p) $("#runPortNew").value = ((p.expected_ports || [])[0] || {}).port || 8000;
  };
  $("#btnStartRun").onclick = async () => {
    const path = sel.value;
    const port = parseInt($("#runPortNew").value, 10) || 0;
    const btn = $("#btnStartRun"); btn.disabled = true;
    const r = await fetch("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, port }),
    });
    const j = await r.json();
    btn.disabled = false;
    if (j.ok) {
      S.visibleRun = j.id;
      toast("started (pid " + j.pid + ") — " + esc(j.note), "ok");
      renderRuns();
    } else toast(esc(j.error || "start failed"), "err");
  };
  $$("#tab-runs .run-tab").forEach(t => t.onclick = () => { S.visibleRun = t.dataset.run; renderRuns(); });
  const sb = $("#btnStopRun");
  if (sb) sb.onclick = async () => {
    const r = await fetch("/api/runs/stop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sb.dataset.run }),
    });
    const j = await r.json();
    toast(j.ok ? "stopping run " + esc(j.id) : esc(j.error || "stop failed"), j.ok ? "ok" : "err");
    renderRuns();
  };
  const rb = $("#btnRestartRun");
  if (rb) rb.onclick = async () => {
    const run = runs.find(x => x.id === rb.dataset.run);
    if (!run) return;
    modal(`
      <h3>Restart <code>${esc(run.project)}</code> on a new port</h3>
      <div class="small muted" style="margin-bottom:4px">Current port: <b class="mono">${run.port || "?"}</b> — the old process is stopped first.</div>
      <input type="text" id="rpPort" value="${run.port || 8000}">
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="mGo">↻ Restart</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      if (run.status === "running") {
        await fetch("/api/runs/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: run.id }) });
        await new Promise(r2 => setTimeout(r2, 1200));
      }
      const port = parseInt($("#rpPort").value, 10) || 0;
      const r = await fetch("/api/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: run.path, port }),
      });
      const j = await r.json();
      if (j.ok) { closeModal(); S.visibleRun = j.id; toast("restarted on port " + port, "ok"); renderRuns(); }
      else toast(esc(j.error || "restart failed"), "err");
    };
  };
  $$("#tab-runs [data-kill]").forEach(b => b.onclick = () => {
    const pid = b.dataset.kill;
    modal(`
      <h3>Kill process ${pid}?</h3>
      <div class="warn-box">This sends SIGTERM to the process (group). Unsaved work in that app is lost.</div>
      <label class="small muted">Type <b>kill</b> to confirm:</label>
      <input type="text" id="killConfirm" autocomplete="off">
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Kill</button></div>`);
    $("#mCancel").onclick = closeModal;
    const go = async () => {
      if ($("#killConfirm").value !== "kill") { toast('type "kill" to confirm', "err"); return; }
      const r = await fetch("/api/kill", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: parseInt(pid, 10), confirm: true }),
      });
      const j = await r.json();
      if (j.ok) { closeModal(); toast("sent SIGTERM to pid " + pid, "ok"); }
      else toast(esc(j.error || "kill failed"), "err");
    };
    $("#mGo").onclick = go;
    $("#killConfirm").onkeydown = e => { if (e.key === "Enter") go(); };
  });
  const ka = $("#killAllBtn");
  if (ka) ka.onclick = () => {
    modal(`
      <h3>Stop all StackRadar-managed runs?</h3>
      <div class="small">Only runs started from this UI are affected (not your other terminals).</div>
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Stop all</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      const r = await fetch("/api/runs/stop_all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      closeModal();
      toast(j.ok ? "stopped " + j.stopped + " managed run(s)" : esc(j.error || "failed"), j.ok ? "ok" : "err");
      renderRuns();
    };
  };
}

async function pollRunLogs() {
  if (!S.visibleRun) return;
  try {
    const r = await fetch("/api/runs?id=" + S.visibleRun);
    const run = await r.json();
    if (run.logs === undefined) return;
    const con = $("#runConsole");
    if (con) {
      const atBottom = con.scrollHeight - con.scrollTop - con.clientHeight < 50;
      con.innerHTML = consoleHtml(run.logs);
      if (atBottom) con.scrollTop = con.scrollHeight;
    }
  } catch (e) { /* ignore */ }
}
function startRunPolling() {
  if (S.runPoll) return;
  S.runPoll = setInterval(async () => {
    if (S.tab !== "runs" || !S.data) return stopRunPolling();
    try {
      const r = await fetch("/api/runs");
      const j = await r.json();
      if (S.data) {
        S.data.runs = j.runs;
        S.data.port_panel = j.port_panel;
        renderRuns();
      }
      await pollRunLogs();
    } catch (e) { /* ignore */ }
  }, 1500);
}
function stopRunPolling() {
  if (S.runPoll) { clearInterval(S.runPoll); S.runPoll = null; }
}

/* ---------------- wiring ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  $$("#nav button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); });
  $("#scanBtn").onclick = doScan;
  $("#exportBtn").onclick = exportJSON;
  $("#drawerClose").onclick = closeDrawer;
  $("#modalBack").addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });
  document.addEventListener("click", e => {
    const c = e.target.closest("[data-copy]");
    if (c && c.dataset.copy) copyText(c.dataset.copy);
  });
  if ($("#rootInput").value === "") $("#rootInput").value = "~";
  try { const t = localStorage.getItem("stackradar.tab"); if (t && RENDERERS[t]) S.tab = t; } catch (_) {}
  graphInit();
  if (window.featuresInit) featuresInit();
  loadState();
});
