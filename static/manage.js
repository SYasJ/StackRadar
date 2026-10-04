// StackRadar 2.2: Ports, Tools & packages, Caches, Disk space, sortable tables, themes.
// Loaded after app.js / features.js; registers renderers and hints.

Object.assign(HINTS, {
  ports: "Every port something is listening on right now, refreshed every few seconds. Stop asks the program to quit (like closing it); Force kill ends it immediately. Only your own programs can be stopped from here.",
  ports_expose: "\"Your network\" means other devices on your Wi-Fi can connect to it. \"This computer only\" means it listens on 127.0.0.1.",
});

/* ---------------- Ports ---------------- */

const PORTS = { data: null, timer: null, q: "", mineOnly: false };
async function loadPorts() {
  PORTS.data = await api("/api/ports");
  if (S.tab === "ports") paintPorts();
  const n = (PORTS.data.ports || []).length;
  const b = $("#nbPorts"); if (b) { b.textContent = n || ""; }
}
function renderPorts() {
  if (!PORTS.data) { $("#tab-ports").innerHTML = `<div class="empty small">reading open ports…</div>`; }
  loadPorts();
  clearInterval(PORTS.timer);
  PORTS.timer = setInterval(() => { if (S.tab === "ports" && !document.hidden) loadPorts(); else clearInterval(PORTS.timer); }, 4000);
}
function paintPorts() {
  const d = PORTS.data || {}, all = d.ports || [];
  const q = PORTS.q.toLowerCase();
  const rows = all.filter(r => (!PORTS.mineOnly || r.mine) && (!q || [r.port, r.proc, r.cmd, r.project, r.service, r.user].join(" ").toLowerCase().includes(q)));
  const exposed = all.filter(r => r.exposure.startsWith("your network")).length;
  const table = rows.map(r => `<tr class="${r.can_stop ? "" : "muted-row"}">
    <td data-v="${r.port}"><b class="mono" style="font-size:15px">${r.port}</b>${r.service ? `<div class="sub">${esc(r.service)}</div>` : ""}</td>
    <td class="prog"><b>${esc(r.proc || "unknown")}</b> <span class="muted mono small">pid ${r.pid || "?"}</span>
      ${r.system ? `<div class="sub">⚙ ${esc(r.system)}</div>` : ""}
      <div class="sub mono ellipsis" title="${esc(r.cmd || "")}">${esc((r.cmd || "").slice(0, 110))}</div></td>
    <td>${r.project ? `<a href="#" data-openproj="${esc(r.project)}">📦 ${esc(r.project)}</a>${r.managed ? " " + badge("Runs", "b-blue") : ""}` : `<span class="muted small">${r.cwd ? esc(r.cwd) : "—"}</span>`}</td>
    <td class="small">${r.exposure.startsWith("your") ? `<span class="badge b-amber" title="bound to ${esc(r.addr)}">🌐 network</span>` : `<span class="badge b-green" title="bound to ${esc(r.addr)}">🔒 local</span>`}</td>
    <td class="small">${esc(r.user || "?")}${r.mine ? "" : ' <span class="badge b-gray">other user</span>'}</td>
    <td class="small" data-v="${r.started || 0}">${r.started ? fmtAgo(r.started) : "—"}</td>
    <td style="white-space:nowrap;text-align:right">
      ${r.port < 65536 ? `<button class="mini-btn" data-openurl="http://localhost:${r.port}" title="open http://localhost:${r.port}">↗</button>` : ""}
      ${r.can_stop ? `<button class="btn small" data-pstop="${r.pid}" data-port="${r.port}">■ Stop</button>
        <button class="btn danger small" data-pkill="${r.pid}" data-port="${r.port}" title="end immediately (unsaved work in that program is lost)">✕ Force</button>`
        : `<span class="small muted" title="${esc(r.why_not || "")}">🔒 ${esc((r.why_not || "").split(".")[0])}</span>${r.admin_cmd ? `<div><code class="small" title="run this in a terminal">${esc(r.admin_cmd)}</code> <button class="mini-btn" data-copy="${esc(r.admin_cmd)}" title="copy">⧉</button></div>` : ""}`}</td></tr>`).join("");
  $("#tab-ports").innerHTML = `
  <h2 class="tab-title">Ports in use right now ${hint("ports")}</h2>
  ${tabHint("ports")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Listening</div><div class="v" style="color:var(--cyan)">${all.length}</div><div class="s">ports open on this computer</div></div>
    <div class="card"><div class="k">Yours</div><div class="v">${all.filter(r => r.mine).length}</div><div class="s">can be stopped from here</div></div>
    <div class="card"><div class="k">Open to your network ${hint("ports_expose")}</div><div class="v" style="color:${exposed ? "var(--amber)" : "var(--green)"}">${exposed}</div><div class="s">reachable from other devices</div></div>
    <div class="card"><div class="k">From your projects</div><div class="v" style="color:var(--blue)">${all.filter(r => r.project).length}</div><div class="s">linked to a scanned project</div></div>
  </div>
  <div class="filterbar">
    <input id="portQ" placeholder="filter by port, program, project…" value="${esc(PORTS.q)}">
    <label class="small"><input type="checkbox" id="portMine" ${PORTS.mineOnly ? "checked" : ""}> only mine</label>
    <span class="spacer"></span><span class="small muted">refreshes every 4 s · ${d.checked_at ? "checked " + new Date(d.checked_at * 1000).toLocaleTimeString() : ""}</span>
    <button class="btn small" id="portRefresh">⟳ Refresh</button>
  </div>
  <div class="panel scroll-x" style="padding:6px 8px"><table class="sortable ports-table">
    <tr><th>port</th><th>program</th><th>project / folder</th><th>reachable from</th><th>user</th><th>started</th><th></th></tr>
    ${table || `<tr><td colspan="7" class="muted">Nothing is listening${PORTS.q || PORTS.mineOnly ? " that matches the filter" : ""}.</td></tr>`}</table></div>`;
  const tab = $("#tab-ports");
  $("#portQ").oninput = e => { PORTS.q = e.target.value; paintPorts(); const i = $("#portQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $("#portMine").onchange = e => { PORTS.mineOnly = e.target.checked; paintPorts(); };
  $("#portRefresh").onclick = loadPorts;
  $$("[data-openproj]", tab).forEach(a => a.onclick = e => { e.preventDefault(); const p = (S.data.projects || []).find(x => x.name === a.dataset.openproj); if (p) openDrawer(p); });
  $$("[data-openurl]", tab).forEach(b => b.onclick = () => window.open(b.dataset.openurl, "_blank"));
  $$("[data-copy]", tab).forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast("copied", "ok"); });
  const stop = async (b, force) => {
    const pid = +(b.dataset.pstop || b.dataset.pkill), port = +b.dataset.port;
    const r = (PORTS.data.ports || []).find(x => x.pid === pid && x.port === port) || {};
    if (force && !confirm(`Force kill ${r.proc || "pid " + pid} on port ${port}?\n\nIt ends immediately; anything unsaved in that program is lost.`)) return;
    if (!force && !r.project && !confirm(`Stop ${r.proc || "pid " + pid} listening on port ${port}?\n\n${r.cmd || ""}`)) return;
    b.disabled = true;
    const j = await api("/api/ports/stop", { pid, port, force });
    if (!j.ok) toast(esc(j.error || "could not stop it") + (j.admin_cmd ? "<br><code>" + esc(j.admin_cmd) + "</code>" : ""), "err");
    else if (j.still_listening) toast(`asked pid ${pid} to quit, but port ${port} is still open. Try ✕ Force.`, "err");
    else toast(`port ${port} is free (${esc(j.method)})`, "ok");
    loadPorts();
  };
  $$("[data-pstop]", tab).forEach(b => b.onclick = () => stop(b, false));
  $$("[data-pkill]", tab).forEach(b => b.onclick = () => stop(b, true));
}


/* ---------------- sortable tables (every table, click a column header) ---------------- */

