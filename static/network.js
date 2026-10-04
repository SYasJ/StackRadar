/* StackRadar — Network Guard tab: live signal radar, who-talks-to-whom, allow/deny prompts,
   security levels, code map (which file calls which host), rules, OS firewall blocks. */
"use strict";

Object.assign(HINTS, {
  network: "Every app that talks to the internet: where it connects, how much it sends ↑ and receives ↓, which file in your code points at that host, and whether sensitive data is involved. Apps started from StackRadar run behind the guard, so you can allow or deny each new destination.",
  net_level: "Low: allow everything, just log it. Medium: trusted dev hosts and hosts your own code references go through, anything new asks you (allowed after 25 s if you don't answer). Strict: only what you allowed goes through, everything else asks (denied after 45 s), and plain-HTTP requests carrying secrets are always blocked.",
  net_radar: "Live signal radar. Inner ring = your apps, outer ring = the hosts they talk to, grouped by kind (AI, cloud, payments, tracking …). Cyan dots flying out = data sent ↑, green dots flying in = data received ↓. Red = blocked, amber = waiting for your answer.",
  net_conns: "Open connections right now, from every process on this machine. 'From' is the script the process runs and the source line that references this host.",
  net_guarded: "Connections that went through the guard proxy (apps started from StackRadar's Runs tab). These are the ones StackRadar can actually allow or block.",
  net_code: "What your code is wired to talk to, found statically: URLs in the source and SDKs in your dependencies (stripe → api.stripe.com …). Flags plain HTTP, credentials near the call, tracking, and secrets going to unknown hosts.",
  net_rules: "Your allow / deny decisions. App-specific rules beat global ones. Rules are stored in ~/.stackradar/network-rules.json.",
  net_events: "Everything the guard decided, newest first.",
  archives: "Archived projects compressed to one file in ~/.stackradar/archives. Regenerable folders (node_modules, .venv, build caches) are left out. Restore unpacks it next to where it was.",
});

const CAT = {
  ai: { c: "#c98500", label: "AI", icon: "✦" }, cloud: { c: "#3987e5", label: "cloud", icon: "☁" },
  payments: { c: "#d95926", label: "payments", icon: "$" }, telemetry: { c: "#d55181", label: "tracking", icon: "◉" },
  registry: { c: "#199e70", label: "registry", icon: "▣" }, vcs: { c: "#9aa6bd", label: "git", icon: "⎇" },
  cdn: { c: "#6f7f9c", label: "CDN", icon: "≋" }, unknown: { c: "#9085e9", label: "unknown", icon: "?" },
  lan: { c: "#4a8f6a", label: "local network", icon: "⌂" }, local: { c: "#4a8f6a", label: "this machine", icon: "⌂" },
};
const OUT_C = "#39c5e0", IN_C = "#2dd4a7", BLOCK_C = "#d03b3b", WAIT_C = "#fab219";
const NETS = { data: null, poll: null, pend: null, focusHost: "", scope: "", R: { nodes: new Map(), t0: performance.now(), raf: null, hover: null } };

function catOf(c) { return CAT[c] || CAT.unknown; }
function rateTxt(b) { return b == null ? "—" : (b < 1 ? "0 KB/s" : fmtBytes(b) + "/s"); }
function totTxt(b) { return b == null ? "—" : fmtBytes(Math.round(b)); }

/* ---------------- polling: tab data + global prompts ---------------- */

async function netPoll() {
  try { NETS.data = await api("/api/network"); } catch (_) { return; }
  if (S.tab === "network") renderNetworkBody();
}
async function pendPoll() {
  if (!featureOn("network")) return;
  let j;
  try { j = await api("/api/network/pending"); } catch (_) { return; }
  renderShield(j.level, (j.pending || []).length);
  renderPrompts(j.pending || []);
}
function renderShield(level, n) {
  const el = $("#shieldBtn");
  if (!el) return;
  el.hidden = !featureOn("network");
  el.className = "shield shield-" + (level || "medium") + (n ? " has-pending" : "");
  el.innerHTML = `🛡 <span>${esc(level || "medium")}</span>${n ? `<b>${n}</b>` : ""}`;
  el.title = `Network Guard: ${level}${n ? ` · ${n} app(s) waiting for your answer` : ""}`;
}

/* ---------------- allow / deny prompts (any tab) ---------------- */

function renderPrompts(list) {
  let box = $("#netPrompts");
  if (!box) { box = document.createElement("div"); box.id = "netPrompts"; document.body.appendChild(box); }
  const ids = new Set(list.map(p => p.id));
  $$(".np-card", box).forEach(c => { if (!ids.has(c.dataset.id)) c.remove(); });
  list.forEach(p => {
    let card = box.querySelector(`.np-card[data-id="${p.id}"]`);
    const cat = catOf(p.category);
    if (!card) {
      card = document.createElement("div");
      card.className = "np-card"; card.dataset.id = p.id;
      card.innerHTML = `
        <div class="np-top"><span class="np-shield">🛡</span><div>
          <div class="np-title"><b>${esc(p.app)}</b> wants to connect</div>
          <div class="np-host"><span class="np-dot" style="background:${cat.c}">${cat.icon}</span><b class="mono">${esc(p.host)}:${p.port}</b>
            ${p.service ? `<span class="badge b-gray">${esc(p.service)}</span>` : ""} <span class="badge" style="color:${cat.c};border-color:${cat.c}">${esc(cat.label)}</span></div></div></div>
        ${p.ref ? `<div class="np-from">from <span class="mono">${esc(p.ref.file || "")}${p.ref.line ? ":" + p.ref.line : ""}</span> <span class="muted mono">${esc((p.ref.snippet || "").slice(0, 70))}</span></div>`
                : `<div class="np-from warn">⚠ no file in this project references this host</div>`}
        ${(p.sensitive || []).length ? `<div class="np-from danger">⚠ request carries: ${p.sensitive.map(s => esc(s.type)).join(", ")}</div>` : ""}
        <div class="np-bar"><div></div></div>
        <div class="np-actions">
          <button class="btn ok small" data-d="allow_once">Allow once</button>
          <button class="btn small" data-d="allow_always">Always allow</button>
          <button class="btn danger small" data-d="deny_once">Deny</button>
          <button class="btn danger small" data-d="deny_always">Always deny</button>
        </div>
        <div class="np-foot muted small">${esc(p.level)} mode · <span class="np-rem"></span></div>`;
      $$("[data-d]", card).forEach(b => b.onclick = async () => {
        card.classList.add("np-done");
        const j = await api("/api/network/decide", { id: p.id, decision: b.dataset.d });
        if (!j.ok) toast(esc(j.error || "too late"), "err");
        else toast(`${b.dataset.d.startsWith("allow") ? "✓ allowed" : "⛔ denied"} <b>${esc(p.host)}</b> for ${esc(p.app)}`, b.dataset.d.startsWith("allow") ? "ok" : "err");
        setTimeout(() => card.remove(), 250);
        netPoll();
      });
      box.appendChild(card);
    }
    const frac = Math.max(0, Math.min(1, p.remaining / p.timeout));
    card.querySelector(".np-bar div").style.width = (frac * 100) + "%";
    card.querySelector(".np-rem").textContent = `${p.remaining}s left, then ${p.level === "strict" ? "denied" : "allowed"} automatically`;
  });
}

