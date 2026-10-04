/* StackRadar 2 — lineage graph engine (canvas, no dependencies).
   Glowing gradient nodes with icons, curved gradient edges with flowing particles,
   three layouts (force / radial / flow), clickable legend filters, search, fit, PNG export. */
"use strict";

const G = {
  nodes: [], edges: [], byId: new Map(), adj: new Map(),
  tf: { x: 0, y: 0, k: 1 }, target: null,
  hover: null, selNode: null, dragNode: null, panning: false,
  W: 800, H: 600, alpha: 0, t0: performance.now(), fitted: false,
  hidden: new Set(), search: "", layout: "force", motion: true, active: false,
};
// 8 categorical slots validated for CVD + contrast on the dark canvas (#0a0d15); the two
// extra types (origin, schedule) are neutral and rely on their icon + label.
const NODE_TYPES = {
  project:  { c: "#3987e5", icon: "◆", label: "project" },
  env:      { c: "#d95926", icon: "⚙", label: "runtime / tool" },
  dep:      { c: "#199e70", icon: "▣", label: "dependency" },
  llm:      { c: "#c98500", icon: "✦", label: "LLM usage" },
  ai:       { c: "#d55181", icon: "🤖", label: "AI agent / IDE" },
  port:     { c: "#008300", icon: "⇄", label: "port" },
  skill:    { c: "#9085e9", icon: "✪", label: "skill" },
  key:      { c: "#e66767", icon: "🔑", label: "secrets" },
  vcs:      { c: "#8b97ad", icon: "⎇", label: "origin / VCS" },
  schedule: { c: "#a7b0c0", icon: "⏰", label: "schedule" },
  folder:   { c: "#6f7f9c", icon: "▤", label: "folder (size)" },
  host:     { c: "#39c5e0", icon: "🌐", label: "network host" },
  category: { c: "#fab219", icon: "🗂", label: "category" },
};
const COLUMN_OF = { vcs: 0, ai: 0, llm: 0, category: 0, project: 1, env: 2, skill: 2, schedule: 2, folder: 2, dep: 3, host: 3, port: 4, key: 4 };
// kept for code that still reads these names
const NODE_COLORS = Object.fromEntries(Object.entries(NODE_TYPES).map(([k, v]) => [k, v.c]));
const NODE_LABELS = Object.fromEntries(Object.entries(NODE_TYPES).map(([k, v]) => [k, v.label]));

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(x => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- build ---------------- */

function buildGraph(focus) {
  const P = S.data.projects || [];
  const K = S.data.skills || {};
  const nodes = [], edges = [], nmap = new Map();
  const add = (id, type, label, meta, r) => {
    let n = nmap.get(id);
    if (!n) {
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
      n = { id, type, label, meta: meta || {}, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, r: r || 8, deg: 0, phase: Math.random() * 6.28 };
      nmap.set(id, n); nodes.push(n);
    }
    return n;
  };
  const link = (a, b, label, kind) => { edges.push({ a: a.id, b: b.id, label: label || "", kind: kind || b.type, seed: Math.random() }); a.deg++; b.deg++; };

  const shown = focus === "all" ? P : P.filter(p => p.path === focus);
  const depBudget = focus === "all" ? 7 : 18;
  shown.forEach(p => {
    const pn = add("proj:" + p.path, "project", p.name, { p }, 15 + Math.min(14, Math.sqrt(p.size || 0) / 900));
    pn.color = (p.meta && p.meta.color) || NODE_TYPES.project.c;
    pn.running = (p.running || []).length > 0;
    pn.risk = p.risk_level;
    const deps = (p.dependencies || []).filter(d => d.kind === "prod").concat((p.dependencies || []).filter(d => d.kind === "dev"));
    deps.slice(0, depBudget).forEach(d => link(pn, add("dep:" + d.name, "dep", d.name, { version: d.version, from: d.from, users: [] }, 7), d.version, "dep"));
    (p.open_ports || []).forEach(o => link(pn, add("port:" + o.port, "port", ":" + o.port, { status: "open now", pid: o.pid, proc: o.proc, open: true }, 9), "open", "port"));
    (p.expected_ports || []).filter(e => !(p.open_ports || []).some(o => o.port === e.port)).slice(0, 4).forEach(e => {
      const t = add("port:" + e.port, "port", ":" + e.port, { status: "expected (closed)", source: e.source }, 7);
      link(pn, t, "expected", "port-exp");
    });
    if (p.key_count) link(pn, add("key:" + p.path, "key", p.key_count + " secret" + (p.key_count > 1 ? "s" : ""), { types: (p.keys || []).slice(0, 5).map(k => k.type) }, 10), "", "key");
    (p.llm || []).forEach(l => link(pn, add("llm:" + (l.model || l.tool), "llm", l.model || l.tool, { tool: l.tool, in: l.tokens_in, out: l.tokens_out, sessions: l.sessions }, 12), Math.round((l.tokens_in || 0) / 1000) + "k in", "llm"));
    if ((p.git || {}).remote_host) link(add("vcs:" + p.git.remote_host, "vcs", p.git.remote_host, { remote: p.git.remote }, 11), pn, "origin", "vcs");
    const envs = [];
    if (p.run && p.run.pkg_manager) envs.push(p.run.pkg_manager === "npm" ? "Node.js" : p.run.pkg_manager);
    if ((p.dependencies || []).some(d => d.from && d.from !== "package.json" && d.from !== "Cargo.toml")) envs.push("Python");
    if (p.primary_language === "Rust") envs.push("Rust");
    if (p.primary_language === "Go") envs.push("Go");
    if (p.primary_language === "Ruby") envs.push("Ruby");
    if ((p.run || {}).why === "Docker Compose project") envs.push("Docker");
    [...new Set(envs)].forEach(en => link(pn, add("env:" + en, "env", en, {}, 12), "", "env"));
    (p.ai_names || []).slice(0, 3).forEach(a => link(add("ai:" + a, "ai", a.replace(/ \(.*\)$/, ""), { full: a }, 11), pn, "built with", "ai"));
    (p.schedules || []).slice(0, focus === "all" ? 2 : 6).forEach((s, i) => link(pn, add("sch:" + p.path + i, "schedule", s.human, { kind: s.kind, expr: s.expr, file: s.file }, 8), s.kind, "schedule"));
    const seen = new Set();
    (K.skills || []).filter(s => (s.used_in || []).includes(p.name) && !seen.has(s.name) && seen.add(s.name))
      .slice(0, focus === "all" ? 3 : 10)
      .forEach(s => link(pn, add("skill:" + s.name, "skill", s.name, { uses: s.uses, agent: s.agent, desc: s.description }, 8 + Math.min(6, Math.sqrt(s.uses || 0))), (s.uses || 0) + "×", "skill"));
    const cat = (p.meta || {}).category;
    if (cat && focus === "all") link(add("cat:" + cat, "category", cat, {}, 13), pn, "", "category");
    if (focus !== "all") {
      // drill-down: folders with their size, nested projects, network hosts the code talks to
      const total = Math.max(1, p.size || 1);
      (p.size_breakdown || []).filter(b => b.size > 0).slice(0, 10).forEach(b => {
        const r = 6 + Math.min(16, 22 * Math.sqrt(b.size / total));
        link(pn, add("dir:" + p.path + "/" + b.name, "folder", b.name + (b.dir ? "/" : "") + " · " + fmtBytes(b.size), { size: b.size, path: p.path + "/" + b.name, dir: b.dir }, r), fmtBytes(b.size), "folder");
      });
      const kids = (p.children || []).map(c => P.find(x => x.path === c)).filter(Boolean);
      kids.forEach(k => { const kn = add("proj:" + k.path, "project", k.name, { p: k }, 12); kn.color = NODE_TYPES.project.c; link(pn, kn, "contains", "nested"); });
      const par = p.parent && P.find(x => x.path === p.parent);
      if (par) { const pp = add("proj:" + par.path, "project", par.name, { p: par }, 13); pp.color = NODE_TYPES.project.c; link(pp, pn, "contains", "nested"); }
      const hosts = new Map();
      (p.net_refs || []).forEach(r => { if (!hosts.has(r.host)) hosts.set(r.host, r); });
      [...hosts.values()].slice(0, 12).forEach(r => link(pn, add("host:" + r.host, "host", r.host, { file: r.file, line: r.line, risk: r.risk, service: r.service }, 8), r.service || "", "host"));
      (S.data.agents || []).forEach(a => {
        const ss = (a.session_list || []).filter(x => x.cwd && (x.cwd === p.path || x.cwd.startsWith(p.path + "/")));
        if (ss.length) link(add("ai:" + a.name, "ai", a.name, { full: a.name, sessions: ss.length, out: ss.reduce((t, x) => t + (x.out || 0), 0) }, 11), pn, ss.length + " sessions", "ai");
      });
    }
  });
  // shared nodes grow with the number of projects that use them
  nodes.forEach(n => { if (n.type !== "project" && n.deg > 1) n.r = Math.min(n.r + (n.deg - 1) * 2.5, 22); });

  G.nodes = nodes; G.edges = edges;
  G.byId = new Map(nodes.map(n => [n.id, n]));
  G.adj = new Map(nodes.map(n => [n.id, new Set()]));
  edges.forEach(e => { G.adj.get(e.a).add(e.b); G.adj.get(e.b).add(e.a); });
  G.selNode = null; G.hover = null;
  $("#nodeInfo").hidden = true;
  applyLayout(true);
  renderLegend(); renderGStats();
}

/* ---------------- layouts ---------------- */

function applyLayout(initial) {
  const N = G.nodes;
  if (G.layout === "radial") {
    const projs = N.filter(n => n.type === "project");
    const R = Math.max(160, projs.length * 46);
    projs.forEach((p, i) => { const a = (i / Math.max(1, projs.length)) * Math.PI * 2 - Math.PI / 2; p.tx = Math.cos(a) * R; p.ty = Math.sin(a) * R; p.ang = a; });
    N.filter(n => n.type !== "project").forEach(n => {
      const nb = [...G.adj.get(n.id)].map(id => G.byId.get(id)).filter(x => x && x.type === "project");
      if (!nb.length) { n.tx = 0; n.ty = 0; return; }
      if (nb.length > 1) {   // shared → pulled toward the centre, between its projects
        const cx = nb.reduce((s, x) => s + x.tx, 0) / nb.length, cy = nb.reduce((s, x) => s + x.ty, 0) / nb.length;
        n.tx = cx * 0.45; n.ty = cy * 0.45;
      } else {
        const p = nb[0];
        const sib = [...G.adj.get(p.id)].filter(id => G.adj.get(id).size === 1);
        const k = sib.indexOf(n.id), spread = Math.min(Math.PI * 0.9, 0.28 * sib.length);
        const a = p.ang + (sib.length > 1 ? (k / (sib.length - 1) - 0.5) * spread : 0);
        const dist = 95 + (k % 2) * 34;
        n.tx = p.tx + Math.cos(a) * dist; n.ty = p.ty + Math.sin(a) * dist;
      }
    });
  } else if (G.layout === "columns") {
    const cols = [[], [], [], [], []];
    N.forEach(n => cols[COLUMN_OF[n.type] != null ? COLUMN_OF[n.type] : 2].push(n));
    const projs = cols[1];
    const order = new Map(projs.map((p, i) => [p.id, i]));
    const rank = n => { const nb = [...G.adj.get(n.id)].map(id => order.get(id)).filter(v => v != null); return nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : 0; };
    cols.forEach((c, ci) => {
      if (ci !== 1) c.sort((a, b) => rank(a) - rank(b) || a.type.localeCompare(b.type));
      const gap = ci === 1 ? 80 : 30;
      c.forEach((n, i) => { n.tx = (ci - 2) * 270; n.ty = (i - (c.length - 1) / 2) * gap; });
    });
  } else {
    N.forEach(n => { n.tx = null; n.ty = null; });
  }
  if (initial && G.layout !== "force") N.forEach(n => { if (n.tx != null) { n.x = n.tx + (Math.random() - 0.5) * 30; n.y = n.ty + (Math.random() - 0.5) * 30; } });
  G.alpha = 1;
  if (initial && G.layout === "force") for (let i = 0; i < 160; i++) simulate(1);
  if (initial) setTimeout(() => fitView(false), 30);
}

function simulate(alpha) {
  const N = G.nodes, E = G.edges, n = N.length;
  if (!n) return;
  if (G.layout !== "force") {
    N.forEach(nd => {
      if (nd === G.dragNode || nd.tx == null) return;
      nd.x += (nd.tx - nd.x) * 0.12 * alpha + 0.0001; nd.y += (nd.ty - nd.y) * 0.12 * alpha;
    });
    return;
  }
  const repulse = 3200 * alpha;
  for (let i = 0; i < n; i++) {
    const a = N[i];
    for (let j = i + 1; j < n; j++) {
      const b = N[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      if (d2 > 250000) continue;
      const d = Math.sqrt(d2), f = repulse / d2;
      const fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      const min = (a.r + b.r) * 1.6;   // collision
      if (d < min) { const push = (min - d) / d * 0.25; a.vx += dx * push; a.vy += dy * push; b.vx -= dx * push; b.vy -= dy * push; }
    }
  }
  E.forEach(e => {
    const a = G.byId.get(e.a), b = G.byId.get(e.b);
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
    const rest = (a.type === "project" || b.type === "project") ? 105 + (a.r + b.r) : 60;
    const f = (d - rest) * 0.02 * alpha, fx = dx / d * f, fy = dy / d * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  });
  N.forEach(nd => {
    if (nd === G.dragNode) { nd.vx = nd.vy = 0; return; }
    nd.vx -= nd.x * 0.006 * alpha; nd.vy -= nd.y * 0.006 * alpha;
    nd.vx *= 0.82; nd.vy *= 0.82;
    nd.x += nd.vx; nd.y += nd.vy;
  });
}

function fitView(animate) {
  const vis = G.nodes.filter(n => !G.hidden.has(n.type));
  if (!vis.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  vis.forEach(n => { const x = n.tx != null && G.layout !== "force" ? n.tx : n.x, y = n.tx != null && G.layout !== "force" ? n.ty : n.y;
    x0 = Math.min(x0, x - n.r); y0 = Math.min(y0, y - n.r); x1 = Math.max(x1, x + n.r); y1 = Math.max(y1, y + n.r + 18); });
  if (G.layout === "columns") x1 += 150;   // labels sit to the right in flow mode
  const padL = 200, pad = 60;   // keep clear of the legend on the left
  const k = Math.max(0.2, Math.min(1.8, Math.min((G.W - padL - pad) / Math.max(1, x1 - x0), (G.H - pad * 2) / Math.max(1, y1 - y0))));
  const t = { k, x: padL + (G.W - padL - pad) / 2 - (x0 + x1) / 2 * k, y: G.H / 2 - (y0 + y1) / 2 * k };
  if (animate) G.target = t; else G.tf = t;
}

/* ---------------- canvas plumbing & input ---------------- */

function graphFit() {
  const canvas = $("#gcanvas"); const wrap = canvas && canvas.parentElement;
  if (!wrap || !wrap.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  G.W = wrap.clientWidth; G.H = wrap.clientHeight;
  canvas.width = G.W * dpr; canvas.height = G.H * dpr;
  if (!G.fitted) { G.tf = { x: G.W / 2, y: G.H / 2, k: 1 }; G.fitted = true; }
}
function toWorld(e) {
  const r = $("#gcanvas").getBoundingClientRect();
  return { x: (e.clientX - r.left - G.tf.x) / G.tf.k, y: (e.clientY - r.top - G.tf.y) / G.tf.k };
}
function pickNode(e) {
  const m = toWorld(e);
  let best = null, bd = 1e9;
  G.nodes.forEach(nd => {
    if (G.hidden.has(nd.type)) return;
    const d = Math.hypot(nd.x - m.x, nd.y - m.y);
    if (d < nd.r + 6 / G.tf.k && d < bd) { best = nd; bd = d; }
  });
  return best;
}

function graphInit() {
  const canvas = $("#gcanvas");
  window.addEventListener("resize", graphFit);
  graphFit();
  let last = { x: 0, y: 0 }, down = { x: 0, y: 0 };
  canvas.addEventListener("pointerdown", e => {
    const nd = pickNode(e);
    last = down = { x: e.clientX, y: e.clientY };
    G.target = null;
    if (nd) G.dragNode = nd; else { G.panning = true; canvas.classList.add("dragging"); }
  });
  window.addEventListener("pointerup", e => {
    const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
    if (click && G.dragNode) selectNode(G.dragNode);
    else if (click && G.panning && e.target === canvas) selectNode(null);
    if (G.dragNode && G.layout !== "force") { G.dragNode.tx = G.dragNode.x; G.dragNode.ty = G.dragNode.y; }
    G.dragNode = null; G.panning = false; canvas.classList.remove("dragging");
  });
  window.addEventListener("pointermove", e => {
    if (!G.active) return;
    if (G.dragNode) {
      G.dragNode.x += (e.clientX - last.x) / G.tf.k; G.dragNode.y += (e.clientY - last.y) / G.tf.k;
      G.alpha = Math.max(G.alpha, 0.35);
    } else if (G.panning) {
      G.tf.x += e.clientX - last.x; G.tf.y += e.clientY - last.y;
    } else if (e.target === canvas) {
      const nd = pickNode(e);
      G.hover = nd; updateTooltip(e, nd);
      canvas.style.cursor = nd ? "pointer" : "grab";
    }
    last = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerleave", () => { G.hover = null; $("#gtooltip").hidden = true; });
  canvas.addEventListener("wheel", e => {
    e.preventDefault(); G.target = null;
    const k2 = Math.min(5, Math.max(0.12, G.tf.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    G.tf.x = mx - (mx - G.tf.x) * (k2 / G.tf.k); G.tf.y = my - (my - G.tf.y) * (k2 / G.tf.k); G.tf.k = k2;
  }, { passive: false });
  canvas.addEventListener("dblclick", e => {
    const nd = pickNode(e);
    if (nd && nd.type === "project") { if (S.line === nd.meta.p.path) openDrawer(nd.meta.p); else drillInto(nd.meta.p.path); }
    else if (nd && nd.type === "category") { $("#gSearch").value = ""; G.search = ""; }
  });

  $("#pngBtn").onclick = exportPNG;
  $("#jsonBtn").onclick = () => {
    const data = { generated: new Date().toISOString(), nodes: G.nodes.map(n => ({ id: n.id, type: n.type, label: n.label, degree: n.deg })),
      edges: G.edges.map(e => ({ source: e.a, target: e.b, label: e.label })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "stackradar-lineage.json"; a.click(); URL.revokeObjectURL(a.href);
    toast("lineage saved as JSON", "ok");
  };
  $("#fitBtn").onclick = () => fitView(true);
  $$("#layoutSeg button").forEach(b => b.onclick = () => {
    G.layout = b.dataset.layout;
    $$("#layoutSeg button").forEach(x => x.classList.toggle("active", x === b));
    applyLayout(false); setTimeout(() => fitView(true), 350);
    if (window.saveSettings) saveSettings({ lineage_layout: G.layout });
  });
  $("#motionToggle").onchange = e => { G.motion = e.target.checked; if (window.saveSettings) saveSettings({ lineage_motion: G.motion }); };
  $("#gSearch").oninput = e => {
    G.search = e.target.value.trim().toLowerCase();
    const hit = G.search && G.nodes.find(n => n.label.toLowerCase().includes(G.search) && !G.hidden.has(n.type));
    if (hit) { G.target = { k: Math.max(G.tf.k, 1.1), x: G.W / 2 - hit.x * Math.max(G.tf.k, 1.1), y: G.H / 2 - hit.y * Math.max(G.tf.k, 1.1) }; }
  };
  requestAnimationFrame(frame);
}

function renderLegend() {
  const counts = {};
  G.nodes.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });
  $("#legend").innerHTML = Object.entries(NODE_TYPES).filter(([t]) => counts[t]).map(([t, v]) =>
    `<button class="lg-item ${G.hidden.has(t) ? "off" : ""}" data-type="${t}" title="click to ${G.hidden.has(t) ? "show" : "hide"} ${v.label}s">
      <span class="lg-dot" style="background:${v.c};box-shadow:0 0 8px ${hexA(v.c, .7)}">${v.icon.length === 1 ? v.icon : ""}</span>${v.label}<span class="lg-n">${counts[t]}</span></button>`).join("");
  $$("#legend .lg-item").forEach(b => b.onclick = () => {
    const t = b.dataset.type;
    G.hidden.has(t) ? G.hidden.delete(t) : G.hidden.add(t);
    renderLegend(); renderGStats();
  });
}
function renderGStats() {
  const vis = G.nodes.filter(n => !G.hidden.has(n.type));
  const shared = G.nodes.filter(n => n.type !== "project" && n.deg > 1).length;
  const el = $("#gStats");
  if (el) el.innerHTML = `<b>${vis.length}</b> nodes · <b>${G.edges.length}</b> links · <b>${shared}</b> shared between projects`;
}

/* ---------------- tooltip & selection ---------------- */

function nodeExtra(nd) {
  const m = nd.meta || {};
  switch (nd.type) {
    case "project": return `${fmtBytes(m.p.size)} · ${m.p.primary_language || "?"} · risk ${m.p.risk_level || "?"}${nd.running ? " · running" : ""}`;
    case "dep": return (m.version ? "pinned " + m.version + " · " : "") + `used by ${nd.deg} project${nd.deg > 1 ? "s" : ""}`;
    case "port": return m.status + (m.proc ? " · " + m.proc : "");
    case "llm": return `${m.tool || ""} · ${(m.in || 0).toLocaleString()} in / ${(m.out || 0).toLocaleString()} out`;
    case "key": return (m.types || []).join(", ");
    case "vcs": return m.remote || "";
    case "skill": return `${m.uses || 0} uses · ${m.agent || ""}`;
    case "schedule": return `${m.kind} · ${m.expr || ""}`;
    case "ai": return (m.full || "") + (m.sessions ? ` · ${m.sessions} sessions · ${fmtNum(m.out)} tokens out` : "");
    case "folder": return fmtBytes(m.size) + (m.dir ? " folder" : " file");
    case "host": return (m.service || "") + (m.file ? " · " + m.file + (m.line ? ":" + m.line : "") : "");
    case "category": return `${nd.deg} project${nd.deg > 1 ? "s" : ""}`;
    default: return `linked to ${nd.deg} project${nd.deg > 1 ? "s" : ""}`;
  }
}
function updateTooltip(e, nd) {
  const tip = $("#gtooltip");
  if (!nd) { tip.hidden = true; return; }
  const r = $("#gcanvas").getBoundingClientRect();
  tip.hidden = false;
  tip.style.left = Math.min(r.width - 260, e.clientX - r.left + 16) + "px";
  tip.style.top = (e.clientY - r.top + 12) + "px";
  const t = NODE_TYPES[nd.type];
  tip.innerHTML = `<div class="gt-type" style="color:${t.c}">${t.icon} ${esc(t.label)}</div><b>${esc(nd.label)}</b><div class="mono small muted">${esc(nodeExtra(nd))}</div>`;
}
function selectNode(nd) {
  G.selNode = nd;
  const info = $("#nodeInfo");
  if (!nd) { info.hidden = true; return; }
  info.hidden = false;
  const t = NODE_TYPES[nd.type], m = nd.meta || {};
  const nbs = [...G.adj.get(nd.id)].map(id => G.byId.get(id)).filter(Boolean);
  let body = `<div class="gt-type" style="color:${t.c}">${t.icon} ${esc(t.label)}</div><b style="font-size:15px">${esc(nd.label)}</b>
    <div class="mono small muted" style="margin:4px 0 8px">${esc(nodeExtra(nd))}</div>`;
  if (nd.type === "project") {
    body += `<div class="small"><span class="path">${esc(m.p.path)}</span></div>
      <div class="small" style="margin-top:6px">${m.p.key_count || 0} secrets · ${(m.p.dependencies || []).length} deps · ${(m.p.schedules || []).length} schedules</div>
      <div class="small">${fmtBytes(m.p.size)} on disk${(m.p.children || []).length ? ` · contains ${m.p.children.length} project(s)` : ""}</div>
      <div class="pill-row" style="margin-top:8px">${S.line !== m.p.path ? `<button class="btn primary small" id="niDrill">🔍 Drill in</button>` : ""}<button class="btn small" id="niOpen">open details →</button><button class="btn small" id="niDisk">▤ folder sizes</button></div>`;
  } else if (nd.type === "folder") {
    body += `<div class="small mono">${esc(m.path)}</div><div class="pill-row" style="margin-top:8px"><button class="btn small" id="niDiskF">▤ open in Disk space</button><button class="btn small" id="niRev">📂 show</button></div>`;
  } else if (nd.type === "host") {
    body += `<div class="small">${m.file ? `referenced in <span class="mono">${esc(m.file)}${m.line ? ":" + m.line : ""}</span>` : ""}${m.risk && m.risk !== "low" ? ` · <span class="sev-${m.risk === "high" ? "high" : "medium"}">${esc(m.risk)} risk</span>` : ""}</div>`;
  } else if (nd.type === "skill" && m.desc) {
    body += `<div class="small muted">${esc(m.desc)}</div>`;
  }
  if (nbs.length) {
    body += `<div class="small muted" style="margin-top:10px">connected to ${nbs.length}:</div><div class="ni-list">` +
      nbs.slice(0, 18).map(x => `<span class="ni-chip" data-nid="${esc(x.id)}" style="border-color:${hexA(NODE_TYPES[x.type].c, .6)}">${NODE_TYPES[x.type].icon} ${esc(x.label)}</span>`).join("") + "</div>";
  }
  info.innerHTML = body;
  const b = $("#niOpen"); if (b) b.onclick = () => openDrawer(m.p);
  const dr = $("#niDrill"); if (dr) dr.onclick = () => drillInto(m.p.path);
  const dk = $("#niDisk"); if (dk && typeof DK !== "undefined") dk.onclick = () => { DK.path = m.p.path; S.tab = "disk"; render(); };
  const dkf = $("#niDiskF"); if (dkf && typeof DK !== "undefined") dkf.onclick = () => { DK.path = m.dir ? m.path : m.path.replace(/[\\/][^\\/]*$/, ""); S.tab = "disk"; render(); };
  const rv = $("#niRev"); if (rv) rv.onclick = () => revealPath(m.path);
  $$("#nodeInfo [data-nid]").forEach(c => c.onclick = () => { const x = G.byId.get(c.dataset.nid); if (x) { selectNode(x); G.target = { k: G.tf.k, x: G.W / 2 - x.x * G.tf.k, y: G.H / 2 - x.y * G.tf.k }; } });
}

/* ---------------- drawing ---------------- */

function frame(now) {
  requestAnimationFrame(frame);
  G.active = S.tab === "lineage" && !!$("#tab-lineage.active");
  if (!G.active) return;
  if (G.alpha > 0.01 || G.dragNode) { simulate(Math.max(G.alpha, G.dragNode ? 0.3 : 0)); G.alpha *= 0.985; }
  if (G.target) {   // smooth camera
    G.tf.x += (G.target.x - G.tf.x) * 0.15; G.tf.y += (G.target.y - G.tf.y) * 0.15; G.tf.k += (G.target.k - G.tf.k) * 0.15;
    if (Math.abs(G.target.k - G.tf.k) < 0.001 && Math.abs(G.target.x - G.tf.x) < 0.5) G.target = null;
  }
  drawGraph(ctxOf($("#gcanvas")), G.W, G.H, (now - G.t0) / 1000, G.tf);
}
function ctxOf(canvas) {
  const ctx = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
function edgeCurve(a, b, seed) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  const bend = G.layout === "columns" ? 0 : 0.12 + seed * 0.08;
  return { cx: mx - dy * bend, cy: my + dx * bend };
}
function bez(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.cx + t * t * b.x, y: u * u * a.y + 2 * u * t * c.cy + t * t * b.y };
}

function drawGraph(ctx, W, H, time, tf) {
  // backdrop: vignette + dot grid
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  bg.addColorStop(0, "#111a2e"); bg.addColorStop(1, "#070a12");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const gs = 34 * tf.k;
  if (gs > 10) {
    ctx.fillStyle = "rgba(120,150,210,0.10)";
    const ox = ((tf.x % gs) + gs) % gs, oy = ((tf.y % gs) + gs) % gs;
    for (let x = ox; x < W; x += gs) for (let y = oy; y < H; y += gs) ctx.fillRect(x, y, 1.2, 1.2);
  }
  const focus = G.selNode || G.hover;
  const nb = focus ? G.adj.get(focus.id) : null;
  const q = G.search;
  const visible = n => !G.hidden.has(n.type);
  const lit = n => !focus || n === focus || (nb && nb.has(n.id));

  ctx.save(); ctx.translate(tf.x, tf.y); ctx.scale(tf.k, tf.k);

  // edges
  G.edges.forEach(e => {
    const a = G.byId.get(e.a), b = G.byId.get(e.b);
    if (!a || !b || !visible(a) || !visible(b)) return;
    const on = !focus || ((a === focus || b === focus));
    const c = edgeCurve(a, b, e.seed);
    const ca = a.type === "project" ? (a.color || NODE_TYPES.project.c) : NODE_TYPES[a.type].c;
    const cb = b.type === "project" ? (b.color || NODE_TYPES.project.c) : NODE_TYPES[b.type].c;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    const al = on ? (focus ? 0.85 : 0.42) : 0.06;
    grad.addColorStop(0, hexA(ca, al)); grad.addColorStop(1, hexA(cb, al));
    ctx.strokeStyle = grad;
    ctx.lineWidth = (e.kind === "port-exp" ? 1 : 1.6) * (on && focus ? 1.6 : 1);
    ctx.setLineDash(e.kind === "port-exp" ? [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.cx, c.cy, b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    // flowing particles
    if (G.motion && on && e.kind !== "port-exp") {
      const n = focus ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const t = ((time * 0.35 + e.seed + i / n) % 1);
        const p = bez(a, c, b, t);
        ctx.fillStyle = hexA(t < 0.5 ? ca : cb, focus ? 0.95 : 0.7);
        ctx.beginPath(); ctx.arc(p.x, p.y, focus ? 2.2 : 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (focus && on && e.label && tf.k > 0.6) {
      const p = bez(a, c, b, 0.5);
      ctx.font = "10px -apple-system, Segoe UI, sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(200,210,230,.8)"; ctx.fillText(e.label, p.x, p.y - 3);
    }
  });

  // nodes
  const order = G.nodes.slice().sort((x, y) => (x.type === "project") - (y.type === "project"));
  order.forEach(nd => {
    if (!visible(nd)) return;
    const t = NODE_TYPES[nd.type];
    const col = nd.type === "project" ? (nd.color || t.c) : t.c;
    const hit = q && nd.label.toLowerCase().includes(q);
    const dim = (focus && !lit(nd)) || (q && !hit);
    ctx.globalAlpha = dim ? 0.13 : 1;
    const r = nd.r * (nd === focus ? 1.15 : 1);
    // glow
    ctx.shadowColor = hexA(col, dim ? 0 : 0.85); ctx.shadowBlur = nd === focus || hit ? 26 : (nd.type === "project" ? 16 : 9);
    const g = ctx.createRadialGradient(nd.x - r * 0.35, nd.y - r * 0.35, r * 0.1, nd.x, nd.y, r);
    g.addColorStop(0, hexA(col, 0.95)); g.addColorStop(0.65, hexA(col, 0.55)); g.addColorStop(1, hexA(col, 0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    if (nd.type === "project") roundHex(ctx, nd.x, nd.y, r); else ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = nd === focus ? 2.4 : 1.3; ctx.strokeStyle = hexA(col, 1); ctx.stroke();
    // halos: running (pulsing good-status ring) / high risk (critical ring)
    if (nd.type === "project" && (nd.running || nd.risk === "high")) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + nd.phase);
      ctx.strokeStyle = nd.running ? hexA("#0ca30c", 0.4 + 0.5 * pulse) : hexA("#d03b3b", 0.35 + 0.4 * pulse);
      ctx.lineWidth = 2; ctx.setLineDash(nd.running ? [] : [5, 4]);
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r + 6 + pulse * 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (nd.type === "port" && nd.meta.open) {
      const pulse = (time * 0.8 + nd.phase) % 1;
      ctx.strokeStyle = hexA(t.c, 0.6 * (1 - pulse)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r + pulse * 12, 0, Math.PI * 2); ctx.stroke();
    }
    // icon
    const isz = Math.max(7, r * (nd.type === "project" ? 0.95 : 0.95));
    ctx.font = `${isz}px -apple-system, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
    ctx.fillText(nd.type === "project" ? nd.label.slice(0, 1).toUpperCase() : t.icon, nd.x, nd.y + 0.5);
    ctx.textBaseline = "alphabetic";
    // label pill
    const show = nd.type === "project" || tf.k > 0.75 || nd === focus || (nb && nb.has(nd.id)) || hit || nd.deg > 1;
    if (show && !dim) {
      const fs = nd.type === "project" ? 12.5 : 10.5;
      ctx.font = `${nd.type === "project" ? "700 " : "500 "}${fs}px -apple-system, "Segoe UI", sans-serif`;
      const label = nd.label.length > 28 ? nd.label.slice(0, 27) + "…" : nd.label;
      const w = ctx.measureText(label).width + 12;
      const side = G.layout === "columns" && nd.type !== "project";
      const lx = side ? nd.x + r + 6 : nd.x - w / 2, y = side ? nd.y - (fs + 7) / 2 : nd.y + r + 8;
      ctx.fillStyle = "rgba(9,12,20,.82)"; ctx.strokeStyle = hexA(col, 0.45); ctx.lineWidth = 1;
      roundRect(ctx, lx, y, w, fs + 7, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = nd.type === "project" ? "#f1f4fa" : "#c9d2e3"; ctx.textAlign = "center";
      ctx.fillText(label, lx + w / 2, y + fs + 1.5);
    }
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function roundHex(ctx, x, y, r) {
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function exportPNG() {
  const scale = 2, c = document.createElement("canvas");
  c.width = G.W * scale; c.height = G.H * scale;
  const ctx = c.getContext("2d"); ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawGraph(ctx, G.W, G.H, (performance.now() - G.t0) / 1000, G.tf);
  ctx.font = "600 13px -apple-system, sans-serif"; ctx.fillStyle = "rgba(220,228,245,.75)"; ctx.textAlign = "left";
  ctx.fillText("StackRadar lineage · " + new Date().toLocaleString(), 16, G.H - 16);
  const a = document.createElement("a");
  a.download = "stackradar-lineage.png"; a.href = c.toDataURL("image/png"); a.click();
  toast("lineage saved as PNG", "ok");
}

function drillInto(path) {
  S.line = path;
  const sel = $("#lineageSel"); if (sel) sel.value = path;
  buildGraph(path); updateLineageCrumb();
}
function updateLineageCrumb() {
  let c = $("#lineageCrumb");
  if (!c) { c = document.createElement("div"); c.id = "lineageCrumb"; c.className = "lineage-crumb"; const w = $(".lineage-wrap"); if (w) w.appendChild(c); }
  const p = (S.data.projects || []).find(x => x.path === S.line);
  c.hidden = !p;
  if (p) {
    c.innerHTML = `<button class="btn small" id="lcBack">← all projects</button> <b>${esc(p.name)}</b> <span class="muted small">${fmtBytes(p.size)} · double-click a project to drill in, again to open it</span>`;
    $("#lcBack").onclick = () => { S.line = "all"; $("#lineageSel").value = "all"; buildGraph("all"); updateLineageCrumb(); };
  }
}
window.drillInto = drillInto;
function renderLineage() {
  requestAnimationFrame(graphFit);
  const P = S.data.projects || [];
  const sel = $("#lineageSel");
  sel.innerHTML = `<option value="all">all projects (${P.length})</option>` + P.map(p => `<option value="${esc(p.path)}">${esc(p.name)}</option>`).join("");
  if (S.line !== "all" && !P.some(p => p.path === S.line)) S.line = "all";
  sel.value = S.line;
  sel.onchange = () => { S.line = sel.value; buildGraph(S.line); updateLineageCrumb(); };
  if (typeof SETTINGS !== "undefined") {
    G.layout = SETTINGS.lineage_layout || G.layout; G.motion = SETTINGS.lineage_motion !== false;
    $$("#layoutSeg button").forEach(x => x.classList.toggle("active", x.dataset.layout === G.layout));
    $("#motionToggle").checked = G.motion;
  }
  const lh = $("#lineageHint"); if (lh) lh.innerHTML = window.tabHint ? tabHint("lineage") : "";
  requestAnimationFrame(() => { graphFit(); buildGraph(S.line); updateLineageCrumb(); });
}
RENDERERS.lineage = renderLineage;