const SORTS = {};
function _tableKey(t) {
  const sec = t.closest("section, .modal, #drawer");
  const head = Array.from(t.querySelector("tr").children).map(c => c.textContent.trim()).join("|");
  return (sec ? sec.id || sec.className : "") + ":" + head;
}
const _UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
function _cellValue(td) {
  if (!td) return "";
  if (td.dataset.v !== undefined) { const n = parseFloat(td.dataset.v); return isNaN(n) ? td.dataset.v.toLowerCase() : n; }
  const t = td.textContent.trim();
  let m = t.match(/^(-?[\d.]+)\s*(B|KB|MB|GB|TB)\b/);
  if (m) return parseFloat(m[1]) * _UNITS[m[2]];
  if (/^just now/.test(t)) return Date.now() / 1000;
  m = t.match(/^(\d+)\s*(min|h|days?)\s+ago/);
  if (m) return Date.now() / 1000 - parseInt(m[1], 10) * ({ min: 60, h: 3600, day: 86400, days: 86400 }[m[2]]);
  m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return Date.parse(m[1]) / 1000;
  m = t.match(/^in\s+(\d+)\s*(s|m|min|h|d)/);
  if (m) return Date.now() / 1000 + parseInt(m[1], 10) * ({ s: 1, m: 60, min: 60, h: 3600, d: 86400 }[m[2]]);
  m = t.match(/^-?[\d,]+(\.\d+)?\s*(%|×|x|k|M|B)?(\s|$)/);
  if (m) { let n = parseFloat(t.replace(/,/g, "")); if (m[2] === "k") n *= 1e3; if (m[2] === "M") n *= 1e6; if (m[2] === "B") n *= 1e9; return n; }
  if (/^(never|—|-|unknown|not checked)$/i.test(t)) return -Infinity;
  return t.toLowerCase();
}
function _sortTable(t, col, dir) {
  const header = t.querySelector("tr");
  const body = header.parentNode;
  const rows = Array.from(body.children).filter(r => r !== header && r.tagName === "TR");
  const fixed = rows.filter(r => r.children.length === 1 && r.children[0].colSpan > 1);
  const data = rows.filter(r => !fixed.includes(r)).map((r, i) => ({ r, v: _cellValue(r.children[col]), i }));
  data.sort((a, b) => {
    const x = a.v, y = b.v;
    if (x === y) return a.i - b.i;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    if (typeof x === "number") return -1 * dir;
    if (typeof y === "number") return 1 * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
  });
  data.forEach(d => body.appendChild(d.r));
  fixed.forEach(r => body.appendChild(r));
  Array.from(header.children).forEach((th, i) => {
    th.classList.toggle("sorted-asc", i === col && dir > 0);
    th.classList.toggle("sorted-desc", i === col && dir < 0);
    if (th.classList.contains("sort-th")) th.setAttribute("aria-sort", i === col ? (dir > 0 ? "ascending" : "descending") : "none");
  });
}
function enhanceTable(t) {
  if (t.dataset.sortReady || t.classList.contains("nosort")) return;
  const header = t.querySelector("tr");
  if (!header || !header.querySelector("th") || header.querySelector("th[data-sort]")) return;   // tables with their own sorting
  t.dataset.sortReady = "1";
  const key = _tableKey(t);
  Array.from(header.children).forEach((th, i) => {
    if (!th.textContent.trim()) return;
    th.classList.add("sort-th");
    th.tabIndex = 0;
    th.title = "sort by " + th.textContent.trim();
    const go = () => {
      const cur = SORTS[key];
      const first = _cellValue((t.querySelectorAll("tr")[1] || {}).children ? t.querySelectorAll("tr")[1].children[i] : null);
      const dir = cur && cur.col === i ? -cur.dir : (typeof first === "number" ? -1 : 1);   // numbers: biggest first
      SORTS[key] = { col: i, dir };
      _sortTable(t, i, dir);
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  const saved = SORTS[key];
  if (saved) _sortTable(t, saved.col, saved.dir);
}
let _enhanceTimer = null;
new MutationObserver(() => {
  clearTimeout(_enhanceTimer);
  _enhanceTimer = setTimeout(() => document.querySelectorAll("table").forEach(enhanceTable), 40);
}).observe(document.body, { childList: true, subtree: true });

/* ---------------- wiring ---------------- */

Object.assign(RENDERERS, { ports: renderPorts });
(function () {
  const prev = window.onTabChange;
  window.onTabChange = function (tab) { if (prev) prev(tab); };
})();

/* ---------------- Agents (drill-down) ---------------- */

Object.assign(HINTS, {
  agent_tokens: "Tokens read from the agents' own local logs (Claude Code, Codex). Split by where the session ran (CLI, IDE, desktop app, web) and by model.",
  agent_sessions: "Every session the agent logged on this machine. Hand off writes a brief another agent (or a new session) can continue from. Archive hides it from the agent but keeps it in ~/.stackradar/archived-sessions.",
});
const AG = { sel: null, view: "sessions", q: "", tag: "", picked: new Set(), latest: {} };
function agentTotals(A) {
  const surf = {}, model = {};
  A.forEach(a => {
    const u = a.usage || {};
    Object.entries(u.by_surface || {}).forEach(([k, v]) => { const x = surf[a.name + "|" + k] = surf[a.name + "|" + k] || { agent: a.name, surface: k, in: 0, out: 0, sessions: 0 }; x.in += v.in; x.out += v.out; x.sessions += v.sessions; });
    Object.entries(u.by_model || {}).forEach(([k, v]) => { const x = model[k] = model[k] || { model: k, agents: new Set(), in: 0, out: 0, msgs: 0, sessions: 0 }; x.agents.add(a.name); x.in += v.in; x.out += v.out; x.msgs += v.msgs || 0; x.sessions += v.sessions || 0; });
  });
  return { surf: Object.values(surf).sort((a, b) => b.out - a.out), model: Object.values(model).sort((a, b) => b.out - a.out) };
}
function tokenBreakdownHtml(A) {
  const t = agentTotals(A);
  if (!t.model.length && !t.surf.length) return `<div class="muted small">No token logs found. Claude Code and Codex keep them locally; other agents don't log tokens.</div>`;
  return `<div class="grid" style="grid-template-columns:1fr 1fr">
    <div><h4 class="set-h">By model</h4><table><tr><th>model</th><th>agent</th><th>tokens in</th><th>tokens out</th><th>replies</th><th>sessions</th></tr>
      ${t.model.map(m => `<tr><td class="mono">${esc(m.model)}</td><td class="small">${[...m.agents].map(esc).join(", ")}</td><td class="mono" data-v="${m.in}">${fmtNum(m.in)}</td><td class="mono" data-v="${m.out}">${fmtNum(m.out)}</td><td class="mono">${m.msgs}</td><td class="mono">${m.sessions}</td></tr>`).join("")}</table></div>
    <div><h4 class="set-h">By agent and where it ran</h4><table><tr><th>agent</th><th>ran in</th><th>tokens in</th><th>tokens out</th><th>sessions</th></tr>
      ${t.surf.map(m => `<tr><td>${esc(m.agent)}</td><td>${badge(m.surface, { CLI: "b-gray", IDE: "b-blue", "Desktop app": "b-purple", "Web / cloud": "b-cyan" }[m.surface] || "b-gray")}</td><td class="mono" data-v="${m.in}">${fmtNum(m.in)}</td><td class="mono" data-v="${m.out}">${fmtNum(m.out)}</td><td class="mono">${m.sessions}</td></tr>`).join("")}</table></div></div>`;
}
const _renderAgentsList = typeof renderAgents === "function" ? renderAgents : null;
function renderAgents2() {
  const A = S.data.agents || [];
  if (AG.sel) { const a = A.find(x => x.id === AG.sel); if (a) return renderAgentDetail(a); AG.sel = null; }
  if (_renderAgentsList) _renderAgentsList();
  const tab = $("#tab-agents");
  // make cards clickable, add the token breakdown
  $$(".agent-card", tab).forEach((c, i) => {
    c.classList.add("clickable"); c.title = "open " + A[i].name;
    c.addEventListener("click", e => { if (e.target.closest("button, a")) return; AG.sel = A[i].id; AG.view = "sessions"; AG.picked.clear(); renderAgents2(); });
  });
  const grid = $(".agent-grid", tab);
  if (grid) grid.insertAdjacentHTML("beforebegin", `<div class="panel"><h3>Tokens by agent, surface and model ${hint("agent_tokens")}</h3>${tokenBreakdownHtml(A)}</div>`);
}
function sessionRow(s, i) {
  return `<tr>
    <td><input type="checkbox" data-pick="${i}" ${AG.picked.has(s.file) ? "checked" : ""} aria-label="select"></td>
    <td style="max-width:360px"><b>${esc(s.title || (s.first_prompt || s.id).slice(0, 90))}</b>${s.subagent ? " " + badge("sub-agent", "b-gray") : ""}
      ${(s.tags || []).map(t => `<span class="badge ${t === "to delete" ? "b-red" : "b-purple"}">${esc(t)}</span>`).join(" ")}
      <div class="sub ellipsis">${esc(s.title && s.first_prompt ? s.first_prompt : "")}</div></td>
    <td class="small">${s.project ? `<a href="#" data-openprojname="${esc(s.project)}">📦 ${esc(s.project)}</a>` : `<span class="mono muted">${esc((s.cwd || "").split(/[\\/]/).slice(-2).join("/"))}</span>`}${s.branch ? `<div class="sub">⎇ ${esc(s.branch)}</div>` : ""}</td>
    <td>${badge(s.surface || "?", "b-gray")}</td>
    <td class="small mono">${(s.models || []).map(esc).join("<br>") || "—"}</td>
    <td class="mono small" data-v="${s.in || 0}">${fmtNum(s.in)}</td><td class="mono small" data-v="${s.out || 0}">${fmtNum(s.out)}</td>
    <td class="small" data-v="${s.last || 0}">${fmtAgo(s.last)}</td>
    <td class="mono small" data-v="${s.size || 0}">${fmtBytes(s.size)}</td>
    <td style="white-space:nowrap;text-align:right">
      <button class="mini-btn" data-sact="view" data-i="${i}" title="read it">👁</button>
      <button class="mini-btn" data-sact="handoff" data-i="${i}" title="hand off to another agent">⇢</button>
      <button class="mini-btn" data-sact="tag" data-i="${i}" title="tag">🏷</button>
      <button class="mini-btn" data-sact="archive" data-i="${i}" title="archive">🗄</button>
      <button class="mini-btn" data-sact="delete" data-i="${i}" title="move to Trash">🗑</button></td></tr>`;
}
async function sessionAct(a, s, act) {
  if (act === "delete" && !confirm(`Move this ${a.name} session to the Trash?\n\n${s.title || s.first_prompt || s.id}`)) return;
  if (act === "tag") {
    const v = prompt("Tags (comma separated). Use \"to delete\" to mark it for clean-up:", (s.tags || []).join(", "));
    if (v === null) return;
    const j = await api("/api/agents/session", { agent: a.id, file: s.file, action: "tag", tags: v.split(",").map(x => x.trim()).filter(Boolean) });
    if (j.ok) { s.tags = j.tags; renderAgentDetail(a); } else toast(esc(j.error), "err");
    return;
  }
  const j = await api("/api/agents/session", { agent: a.id, file: s.file, action: act });
  if (!j.ok) return toast(esc(j.error || "failed"), "err");
  if (act === "view") return modal(`<h3>${esc(s.title || s.id)}</h3>
    <div class="small muted">${esc(s.cwd || "")} · ${fmtNum(s.in)} in / ${fmtNum(s.out)} out</div>
    <div class="console" style="height:380px;white-space:pre-wrap">${(j.users || []).slice(-30).map((u, k) => `<div style="margin:8px 0"><b style="color:var(--cyan)">you:</b> ${esc(u.slice(0, 1200))}</div>${j.replies && j.replies[k] ? "" : ""}`).join("")}
      ${(j.replies || []).length ? `<div style="margin:12px 0"><b style="color:var(--green)">agent (last reply):</b> ${esc(j.replies[j.replies.length - 1].slice(0, 3000))}</div>` : ""}</div>
    ${(j.files || []).length ? `<div class="small"><b>files touched:</b> ${j.files.slice(0, 20).map(f => `<code>${esc(f)}</code>`).join(" ")}</div>` : ""}
    <div class="m-actions"><button class="btn" id="mCancel">Close</button></div>`), ($("#mCancel").onclick = closeModal);
  if (act === "handoff") return handoffModal(j, s.cwd);
  toast(act === "archive" ? "archived (restore any time)" : "moved to Trash", "ok");
  a.session_list = a.session_list.filter(x => x.file !== s.file);
  renderAgentDetail(a);
}
function handoffModal(j, cwd) {
  modal(`<h3>⇢ Hand off to another agent</h3>
    <div class="small">Brief saved to <code>${esc(j.file)}</code>. Pick a command, or copy the brief into any agent or chat.</div>
    ${Object.entries(j.commands || {}).map(([k, c], i) => `<div class="cmd-row"><b class="small">${esc(k)}</b><code class="small">${esc(c)}</code>
      <button class="mini-btn" data-copyc="${i}" title="copy">⧉</button><button class="btn small" data-termc="${i}">Open in Terminal</button></div>`).join("")}
    <details style="margin-top:8px"><summary class="small">Show the brief</summary><pre class="small" style="white-space:pre-wrap;max-height:300px;overflow:auto">${esc(j.markdown || j.brief || "")}</pre></details>
    <div class="m-actions"><button class="btn" id="mCopyBrief">Copy brief</button><button class="btn" id="mCancel">Close</button></div>`);
  const cmds = Object.values(j.commands || {});
  $("#mCancel").onclick = closeModal;
  $("#mCopyBrief").onclick = () => { navigator.clipboard.writeText(j.markdown || j.brief || ""); toast("brief copied", "ok"); };
  $$("[data-copyc]").forEach(b => b.onclick = () => { navigator.clipboard.writeText(cmds[+b.dataset.copyc]); toast("copied", "ok"); });
  $$("[data-termc]").forEach(b => b.onclick = async () => {
    const r = await api("/api/terminal", { command: cmds[+b.dataset.termc], cwd: cwd || "~", confirm: true });
    toast(r.ok ? "opened a terminal" : esc(r.error), r.ok ? "ok" : "err");
  });
}
function renderAgentDetail(a) {
  const tab = $("#tab-agents");
  const L = a.session_list || [];
  const tags = [...new Set(L.flatMap(s => s.tags || []))];
  const q = AG.q.toLowerCase();
  const rows = L.filter(s => (!q || [s.title, s.first_prompt, s.cwd, s.project, (s.models || []).join(" ")].join(" ").toLowerCase().includes(q)) && (!AG.tag || (s.tags || []).includes(AG.tag)));
  const sk = ((S.data.skills || {}).skills || []).filter(x => (x.agent || "").startsWith(a.name.split(" (")[0]));
  const lat = AG.latest[a.id];
  const views = [["sessions", "Sessions (" + L.length + ")"], ["usage", "Tokens & models"], ["procs", "Processes (" + (a.running || []).length + ")"], ["skills", "Skills (" + sk.length + ")"], ["mcp", "MCP (" + (a.mcp || []).length + ")"]];
  let body = "";
  if (AG.view === "sessions") {
    body = `<div class="filterbar"><input id="agQ" placeholder="search sessions…" value="${esc(AG.q)}">
      <select id="agTag"><option value="">any tag</option>${tags.map(t => `<option ${AG.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <span class="spacer"></span><span class="small muted">${AG.picked.size} selected</span>
      <button class="btn small" id="agTagSel" ${AG.picked.size ? "" : "disabled"}>🏷 tag “to delete”</button>
      <button class="btn small" id="agArchSel" ${AG.picked.size ? "" : "disabled"}>🗄 archive</button>
      <button class="btn danger small" id="agDelSel" ${AG.picked.size ? "" : "disabled"}>🗑 delete</button>
      <button class="btn small" id="agArchived">Archived…</button></div>
      ${L.length ? `<table><tr><th><input type="checkbox" id="agAll" aria-label="select all"></th><th>session</th><th>project</th><th>ran in</th><th>model</th><th>in</th><th>out</th><th>last</th><th>size</th><th></th></tr>${rows.slice(0, 300).map(sessionRow).join("")}</table>`
        : `<div class="muted small">${a.sessions ? a.sessions + " session files found, but StackRadar can only read Claude Code and Codex logs in detail." : "No sessions logged."}</div>`}`;
  } else if (AG.view === "usage") {
    body = tokenBreakdownHtml([a]);
  } else if (AG.view === "procs") {
    const P = a.running || [];
    body = P.length ? `${P.length > 1 ? `<div class="filterbar"><span class="small">${P.length} processes. The newest is probably the one you're using.</span><span class="spacer"></span><button class="btn danger small" id="agKillOld">■ Stop all but the newest</button></div>` : ""}
      <table><tr><th>pid</th><th>started</th><th>CPU</th><th>memory</th><th>folder</th><th>command</th><th></th></tr>
      ${P.map((r, i) => `<tr><td class="mono">${r.pid}${i === 0 && P.length > 1 ? " " + badge("newest", "b-green") : ""}</td><td class="small" data-v="${r.started || 0}">${r.started ? fmtAgo(r.started) : "—"}</td>
        <td class="mono small">${r.cpu != null ? r.cpu.toFixed(1) + "%" : "—"}</td><td class="mono small" data-v="${r.rss || 0}">${r.rss ? fmtBytes(r.rss) : "—"}</td>
        <td class="small mono ellipsis">${esc(r.cwd || "")}</td><td class="small mono ellipsis" title="${esc(r.cmd)}">${esc(r.cmd)}</td>
        <td style="white-space:nowrap"><button class="btn small" data-akill="${r.pid}">■ Stop</button><button class="btn danger small" data-akill="${r.pid}" data-force="1">✕</button></td></tr>`).join("")}</table>`
      : `<div class="muted small">Not running right now.</div>`;
  } else if (AG.view === "skills") {
    body = sk.length ? `<table><tr><th>skill</th><th>scope</th><th>uses</th><th>last used</th><th></th></tr>${sk.map(x => `<tr><td><b>${esc(x.name)}</b><div class="sub">${esc((x.description || "").slice(0, 120))}</div></td>
      <td class="small">${x.scope === "project" ? "📦 " + esc(x.project || "") : "global"}</td><td class="mono">${x.uses || 0}</td><td class="small">${x.last_used ? fmtAgo(x.last_used) : "never"}</td>
      <td><button class="mini-btn" data-reveal="${esc(x.folder)}">📂</button></td></tr>`).join("")}</table>` : `<div class="muted small">No skills for this agent.</div>`;
  } else {
    body = (a.mcp || []).length ? `<div class="pill-row">${a.mcp.map(m => `<span class="chip">🔌 ${esc(m)}</span>`).join("")}</div><div class="small muted" style="margin-top:6px">Configured in ${esc((a.dirs || []).join(", "))}</div>` : `<div class="muted small">No MCP servers configured.</div>`;
  }
  tab.innerHTML = `
  <div class="filterbar"><button class="btn small" id="agBack">← All agents</button></div>
  <h2 class="tab-title">${esc(a.name)} <span class="muted small">${esc(a.vendor)}</span></h2>
  <div class="grid cards" style="margin-bottom:12px">
    <div class="card"><div class="k">Installed</div><div class="v" style="font-size:18px">${esc(a.version || "—")}</div><div class="s mono ellipsis">${esc(a.bin || "")}</div></div>
    <div class="card"><div class="k">Newest</div><div class="v" style="font-size:18px">${lat ? esc(lat.latest || "?") : "—"}</div><div class="s">${lat ? (lat.released ? "released " + fmtAgo(lat.released) : esc(lat.error || "")) : `<button class="btn small" id="agLatest" ${a.package ? "" : "disabled"}>Check</button>`}${lat && lat.update_cmd ? ` <button class="btn ok small" id="agUpdate">⬆ Update</button>` : ""}</div></div>
    <div class="card"><div class="k">Tokens</div><div class="v" style="font-size:18px">${fmtNum((a.tokens_in || 0) + (a.tokens_out || 0))}</div><div class="s">${fmtNum(a.tokens_in)} in · ${fmtNum(a.tokens_out)} out${a.cache_tokens ? " · " + fmtNum(a.cache_tokens) + " cache" : ""}</div></div>
    <div class="card"><div class="k">On disk</div><div class="v" style="font-size:18px">${fmtBytes(a.size)}</div><div class="s">${a.sessions || 0} sessions · last ${fmtAgo(a.last_active)}</div></div>
  </div>
  <div class="pill-row" style="margin-bottom:8px">${views.map(v => `<button class="btn small ${AG.view === v[0] ? "ok" : ""}" data-agv="${v[0]}">${esc(v[1])}</button>`).join("")} ${hint("agent_sessions")}</div>
  <div class="panel">${body}</div>`;
  $("#agBack").onclick = () => { AG.sel = null; renderAgents2(); };
  $$("[data-agv]", tab).forEach(b => b.onclick = () => { AG.view = b.dataset.agv; renderAgentDetail(a); });
  $$("[data-reveal]", tab).forEach(b => b.onclick = () => revealPath(b.dataset.reveal));
  $$("[data-openprojname]", tab).forEach(x => x.onclick = e => { e.preventDefault(); const p = (S.data.projects || []).find(y => y.name === x.dataset.openprojname); if (p) openDrawer(p); });
  const lb = $("#agLatest");
  if (lb) lb.onclick = async () => { AG.latest[a.id] = await api("/api/agents/latest?id=" + encodeURIComponent(a.id)); renderAgentDetail(a); };
  const ub = $("#agUpdate");
  if (ub) ub.onclick = async () => {
    if (!confirm("Run: " + lat.update_cmd + " ?")) return;
    const j = await api("/api/tools/action", { manager: lat.manager, name: lat.package, action: "update", confirm: true });
    if (j.ok) showJob(j.id, () => {}, "Updating " + a.name + "…"); else toast(esc(j.error), "err");
  };
  if (AG.view === "sessions") {
    const qi = $("#agQ");
    if (qi) qi.oninput = e => { AG.q = e.target.value; renderAgentDetail(a); const i = $("#agQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    const tg = $("#agTag"); if (tg) tg.onchange = e => { AG.tag = e.target.value; renderAgentDetail(a); };
    $$("[data-pick]", tab).forEach(c => c.onchange = () => { const s = rows[+c.dataset.pick]; c.checked ? AG.picked.add(s.file) : AG.picked.delete(s.file); renderAgentDetail(a); });
    const all = $("#agAll"); if (all) all.onchange = () => { rows.slice(0, 300).forEach(s => all.checked ? AG.picked.add(s.file) : AG.picked.delete(s.file)); renderAgentDetail(a); };
    $$("[data-sact]", tab).forEach(b => b.onclick = () => sessionAct(a, rows[+b.dataset.i], b.dataset.sact));
    const bulk = async (act) => {
      const files = [...AG.picked];
      if (act === "delete" && !confirm(`Move ${files.length} session(s) to the Trash?`)) return;
      for (const f of files) {
        const s = L.find(x => x.file === f) || {};
        const j = await api("/api/agents/session", { agent: a.id, file: f, action: act, tags: act === "tag" ? [...new Set([...(s.tags || []), "to delete"])] : undefined });
        if (j.ok && act === "tag") s.tags = j.tags;
        if (j.ok && act !== "tag") a.session_list = a.session_list.filter(x => x.file !== f);
      }
      AG.picked.clear(); toast("done", "ok"); renderAgentDetail(a);
    };
    const t1 = $("#agTagSel"); if (t1) t1.onclick = () => bulk("tag");
    const t2 = $("#agArchSel"); if (t2) t2.onclick = () => bulk("archive");
    const t3 = $("#agDelSel"); if (t3) t3.onclick = () => bulk("delete");
    const ar = $("#agArchived"); if (ar) ar.onclick = async () => {
      const j = await api("/api/agents/archived");
      const X = (j.sessions || []).filter(x => x.agent === a.id);
      modal(`<h3>Archived ${esc(a.name)} sessions</h3>${X.length ? `<table><tr><th>session</th><th>size</th><th>archived</th><th></th></tr>${X.map((x, i) => `<tr><td class="mono small">${esc(x.id)}</td><td class="mono small">${fmtBytes(x.size)}</td><td class="small">${fmtAgo(x.last)}</td><td><button class="btn small" data-rest="${i}">↩ restore</button></td></tr>`).join("")}</table>` : '<div class="muted small">none</div>'}
        <div class="m-actions"><button class="btn" id="mCancel">Close</button></div>`);
      $("#mCancel").onclick = closeModal;
      $$("[data-rest]").forEach(b => b.onclick = async () => { const r = await api("/api/agents/session", { agent: a.id, file: X[+b.dataset.rest].file, action: "restore" }); toast(r.ok ? "restored, rescan to see it" : esc(r.error), r.ok ? "ok" : "err"); b.disabled = true; });
    };
  }
  if (AG.view === "procs") {
    $$("[data-akill]", tab).forEach(b => b.onclick = async () => {
      const force = !!b.dataset.force;
      if (!confirm(`${force ? "Force kill" : "Stop"} pid ${b.dataset.akill}?`)) return;
      const j = await api("/api/agents/stop", { pid: +b.dataset.akill, force });
      toast(j.ok ? `pid ${b.dataset.akill}: ${esc(j.method)}` : esc(j.error) + (j.admin_cmd ? `<br><code>${esc(j.admin_cmd)}</code>` : ""), j.ok ? "ok" : "err");
      if (j.ok) { a.running = a.running.filter(r => r.pid !== +b.dataset.akill); renderAgentDetail(a); }
    });
    const ko = $("#agKillOld");
    if (ko) ko.onclick = async () => {
      const old = (a.running || []).slice(1);
      if (!confirm(`Stop ${old.length} older ${a.name} process(es)?\n\nKeeping the newest: pid ${a.running[0].pid}`)) return;
      for (const r of old) { const j = await api("/api/agents/stop", { pid: r.pid }); if (j.ok) a.running = a.running.filter(x => x.pid !== r.pid); else toast(`pid ${r.pid}: ${esc(j.error)}`, "err"); }
      toast("older processes stopped", "ok"); renderAgentDetail(a);
    };
  }
}
RENDERERS.agents = renderAgents2;

/* ---------------- package info (what it does + what's new) ---------------- */

function mdLite(t) {   // tiny, safe Markdown → HTML for release notes
  return esc(t || "").replace(/^### (.*)$/gm, "<b>$1</b>").replace(/^## (.*)$/gm, "<b>$1</b>").replace(/^# (.*)$/gm, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/^[*-] (.*)$/gm, "• $1");
}
async function packageInfoModal(manager, name, current, actions) {
  modal(`<h3>${esc(name)} <span class="muted small">${esc(manager)}</span></h3><div class="small muted">looking it up…</div>`);
  const j = await api(`/api/pkg/info?manager=${encodeURIComponent(manager)}&name=${encodeURIComponent(name)}&current=${encodeURIComponent(current || "")}`);
  const rel = j.releases || [];
  modal(`<h3>${esc(name)} <span class="muted small">${esc(manager)}</span></h3>
    ${j.ok === false ? `<div class="warn-box small">${esc(j.error)}</div>` : ""}
    <div style="margin:4px 0 10px">${esc(j.description || "No description published.")}</div>
    <div class="kv">
      <div class="k">installed</div><div><b class="mono">${esc(current || "—")}</b>${j.current_date ? ` <span class="muted small">released ${fmtAgo(j.current_date)}</span>` : ""}</div>
      <div class="k">newest</div><div><b class="mono" style="color:${j.latest && current && j.latest !== current ? "var(--green)" : "inherit"}">${esc(j.latest || "?")}</b>${j.latest_date ? ` <span class="muted small">released ${fmtAgo(j.latest_date)}</span>` : ""}${j.versions_behind ? ` · <b>${j.versions_behind}</b> release${j.versions_behind > 1 ? "s" : ""} behind` : ""}</div>
      ${j.license ? `<div class="k">license</div><div>${esc(j.license)}</div>` : ""}
      <div class="k">links</div><div>${[j.homepage && `<a href="${esc(j.homepage)}" target="_blank" rel="noopener">homepage ↗</a>`, j.repo_url && `<a href="${esc(j.repo_url)}" target="_blank" rel="noopener">source ↗</a>`, j.changelog_url && `<a href="${esc(j.changelog_url)}" target="_blank" rel="noopener">changelog ↗</a>`].filter(Boolean).join(" · ") || "—"}</div>
    </div>
    <h4 class="set-h">What's new${current ? " since " + esc(current) : ""}</h4>
    ${rel.length ? `<div class="rel-list">${rel.map(r => `<details ${rel.length < 3 ? "open" : ""}><summary><b class="mono">${esc(r.version)}</b> <span class="muted small">${r.date ? fmtAgo(r.date) : ""}</span> <a href="${esc(r.url)}" target="_blank" rel="noopener" class="small">↗</a></summary>
      <div class="small rel-notes">${mdLite(r.notes).replace(/\n/g, "<br>") || '<span class="muted">no notes</span>'}</div></details>`).join("")}</div>`
      : `<div class="small muted">${j.releases_error ? esc(j.releases_error) + ". " : ""}No release notes found here${j.changelog_url ? `: see the <a href="${esc(j.changelog_url)}" target="_blank" rel="noopener">changelog</a>` : ""}.</div>`}
    <div class="m-actions"><button class="btn" id="mCancel">Close</button>${(actions || []).map((a, i) => `<button class="btn ${a.cls || ""}" data-pact="${i}">${esc(a.label)}</button>`).join("")}</div>`);
  $("#mCancel").onclick = closeModal;
  $$("[data-pact]").forEach(b => b.onclick = () => actions[+b.dataset.pact].fn(j));
}
window.packageInfoModal = packageInfoModal;

/* ---------------- Tools & packages ---------------- */

Object.assign(HINTS, {
  tools: "Every developer tool and global package on this machine: the version you have, the newest one, when you last used it (from your shell history), and which ones nothing uses. Click a name for what it does and what's new.",
  tools_unused: "Not used by any scanned project, not needed by another package, and never typed in your shell history.",
});
const TL = { data: null, view: "tools", q: "", filter: "" };
async function loadTools(force) {
  TL.data = await api("/api/tools" + (force ? "?refresh=1" : ""));
  if (S.tab === "tools") paintTools();
  const n = Object.values((TL.data || {}).managers || {}).reduce((a, m) => a + m.items.filter(i => i.outdated).length, 0) + ((TL.data || {}).tools || []).filter(t => t.outdated).length;
  const b = $("#nbTools"); if (b) b.textContent = n || "";
}
function renderTools() {
  if (!TL.data) { $("#tab-tools").innerHTML = `<div class="empty small">checking installed tools and packages… (first time takes a few seconds)</div>`; loadTools(false); return; }
  paintTools();
}
function useCell(it) {
  if (it.last_used) return `<span data-v="${it.last_used}">${fmtAgo(it.last_used)}</span><div class="sub">${it.uses}× in history</div>`;
  if (it.uses) return `<span data-v="1">used</span><div class="sub">${it.uses}× (no dates in history)</div>`;
  return `<span class="muted" data-v="0">never seen</span>`;
}
function verCell(it) {
  return `<span class="mono">${esc(it.version || "?")}</span>${it.outdated ? ` <span class="badge b-amber">→ ${esc(it.latest)}</span>` : it.latest ? ' <span class="badge b-green">latest</span>' : ""}`;
}
function paintTools() {
  const d = TL.data || {}, M = d.managers || {}, Z = d.zsh || {};
  const tabs = [["tools", "CLI tools", (d.tools || []).length]].concat(Object.entries(M).map(([k, m]) => [k, m.label, m.items.length]));
  if ((Z.plugins || []).length || Z.framework) tabs.push(["zsh", "zsh plugins", (Z.plugins || []).length]);
  const q = TL.q.toLowerCase();
  const match = it => (!q || [it.name, it.cmd, it.summary, it.package].join(" ").toLowerCase().includes(q)) &&
    (!TL.filter || (TL.filter === "outdated" && it.outdated) || (TL.filter === "unused" && it.unused) || (TL.filter === "old" && it.age));
  let body = "";
  if (TL.view === "tools") {
    const T = (d.tools || []).filter(match);
    body = `<table><tr><th>tool</th><th>group</th><th>version</th><th>installed with</th><th>last used</th><th></th></tr>
      ${T.map((t, i) => `<tr><td><a href="#" data-tinfo="${i}"><b>${esc(t.name)}</b></a> <span class="mono muted small">${esc(t.cmd)}</span><div class="sub mono ellipsis" title="${esc(t.path)}">${esc(t.path)}</div></td>
        <td class="small">${esc(t.group)}</td><td>${verCell(t)}</td>
        <td class="small">${esc(t.method)}${t.package && t.package !== t.cmd ? `<div class="sub mono">${esc(t.package)}</div>` : ""}</td><td class="small">${useCell(t)}</td>
        <td style="white-space:nowrap;text-align:right">${t.can_update ? `<button class="btn small" data-tact="update" data-mgr="${esc(t.manager)}" data-name="${esc(t.package || t.cmd)}">⬆ update</button>` : ""}
          ${t.can_remove ? `<button class="btn danger small" data-tact="remove" data-mgr="${esc(t.manager)}" data-name="${esc(t.package || t.cmd)}">remove</button>` : `<span class="small muted" title="installed by the OS or by hand">—</span>`}</td></tr>`).join("")}</table>`;
    TL.rows = T;
  } else if (TL.view === "zsh") {
    body = `${Z.framework ? `<div class="small" style="margin-bottom:8px"><b>${esc(Z.framework.name)}</b> at <code>${esc(Z.framework.path)}</code>${Z.framework.last_update ? " · updated " + fmtAgo(Z.framework.last_update) : ""} · theme <b>${esc(Z.theme || "default")}</b>
      <button class="btn small" data-zact="update" data-path="${esc(Z.framework.path)}">⬆ update oh-my-zsh</button></div>` : ""}
      <table><tr><th>plugin</th><th>kind</th><th>enabled in .zshrc</th><th>last update</th><th></th></tr>
      ${(Z.plugins || []).filter(match).map(z => `<tr><td><b>${esc(z.name)}</b>${z.remote ? `<div class="sub mono">${esc(z.remote)}</div>` : ""}</td><td class="small">${esc(z.kind)}</td>
        <td>${z.enabled ? badge("✓ enabled", "b-green") : badge("installed, not used", "b-amber")}</td><td class="small">${z.last_update ? fmtAgo(z.last_update) : "—"}</td>
        <td style="white-space:nowrap;text-align:right">${z.can_update ? `<button class="btn small" data-zact="update" data-path="${esc(z.path)}">⬆ update</button>` : ""}${z.can_remove ? `<button class="btn danger small" data-zact="remove" data-path="${esc(z.path)}">remove</button>` : ""}</td></tr>`).join("")}</table>`;
  } else {
    const m = M[TL.view] || { items: [] };
    const I = m.items.filter(match);
    TL.rows = I;
    body = `${!m.checked_latest ? `<div class="warn-box small">Newest versions not checked yet. <button class="btn small" id="tlLatest2">Check for newer versions</button></div>` : ""}
      <table><tr><th>package</th><th>version</th><th>installed</th><th>used by</th><th>last used</th><th></th></tr>
      ${I.map((it, i) => `<tr><td><a href="#" data-pinfo="${i}"><b>${esc(it.name)}</b></a> ${it.kind && it.kind !== "formula" ? badge(it.kind, "b-gray") : ""} ${it.unused ? `<span class="badge b-amber" title="${esc(HINTS.tools_unused)}">unused</span>` : ""} ${it.age ? badge(it.age, it.age === "very old" ? "b-red" : "b-gray") : ""}
          <div class="sub ellipsis">${esc(it.summary || (it.bins || []).join(", "))}</div></td>
        <td>${verCell(it)}</td><td class="small" data-v="${it.installed || 0}">${it.installed ? fmtAgo(it.installed) : "—"}</td>
        <td class="small">${(it.used_by_projects || []).length ? "📦 " + it.used_by_projects.map(esc).join(", ") : ""}${(it.required_by || []).length ? `<div class="sub">needed by ${it.required_by.map(esc).join(", ")}</div>` : ""}${it.dependency_only ? '<span class="muted">dependency of another formula</span>' : ""}</td>
        <td class="small">${useCell(it)}</td>
        <td style="white-space:nowrap;text-align:right">${it.outdated ? `<button class="btn ok small" data-tact="update" data-mgr="${esc(TL.view)}" data-name="${esc(it.name)}">⬆ ${esc(it.latest)}</button>` : ""}
          <button class="btn danger small" data-tact="remove" data-mgr="${esc(TL.view)}" data-name="${esc(it.name)}">remove</button></td></tr>`).join("")}</table>`;
  }
  const all = Object.values(M).flatMap(m => m.items);
  $("#tab-tools").innerHTML = `
  <h2 class="tab-title">Tools &amp; packages ${hint("tools")}</h2>
  ${tabHint("tools")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">CLI tools</div><div class="v">${(d.tools || []).length}</div><div class="s">${(d.tools || []).filter(t => t.outdated).length} with a newer version</div></div>
    <div class="card clickable-card" data-tlf="outdated"><div class="k">Outdated packages</div><div class="v" style="color:var(--amber)">${all.filter(i => i.outdated).length}</div><div class="s">${d.latest_checked_at ? "checked " + fmtAgo(d.latest_checked_at) : "not checked yet"}</div></div>
    <div class="card clickable-card" data-tlf="unused"><div class="k">Never used</div><div class="v">${all.filter(i => i.unused).length}</div><div class="s">${d.history_found ? "from projects + shell history" : "no shell history found"}</div></div>
    <div class="card clickable-card" data-tlf="old"><div class="k">Installed &gt; 1 year ago</div><div class="v">${all.filter(i => i.age).length}</div><div class="s">old or very old</div></div>
  </div>
  <div class="filterbar"><input id="tlQ" placeholder="search…" value="${esc(TL.q)}">
    <select id="tlF">${[["", "everything"], ["outdated", "outdated"], ["unused", "never used"], ["old", "installed > 1 year ago"]].map(x => `<option value="${x[0]}" ${TL.filter === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}</select>
    <span class="spacer"></span><span class="small muted">${d.checked_at ? "listed " + fmtAgo(d.checked_at) : ""}</span>
    <button class="btn small" id="tlLatest">⟳ Check for newer versions</button><button class="btn small" id="tlRefresh">⟳ Re-list</button></div>
  <div class="pill-row" style="margin-bottom:8px">${tabs.map(t => `<button class="btn small ${TL.view === t[0] ? "ok" : ""}" data-tlv="${esc(t[0])}">${esc(t[1])} (${t[2]})</button>`).join("")}</div>
  <div class="panel" style="padding:6px 8px">${body}</div>`;
  const tab = $("#tab-tools");
  $$("[data-tlv]", tab).forEach(b => b.onclick = () => { TL.view = b.dataset.tlv; paintTools(); });
  $$("[data-tlf]", tab).forEach(b => b.onclick = () => { TL.filter = b.dataset.tlf; if (TL.view === "tools") TL.view = Object.keys(M)[0] || "tools"; paintTools(); });
  $("#tlQ").oninput = e => { TL.q = e.target.value; paintTools(); const i = $("#tlQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $("#tlF").onchange = e => { TL.filter = e.target.value; paintTools(); };
  $("#tlRefresh").onclick = () => loadTools(true);
  const latest = async () => { const j = await api("/api/tools/latest", {}); if (j.ok) showJob(j.id, () => loadTools(false), "Checking for newer versions…"); };
  $("#tlLatest").onclick = latest; const l2 = $("#tlLatest2"); if (l2) l2.onclick = latest;
  const runAct = async (mgr, name, act) => {
    if (!confirm(`${act === "remove" ? "Remove" : "Update"} ${name} (${mgr})?${act === "remove" ? "\n\nAnything that needs it may stop working." : ""}`)) return;
    const j = await api("/api/tools/action", { manager: mgr, name, action: act, confirm: true });
    if (!j.ok) return toast(esc(j.error || "failed"), "err");
    showJob(j.id, () => loadTools(true), (act === "remove" ? "Removing " : "Updating ") + name + "…");
  };
  $$("[data-tact]", tab).forEach(b => b.onclick = () => runAct(b.dataset.mgr, b.dataset.name, b.dataset.tact));
  $$("[data-zact]", tab).forEach(b => b.onclick = async () => {
    if (!confirm(`${b.dataset.zact === "remove" ? "Move this plugin to the Trash" : "Update (git pull)"}?\n${b.dataset.path}`)) return;
    const j = await api("/api/tools/action", { manager: "zsh", path: b.dataset.path, action: b.dataset.zact, confirm: true });
    if (!j.ok) return toast(esc(j.error || "failed"), "err");
    if (j.id) showJob(j.id, () => loadTools(true), "Updating plugin…"); else { toast("removed. " + esc(j.note || ""), "ok"); loadTools(true); }
  });
  $$("[data-pinfo]", tab).forEach(a => a.onclick = e => {
    e.preventDefault(); const it = TL.rows[+a.dataset.pinfo];
    const acts = [];
    if (it.outdated) acts.push({ label: "⬆ Update to " + it.latest, cls: "ok", fn: () => { closeModal(); runAct(TL.view, it.name, "update"); } });
    acts.push({ label: "Remove", cls: "danger", fn: () => { closeModal(); runAct(TL.view, it.name, "remove"); } });
    packageInfoModal(TL.view === "pipx" ? "pip" : TL.view, it.name, it.version, acts);
  });
  $$("[data-tinfo]", tab).forEach(a => a.onclick = e => {
    e.preventDefault(); const t = TL.rows[+a.dataset.tinfo];
    if (t.manager) packageInfoModal(t.manager === "pipx" ? "pip" : t.manager, t.package || t.cmd, t.version, t.can_update ? [{ label: "⬆ Update", cls: "ok", fn: () => { closeModal(); runAct(t.manager, t.package || t.cmd, "update"); } }] : []);
    else modal(`<h3>${esc(t.name)}</h3><div class="kv"><div class="k">version</div><div class="mono">${esc(t.raw || t.version || "?")}</div><div class="k">path</div><div class="mono">${esc(t.path)}</div><div class="k">installed with</div><div>${esc(t.method)}</div><div class="k">last used</div><div>${t.last_used ? fmtAgo(t.last_used) : t.uses ? t.uses + "× in history" : "not in shell history"}</div></div>
      <div class="small muted" style="margin-top:8px">Installed by the OS or by hand, so StackRadar doesn't update or remove it. Use the tool's own installer.</div><div class="m-actions"><button class="btn" id="mCancel">Close</button></div>`), ($("#mCancel").onclick = closeModal);
  });
}
Object.assign(RENDERERS, { tools: renderTools });

/* ---------------- Caches ---------------- */

Object.assign(HINTS, {
  caches: "Download and build caches of your tools (npm, pip, Homebrew, Xcode, Playwright …). They refill themselves when needed, so they're safe to clear. Clean uses the tool's own command; Open shows what's inside so you can delete just part of it.",
  disk: "Every folder with its size, biggest first. Click a folder to go inside. Folder sizes come from your last scan when possible; others are measured live.",
});
const CA = { data: null };
async function renderCaches() {
  const el = $("#tab-caches");
  CA.data = await api("/api/caches");
  if (CA.data.empty) {
    el.innerHTML = `<h2 class="tab-title">Caches ${hint("caches")}</h2>${tabHint("caches")}<div class="empty">Caches haven't been measured yet.<br><br><button class="btn primary" id="caScan">Measure caches</button></div>`;
    $("#caScan").onclick = startCacheScan;
    return;
  }
  const C = CA.data.caches || [];
  const max = Math.max(1, ...C.map(c => c.size));
  const groups = [...new Set(C.map(c => c.group))];
  el.innerHTML = `
  <h2 class="tab-title">Caches ${hint("caches")}</h2>${tabHint("caches")}
  <div class="grid cards" style="margin-bottom:14px">
    <div class="card"><div class="k">Caches total</div><div class="v" style="color:var(--amber)">${fmtBytes(CA.data.total)}</div><div class="s">measured ${fmtAgo(CA.data.checked_at)}</div></div>
    <div class="card"><div class="k">Biggest</div><div class="v" style="font-size:18px">${C[0] ? esc(C[0].label) : "—"}</div><div class="s">${C[0] ? fmtBytes(C[0].size) : ""}</div></div>
    <div class="card"><div class="k">One-click clean</div><div class="v">${C.filter(c => c.clean_cmd).length}</div><div class="s">use the tool's own command</div></div>
  </div>
  <div class="filterbar"><span class="spacer"></span><button class="btn small" id="caScan">⟳ Measure again</button></div>
  <div class="panel" style="padding:6px 8px"><table><tr><th>cache</th><th>group</th><th>size</th><th>where</th><th></th></tr>
    ${C.map((c, i) => `<tr><td><b>${esc(c.label)}</b>${c.note ? `<div class="sub">${esc(c.note)}</div>` : ""}</td><td class="small">${esc(c.group)}</td>
      <td data-v="${c.size}"><div class="use-bar" style="width:120px"><div style="width:${100 * c.size / max}%"></div></div><span class="mono small">${fmtBytes(c.size)}</span></td>
      <td class="small">${c.paths.map(p => `<div class="mono ellipsis" title="${esc(p.path)}">${esc(p.path)} <span class="muted">${fmtBytes(p.size)}</span></div>`).join("")}</td>
      <td style="white-space:nowrap;text-align:right">
        ${c.clean_cmd ? `<button class="btn ok small" data-caclean="${esc(c.id)}" title="${esc(c.clean_cmd)}">🧹 Clean</button>` : ""}
        <button class="btn small" data-caopen="${i}">Open ›</button></td></tr>`).join("")}</table></div>
  ${(CA.data.docker || []).length ? `<div class="panel"><h3>Docker</h3><table><tr><th>type</th><th>total</th><th>size</th><th>reclaimable</th></tr>${CA.data.docker.map(x => `<tr><td>${esc(x.Type)}</td><td>${esc(x.TotalCount)}</td><td>${esc(x.Size)}</td><td>${esc(x.Reclaimable)}</td></tr>`).join("")}</table>
    <div class="small muted">Clean with <code>docker system prune</code> (unused containers, networks, dangling images) or add <code>-a</code> for all unused images.</div></div>` : ""}`;
  $("#caScan").onclick = startCacheScan;
  $$("[data-caclean]", el).forEach(b => b.onclick = async () => {
    const c = C.find(x => x.id === b.dataset.caclean);
    if (!confirm(`Run: ${c.clean_cmd}\n\nFrees up to ${fmtBytes(c.size)}. The cache refills when needed.`)) return;
    const j = await api("/api/caches/clean", { id: c.id });
    if (!j.ok) return toast(esc(j.error), "err");
    showJob(j.id, () => startCacheScan(), "Cleaning " + c.label + "…");
  });
  $$("[data-caopen]", el).forEach(b => b.onclick = () => { const c = C[+b.dataset.caopen]; DK.path = c.paths[0].path; S.tab = "disk"; render(); });
}
async function startCacheScan() {
  const j = await api("/api/caches/scan", {});
  if (j.ok) showJob(j.id, () => { closeModal(); renderCaches(); }, "Measuring caches…");
}

/* ---------------- Disk space explorer ---------------- */

const DK = { path: "~", data: null, picked: new Set() };
async function renderDisk() {
  const el = $("#tab-disk");
  if (!DK.data || DK.data.path !== DK.path) el.innerHTML = `<h2 class="tab-title">Disk space ${hint("disk")}</h2><div class="empty small">measuring ${esc(DK.path)}…</div>`;
  const d = DK.data = await api("/api/disk?path=" + encodeURIComponent(DK.path));
  if (!d.ok) { el.innerHTML = `<div class="warn-box">${esc(d.error)}</div><button class="btn" id="dkHome">← home</button>`; $("#dkHome").onclick = () => { DK.path = "~"; renderDisk(); }; return; }
  DK.path = d.path;
  const max = Math.max(1, ...d.items.map(i => i.size));
  el.innerHTML = `
  <h2 class="tab-title">Disk space ${hint("disk")}</h2>${tabHint("disk")}
  <div class="filterbar"><div class="crumbs">${d.crumbs.map((c, i) => `<a href="#" data-dkgo="${esc(c.path)}">${esc(i === 0 ? "🏠 " + c.name : c.name)}</a>`).join(" › ")}</div>
    <span class="spacer"></span><span class="small muted">${d.count} items · ${fmtBytes(d.total)}${d.is_cache ? " · cache folder" : ""}</span>
    <button class="btn small" data-reveal="${esc(d.path)}">📂 Show</button></div>
  <div class="panel" style="padding:6px 8px"><table><tr><th>name</th><th>size</th><th>modified</th><th></th></tr>
    ${d.parent ? `<tr class="clickable" data-dkgo="${esc(d.parent)}"><td colspan="4">⬆ ..</td></tr>` : ""}
    ${d.items.map((it, i) => `<tr class="${it.type === "dir" ? "clickable" : ""}" ${it.type === "dir" ? `data-dkgo="${esc(it.path)}"` : ""}>
      <td>${it.type === "dir" ? "📁" : it.type === "link" ? "🔗" : "📄"} <b>${esc(it.name)}</b> ${it.project ? badge("📦 project", "b-purple") : ""} ${it.cache ? badge("cache", "b-amber") : ""} ${it.protected ? badge("protected", "b-gray") : ""}</td>
      <td data-v="${it.size}" style="min-width:200px"><div class="hog-bar-wrap" style="display:inline-block;width:110px;vertical-align:middle"><div class="hog-bar" style="width:${Math.max(1, 100 * it.size / max)}%;background:${it.cache ? "var(--amber)" : "var(--blue)"}"></div></div> <span class="mono small">${fmtBytes(it.size)}</span></td>
      <td class="small" data-v="${it.mtime || 0}">${it.mtime ? fmtAgo(it.mtime) : ""}</td>
      <td style="white-space:nowrap;text-align:right" class="no-row-click">
        <button class="mini-btn" data-reveal="${esc(it.path)}" title="show in file manager">📂</button>
        ${it.protected ? "" : `<button class="mini-btn" data-dkdel="${i}" title="delete">🗑</button>`}</td></tr>`).join("")}
    ${d.more ? `<tr><td colspan="4" class="muted small">+ ${d.more} smaller items</td></tr>` : ""}</table></div>`;
  $$("[data-dkgo]", el).forEach(x => x.onclick = e => { if (e.target.closest(".no-row-click")) return; e.preventDefault(); DK.path = x.dataset.dkgo; renderDisk(); });
  $$("[data-reveal]", el).forEach(b => b.onclick = e => { e.stopPropagation(); revealPath(b.dataset.reveal); });
  $$("[data-dkdel]", el).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const it = d.items[+b.dataset.dkdel];
    modal(`<h3>Delete ${esc(it.name)}?</h3><div class="small">${esc(it.path)} · <b>${fmtBytes(it.size)}</b></div>
      ${it.project ? `<div class="warn-box small">This is a project folder. Consider archiving it from the Projects tab instead.</div>` : ""}
      <label class="upd-item"><input type="checkbox" id="dkPerm" ${it.cache || d.is_cache ? "checked" : ""}> delete permanently (frees the space now; otherwise it goes to the Trash)</label>
      <div class="small">Type <b class="mono">${esc(it.name)}</b> to confirm:</div><input class="search-in" id="dkConfirm" style="width:100%">
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn danger" id="mGo">Delete</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mGo").onclick = async () => {
      const j = await api("/api/disk/delete", { path: it.path, confirm: $("#dkConfirm").value, permanent: $("#dkPerm").checked });
      if (!j.ok) return toast(esc(j.error || "failed"), "err");
      closeModal(); toast(`${esc(j.method)} · freed ${fmtBytes(j.freed)}`, "ok"); renderDisk();
    };
  });
}
Object.assign(RENDERERS, { caches: renderCaches, disk: renderDisk });

/* ---------------- tags: click any tag to see every project that has it ---------------- */

function projectsWithTag(kind, val) {
  const P = S.data.projects || [], v = String(val).toLowerCase();
  const has = {
    lang: p => (p.primary_language || "").toLowerCase() === v || (p.languages || []).some(l => String(l[0]).toLowerCase() === v),
    ai: p => (p.ai_names || []).some(x => x.toLowerCase() === v) || (p.llm || []).some(l => (l.tool || "").toLowerCase() === v),
    dep: p => (p.dependencies || []).some(d => (d.name || "").toLowerCase() === v),
    stage: p => p.stage === val,
    category: p => (metaOf(p).category || "").toLowerCase() === v,
    tag: p => (metaOf(p).tags || []).some(t => t.toLowerCase() === v),
    skill: p => (((S.data.skills || {}).skills || []).some(s => s.name.toLowerCase() === v && ((s.used_in || []).includes(p.name) || (s.scope === "project" && s.project === p.name)))),
    host: p => (p.net_refs || []).some(r => (r.host || "").toLowerCase() === v),
  }[kind];
  return has ? P.filter(has) : [];
}
function tagModal(kind, val) {
  const list = projectsWithTag(kind, val);
  const label = { lang: "language", ai: "AI tool", dep: "dependency", stage: "stage", category: "category", tag: "tag", skill: "skill", host: "host" }[kind] || kind;
  const where = p => {
    if (kind === "dep") { const d = (p.dependencies || []).find(x => (x.name || "").toLowerCase() === String(val).toLowerCase()); return d ? `<span class="mono small">${esc(d.version || "")}</span> <span class="muted small">${esc(d.from || "")}${d.kind === "dev" ? " · dev" : ""}</span>` : ""; }
    if (kind === "lang") { const l = (p.languages || []).find(x => String(x[0]).toLowerCase() === String(val).toLowerCase()); return l ? `<span class="small">${l[1]} files</span>` : ""; }
    if (kind === "host") { const r = (p.net_refs || []).find(x => x.host === val); return r ? `<span class="mono small">${esc(r.file || "")}${r.line ? ":" + r.line : ""}</span>` : ""; }
    return "";
  };
  modal(`<h3>${esc(label)}: <span class="mono">${esc(val)}</span> <span class="muted small">${list.length} project${list.length === 1 ? "" : "s"}</span></h3>
    ${list.length ? `<table><tr><th>project</th><th>where</th><th>size</th><th>last active</th></tr>
      ${list.map((p, i) => `<tr class="clickable" data-tagp="${i}"><td><b>${esc(p.name)}</b><div class="sub mono">${esc(p.path)}</div></td><td>${where(p)}</td>
        <td class="mono small" data-v="${p.size || 0}">${fmtBytes(p.size)}</td><td class="small" data-v="${p.last_run_ts || 0}">${fmtAgo(p.last_run_ts)}</td></tr>`).join("")}</table>`
      : `<div class="muted small">No other project has this ${esc(label)}.</div>`}
    <div class="m-actions">${kind === "dep" ? `<button class="btn" id="mPkg">What is ${esc(val)}?</button>` : ""}<button class="btn" id="mCancel">Close</button></div>`);
  $("#mCancel").onclick = closeModal;
  const pk = $("#mPkg");
  if (pk) pk.onclick = () => {
    const p0 = list[0], d = p0 && (p0.dependencies || []).find(x => x.name === val);
    const mgr = d && /requirements|pyproject|Pipfile|setup/.test(d.from || "") ? "pip" : "npm";
    packageInfoModal(mgr, val, d && d.version ? String(d.version).replace(/^[\^~>=<\s]+/, "") : "");
  };
  $$("[data-tagp]").forEach(tr => tr.onclick = () => { closeModal(); openDrawer(list[+tr.dataset.tagp]); });
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tag]");
  if (!t || e.target.closest("button, a, input, select")) return;
  e.preventDefault(); e.stopPropagation();
  const raw = t.dataset.tag, i = raw.indexOf(":");
  tagModal(raw.slice(0, i), raw.slice(i + 1));
}, true);

/* ---------------- continue a project with another agent / model ---------------- */

const TR = { opts: null };
async function transferPanel(p) {
  const body = $("#drawerBody .drawer-body");
  if (!body) return;
  const sessions = (S.data.agents || []).flatMap(a => (a.session_list || []).map(s => Object.assign({ agentName: a.name }, s)))
    .filter(s => s.cwd && (s.cwd === p.path || s.cwd.startsWith(p.path + "/") || s.cwd.startsWith(p.path + "\\")) && !s.subagent)
    .sort((a, b) => (b.last || 0) - (a.last || 0));
  const last = sessions[0];
  const idleDays = last ? Math.floor((Date.now() / 1000 - last.last) / 86400) : null;
  const stalled = last && idleDays >= 14 && p.stage !== "ready";
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `<h3>Continue with another agent ${stalled ? badge("stalled " + idleDays + " days", "b-amber") : ""}</h3>
    ${last ? `<div class="small">Last worked on with <b>${esc(last.agentName)}</b> ${fmtAgo(last.last)}${(last.models || []).length ? " using <span class='mono'>" + esc(last.models[0]) + "</span>" : ""} · ${sessions.length} session${sessions.length > 1 ? "s" : ""} · ${fmtNum(sessions.reduce((a, s) => a + (s.out || 0), 0))} tokens out</div>`
      : `<div class="small muted">No agent sessions found for this project. The brief will be built from what StackRadar knows about it.</div>`}
    <div class="pill-row" style="margin-top:8px">
      <select class="sel-inline" id="trAgent" aria-label="agent"><option>loading…</option></select>
      <input class="search-in" id="trModel" list="trModels" placeholder="model (optional)" style="width:190px"><datalist id="trModels"></datalist>
      <button class="btn primary small" id="trGo">⇢ Create hand-off</button></div>`;
  body.insertBefore(wrap, body.children[1] || null);
  if (!TR.opts) TR.opts = await api("/api/transfer/options");
  const sel = $("#trAgent", wrap);
  sel.innerHTML = (TR.opts.agents || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.installed ? "" : " (not installed)"}</option>`).join("");
  const fillModels = () => { const a = (TR.opts.agents || []).find(x => x.id === sel.value); $("#trModels", wrap).innerHTML = ((a && a.models) || []).map(m => `<option value="${esc(m)}">`).join(""); };
  sel.onchange = fillModels; fillModels();
  $("#trGo", wrap).onclick = async () => {
    const j = await api("/api/transfer", { path: p.path, agent: sel.value, model: $("#trModel", wrap).value.trim() });
    if (!j.ok) return toast(esc(j.error), "err");
    handoffModal({ file: j.file, brief: j.brief, commands: { [(sel.options[sel.selectedIndex] || {}).text + (j.installed ? "" : " (install it first)")]: j.command } }, p.path);
    const info = document.createElement("div"); info.className = "small muted"; info.textContent = "Built from: " + j.source;
    $("#modalBox").insertBefore(info, $("#modalBox").children[1]);
  };
}
window.transferPanel = transferPanel;

/* ---------------- themes: light / dark / auto, presets, every color editable ---------------- */

const THEME_TOKENS = [
  ["Surfaces", ["--bg", "--bg2", "--panel", "--panel2", "--glow", "--code-bg"]],
  ["Text", ["--text", "--dim", "--faint"]],
  ["Lines", ["--line", "--line-soft"]],
  ["Accents", ["--blue", "--cyan", "--green", "--amber", "--red", "--purple", "--pink", "--gray"]],
  ["Text on tinted badges", ["--t-blue", "--t-cyan", "--t-green", "--t-amber", "--t-red", "--t-purple", "--t-pink", "--t-gray"]],
  ["Buttons", ["--btn-primary", "--btn-primary-line", "--btn-ok", "--btn-ok-line", "--btn-danger", "--btn-danger-line"]],
  ["Bars & overlays", ["--chrome", "--chrome2", "--overlay", "--backdrop"]],
  ["Console & graphs", ["--console-bg", "--console-text", "--canvas-bg"]],
];
const THEME_PRESETS = {
  midnight: { kind: "dark", label: "Midnight (default)", tokens: {} },
  dracula: { kind: "dark", label: "Dracula", tokens: { "--bg": "#282a36", "--bg2": "#21222c", "--panel": "#2f3140", "--panel2": "#363848", "--line": "#44475a", "--text": "#f8f8f2", "--dim": "#a5a9c3", "--faint": "#6272a4",
    "--green": "#50fa7b", "--red": "#ff5555", "--amber": "#f1fa8c", "--blue": "#6c9cff", "--purple": "#bd93f9", "--cyan": "#8be9fd", "--pink": "#ff79c6", "--glow": "#3a3c4e", "--code-bg": "#21222c", "--btn-primary": "#6c4fd7", "--btn-primary-line": "#8b6ff0" } },
  nord: { kind: "dark", label: "Nord", tokens: { "--bg": "#2e3440", "--bg2": "#2b303b", "--panel": "#3b4252", "--panel2": "#434c5e", "--line": "#4c566a", "--text": "#eceff4", "--dim": "#aab4c6", "--faint": "#6c7a92",
    "--green": "#a3be8c", "--red": "#bf616a", "--amber": "#ebcb8b", "--blue": "#81a1c1", "--purple": "#b48ead", "--cyan": "#88c0d0", "--pink": "#d08770", "--glow": "#3b4252", "--code-bg": "#2b303b", "--btn-primary": "#5e81ac", "--btn-primary-line": "#81a1c1" } },
  contrast: { kind: "dark", label: "High contrast", tokens: { "--bg": "#000000", "--bg2": "#0a0a0a", "--panel": "#0f0f0f", "--panel2": "#1a1a1a", "--line": "#6a6a6a", "--line-soft": "rgba(160,160,160,.45)", "--text": "#ffffff", "--dim": "#d6d6d6", "--faint": "#a8a8a8",
    "--green": "#3dffb0", "--red": "#ff4d6d", "--amber": "#ffd23f", "--blue": "#66b3ff", "--purple": "#d0a2ff", "--cyan": "#4de8ff", "--pink": "#ff8ad8", "--glow": "#000000", "--code-bg": "#0a0a0a" } },
  daylight: { kind: "light", label: "Daylight (default)", tokens: {} },
  solarized: { kind: "light", label: "Solarized light", tokens: { "--bg": "#fdf6e3", "--bg2": "#f5efdc", "--panel": "#fffbf0", "--panel2": "#eee8d5", "--line": "#e0d8c0", "--text": "#3c4a52", "--dim": "#657b83", "--faint": "#93a1a1",
    "--green": "#859900", "--red": "#dc322f", "--amber": "#b58900", "--blue": "#268bd2", "--purple": "#6c71c4", "--cyan": "#2aa198", "--pink": "#d33682", "--glow": "#f5e9c9", "--code-bg": "#eee8d5",
    "--t-green": "#5b6b00", "--t-red": "#a8231f", "--t-amber": "#7d5e00", "--t-blue": "#1a659e", "--t-purple": "#4b4f9a", "--t-cyan": "#1c7770", "--t-pink": "#a0255f" } },
  paper: { kind: "light", label: "Paper (high contrast)", tokens: { "--bg": "#ffffff", "--bg2": "#f7f7f7", "--panel": "#ffffff", "--panel2": "#f2f2f2", "--line": "#9a9a9a", "--text": "#000000", "--dim": "#333333", "--faint": "#666666", "--glow": "#ffffff" } },
};
const THEME_BASE = {
  dark: { "--bg": "#0b0e14", "--bg2": "#0f131c", "--panel": "#121826", "--panel2": "#171f30", "--line": "#223049", "--line-soft": "rgba(34,48,73,.55)", "--text": "#e8ecf5", "--dim": "#8b97ad", "--faint": "#5a6578",
    "--green": "#2dd4a7", "--red": "#f4536e", "--amber": "#f5b342", "--blue": "#4d9fff", "--purple": "#b478ff", "--cyan": "#39c5e0", "--pink": "#ff6fb3", "--gray": "#6b7688",
    "--t-green": "#9ff0d8", "--t-red": "#ffb3c0", "--t-amber": "#ffd98d", "--t-blue": "#a8ceff", "--t-purple": "#d9b8ff", "--t-cyan": "#a5ecf7", "--t-pink": "#ffc0da", "--t-gray": "#b6c0d0",
    "--glow": "#14203a", "--chrome": "rgba(10,13,20,.85)", "--chrome2": "rgba(10,13,20,.55)", "--overlay": "rgba(10,13,20,.9)", "--backdrop": "rgba(5,7,12,.7)",
    "--code-bg": "#0a0f18", "--console-bg": "#04060c", "--console-text": "#cfe3ff", "--canvas-bg": "#070a12",
    "--btn-primary": "#1c4fd7", "--btn-primary-line": "#2a63e8", "--btn-danger": "#571a26", "--btn-danger-line": "#8b2a3c", "--btn-ok": "#123c30", "--btn-ok-line": "#1d5c4a" },
  light: { "--bg": "#f5f7fb", "--bg2": "#eef2f8", "--panel": "#ffffff", "--panel2": "#f3f6fb", "--line": "#d6dde9", "--line-soft": "rgba(120,140,170,.28)", "--text": "#1a2233", "--dim": "#5b6779", "--faint": "#8a95a8",
    "--green": "#0f9d74", "--red": "#d6304f", "--amber": "#b7791f", "--blue": "#2563eb", "--purple": "#7c4ddb", "--cyan": "#0e8fa8", "--pink": "#c73b80", "--gray": "#6b7688",
    "--t-green": "#0b6b50", "--t-red": "#a51f3a", "--t-amber": "#8a5a0c", "--t-blue": "#1d4ed8", "--t-purple": "#5b33b0", "--t-cyan": "#0b6b80", "--t-pink": "#9b2a62", "--t-gray": "#4a5568",
    "--glow": "#dbe6ff", "--chrome": "rgba(255,255,255,.88)", "--chrome2": "rgba(255,255,255,.65)", "--overlay": "rgba(255,255,255,.96)", "--backdrop": "rgba(20,30,50,.35)",
    "--code-bg": "#eef2f8", "--console-bg": "#0f1420", "--console-text": "#d7e6ff", "--canvas-bg": "#0b1020",
    "--btn-primary": "#2563eb", "--btn-primary-line": "#1d4ed8", "--btn-danger": "#fde2e7", "--btn-danger-line": "#f2a3b3", "--btn-ok": "#dcf5ec", "--btn-ok-line": "#9fdcc6" },
};
function themeCfg() { return Object.assign({ dark: "midnight", light: "daylight", overrides: {}, custom_presets: {} }, SETTINGS.theme_custom || {}); }
function allPresets() { return Object.assign({}, THEME_PRESETS, themeCfg().custom_presets || {}); }
function themeMode() {
  const m = SETTINGS.theme || "dark";
  return m === "auto" ? (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : m;
}
function resolveTheme(kind, presetName, extra) {
  const cfg = themeCfg(), P = allPresets();
  const name = presetName || cfg[kind];
  const pr = P[name] && P[name].kind === kind ? P[name] : P[kind === "light" ? "daylight" : "midnight"];
  return { kind, preset: name, tokens: Object.assign({}, THEME_BASE[kind], pr.tokens || {}, (cfg.overrides || {})[name] || {}, extra || {}) };
}
function applyTheme(t) {
  t = t || resolveTheme(themeMode());
  const r = document.documentElement;
  r.dataset.theme = t.kind; r.style.colorScheme = t.kind;
  Object.entries(t.tokens).forEach(([k, v]) => r.style.setProperty(k, v));
  try { localStorage.setItem("stackradar.theme", JSON.stringify(t)); } catch (_) {}
}
window.applyTheme = applyTheme;
if (window.matchMedia) matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (SETTINGS.theme === "auto") applyTheme(); });
function toHex(v) {
  const m = String(v).match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return "#" + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + v.slice(1).split("").map(x => x + x).join("");
  return /^#[0-9a-f]{6}/i.test(v) ? v.slice(0, 7) : "#000000";
}
function themeEditor() {
  const cfg = themeCfg();
  const kind = themeMode();
  let preset = cfg[kind], work = Object.assign({}, (cfg.overrides || {})[preset] || {});
  const draw = () => {
    const P = allPresets(), t = resolveTheme(kind, preset, work);
    modal(`<h3>Appearance</h3>
      <div class="set-row"><div><b>Mode</b><div class="small muted">Auto follows your OS light / dark setting</div></div>
        <div class="seg" id="thMode">${["dark", "light", "auto"].map(m => `<button data-m="${m}" class="${(SETTINGS.theme || "dark") === m ? "active" : ""}">${{ dark: "🌙 Dark", light: "☀ Light", auto: "◐ Auto" }[m]}</button>`).join("")}</div></div>
      <h4 class="set-h">${kind === "light" ? "Light" : "Dark"} theme</h4>
      <div class="theme-grid">${Object.entries(P).filter(([, p]) => p.kind === kind).map(([k, p]) => { const tt = resolveTheme(kind, k).tokens; return `<button class="theme-card ${k === preset ? "sel" : ""}" data-pre="${esc(k)}" style="background:${tt["--bg"]};color:${tt["--text"]};border-color:${k === preset ? tt["--cyan"] : tt["--line"]}">
        <span class="tc-name">${esc(p.label)}</span><span class="tc-dots">${["--blue", "--cyan", "--green", "--amber", "--red", "--purple"].map(c => `<i style="background:${tt[c]}"></i>`).join("")}</span></button>`; }).join("")}</div>
      <details ${Object.keys(work).length ? "open" : ""}><summary class="small"><b>Edit every color</b> ${Object.keys(work).length ? `<span class="badge b-amber">${Object.keys(work).length} changed</span>` : ""}</summary>
        ${THEME_TOKENS.map(([g, ks]) => `<div class="small muted" style="margin:10px 0 4px">${esc(g)}</div><div class="tok-grid">${ks.map(k => `<label class="tok" title="${k}">
          <input type="color" data-tok="${k}" value="${toHex(t.tokens[k])}"><span>${k.replace(/^--/, "")}</span>${work[k] ? `<button class="mini-btn" data-untok="${k}" title="back to the preset">↺</button>` : ""}</label>`).join("")}</div>`).join("")}
      </details>
      <div class="pill-row" style="margin-top:12px">
        <button class="btn small" id="thExport">⬇ Export theme</button>
        <label class="btn small" style="cursor:pointer">⬆ Import theme<input type="file" id="thImport" accept=".json,application/json" hidden></label>
        <button class="btn small" id="thSaveAs">Save as new preset…</button>
        <button class="btn small" id="thReset" ${Object.keys(work).length ? "" : "disabled"}>Reset changes</button></div>
      <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="thSave">Save</button></div>`);
    applyTheme(t);
    $("#mCancel").onclick = () => { closeModal(); applyTheme(); };
    $$("#thMode button").forEach(b => b.onclick = async () => { await saveSettings({ theme: b.dataset.m }); SETTINGS.theme = b.dataset.m; applyTheme(); themeEditor(); });
    $$("[data-pre]").forEach(b => b.onclick = () => { preset = b.dataset.pre; work = Object.assign({}, (themeCfg().overrides || {})[preset] || {}); draw(); });
    $$("[data-tok]").forEach(inp => inp.oninput = () => { work[inp.dataset.tok] = inp.value; applyTheme(resolveTheme(kind, preset, work)); });
    $$("[data-tok]").forEach(inp => inp.onchange = () => draw());
    $$("[data-untok]").forEach(b => b.onclick = e => { e.preventDefault(); delete work[b.dataset.untok]; draw(); });
    $("#thReset").onclick = () => { work = {}; draw(); };
    $("#thExport").onclick = () => {
      const tt = resolveTheme(kind, preset, work);
      const blob = new Blob([JSON.stringify({ stackradar_theme: 1, name: (allPresets()[preset] || {}).label || preset, kind, tokens: tt.tokens }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "stackradar-theme-" + preset + ".json"; a.click(); URL.revokeObjectURL(a.href);
    };
    $("#thImport").onchange = async e => {
      try {
        const j = JSON.parse(await e.target.files[0].text());
        if (!j.tokens || !["dark", "light"].includes(j.kind)) throw new Error("not a StackRadar theme file");
        const c = themeCfg(); const id = "custom-" + Date.now().toString(36);
        c.custom_presets = Object.assign({}, c.custom_presets, { [id]: { kind: j.kind, label: String(j.name || "Imported").slice(0, 40), tokens: j.tokens } });
        c[j.kind] = id;
        await saveSettings({ theme_custom: c, theme: j.kind }); SETTINGS.theme_custom = c; SETTINGS.theme = j.kind;
        toast("theme imported", "ok"); applyTheme(); themeEditor();
      } catch (err) { toast(esc(err.message || "couldn't read that file"), "err"); }
    };
    $("#thSaveAs").onclick = async () => {
      const name = prompt("Name for your preset:", "My theme"); if (!name) return;
      const c = themeCfg(), id = "custom-" + Date.now().toString(36);
      c.custom_presets = Object.assign({}, c.custom_presets, { [id]: { kind, label: name.slice(0, 40), tokens: resolveTheme(kind, preset, work).tokens } });
      c[kind] = id;
      await saveSettings({ theme_custom: c }); SETTINGS.theme_custom = c; preset = id; work = {}; draw();
    };
    $("#thSave").onclick = async () => {
      const c = themeCfg();
      c[kind] = preset;
      c.overrides = Object.assign({}, c.overrides, { [preset]: work });
      await saveSettings({ theme_custom: c }); SETTINGS.theme_custom = c;
      applyTheme(); closeModal(); toast("theme saved", "ok");
    };
  };
  draw();
}
window.themeEditor = themeEditor;
(function () {
  const orig = window.openSettings || (typeof openSettings === "function" ? openSettings : null);
  if (!orig) return;
  window.openSettings = function () {
    orig();
    const box = $("#modalBox");
    if (box && !$("#setTheme", box)) {
      const row = document.createElement("div");
      row.className = "set-row";
      row.innerHTML = `<div><b>Appearance</b><div class="small muted">dark / light / auto, presets, every color, import / export</div></div>
        <div class="pill-row"><button class="btn small" id="setThemeToggle">${themeMode() === "light" ? "🌙 Dark" : "☀ Light"}</button><button class="btn small" id="setTheme">🎨 Customize…</button></div>`;
      box.insertBefore(row, box.children[1]);
      $("#setTheme").onclick = themeEditor;
      $("#setThemeToggle").onclick = async () => { const m = themeMode() === "light" ? "dark" : "light"; await saveSettings({ theme: m }); SETTINGS.theme = m; applyTheme(); closeModal(); };
    }
  };
})();