/* ---------------- the tab ---------------- */

function renderNetwork() {
  const el = $("#tab-network");
  if (!el.querySelector("#netRadar")) {
    el.innerHTML = `
    <h2 class="tab-title">Network Guard — who talks to the internet ${hint("network")}</h2>
    ${tabHint("network")}
    <div class="net-head">
      <div class="seg net-level" id="netLevel" role="group" aria-label="security level">
        <button data-l="low">◌ Low</button><button data-l="medium">◐ Medium</button><button data-l="strict">● Strict</button>
      </div>${hint("net_level")}
      <label class="switch" title="route apps started from StackRadar through the guard"><input type="checkbox" id="netGuardRuns"><span class="slider"></span><span class="switch-label">Guard StackRadar runs</span></label>
      <span class="muted small" id="netLevelTxt"></span>
      <span class="spacer"></span>
      <label class="small" for="netScope">Show</label>
      <select class="sel-inline" id="netScope" aria-label="project, app or repo"></select>
    </div>
    <div id="netScopePanel"></div>
    <div class="grid cards" id="netCards" style="margin:12px 0 14px"></div>
    <div class="grid net-main">
      <div class="panel net-radar-panel"><h3>Signal radar ${hint("net_radar")} <span class="spacer"></span>
          <span class="legend-inline"><i style="background:${OUT_C}"></i>↑ sending <i style="background:${IN_C}"></i>↓ receiving <i style="background:${BLOCK_C}"></i>blocked <i style="background:${WAIT_C}"></i>asking</span></h3>
        <div class="net-radar-wrap"><canvas id="netRadar"></canvas><div id="netTip" class="gtooltip" hidden></div></div>
      </div>
      <div class="panel"><h3>Apps online</h3><div id="netApps"></div></div>
    </div>
    <div class="panel"><h3>Live connections ${hint("net_conns")} <span class="spacer"></span><input class="search-in" id="netQ" placeholder="filter host / app…"></h3><div id="netConns"></div></div>
    <div class="grid" style="grid-template-columns: 1fr 1fr">
      <div class="panel"><h3>Guarded traffic ${hint("net_guarded")}</h3><div id="netGuarded"></div></div>
      <div class="panel"><h3>Guard log ${hint("net_events")} <span class="spacer"></span><button class="btn small" id="netClearLog">Clear</button></h3><div id="netEvents" class="net-events"></div></div>
    </div>
    <div class="panel"><h3>Code map — what your code talks to ${hint("net_code")}</h3><div id="netCode"></div></div>
    <div class="panel"><h3>Rules ${hint("net_rules")} <span class="spacer"></span>
      <input class="search-in" id="ruleHost" placeholder="host or *.domain" style="width:180px">
      <select class="sel-inline" id="ruleAct"><option value="deny">deny</option><option value="allow">allow</option></select>
      <button class="btn small" id="ruleAdd">+ add global rule</button></h3><div id="netRules"></div></div>`;
    $$("#netLevel button").forEach(b => b.onclick = async () => {
      await api("/api/network/level", { net_level: b.dataset.l });
      toast("Network Guard: <b>" + b.dataset.l + "</b>", "ok"); netPoll(); pendPoll();
    });
    $("#netGuardRuns").onchange = async e => { await api("/api/network/level", { guard_runs: e.target.checked }); netPoll(); };
    $("#netQ").oninput = e => { NETS.focusHost = e.target.value.toLowerCase(); renderNetworkBody(); };
    $("#netScope").onchange = e => { NETS.scope = e.target.value; renderNetworkBody(); };
    $("#netClearLog").onclick = async () => { await api("/api/network/clear-log", {}); netPoll(); };
    $("#ruleAdd").onclick = async () => {
      const j = await api("/api/network/rules", { host: $("#ruleHost").value, action: $("#ruleAct").value, app: "*" });
      if (j.ok) { toast("rule added", "ok"); $("#ruleHost").value = ""; netPoll(); } else toast(esc(j.error), "err");
    };
    radarInit();
  }
  netPoll();
  clearInterval(NETS.poll);
  NETS.poll = setInterval(() => { if (S.tab === "network") netPoll(); else { clearInterval(NETS.poll); NETS.poll = null; } }, 2000);
}

function renderNetworkBody() {
  const d = NETS.data;
  if (!d || !$("#netCards")) return;
  $$("#netLevel button").forEach(b => b.classList.toggle("active", b.dataset.l === d.level));
  $("#netGuardRuns").checked = !!d.guard_runs;
  $("#netLevelTxt").textContent = { low: "logging only — nothing is blocked", medium: "new destinations ask you · allowed after 25 s",
    strict: "only allowed destinations · everything else denied after 45 s" }[d.level] + (d.proxy_port ? ` · guard proxy 127.0.0.1:${d.proxy_port}` : "");
  // scope: one project / app / repo, or everything
  const sc = NETS.scope, scopeObj = (d.scopes || []).find(x => x.path === sc);
  const sel = $("#netScope");
  if (sel && sel.dataset.n !== String((d.scopes || []).length)) {
    const groups = { repo: "Repos", app: "Apps", project: "Projects" };
    sel.innerHTML = `<option value="">All apps & projects</option>` + Object.entries(groups).map(([k, label]) => {
      const xs = (d.scopes || []).filter(x => x.kind === k);
      return xs.length ? `<optgroup label="${label}">${xs.map(x => `<option value="${esc(x.path)}">${esc(x.name)}${x.refs ? " · " + x.refs + " hosts in code" : ""}</option>`).join("")}</optgroup>` : "";
    }).join("");
    sel.dataset.n = String((d.scopes || []).length);
  }
  if (sel) sel.value = sc;
  const inScope = c => !sc || c.project_path === sc;
  renderScopePanel(d, scopeObj);
  const C = (d.connections || []).filter(inScope);
  const appsIn = (d.apps || []).filter(a => !sc || a.project_path === sc);
  const ext = C.filter(c => !["local"].includes(c.category));
  const rin = C.reduce((a, c) => a + (c.rate_in || 0), 0), rout = C.reduce((a, c) => a + (c.rate_out || 0), 0);
  const since = Date.now() / 1000 - 86400;
  const blocked = (d.events || []).filter(e => e.kind === "blocked" && e.t > since).length;
  const sens = (d.alerts || []).filter(e => e.kind === "sensitive" || e.kind === "exfil").length;
  const risky = (d.static_refs || []).filter(r => r.risk === "high").length;
  $("#netCards").innerHTML = `
    <div class="card"><div class="k">Apps online</div><div class="v" style="color:var(--cyan)">${(d.apps || []).length}</div><div class="s">${ext.length} external connections</div></div>
    <div class="card"><div class="k">Sent ↑</div><div class="v" style="color:${OUT_C}">${totTxt(sc ? appsIn.reduce((a, x) => a + (x.total_out || 0), 0) : d.total_out)}</div><div class="s">${rateTxt(rout)} now · since ${new Date(d.totals_since * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div>
    <div class="card"><div class="k">Received ↓</div><div class="v" style="color:${IN_C}">${totTxt(sc ? appsIn.reduce((a, x) => a + (x.total_in || 0), 0) : d.total_in)}</div><div class="s">${d.os === "Linux" || d.os === "Darwin" ? rateTxt(rin) + " now" : "per-app bytes: guarded runs only on Windows"}</div></div>
    <div class="card"><div class="k">Blocked (24 h)</div><div class="v" style="color:${blocked ? BLOCK_C : "var(--green)"}">${blocked}</div><div class="s">by rules or your answers</div></div>
    <div class="card"><div class="k">Sensitive data</div><div class="v" style="color:${sens ? BLOCK_C : "var(--green)"}">${sens}</div><div class="s">secrets / PII seen in traffic</div></div>
    <div class="card"><div class="k">Risky code paths</div><div class="v" style="color:${risky ? WAIT_C : "var(--green)"}">${risky}</div><div class="s">credentials over HTTP, unknown hosts</div></div>`;
  // apps
  const maxR = Math.max(1, ...appsIn.map(a => a.rate_in + a.rate_out));
  $("#netApps").innerHTML = appsIn.slice(0, 14).map((a, ai) => `
    <div class="net-app clickable" data-app="${ai}" title="click for details and actions">
      <div class="net-app-top"><b>${esc(a.name)}</b> ${a.project ? badge("📦 project", "b-purple") : ""} ${a.guarded || a.managed ? badge("🛡 guarded", "b-cyan") : ""}
        <span class="spacer"></span><span class="mono small" style="color:${OUT_C}" title="sent: ${totTxt(a.total_out)} total">↑ ${rateTxt(a.rate_out)} · ${totTxt(a.total_out)}</span> <span class="mono small" style="color:${IN_C}" title="received: ${totTxt(a.total_in)} total">↓ ${rateTxt(a.rate_in)} · ${totTxt(a.total_in)}</span></div>
      <div class="net-bars"><div style="width:${100 * a.rate_out / maxR}%;background:${OUT_C}"></div><div style="width:${100 * a.rate_in / maxR}%;background:${IN_C}"></div></div>
      <div class="small muted">${a.conns} conn · ${esc((a.hosts || []).slice(0, 3).join(", "))}${(a.hosts || []).length > 3 ? " …" : ""}${a.entry ? ` · runs <span class="mono">${esc(a.entry)}</span>` : ""}</div>
      ${(a.flags || []).length ? `<div>${a.flags.map(f => badge("⚠ " + f, f === "deny rule" ? "b-red" : "b-amber")).join(" ")}</div>` : ""}
    </div>`).join("") || `<div class="muted small">${sc ? "this project isn't talking to the network right now" : "no app is talking to the network right now"}</div>`;
  $$("#netApps [data-app]").forEach(el => el.onclick = () => appDetail(appsIn[+el.dataset.app]));
  // connections table
  const q = NETS.focusHost;
  const grouped = new Map();
  C.filter(c => c.category !== "local").forEach(c => {
    const k = [c.pid, c.host || c.remote_ip, c.remote_port].join("|");
    const g = grouped.get(k);
    if (g) { g.n++; g.rate_in = (g.rate_in || 0) + (c.rate_in || 0); g.rate_out = (g.rate_out || 0) + (c.rate_out || 0); }
    else grouped.set(k, Object.assign({ n: 1 }, c));
  });
  const rows = [...grouped.values()].filter(c => !q || ((c.host || "") + c.remote_ip + (c.project || "") + (c.proc || "") + (c.service || "")).toLowerCase().includes(q));
  $("#netConns").innerHTML = rows.length ? `<table><tr><th>app</th><th>destination</th><th>kind</th><th style="text-align:right">↑ out (now · total)</th><th style="text-align:right">↓ in (now · total)</th><th>from (code)</th><th>flags</th><th></th></tr>
    ${rows.slice(0, 120).map((c, i) => {
      const cat = catOf(c.category);
      const flags = [];
      if (c.ref && c.ref.carries_secret) flags.push(badge("🔑 credentials", "b-amber"));
      if (c.category === "telemetry") flags.push(badge("◉ tracking", "b-pink"));
      if (c.remote_port === 80) flags.push(badge("plain HTTP", "b-red"));
      if (c.rule === "deny") flags.push(badge("⛔ deny rule", "b-red"));
      if (c.rule === "allow") flags.push(badge("✓ allowed", "b-green"));
      return `<tr class="clickable" data-crow="${i}" title="click for details">
        <td><b>${esc(c.project || c.proc || "?")}</b><div class="sub mono">pid ${c.pid || "?"}${c.managed ? " · 🛡" : ""}</div></td>
        <td><span class="mono">${esc(c.host || c.remote_ip)}</span>:${c.remote_port}${c.n > 1 ? ` <span class="badge b-gray">×${c.n}</span>` : ""}${c.host ? `<div class="sub mono">${esc(c.remote_ip)}</div>` : ""}</td>
        <td><span class="badge" style="color:${cat.c};border-color:${cat.c}">${cat.icon} ${esc(c.service || cat.label)}</span></td>
        <td class="mono" style="text-align:right;color:${OUT_C}" data-v="${c.total_out != null ? c.total_out : (c.rate_out || 0)}">${rateTxt(c.rate_out)}<div class="sub">${c.total_out != null ? totTxt(c.total_out) + " total" : c.proc_total_out != null ? totTxt(c.proc_total_out) + " (whole app)" : ""}</div></td>
        <td class="mono" style="text-align:right;color:${IN_C}" data-v="${c.total_in != null ? c.total_in : (c.rate_in || 0)}">${rateTxt(c.rate_in)}<div class="sub">${c.total_in != null ? totTxt(c.total_in) + " total" : c.proc_total_in != null ? totTxt(c.proc_total_in) + " (whole app)" : ""}</div></td>
        <td class="small">${c.ref ? `<span class="mono">${esc(c.ref.file || "")}${c.ref.line ? ":" + c.ref.line : ""}</span><div class="sub mono">${esc((c.ref.snippet || "").slice(0, 60))}</div>` : (c.entry ? `<span class="mono">${esc(c.entry)}</span>` : '<span class="muted">—</span>')}</td>
        <td>${flags.join(" ")}</td>
        <td style="white-space:nowrap"><button class="mini-btn" data-ca="allow" data-i="${i}" title="always allow">✓</button><button class="mini-btn" data-ca="deny" data-i="${i}" title="always deny">⛔</button><button class="mini-btn" data-ca="os" data-i="${i}" title="block at the OS firewall">🧱</button></td></tr>`;
    }).join("")}</table>` : `<div class="muted small">no external connections${q ? " match" : ""} right now</div>`;
  $$("#netConns [data-ca]").forEach(b => b.onclick = e => { e.stopPropagation(); connAction(rows[+b.dataset.i], b.dataset.ca); });
  $$("#netConns [data-crow]").forEach(tr => tr.onclick = () => connDetail(rows[+tr.dataset.crow]));
  // guarded traffic
  const proxied = (d.proxied || []).filter(p => !scopeObj || p.app === scopeObj.name);
  $("#netGuarded").innerHTML = proxied.length ? `<table><tr><th>app</th><th>host</th><th style="text-align:right">↑</th><th style="text-align:right">↓</th><th></th></tr>
    ${proxied.slice(0, 30).map(p => `<tr><td>${esc(p.app)}</td><td class="mono small">${esc(p.host)}:${p.port}${(p.sensitive || []).length ? " " + badge("⚠ " + p.sensitive.join(", "), "b-red") : ""}</td>
      <td class="mono small" style="text-align:right;color:${OUT_C}">${fmtBytes(p.bytes_out)}</td><td class="mono small" style="text-align:right;color:${IN_C}">${fmtBytes(p.bytes_in)}</td>
      <td>${p.open ? '<span class="dot open"></span>' : '<span class="dot closed"></span>'}</td></tr>`).join("")}</table>`
    : `<div class="muted small">Nothing yet. Start a project from the <b>Runs</b> tab and its HTTP(S) traffic goes through the guard.</div>`;
  // events
  const icon = { allowed: "✓", blocked: "⛔", prompt: "❓", sensitive: "⚠", violation: "‼", exfil: "📤", error: "✗" };
  $("#netEvents").innerHTML = (d.events || []).filter(e => !scopeObj || e.app === scopeObj.name).slice(0, 60).map(e => `<div class="ne ne-${e.kind}"><span class="ne-i">${icon[e.kind] || "·"}</span>
    <span class="muted small mono">${new Date(e.t * 1000).toLocaleTimeString()}</span> <b>${esc(e.app || "")}</b> → <span class="mono">${esc(e.host || "")}${e.port ? ":" + e.port : ""}</span>
    <span class="muted small">${esc(e.reason || e.detail || e.kind)}</span></div>`).join("") || `<div class="muted small">quiet so far</div>`;
  // code map
  const refs = (d.static_refs || []).filter(r => !sc || r.project_path === sc);
  $("#netCode").innerHTML = refs.length ? `<table><tr><th>project</th><th>host</th><th>kind</th><th>file</th><th>notes</th></tr>
    ${refs.slice(0, 80).map(r => { const cat = catOf(r.category); return `<tr>
      <td>${esc(r.project)}</td><td class="mono small">${esc(r.scheme)}://${esc(r.host)}</td>
      <td><span class="badge" style="color:${cat.c};border-color:${cat.c}">${cat.icon} ${esc(r.service || cat.label)}</span></td>
      <td class="small"><span class="mono">${esc(r.file || "")}${r.line ? ":" + r.line : ""}</span><div class="sub mono">${esc((r.snippet || "").slice(0, 70))}</div></td>
      <td>${r.risk !== "low" ? `<span class="sev-tag sev-${r.risk === "high" ? "high" : "medium"}">${r.risk}</span>` : ""} <span class="small">${esc((r.notes || []).join(" · "))}</span></td></tr>`; }).join("")}</table>`
    : `<div class="muted small">no outbound URLs or network SDKs found in scanned projects</div>`;
  // rules
  const rulesIn = (d.rules || []).filter(r => !sc || r.app === sc || r.app === "*");
  $("#netRules").innerHTML = rulesIn.length ? rulesIn.map(r => `<div class="key-row">
      <span class="badge ${r.action === "allow" ? "b-green" : "b-red"}">${r.action === "allow" ? "✓ allow" : "⛔ deny"}</span>
      <span class="mono">${esc(r.host)}</span><span class="muted small">${r.app === "*" ? "all apps" : esc(r.app.split(/[\\/]/).pop())} · ${r.hits || 0} hits${r.note ? " · " + esc(r.note) : ""}</span>
      <button class="mini-btn" style="margin-left:auto" data-rflip="${esc(r.id)}" title="switch to ${r.action === "allow" ? "deny" : "allow"}">⇄</button>
      <button class="mini-btn" data-rdel="${esc(r.id)}" title="delete this rule">✕</button></div>`).join("")
    : `<div class="muted small">no rules yet — answer a prompt with “Always …” or add one above</div>`;
  $$("#netRules [data-rdel]").forEach(b => b.onclick = async () => { await api("/api/network/rules", { op: "delete", id: b.dataset.rdel }); toast("rule deleted", "ok"); netPoll(); });
  $$("#netRules [data-rflip]").forEach(b => b.onclick = async () => {
    const r = (d.rules || []).find(x => x.id === b.dataset.rflip); if (!r) return;
    await api("/api/network/rules", { app: r.app, host: r.host, action: r.action === "allow" ? "deny" : "allow" }); netPoll();
  });
  radarData(sc ? Object.assign({}, d, { connections: C, apps: appsIn, proxied, pending: (d.pending || []).filter(p => p.app_path === sc) }) : d);
}

/* ---------------- scope panel: one project's own guard settings ---------------- */

function renderScopePanel(d, sc) {
  const el = $("#netScopePanel");
  if (!el) return;
  if (!sc) { el.innerHTML = ""; return; }
  const own = (d.app_levels || {})[sc.path];
  const app = (d.apps || []).find(a => a.project_path === sc.path);
  const proj = (S.data.projects || []).find(p => p.path === sc.path);
  const run = (S.data.runs || []).find(r => r.path === sc.path && r.status === "running");
  el.innerHTML = `<div class="panel scope-panel">
    <h3>${sc.kind === "repo" ? "⎇" : sc.kind === "app" ? "▶" : "📦"} ${esc(sc.name)} <span class="badge b-gray">${esc(sc.kind)}</span>
      <span class="muted small mono">${esc(sc.path)}</span><span class="spacer"></span>
      <button class="btn small" id="scOpen">Open project</button></h3>
    <div class="scope-grid">
      <div><div class="small muted">Security level for this ${esc(sc.kind)}</div>
        <div class="seg" id="scLevel" role="group" aria-label="security level for ${esc(sc.name)}">
          <button data-l="" class="${!own ? "active" : ""}">Use global (${esc(d.level)})</button>
          <button data-l="low" class="${own === "low" ? "active" : ""}">◌ Low</button>
          <button data-l="medium" class="${own === "medium" ? "active" : ""}">◐ Medium</button>
          <button data-l="strict" class="${own === "strict" ? "active" : ""}">● Strict</button></div>
        <div class="small muted" style="margin-top:4px">Applies when it runs through the guard (start it from StackRadar).</div></div>
      <div><div class="small muted">Right now</div>
        <div>${app ? `<b>${app.conns}</b> connection${app.conns === 1 ? "" : "s"} · <span style="color:${OUT_C}">↑ ${rateTxt(app.rate_out)} (${totTxt(app.total_out)} sent)</span> · <span style="color:${IN_C}">↓ ${rateTxt(app.rate_in)} (${totTxt(app.total_in)} received)</span> · pid ${app.pids.join(", ")}` : '<span class="muted">not connected to anything</span>'}</div>
        <div class="pill-row" style="margin-top:6px">
          ${run ? `<button class="btn small" id="scStopRun">■ Stop run</button>` : `<button class="btn ok small" id="scRun" ${proj && (proj.run || {}).command ? "" : "disabled title='no run command found'"}>▶ Run guarded</button>`}
          ${app && app.pids.length ? `<button class="btn danger small" id="scKill">■ Stop process${app.pids.length > 1 ? "es" : ""}</button>` : ""}</div></div>
      <div><div class="small muted">Rule for this ${esc(sc.kind)}</div>
        <div class="pill-row"><input class="search-in" id="scHost" placeholder="host or *.domain" style="width:170px">
          <button class="btn ok small" data-scr="allow">✓ allow</button><button class="btn danger small" data-scr="deny">⛔ deny</button>
          <button class="btn danger small" data-scr="deny-all" title="deny every host for this project except what you allow">⛔ deny everything else</button></div></div>
    </div></div>`;
  $("#scOpen").onclick = () => { if (proj) openDrawer(proj); };
  $$("#scLevel button").forEach(b => b.onclick = async () => {
    await api("/api/network/app-level", { app: sc.path, level: b.dataset.l || null });
    toast(`${esc(sc.name)}: ${b.dataset.l ? "<b>" + b.dataset.l + "</b>" : "uses the global level"}`, "ok"); netPoll();
  });
  $$("[data-scr]", el).forEach(b => b.onclick = async () => {
    const host = b.dataset.scr === "deny-all" ? "*" : $("#scHost").value;
    const j = await api("/api/network/rules", { app: sc.path, host, action: b.dataset.scr === "allow" ? "allow" : "deny" });
    if (j.ok) { toast("rule added for " + esc(sc.name), "ok"); netPoll(); } else toast(esc(j.error), "err");
  });
  const kill = $("#scKill");
  if (kill) kill.onclick = async () => {
    if (!confirm(`Stop ${sc.name} (pid ${app.pids.join(", ")})?`)) return;
    for (const pid of app.pids) {
      const j = await api("/api/network/stop", { pid });
      toast(j.ok ? `stopped pid ${pid}` : esc(j.error) + (j.admin_cmd ? `<br><code>${esc(j.admin_cmd)}</code>` : ""), j.ok ? "ok" : "err");
    }
    netPoll();
  };
  const runB = $("#scRun");
  if (runB) runB.onclick = async () => {
    const j = await api("/api/run", { path: sc.path });
    toast(j.ok ? "started behind the guard" : esc(j.error || "could not start"), j.ok ? "ok" : "err");
    await loadState(); netPoll();
  };
  const stopR = $("#scStopRun");
  if (stopR) stopR.onclick = async () => { await api("/api/runs/stop", { id: run.id }); await loadState(); netPoll(); };
}

/* ---------------- detail windows ---------------- */

function appDetail(a) {
  if (!a) return;
  if (a.project_path && NETS.scope !== a.project_path) { NETS.scope = a.project_path; renderNetworkBody(); return; }
  const conns = (NETS.data.connections || []).filter(c => (c.project || c.proc || "pid " + c.pid) === a.name && c.category !== "local");
  modal(`<h3>${esc(a.name)} ${a.guarded || a.managed ? badge("🛡 guarded", "b-cyan") : badge("monitored only", "b-gray")}</h3>
    <div class="small">pid ${a.pids.join(", ")}${a.entry ? " · runs <span class='mono'>" + esc(a.entry) + "</span>" : ""} · ${a.conns} connection(s) · ↑ ${rateTxt(a.rate_out)} · ↓ ${rateTxt(a.rate_in)}</div>
    <table style="margin-top:8px"><tr><th>destination</th><th>kind</th><th>↑</th><th>↓</th></tr>
      ${conns.map(c => `<tr><td class="mono small">${esc(c.host || c.remote_ip)}:${c.remote_port}</td><td class="small">${esc(c.service || catOf(c.category).label)}</td><td class="mono small">${rateTxt(c.rate_out)}</td><td class="mono small">${rateTxt(c.rate_in)}</td></tr>`).join("")}</table>
    ${!a.project_path ? `<div class="small muted" style="margin-top:8px">Not inside a scanned project, so per-project rules don't apply. You can still stop it or block hosts for every app.</div>` : ""}
    <div class="m-actions"><button class="btn" id="mCancel">Close</button>
      ${a.pids.length ? `<button class="btn danger" id="mStop">■ Stop</button><button class="btn danger" id="mKill">✕ Force kill</button>` : ""}</div>`);
  $("#mCancel").onclick = closeModal;
  const stop = async force => {
    for (const pid of a.pids) {
      const j = await api("/api/network/stop", { pid, force });
      toast(j.ok ? `pid ${pid}: ${esc(j.method)}` : esc(j.error) + (j.admin_cmd ? `<br><code>${esc(j.admin_cmd)}</code>` : ""), j.ok ? "ok" : "err");
    }
    closeModal(); netPoll();
  };
  if ($("#mStop")) { $("#mStop").onclick = () => stop(false); $("#mKill").onclick = () => { if (confirm("Force kill? Unsaved work in that program is lost.")) stop(true); }; }
}

function connDetail(c) {
  if (!c) return;
  const cat = catOf(c.category), host = c.host || c.remote_ip;
  modal(`<h3><span class="badge" style="color:${cat.c};border-color:${cat.c}">${cat.icon} ${esc(c.service || cat.label)}</span> ${esc(host)}:${c.remote_port}</h3>
    <div class="kv">
      <div class="k">app</div><div><b>${esc(c.project || c.proc || "?")}</b> · pid ${c.pid || "?"} ${c.managed ? badge("🛡 guarded", "b-cyan") : badge("monitored only", "b-gray")}</div>
      <div class="k">address</div><div class="mono">${esc(c.remote_ip)}:${c.remote_port}${c.host ? " (" + esc(c.host) + ")" : ""}</div>
      <div class="k">traffic now</div><div><span style="color:${OUT_C}">↑ ${rateTxt(c.rate_out)}</span> · <span style="color:${IN_C}">↓ ${rateTxt(c.rate_in)}</span>${c.n > 1 ? ` · ${c.n} sockets` : ""}</div>
      <div class="k">total</div><div>${c.total_out != null ? `↑ ${totTxt(c.total_out)} sent · ↓ ${totTxt(c.total_in)} received on this connection` : c.proc_total_out != null ? `whole app: ↑ ${totTxt(c.proc_total_out)} · ↓ ${totTxt(c.proc_total_in)}` : '<span class="muted">not available on this OS</span>'}</div>
      <div class="k">from (code)</div><div>${c.ref ? `<span class="mono">${esc(c.ref.file || "")}${c.ref.line ? ":" + c.ref.line : ""}</span><div class="sub mono">${esc(c.ref.snippet || "")}</div>${c.ref.carries_secret ? badge("🔑 credentials near this call", "b-amber") : ""}` : (c.entry ? `runs <span class="mono">${esc(c.entry)}</span> (no file references this host)` : '<span class="muted">unknown</span>')}</div>
      <div class="k">rule</div><div>${c.rule ? badge(c.rule === "allow" ? "✓ allowed" : "⛔ denied", c.rule === "allow" ? "b-green" : "b-red") : '<span class="muted">none</span>'}</div>
    </div>
    ${!c.managed ? `<div class="warn-box small" style="margin-top:8px">This app wasn't started by StackRadar, so a deny rule is recorded and alerts you, but can't cut the connection. To stop it now: <b>Stop app</b> below, <b>block at the OS firewall</b>, or restart it from Runs.</div>` : ""}
    <div class="pill-row" style="margin-top:10px">
      ${c.project_path ? `<button class="btn ok small" data-cd="allow">✓ Always allow for ${esc(c.project)}</button><button class="btn danger small" data-cd="deny">⛔ Always deny for ${esc(c.project)}</button>` : ""}
      <button class="btn ok small" data-cd="allow-all">✓ Allow for all apps</button><button class="btn danger small" data-cd="deny-all">⛔ Deny for all apps</button>
      <button class="btn small" data-cd="os">🧱 Block at OS firewall</button>
      <button class="btn small" data-cd="filter">🔎 Show only ${esc(host)}</button>
      ${c.pid ? `<button class="btn danger small" data-cd="stop">■ Stop app</button>` : ""}
    </div>
    <div class="m-actions"><button class="btn" id="mCancel">Close</button></div>`);
  $("#mCancel").onclick = closeModal;
  $$("[data-cd]").forEach(b => b.onclick = async () => {
    const a = b.dataset.cd;
    if (a === "os") { closeModal(); return osBlockModal(host, c.remote_ip); }
    if (a === "filter") { closeModal(); $("#netQ").value = host; NETS.focusHost = host.toLowerCase(); return renderNetworkBody(); }
    if (a === "stop") {
      if (!confirm(`Stop ${c.project || c.proc || "pid " + c.pid}?`)) return;
      const j = await api("/api/network/stop", { pid: c.pid });
      toast(j.ok ? "stopped" : esc(j.error) + (j.admin_cmd ? `<br><code>${esc(j.admin_cmd)}</code>` : ""), j.ok ? "ok" : "err");
      closeModal(); return netPoll();
    }
    const j = await api("/api/network/rules", { app: a.endsWith("-all") ? "*" : c.project_path, host, action: a.startsWith("allow") ? "allow" : "deny" });
    toast(j.ok ? "rule saved" : esc(j.error), j.ok ? "ok" : "err");
    closeModal(); netPoll();
  });
}

async function connAction(c, act) {
  const host = c.host || c.remote_ip;
  if (act === "os") return osBlockModal(host, c.remote_ip);
  const j = await api("/api/network/rules", { app: c.project_path || "*", host, action: act });
  if (!j.ok) return toast(esc(j.error), "err");
  toast(`${act === "allow" ? "✓ always allow" : "⛔ always deny"} <b>${esc(host)}</b>${c.project ? " for " + esc(c.project) : ""}` +
        (act === "deny" && !c.managed ? "<br><span class='small'>This app wasn't started by StackRadar — use 🧱 to block it at the OS firewall, or restart it from Runs.</span>" : ""), act === "allow" ? "ok" : "err");
  netPoll();
}

async function osBlockModal(host, ip) {
  const pre = await api("/api/network/osblock", { host: /^[\d.:a-f]+$/i.test(host) ? "" : host, ips: /^[\d.:a-f]+$/i.test(host) ? [host] : [] });
  if (!pre.ok) return toast(esc(pre.error), "err");
  modal(`<h3>🧱 Block ${esc(host)} for every app?</h3>
    <div class="small">This adds an <b>OS firewall</b> rule that drops outgoing traffic to ${pre.ips.map(esc).join(", ")}. Your OS will ask for an administrator password (or UAC on Windows). Command:</div>
    <pre class="small" style="white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:8px;border:1px solid var(--line)">${esc(pre.command)}</pre>
    <div class="small muted">Undo later from this same menu, or remove the rule named <code>StackRadar-…</code> in your firewall settings. CDN-hosted services can change IPs, so a host rule in the guard is usually the better first step.</div>
    <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn" id="mUn">Unblock</button><button class="btn danger" id="mGo">Block now</button></div>`);
  $("#mCancel").onclick = closeModal;
  const go = async op => {
    const j = await api("/api/network/osblock", { host: pre.ips.length && /^[\d.:a-f]+$/i.test(host) ? "" : host, ips: pre.ips, op, execute: true, confirm: true });
    if (!j.ok) return toast(esc(j.error || "failed"), "err");
    showJob(j.id, () => netPoll(), op === "block" ? "Blocking at the OS firewall…" : "Removing the firewall rule…");
  };
  $("#mGo").onclick = () => go("block");
  $("#mUn").onclick = () => go("unblock");
}

/* ---------------- signal radar (canvas) ---------------- */

function radarFit() {
  const cv = $("#netRadar");
  if (!cv) return false;
  const w = cv.parentElement.clientWidth, h = cv.parentElement.clientHeight, dpr = window.devicePixelRatio || 1;
  if (w < 80 || h < 80) return false;
  if (w !== NETS.R.W || h !== NETS.R.H) { cv.width = w * dpr; cv.height = h * dpr; NETS.R.W = w; NETS.R.H = h; if (NETS.data) radarData(NETS.data); }
  return true;
}
function radarInit() {
  const cv = $("#netRadar");
  window.addEventListener("resize", radarFit); radarFit();
  cv.onpointermove = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 1e9;
    NETS.R.nodes.forEach(n => { const dd = Math.hypot(n.x - x, n.y - y); if (dd < n.r + 8 && dd < bd) { best = n; bd = dd; } });
    NETS.R.hover = best;
    const tip = $("#netTip");
    if (!best) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = Math.min(r.width - 240, x + 14) + "px"; tip.style.top = (y + 10) + "px";
    tip.innerHTML = best.kind === "app"
      ? `<b>${esc(best.label)}</b><div class="small mono"><span style="color:${OUT_C}">↑ ${rateTxt(best.out)}</span> · <span style="color:${IN_C}">↓ ${rateTxt(best.in)}</span></div><div class="small muted">${best.conns} connection(s)</div>`
      : `<div class="gt-type" style="color:${catOf(best.cat).c}">${catOf(best.cat).icon} ${esc(catOf(best.cat).label)}</div><b class="mono">${esc(best.label)}</b>${best.service ? `<div class="small">${esc(best.service)}</div>` : ""}${best.state ? `<div class="small" style="color:${best.state === "blocked" ? BLOCK_C : WAIT_C}">${best.state}</div>` : ""}`;
  };
  cv.onpointerleave = () => { NETS.R.hover = null; $("#netTip").hidden = true; };
  cv.onclick = () => { const n = NETS.R.hover; if (n && n.kind === "host") { $("#netQ").value = n.label; NETS.focusHost = n.label.toLowerCase(); renderNetworkBody(); } };
  const loop = now => {
    NETS.R.raf = requestAnimationFrame(loop);
    if (S.tab !== "network" || !$("#netRadar")) return;
    radarDraw((now - NETS.R.t0) / 1000);
  };
  cancelAnimationFrame(NETS.R.raf);
  NETS.R.raf = requestAnimationFrame(loop);
}

const SECTOR = ["ai", "cloud", "payments", "registry", "vcs", "cdn", "telemetry", "unknown", "lan"];
function hashf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

function radarData(d) {
  const R = NETS.R, keep = new Set(), links = [];
  const W = R.W || 800, H = R.H || 420, cx = W / 2, cy = H / 2, rad = Math.max(40, Math.min(W, H) / 2 - 26);
  const apps = (d.apps || []).slice(0, 12);
  const add = (id, props) => { keep.add(id); const n = R.nodes.get(id) || { id, x: cx, y: cy }; Object.assign(n, props); R.nodes.set(id, n); return n; };
  apps.forEach((a, i) => {
    const ang = (i / Math.max(1, apps.length)) * Math.PI * 2 - Math.PI / 2;
    add("app:" + a.name, { kind: "app", label: a.name, tx: cx + Math.cos(ang) * rad * 0.34, ty: cy + Math.sin(ang) * rad * 0.34,
      r: 9 + Math.min(10, a.conns * 1.5), in: a.rate_in, out: a.rate_out, conns: a.conns, guarded: a.guarded || a.managed });
  });
  const byHost = new Map();
  (d.connections || []).filter(c => c.category !== "local").forEach(c => {
    const host = c.host || c.remote_ip, app = c.project || c.proc || "pid " + c.pid;
    const h = byHost.get(host) || { host, cat: c.category, service: c.service, apps: new Map() };
    const e = h.apps.get(app) || { in: 0, out: 0 };
    e.in += c.rate_in || 0; e.out += c.rate_out || 0; h.apps.set(app, e); byHost.set(host, h);
  });
  (d.proxied || []).filter(p => p.open).forEach(p => {
    const h = byHost.get(p.host) || { host: p.host, cat: null, service: null, apps: new Map() };
    if (!h.apps.has(p.app)) h.apps.set(p.app, { in: 300, out: 300 }); byHost.set(p.host, h);
  });
  const recent = Date.now() / 1000 - 30;
  (d.events || []).filter(e => e.t > recent && e.kind === "blocked").forEach(e => {
    const h = byHost.get(e.host) || { host: e.host, cat: null, service: e.service, apps: new Map() };
    h.state = "blocked"; if (!h.apps.has(e.app)) h.apps.set(e.app, { in: 0, out: 0 }); byHost.set(e.host, h);
  });
  (d.pending || []).forEach(p => {
    const h = byHost.get(p.host) || { host: p.host, cat: p.category, service: p.service, apps: new Map() };
    h.state = "asking"; if (!h.apps.has(p.app)) h.apps.set(p.app, { in: 0, out: 0 }); byHost.set(p.host, h);
  });
  [...byHost.values()].slice(0, 40).forEach(h => {
    const cat = h.cat || "unknown", si = Math.max(0, SECTOR.indexOf(cat));
    const ang = ((si + 0.15 + hashf(h.host) * 0.7) / SECTOR.length) * Math.PI * 2 - Math.PI / 2;
    const rr = rad * (0.72 + hashf(h.host + "r") * 0.25);
    const n = add("host:" + h.host, { kind: "host", label: h.host, cat, service: h.service, state: h.state, tx: cx + Math.cos(ang) * rr, ty: cy + Math.sin(ang) * rr, r: 6 });
    h.apps.forEach((v, app) => {
      const a = R.nodes.get("app:" + app) || add("app:" + app, { kind: "app", label: app, tx: cx, ty: cy, r: 8, in: 0, out: 0, conns: 0 });
      links.push({ a: a.id, h: n.id, in: v.in, out: v.out, state: h.state, seed: hashf(app + h.host) });
    });
  });
  [...R.nodes.keys()].forEach(k => { if (!keep.has(k)) R.nodes.delete(k); });
  R.links = links; R.cx = cx; R.cy = cy; R.rad = rad;
}

function radarDraw(t) {
  if (!radarFit()) return;
  const R = NETS.R, cv = $("#netRadar"), ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1;
  const W = R.W, H = R.H, cx = W / 2, cy = H / 2, rad = Math.max(40, Math.min(W, H) / 2 - 26);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.7);
  bg.addColorStop(0, "#0f1d36"); bg.addColorStop(1, "#060910");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // rings + sector labels
  ctx.strokeStyle = "rgba(57,197,224,.16)"; ctx.lineWidth = 1;
  [0.34, 0.72, 1].forEach(f => { ctx.beginPath(); ctx.arc(cx, cy, rad * f, 0, Math.PI * 2); ctx.stroke(); });
  ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(170,185,210,.45)";
  SECTOR.forEach((s, i) => {
    const a = ((i + 0.5) / SECTOR.length) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = "rgba(57,197,224,.06)"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a - Math.PI / SECTOR.length) * rad, cy + Math.sin(a - Math.PI / SECTOR.length) * rad); ctx.stroke();
    ctx.fillText(catOf(s).label.toUpperCase(), cx + Math.cos(a) * (rad + 14), cy + Math.sin(a) * (rad + 14) + 3);
  });
  // sweep
  const sa = (t * 0.9) % (Math.PI * 2);
  const g = ctx.createConicGradient ? ctx.createConicGradient(sa - 0.7, cx, cy) : null;
  if (g) { g.addColorStop(0, "rgba(57,197,224,0)"); g.addColorStop(0.11, "rgba(57,197,224,.20)"); g.addColorStop(0.112, "rgba(57,197,224,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); }
  // ease nodes
  R.nodes.forEach(n => { n.x += ((n.tx ?? cx) - n.x) * 0.12; n.y += ((n.ty ?? cy) - n.y) * 0.12; });
  // centre: this machine
  ctx.fillStyle = "rgba(57,197,224,.15)"; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
  ctx.font = "13px sans-serif"; ctx.fillStyle = "#e8ecf5"; ctx.fillText("💻", cx, cy + 5);
  // links + packets
  (R.links || []).forEach(l => {
    const a = R.nodes.get(l.a), h = R.nodes.get(l.h);
    if (!a || !h) return;
    const blocked = l.state === "blocked", asking = l.state === "asking";
    const hot = R.hover && (R.hover === a || R.hover === h);
    ctx.strokeStyle = blocked ? "rgba(208,59,59,.6)" : asking ? "rgba(250,178,25,.6)" : hot ? "rgba(200,220,255,.45)" : "rgba(120,150,200,.18)";
    ctx.lineWidth = hot ? 1.6 : 1; ctx.setLineDash(blocked || asking ? [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.setLineDash([]);
    if (blocked || asking) return;
    const lane = (k, rate, outgoing) => {   // dots: more + faster with more bytes/s; one slow pulse when idle
      const n = rate > 0 ? Math.min(6, 1 + Math.floor(Math.log10(rate + 1))) : 1;
      const speed = rate > 0 ? 0.35 + Math.min(1.2, Math.log10(rate + 1) / 5) : 0.12;
      for (let i = 0; i < n; i++) {
        const p = (t * speed + l.seed + i / n + k) % 1, f = outgoing ? p : 1 - p;
        const x = a.x + (h.x - a.x) * f, y = a.y + (h.y - a.y) * f;
        const off = outgoing ? 2.5 : -2.5, nx = -(h.y - a.y), ny = h.x - a.x, nl = Math.hypot(nx, ny) || 1;
        ctx.fillStyle = outgoing ? OUT_C : IN_C; ctx.globalAlpha = rate > 0 ? 0.95 : 0.35;
        ctx.beginPath(); ctx.arc(x + nx / nl * off, y + ny / nl * off, rate > 0 ? 2.4 : 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    lane(0, l.out, true); lane(0.5, l.in, false);
  });
  // nodes
  R.nodes.forEach(n => {
    const hot = R.hover === n;
    if (n.kind === "app") {
      ctx.shadowColor = n.guarded ? OUT_C : "rgba(140,170,220,.8)"; ctx.shadowBlur = hot ? 20 : 10;
      ctx.fillStyle = "#13203a"; ctx.strokeStyle = n.guarded ? OUT_C : "#7f95bd"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = "700 11px sans-serif"; ctx.fillStyle = "#e8ecf5"; ctx.textAlign = "center";
      ctx.fillText((n.guarded ? "🛡 " : "") + n.label.slice(0, 18), n.x, n.y + n.r + 13);
    } else {
      const c = n.state === "blocked" ? BLOCK_C : n.state === "asking" ? WAIT_C : catOf(n.cat).c;
      const a = Math.atan2(n.y - cy, n.x - cx), da = ((a - sa + Math.PI * 4 + Math.PI / 2) % (Math.PI * 2));
      const glow = da < 0.6 ? 1 - da / 0.6 : 0;   // blip lights up as the sweep passes
      ctx.shadowColor = c; ctx.shadowBlur = 8 + glow * 18 + (hot ? 10 : 0);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + glow * 2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      if (n.state === "blocked") { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(n.x - 3, n.y - 3); ctx.lineTo(n.x + 3, n.y + 3); ctx.moveTo(n.x + 3, n.y - 3); ctx.lineTo(n.x - 3, n.y + 3); ctx.stroke(); }
      if (n.state === "asking") { ctx.strokeStyle = WAIT_C; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 + (t * 8 % 8), 0, Math.PI * 2); ctx.stroke(); }
      if (hot || glow > 0.2 || n.state) {
        ctx.font = "10.5px ui-monospace, monospace"; ctx.fillStyle = "rgba(220,230,245,.85)"; ctx.textAlign = n.x > cx ? "left" : "right";
        ctx.fillText(n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label, n.x + (n.x > cx ? 10 : -10), n.y + 4);
      }
    }
  });
}

/* ---------------- archives (compress on archive) ---------------- */

function archiveModal(p) {
  modal(`<h3>🗜 Archive &amp; compress <code>${esc(p.name)}</code></h3>
    <div class="small">Packs the project into one ${navigator.platform.startsWith("Win") ? ".zip" : ".tar.gz"} file in <code>~/.stackradar/archives</code>, checks every file made it in, and marks the project <b>archived</b>.</div>
    <label class="upd-item"><input type="checkbox" id="arRegen" checked> leave out regenerable folders (node_modules, .venv, build caches)</label>
    <label class="upd-item"><input type="checkbox" id="arTrash" checked> move the original folder to the Trash afterwards (frees ${fmtBytes(p.size)})</label>
    <div class="small muted">Restore any time from <b>Reclaim space → Archives</b>.</div>
    <div class="m-actions"><button class="btn" id="mCancel">Cancel</button><button class="btn" id="mOnly">Just mark archived</button><button class="btn primary" id="mGo">🗜 Compress &amp; archive</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOnly").onclick = async () => { await saveMeta(p, { status: "archived" }); closeModal(); openDrawer(p); if (S.tab === "projects") renderProjects(); };
  $("#mGo").onclick = async () => {
    const j = await api("/api/archive", { path: p.path, confirm: true, trash_original: $("#arTrash").checked, exclude_regen: $("#arRegen").checked });
    if (!j.ok) return toast(esc(j.error || "failed"), "err");
    showJob(j.id, () => { loadState(); closeDrawer(); }, "Compressing " + p.name + "…");
  };
}

async function archivesPanelHtml() {
  let j = {};
  try { j = await api("/api/archives"); } catch (_) {}
  const A = j.archives || [];
  return `<div class="panel"><h3>Archives ${hint("archives")} <span class="count">${A.length} · ${fmtBytes(A.reduce((s, a) => s + a.size, 0))}</span></h3>
    ${A.length ? `<table><tr><th>archive</th><th style="text-align:right">size</th><th style="text-align:right">saved</th><th></th></tr>
      ${A.map(a => `<tr><td><b>${esc(a.name)}</b><div class="sub path">${esc(a.original_path || "")}${a.original_exists ? " · original still there" : ""}</div></td>
        <td class="mono" style="text-align:right">${fmtBytes(a.size)}</td>
        <td class="mono" style="text-align:right;color:var(--green)">${a.original_size ? Math.round(100 * (1 - a.size / a.original_size)) + "%" : "—"}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn small" data-arrestore="${esc(a.file)}" ${a.original_exists ? "disabled title='original folder still exists'" : ""}>↩ restore</button>
          <button class="mini-btn" data-reveal="${esc(a.file)}">📂</button></td></tr>`).join("")}</table>`
      : `<div class="muted small">No archives yet. Set a project's status to <b>archived</b> (or use 🗜 in its drawer) to compress it.</div>`}</div>`;
}
function wireArchives(root) {
  $$("[data-arrestore]", root).forEach(b => b.onclick = async () => {
    const j = await api("/api/archive/restore", { file: b.dataset.arrestore });
    if (!j.ok) return toast(esc(j.error || "failed"), "err");
    showJob(j.id, () => { loadState(); if (S.tab === "reclaim") renderReclaim(); }, "Restoring…");
  });
  $$("[data-reveal]", root).forEach(b => b.onclick = () => revealPath(b.dataset.reveal));
}

/* ---------------- register ---------------- */

RENDERERS.network = renderNetwork;
(function () {
  const start = () => {
    pendPoll();
    setInterval(pendPoll, 1500);
    const sb = $("#shieldBtn");
    if (sb) sb.onclick = () => { S.tab = "network"; render(); };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
