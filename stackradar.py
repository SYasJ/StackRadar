#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
StackRadar — a local radar for your developer workspace.

Copyright (c) 2026 Yasir Jilani. Free for personal, non-commercial use under the
PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use: see COMMERCIAL.md.

Scans a folder tree and tells you, for every project/repo/app it finds:
  * what it is (purpose, language, framework), where it lives, how big it is
  * how to run it + what it needs (dependencies, env, ports)
  * which ports it should use and which are actually open right now
  * API keys / secrets found (masked, never sent anywhere)
  * risk flags (rough vulnerability check)
  * when it was last run, running processes
  * version control (git branch / remote / commits / dirty state)
  * where it came from (git remote host, docker registry, "local only")
  * AI / IDE traces (Claude Code, Cursor, VS Code, Windsurf, Antigravity...)
    incl. LLM model + input/output token usage when logs exist
  * document types + natural language of docs
  * installed packages (project venv/node_modules + global npm/pip/brew/docker)
  * terminal environment (shell, rc files, exports, aliases, PATH)

Plus: interactive lineage graph, and safe delete / move / rename actions
to reclaim space.

100% local. Python 3.9+ standard library only. Nothing ever leaves your machine.

Usage:
  python3 stackradar.py [--port 8765] [--root PATH ...] [--depth 6] [--open]
"""

import argparse
import concurrent.futures
import hashlib
import secrets as secretsmod
import glob as globmod
import json
import os
import platform
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# when frozen by PyInstaller (desktop build) the UI files live in the bundle dir
APP_DIR = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
OS_NAME = platform.system()  # 'Darwin' | 'Linux' | 'Windows'


def _read_version():
    for d in (APP_DIR, os.path.dirname(os.path.abspath(__file__))):
        try:
            with open(os.path.join(d, "VERSION")) as f:
                return f.read().strip()
        except Exception:
            continue
    return "0.0.0"


VERSION = _read_version()
# per-launch secret: every state-changing request must carry it (blocks CSRF from
# other websites open in your browser). It is injected into index.html only.
API_TOKEN = secretsmod.token_urlsafe(24)

# dirs that we SIZE but never descend into (contents are not interesting)
CONTENT_SKIP_DIRS = {
    "node_modules", "site-packages", ".git", "venv", ".venv", "env", ".env-dir",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".next", ".nuxt",
    ".cache", ".npm", ".turbo", ".venv-tmp",
}
# top-level hidden dirs we never even enter
TOP_SKIP_DIRS = {".Trash", ".trash", ".git", ".hg", ".svn"}

MAX_READ_BYTES = 300_000          # per file for pattern scanning
MAX_DETAIL_FILES = 600            # per project file-level work cap
MAX_LINE_LEN = 500

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def fmt_bytes(n):
    try:
        n = float(n)
    except Exception:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return ("%.0f " if unit == "B" else "%.1f ") % n + unit
        n /= 1024.0
    return "?"


def fmt_ago(ts):
    if not ts:
        return "never / unknown"
    d = time.time() - ts
    if d < 90:
        return "just now"
    if d < 3600:
        return "%d min ago" % int(d // 60)
    if d < 86400:
        return "%d h ago" % int(d // 3600)
    if d < 86400 * 30:
        return "%d days ago" % int(d // 86400)
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def run_cmd(args, timeout=15, cwd=None):
    """Run a command, return (ok, stdout_text). Never raises."""
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception:
        return False, ""


def read_head(path, limit=MAX_READ_BYTES):
    try:
        with open(path, "rb") as f:
            return f.read(limit).decode("utf-8", "replace")
    except Exception:
        return ""


def walk_files(root, cap_files=MAX_DETAIL_FILES, cap_bytes=4_000_000,
               include_hidden=True, skip_dirs=None):
    """Collect file paths under root, pruning big dep dirs. Returns (paths, truncated)."""
    skip = set(skip_dirs or ()) | CONTENT_SKIP_DIRS | {".git"}
    out, files, total = [], 0, 0
    truncated = False
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except Exception:
            continue
        with it:
            entries = sorted(it, key=lambda e: e.name)
        for e in entries:
            try:
                name = e.name
                if e.is_symlink():
                    continue
                if e.is_dir(follow_symlinks=False):
                    if name in skip:
                        continue
                    stack.append(e.path)
                elif e.is_file(follow_symlinks=False):
                    if files >= cap_files:
                        truncated = True
                        break
                    files += 1
                    out.append(e.path)
                    try:
                        total += e.stat(follow_symlinks=False).st_size
                    except Exception:
                        pass
                    if total > cap_bytes:
                        truncated = True
                        break
            except Exception:
                continue
        if truncated:
            break
    return out, truncated


def fast_dir_size(path):
    """Size of a whole tree without recording anything (for pruned dirs)."""
    total, files = 0, 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except Exception:
            continue
        with it:
            for e in it:
                try:
                    if e.is_symlink():
                        continue
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                    elif e.is_file(follow_symlinks=False):
                        s = e.stat(follow_symlinks=False).st_size
                        total += s
                        files += 1
                except Exception:
                    pass
    return total, files


def mask_value(v):
    v = v.strip().strip("'\"")
    if len(v) <= 8:
        return v[:1] + "…" if v else "…"
    return v[:4] + "…" + v[-2:]


# ---------------------------------------------------------------------------
# language / docs detection
# ---------------------------------------------------------------------------

EXT_LANG = {
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".py": "Python", ".rs": "Rust", ".go": "Go", ".rb": "Ruby", ".php": "PHP",
    ".java": "Java", ".c": "C", ".cpp": "C++", ".cc": "C++", ".h": "C/C++ header",
    ".hpp": "C++", ".cs": "C#", ".swift": "Swift", ".kt": "Kotlin", ".kts": "Kotlin",
    ".scala": "Scala", ".lua": "Lua", ".pl": "Perl", ".r": "R", ".jl": "Julia",
    ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".ps1": "PowerShell",
    ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "SCSS", ".sass": "Sass",
    ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte", ".ex": "Elixir", ".exs": "Elixir",
    ".erl": "Erlang", ".zig": "Zig", ".dart": "Dart", ".fs": "F#", ".fsx": "F#",
    ".m": "Objective-C", ".mm": "Objective-C++", ".groovy": "Groovy", ".nim": "Nim",
    ".hs": "Haskell", ".clj": "Clojure",
}
DOC_TYPES = {
    ".md": "Markdown", ".rst": "reStructuredText", ".adoc": "AsciiDoc",
    ".pdf": "PDF", ".doc": "Word (legacy)", ".docx": "Word", ".txt": "Plain text",
    ".rtf": "RTF", ".csv": "CSV", ".tsv": "TSV", ".json": "JSON", ".xml": "XML",
    ".yaml": "YAML", ".yml": "YAML", ".xlsx": "Excel", ".xls": "Excel (legacy)",
    ".pptx": "PowerPoint", ".ppt": "PowerPoint (legacy)",
    ".ipynb": "Jupyter notebook", ".html": "HTML",
}
SOURCE_EXTS = set(EXT_LANG) - {".html", ".htm", ".css", ".scss", ".sass", ".sql", ".zsh", ".ps1"}

_WORD_MAP = {
    "en": ["the", "and", "for", "with", "this", "that", "you", "use", "run", "install", "app", "server", "test"],
    "fr": ["le", "la", "les", "pour", "avec", "vous", "une", "est", "dans", "qui"],
    "es": ["que", "para", "con", "los", "las", "una", "por", "como", "ser", "está"],
    "de": ["und", "der", "die", "das", "für", "mit", "ist", "nicht", "auch", "eine"],
    "pt": ["que", "para", "com", "uma", "por", "não", "ser", "está", "os", "das"],
    "it": ["che", "per", "con", "una", "sono", "non", "anche", "della", "questo"],
    "nl": ["en", "het", "een", "voor", "met", "zijn", "niet", "ook", "de", "dat"],
}
_WORD_RE = {}
for _lang, _words in _WORD_MAP.items():
    _WORD_RE[_lang] = re.compile(r"\b(" + "|".join(re.escape(w) for w in _words) + r")\b", re.I)


def detect_natural_lang(text):
    if not text or len(text) < 20:
        return "n/a"
    if re.search(r"[\u4e00-\u9fff]", text):
        return "Chinese/Japanese (CJK)"
    if re.search(r"[\u3040-\u30ff]", text):
        return "Japanese"
    if re.search(r"[\uac00-\ud7af]", text):
        return "Korean"
    if re.search(r"[\u0400-\u04ff]", text):
        return "Cyrillic (Russian/Ukrainian/…)"
    if re.search(r"[\u0600-\u06ff]", text):
        return "Arabic"
    if re.search(r"[\u0e00-\u0e7f]", text):
        return "Thai"
    if not re.search(r"[A-Za-z]", text):
        return "non-Latin"
    best, best_score = "English", 0
    for lang, rx in _WORD_RE.items():
        s = len(rx.findall(text.lower()))
        if s > best_score:
            best, best_score = lang, s
    return best.capitalize() if best != "n/a" else "English (guess)"


# ---------------------------------------------------------------------------
# secret + risk patterns
# ---------------------------------------------------------------------------

SECRET_PATTERNS = [
    # (name, regex, severity, value-group-index)
    ("AWS Access Key ID", re.compile(r"AKIA[0-9A-Z]{16}"), "high", 0),
    ("AWS Secret Key", re.compile(r"(?i)aws.{0,12}secret.{0,20}?[=:]\s*['\"]?([A-Za-z0-9/+=]{28,40})"), "high", 1),
    ("OpenAI API key", re.compile(r"sk-[A-Za-z0-9_-]{20,}"), "high", 0),
    ("Anthropic API key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "high", 0),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_-]{30,35}"), "high", 0),
    ("Slack token", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}"), "high", 0),
    ("GitHub token", re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}"), "high", 0),
    ("Stripe key", re.compile(r"(sk|pk|rk)_(live|test)_[0-9a-zA-Z]{10,}"), "high", 0),
    ("JWT token", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}"), "medium", 0),
    ("Private key block", re.compile(r"BEGIN (?:RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY"), "high", 0),
    ("DB connection string w/ password", re.compile(r"(?:postgres|mysql|mongodb(?:\+srv)?|redis|amqp)://[\w.+\-]+:[^\s'\" ]{3,}@[\w.\-]+"), "high", 0),
    ("Generic secret assignment", re.compile(r"(?i)(api[_-]?key|secret|access[_-]?token|auth[_-]?token|passwd|password)\s*[:=]\s*['\"]?([A-Za-z0-9+/_@\-]{12,40})['\"]?"), "medium", 2),
]

RISK_PATTERNS = [
    ("TLS verification disabled", re.compile(r"verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*[\"']?0|-k\s+$"), "high"),
    ("Web framework debug mode", re.compile(r"app\.run\(.*debug\s*=\s*True|DEBUG\s*=\s*(?:True|true|\"?1)"), "medium"),
    ("eval()/exec() usage", re.compile(r"\beval\s*\(|\bexec\s*\("), "medium"),
    ("pickle deserialization", re.compile(r"pickle\.loads?\(|cPickle\.loads?\("), "medium"),
    ("Unsafe YAML load", re.compile(r"yaml\.load\((?![^)]*Loader)"), "medium"),
    ("subprocess shell=True", re.compile(r"shell\s*=\s*True"), "low"),
    ("os.system usage", re.compile(r"os\.system\s*\("), "low"),
    ("Plain-HTTP external URL", re.compile(r"http://(?!localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com|\[::1\])"), "low"),
    ("Wide-open bind 0.0.0.0", re.compile(r"(host|bind)[\"']?\s*[=:]\s*[\"']0\.0\.0\.0"), "info"),
]

SECRET_FILE_HINTS = re.compile(
    r"(^|/)(\.env|.*\.env\..*|config.*\.(ini|cfg|conf|json|ya?ml|toml|properties)$|.*\.pem$|id_rsa$|credentials.*|secrets.*|.*\.sqlite$|.*\.db$)"
)
CODE_EXT_SCAN = {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rb", ".sh", ".php", ".java", ".cs",
                 ".yml", ".yaml", ".json", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env",
                 ".xml", ".sql", ".tf", ".tfvars", ".mjs", ".c", ".cpp", ".rs"}


def scan_secrets(files):
    found = []
    claimed = []

    def _add(fp, line_no, name, sev, span, val):
        # skip if this match overlaps a span already claimed by a specific pattern
        for s, e in claimed:
            if s < span[1] and e > span[0]:
                return
        if name == "Generic secret assignment" and len(val) < 12:
            return
        claimed.append(span)
        found.append({"type": name, "severity": sev, "file": fp, "line": line_no,
                      "masked": mask_value(val)})

    for fp in files:
        text = read_head(fp)
        if not text:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            if len(line) > MAX_LINE_LEN:
                continue
            claimed.clear()
            # pass 1: specific patterns (in priority order)
            for name, rx, sev, vgroup in SECRET_PATTERNS:
                if name == "Generic secret assignment":
                    continue
                for m in rx.finditer(line):
                    try:
                        val = m.group(vgroup) if vgroup <= len(m.groups()) else m.group(0)
                    except Exception:
                        val = m.group(0)
                    _add(fp, line_no, name, sev, (m.start(), m.end()), val)
                    if len(found) >= 60:
                        break
                if len(found) >= 60:
                    break
            if len(found) >= 60:
                break
            # pass 2: generic pattern, only in regions not claimed by pass 1
            gname, grx, gsev, gv = SECRET_PATTERNS[-1]
            for m in grx.finditer(line):
                _add(fp, line_no, gname, gsev, (m.start(2), m.end(2)), m.group(2))
                if len(found) >= 60:
                    break
        if len(found) >= 60:
            break

    # dedupe by (file, line, type)
    seen, out = set(), []
    for f in found:
        k = (f["file"], f["line"], f["type"])
        if k not in seen:
            seen.add(k)
            out.append(f)
    return out


def scan_risks(files, root, has_gitignore, gitignore_text, env_files):
    flags = []
    todos = 0
    for fp in files:
        text = read_head(fp)
        if not text:
            continue
        todos += len(re.findall(r"TODO|FIXME|HACK", text))
        for name, rx, sev in RISK_PATTERNS:
            m = rx.search(text)
            if m:
                flags.append({"label": name, "severity": sev,
                              "file": os.path.relpath(fp, root)})
                if len(flags) >= 30:
                    break
        if len(flags) >= 30:
            break
    if env_files and has_gitignore and not re.search(r"(^|\n)\s*(\.env|.*\.env)\s*(\n|$)|\.env\*", gitignore_text):
        flags.insert(0, {"label": ".env file not ignored by git — secrets may be committed", "severity": "high", "file": ".env"})
    if env_files and not has_gitignore:
        flags.insert(0, {"label": ".env file exists and there is no .gitignore at all", "severity": "high", "file": ".env"})
    if not has_gitignore and not env_files:
        flags.append({"label": "No .gitignore present", "severity": "low", "file": ".gitignore"})
    sev_rank = {"high": 5, "medium": 2, "low": 1, "info": 0}
    score = sum(sev_rank[f["severity"]] for f in flags)
    if score >= 8:
        level = "high"
    elif score >= 3:
        level = "medium"
    else:
        level = "low"
    return flags, todos, level, score


# ---------------------------------------------------------------------------
# manifest parsing
# ---------------------------------------------------------------------------

def parse_package_json(path):
    try:
        data = json.loads(read_head(path, 500_000))
    except Exception:
        return {}
    return data


def parse_toml_simple(path):
    try:
        import tomllib
        with open(path, "rb") as f:
            return tomllib.load(f)
    except Exception:
        return {}


def parse_requirements(path):
    deps = []
    for line in read_head(path, 200_000).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        m = re.match(r"([A-Za-z0-9._-]+)\s*([=<>!~]=?)\s*([^\s;#]+)", line)
        if m:
            deps.append({"name": m.group(1), "version": m.group(3)})
        else:
            m = re.match(r"([A-Za-z0-9._-]+)\s*[,<>=!~\s]", line)
            if m:
                deps.append({"name": m.group(1), "version": None})
    return deps


def parse_compose_ports(text):
    ports = []
    for m in re.finditer(r"^\s*-\s*[\"']?(\d+)(?::(\d+))?[\"']?\s*$", text, re.M):
        ports.append(int(m.group(2) or m.group(1)))
    for m in re.finditer(r"ports\s*:\s*(\d+:\d+|\d+)", text):
        p = m.group(1).split(":")
        ports.append(int(p[0]))
    return sorted(set(ports))


def parse_compose_images(text):
    imgs = []
    for m in re.finditer(r"image\s*:\s*[\"']?([\w.\-/:]+)", text):
        imgs.append(m.group(1))
    return imgs


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------

def scan_git(root):
    gdir = os.path.join(root, ".git")
    info = {"vcs": None, "branch": None, "remote": None, "remote_host": None,
            "last_commit": None, "last_author": None, "last_date": None,
            "commit_count": None, "dirty_files": None}
    if not os.path.exists(gdir):
        if os.path.exists(os.path.join(root, ".hg")):
            info["vcs"] = "Mercurial"
        elif os.path.exists(os.path.join(root, ".svn")):
            info["vcs"] = "Subversion"
        return info
    info["vcs"] = "Git"
    git = shutil.which("git")
    if git:
        ok, out = run_cmd([git, "-C", root, "branch", "--show-current"], timeout=8)
        info["branch"] = out.strip() or None
        ok, out = run_cmd([git, "-C", root, "remote"], timeout=8)
        remotes = [r for r in out.split() if r]
        origin = "origin" if remotes else (remotes[0] if remotes else None)
        if origin:
            ok, out = run_cmd([git, "-C", root, "remote", "get-url", origin], timeout=8)
            url = out.strip()
            if url:
                info["remote"] = url
                m = re.match(r"(?:https?|git|ssh)://([^/]+)/", url)
                if m:
                    info["remote_host"] = m.group(1)
                m = re.match(r"[\w.-]+@([\w.-]+):", url)
                if m:
                    info["remote_host"] = m.group(1)
        ok, out = run_cmd([git, "-C", root, "log", "-1", "--format=%H%x09%an%x09%at%x09%s"], timeout=8)
        if ok and out.strip():
            parts = out.strip().split("\t")
            if len(parts) == 4:
                info["last_commit"], info["last_author"] = parts[0][:10], parts[1]
                try:
                    info["last_date"] = int(parts[2])
                except Exception:
                    pass
                info["last_subject"] = parts[3]
        ok, out = run_cmd([git, "-C", root, "rev-list", "--count", "HEAD"], timeout=15)
        if ok and out.strip().isdigit():
            info["commit_count"] = int(out.strip())
        ok, out = run_cmd([git, "-C", root, "status", "--porcelain"], timeout=15)
        info["dirty_files"] = len([l for l in out.splitlines() if l.strip()])
    else:
        # no git binary: read config manually
        cfg = read_head(os.path.join(gdir, "config"), 50_000)
        m = re.search(r'\[remote "origin"\]\s*url\s*=\s*(\S+)', cfg)
        if m:
            info["remote"] = m.group(1)
            mm = re.match(r"(?:https?|git|ssh)://([^/]+)/", m.group(1))
            if mm:
                info["remote_host"] = mm.group(1)
        head = read_head(os.path.join(gdir, "HEAD"), 2_000)
        m = re.match(r"ref:\s*refs/heads/(\S+)", head.strip())
        if m:
            info["branch"] = m.group(1)
    return info


# ---------------------------------------------------------------------------
# AI / IDE traces + LLM token usage
# ---------------------------------------------------------------------------

AI_MARKERS = [
    (".claude", "Claude Code (Anthropic)"),
    ("CLAUDE.md", "Claude Code (Anthropic)"),
    (".cursor", "Cursor"),
    (".cursorrules", "Cursor"),
    ("cursorrules", "Cursor"),
    (".vscode", "VS Code"),
    (".idea", "JetBrains IDE (IntelliJ/PyCharm/WebStorm/CLion)"),
    (".windsurf", "Windsurf"),
    (".gemini", "Gemini CLI"),
    (".copilot", "GitHub Copilot"),
    (".cline", "Cline"),
    (".roo", "Roo Code"),
    (".aider", "Aider"),
    (".lingma", "Lingma"),
    (".antigravity", "Antigravity (Google)"),
    (".vibe", "Vibe coding"),
]


def _claude_project_encoding(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def claude_usage_for(project_path):
    """Parse ~/.claude/projects/<encoded-path>/*.jsonl for token usage."""
    base = os.path.expanduser(os.path.join("~", ".claude", "projects"))
    enc = _claude_project_encoding(os.path.abspath(project_path))
    result = {"model": None, "tokens_in": 0, "tokens_out": 0,
              "cache_read": 0, "cache_write": 0, "sessions": 0, "last": None,
              "user_msgs": 0, "assistant_msgs": 0}
    d = os.path.join(base, enc)
    if not os.path.isdir(d):
        return None
    total_bytes = 0
    models = {}
    for fp in globmod.glob(os.path.join(d, "*.jsonl")):
        try:
            sz = os.path.getsize(fp)
        except Exception:
            continue
        if sz > 8_000_000 or total_bytes > 20_000_000:
            continue
        total_bytes += sz
        result["sessions"] += 1
        try:
            mtime = os.path.getmtime(fp)
            if result["last"] is None or mtime > result["last"]:
                result["last"] = mtime
        except Exception:
            pass
        with open(fp, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or '"usage"' not in line and '"model"' not in line and '"type"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                t = obj.get("type")
                msg = obj.get("message") or {}
                if t == "assistant" and isinstance(msg, dict):
                    result["assistant_msgs"] += 1
                    model = msg.get("model")
                    if model:
                        models[model] = models.get(model, 0) + 1
                    usage = msg.get("usage") or {}
                    if usage:
                        result["tokens_in"] += int(usage.get("input_tokens") or 0)
                        result["tokens_out"] += int(usage.get("output_tokens") or 0)
                        result["cache_read"] += int(usage.get("cache_read_input_tokens") or 0)
                        result["cache_write"] += int(usage.get("cache_creation_input_tokens") or 0)
                elif t == "user":
                    result["user_msgs"] += 1
    if models:
        result["model"] = max(models.items(), key=lambda kv: kv[1])[0]
        result["models"] = models
    return result


def cursor_usage_best_effort():
    """Very best-effort: look for token usage in Cursor's sqlite state."""
    cands = []
    home = os.path.expanduser("~")
    if OS_NAME == "Darwin":
        cands.append(os.path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"))
    elif OS_NAME == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            cands.append(os.path.join(appdata, "Cursor", "User", "globalStorage", "state.vscdb"))
    else:
        cands.append(os.path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"))
    for db in cands:
        if not os.path.isfile(db):
            continue
        try:
            con = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=2)
            cur = con.cursor()
            cur.execute("SELECT key FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%session%' OR key LIKE '%usage%' LIMIT 50")
            keys = [r[0] for r in cur.fetchall()]
            con.close()
            if keys:
                return {"db": db, "chat_keys": len(keys)}
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# listeners / processes
# ---------------------------------------------------------------------------

def get_listeners_linux():
    """Use ss if available, else /proc. Returns [{port, pid, proc}]."""
    out = []
    if shutil.which("ss"):
        ok, text = run_cmd(["ss", "-H", "-tlnp"], timeout=8)
        if ok:
            for line in text.splitlines():
                parts = line.split()
                if len(parts) < 5:
                    continue
                laddr = parts[3]
                m = re.match(r"^(.*):(\d+)$", laddr)
                if not m:
                    continue
                port = int(m.group(2))
                pid, proc = None, None
                pm = re.search(r"pid=(\d+)", line)
                nm = re.search(r'name="([^"]+)"', line) or re.search(r'\("([^"]+)",pid=', line)
                if pm:
                    pid = int(pm.group(1))
                if nm:
                    proc = nm.group(1)
                out.append({"port": port, "pid": pid, "proc": proc})
            if out:
                return out
    # /proc fallback
    try:
        inodes = {}
        for f in ("/proc/net/tcp", "/proc/net/tcp6"):
            if not os.path.isfile(f):
                continue
            for line in open(f).readlines()[1:]:
                parts = line.split()
                if len(parts) < 12 or parts[3] != "0A":
                    continue
                try:
                    port = int(parts[1].split(":")[1], 16)
                except Exception:
                    continue
                inodes[parts[10]] = {"port": port, "pid": None, "proc": None}
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open("/proc/%s/comm" % pid) as f:
                    comm = f.read().strip()
                for fd in os.listdir("/proc/%s/fd" % pid):
                    try:
                        link = os.readlink("/proc/%s/fd/%s" % (pid, fd))
                    except Exception:
                        continue
                    if link.startswith("socket:["):
                        key = link[8:-1]
                        if key in inodes:
                            inodes[key]["pid"] = int(pid)
                            inodes[key]["proc"] = comm
            except Exception:
                continue
        out = list(inodes.values())
    except Exception:
        pass
    return out


def get_listeners_mac():
    out = []
    ok, text = run_cmd(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpnt"], timeout=15)
    if not ok:
        return out
    cur = {}
    for line in text.splitlines():
        if line.startswith("n"):
            m = re.search(r":(\d+)\s*\(LISTEN\)", line)
            if m:
                cur["port"] = int(m.group(1))
        elif line.startswith("p"):
            cur["pid"] = int(line[1:])
        elif line.startswith("c"):
            cur["proc"] = line[1:]
        elif line.startswith("/"):
            cur["name"] = line[1:]
        elif line.startswith("a"):
            if "port" in cur:
                out.append({"port": cur["port"], "pid": cur.get("pid"),
                            "proc": cur.get("proc") or cur.get("name")})
            cur = {}
    return out


def get_listeners_windows():
    out = []
    ok, text = run_cmd(["netstat", "-ano"], timeout=10)
    if not ok:
        return out
    for line in text.splitlines():
        if "LISTENING" in line:
            parts = line.split()
            if len(parts) >= 5:
                m = re.match(r"^(.*):(\d+)$", parts[1])
                if m:
                    try:
                        out.append({"port": int(m.group(2)), "pid": int(parts[-1]), "proc": None})
                    except Exception:
                        pass
    return out


def get_cwd_mac(pid):
    ok, text = run_cmd(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], timeout=4)
    for line in text.splitlines():
        if line.startswith("n"):
            return line[1:]
    return None


def get_all_cwd_mac():
    """Single lsof pass: {pid: cwd}."""
    res = {}
    ok, text = run_cmd(["lsof", "-a", "-d", "cwd", "-Fn", "-w"], timeout=25)
    if not ok:
        return res
    pid = None
    for line in text.splitlines():
        if line.startswith("p"):
            try:
                pid = int(line[1:])
            except Exception:
                pid = None
        elif line.startswith("n") and pid:
            res[pid] = line[1:]
    return res


def get_processes_linux():
    procs = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open("/proc/%s/cmdline" % pid, "rb") as f:
                cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
            cwd = os.readlink("/proc/%s/cwd" % pid)
            with open("/proc/%s/comm" % pid) as f:
                comm = f.read().strip()
            procs.append({"pid": int(pid), "cmd": cmd[:300] or comm, "cwd": cwd})
        except Exception:
            continue
    return procs


def get_processes_mac():
    ok, text = run_cmd(["ps", "-axww", "-o", "pid=,comm="], timeout=10)
    if not ok:
        return []
    procs = []
    for line in text.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            try:
                procs.append({"pid": int(parts[0]), "cmd": parts[1][:300], "cwd": None})
            except Exception:
                continue
    cwds = get_all_cwd_mac()
    for p in procs:
        p["cwd"] = cwds.get(p["pid"])
    return procs


def get_processes_windows():
    procs = []
    ok, text = False, ""
    if shutil.which("wmic"):
        ok, text = run_cmd(["wmic", "process", "get", "ProcessId,CommandLine", "/format:csv"], timeout=15)
    if not ok:
        ok, text = run_cmd(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process | ForEach-Object { \"x,$($_.ProcessId),$($_.CommandLine)\" }"],
                           timeout=25)
        if ok:
            for line in text.splitlines():
                parts = line.strip().split(",", 2)
                if len(parts) == 3 and parts[1].isdigit() and parts[2]:
                    procs.append({"pid": int(parts[1]), "cmd": parts[2][:300], "cwd": None})
            return procs
    if ok:
        for line in text.splitlines()[1:]:
            m = re.match(r".*?(\d+),(.*)$", line.strip())
            if m and m.group(2):
                procs.append({"pid": int(m.group(1)), "cmd": m.group(2)[:300], "cwd": None})
    return procs


# ---------------------------------------------------------------------------
# shell history (last-run heuristic)
# ---------------------------------------------------------------------------

def sanitize_cmd(s):
    """Redact secret-looking values out of a shell command line."""
    if not s:
        return s
    for name, rx, sev, vgroup in SECRET_PATTERNS:
        s = rx.sub(lambda m: (m.group(0)[:4] + "…REDACTED") if len(m.group(0)) > 8 else "REDACTED", s)
    return s


def scan_shell_history(project_path, base_name):
    hits = []
    home = os.path.expanduser("~")
    cands = [
        os.path.join(home, ".zsh_history"),
        os.path.join(home, ".bash_history"),
        os.path.join(home, ".local", "share", "fish", "fish_history"),
    ]
    rx = re.compile(re.escape(base_name) + r"(\b|[\\/])")
    run_rx = re.compile(r"(cd\s|npm|pnpm|yarn|npx|pip|python|python3|uvicorn|flask|django|docker|cargo|go\s+run|bundle|make|gradle|just|poetry|uv\s)")
    for fp in cands:
        if not os.path.isfile(fp):
            continue
        text = read_head(fp, 2_000_000)
        t_re = None
        if fp.endswith("fish_history"):
            try:
                data = json.loads(text)
                items = data.get("items") or []
                for it in items[-3000:]:
                    cmd = it.get("cmd", "")
                    if rx.search(cmd) and run_rx.search(cmd):
                        hits.append({"cmd": sanitize_cmd(cmd[:200]), "ts": it.get("when", 0) / 1000 if it.get("when") else None, "src": "fish"})
            except Exception:
                pass
            continue
        for raw in text.splitlines()[-3000:]:
            ts = None
            cmd = raw
            m = re.match(r"^#(\d{9,11})\n(.*)$", raw)
            if m:
                ts = int(m.group(1))
                cmd = m.group(2)
            else:
                m = re.match(r"^\^H(\d{9,11}) \d+\n(.*)$", raw)
                if m:
                    ts = int(m.group(1))
                    cmd = m.group(2)
            if rx.search(cmd) and run_rx.search(cmd):
                hits.append({"cmd": sanitize_cmd(cmd[:200]), "ts": ts, "src": os.path.basename(fp)})
    hits.sort(key=lambda h: h.get("ts") or 0)
    return hits[-25:]


# ---------------------------------------------------------------------------
# run command + port detection
# ---------------------------------------------------------------------------

def detect_run_command(root, manifest, text_samples):
    """Returns {command, why, expected_ports:[{port, source}], pkg_manager}."""
    res = {"command": None, "why": None, "expected_ports": [], "pkg_manager": None}
    pj = os.path.join(root, "package.json")
    if os.path.isfile(pj):
        data = parse_package_json(pj)
        scripts = data.get("scripts") or {}
        pkg = data.get("name") or ""
        deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
        pm = "npm"
        if os.path.isfile(os.path.join(root, "pnpm-lock.yaml")):
            pm = "pnpm"
        elif os.path.isfile(os.path.join(root, "yarn.lock")):
            pm = "yarn"
        elif os.path.isfile(os.path.join(root, "bun.lockb")) or os.path.isfile(os.path.join(root, "bun.lock")):
            pm = "bun"
        res["pkg_manager"] = pm
        port = 3000
        framework = None
        if "next" in deps:
            framework, port = "Next.js", 3000
        elif "vite" in deps:
            framework, port = "Vite", 5173
        elif "react-scripts" in deps:
            framework, port = "Create React App", 3000
        elif "@sveltejs/kit" in deps:
            framework, port = "SvelteKit", 5173
        elif "nuxt" in deps:
            framework, port = "Nuxt", 3000
        elif "express" in deps or "fastify" in deps:
            framework, port = "Node server (Express/Fastify)", 3000
        elif "electron" in deps:
            framework = "Electron app"
        elif "cypress" in deps and "playwright" not in deps and len(deps) < 5:
            framework = "Test suite"
        if framework:
            res["why"] = framework
        cmd = None
        if scripts.get("dev"):
            cmd = "%s run dev" % pm
        elif scripts.get("start"):
            cmd = "%s run start" % pm
        elif scripts.get("serve"):
            cmd = "%s run serve" % pm
        elif framework == "Electron app" and scripts.get("start"):
            cmd = "%s start" % pm
        if cmd:
            res["command"] = cmd
            if not res["why"]:
                res["why"] = "package.json scripts"
            if framework and framework != "Test suite":
                res["expected_ports"].append({"port": port, "source": framework + " default"})
        else:
            res["command"] = "%s install   # then check scripts in package.json" % pm
            res["why"] = "package.json (no dev/start script)"
        return res

    if os.path.isfile(os.path.join(root, "manage.py")):
        res["command"] = "python manage.py runserver"
        res["why"] = "Django project (manage.py)"
        res["expected_ports"].append({"port": 8000, "source": "Django default"})
        return res

    py_deps = []
    for req in ("requirements.txt", "requirements-dev.txt"):
        fp = os.path.join(root, req)
        if os.path.isfile(fp):
            py_deps += [d["name"].lower() for d in parse_requirements(fp)]
    pyproject = os.path.join(root, "pyproject.toml")
    if os.path.isfile(pyproject):
        data = parse_toml_simple(pyproject)
        for d in (data.get("project", {}) or {}).get("dependencies") or []:
            m = re.match(r"([A-Za-z0-9._-]+)", d)
            if m:
                py_deps.append(m.group(1).lower())
        scripts = (data.get("project", {}) or {}).get("scripts") or (data.get("tool", {}).get("poetry", {}) or {}).get("scripts") or {}
        if scripts:
            res["command"] = list(scripts.keys())[0] + "   # entry point from pyproject"
            res["why"] = "pyproject.toml script entry"
            return res
    if "streamlit" in py_deps:
        entry = None
        for cand in ("app.py", "main.py", "streamlit_app.py"):
            if os.path.isfile(os.path.join(root, cand)):
                entry = cand
                break
        res["command"] = "streamlit run %s" % (entry or "app.py")
        res["why"] = "Streamlit app"
        res["expected_ports"].append({"port": 8501, "source": "Streamlit default"})
        return res
    if "jupyter" in py_deps or "notebook" in py_deps:
        res["command"] = "jupyter notebook"
        res["why"] = "Jupyter project"
        res["expected_ports"].append({"port": 8888, "source": "Jupyter default"})
        return res
    if "flask" in py_deps:
        res["command"] = "flask --app app run   # or: python app.py"
        res["why"] = "Flask app (requirements)"
        res["expected_ports"].append({"port": 5000, "source": "Flask default"})
        return res
    if "fastapi" in py_deps or "uvicorn" in py_deps:
        res["command"] = "uvicorn main:app --reload   # adjust module:app if needed"
        res["why"] = "FastAPI/uvicorn project"
        res["expected_ports"].append({"port": 8000, "source": "uvicorn default"})
        return res

    compose_files = []
    for cand in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
        if os.path.isfile(os.path.join(root, cand)):
            compose_files.append(os.path.join(root, cand))
    if compose_files:
        use = "docker compose up --build   # (docker-compose up -d on older installs)"
        res["command"] = use
        res["why"] = "Docker Compose project"
        text = read_head(compose_files[0], 200_000)
        for p in parse_compose_ports(text):
            res["expected_ports"].append({"port": p, "source": "docker-compose ports"})
        res["compose_images"] = parse_compose_images(text)
        return res

    if os.path.isfile(os.path.join(root, "Cargo.toml")):
        res["command"] = "cargo run"
        res["why"] = "Rust project (Cargo)"
        return res
    if os.path.isfile(os.path.join(root, "go.mod")):
        res["command"] = "go run ."
        res["why"] = "Go project"
        res["expected_ports"].append({"port": 8080, "source": "common Go default (check code)"})
        return res
    if os.path.isfile(os.path.join(root, "Gemfile")):
        text = read_head(os.path.join(root, "Gemfile"), 50_000)
        if "rails" in text:
            res["command"] = "bin/rails server   # (bundle install first)"
            res["why"] = "Ruby on Rails"
            res["expected_ports"].append({"port": 3000, "source": "Rails default"})
        else:
            res["command"] = "bundle install && bundle exec ruby main.rb   # check README"
            res["why"] = "Ruby project (Bundler)"
        return res
    if os.path.isfile(os.path.join(root, "pom.xml")):
        text = read_head(os.path.join(root, "pom.xml"), 200_000)
        if "spring-boot" in text:
            res["command"] = "mvn spring-boot:run"
            res["why"] = "Spring Boot (Maven)"
            res["expected_ports"].append({"port": 8080, "source": "Spring Boot default"})
        else:
            res["command"] = "mvn package"
            res["why"] = "Java (Maven)"
        return res
    if os.path.isfile(os.path.join(root, "build.gradle")) or os.path.isfile(os.path.join(root, "build.gradle.kts")):
        res["command"] = "./gradlew bootRun   # or: gradle build"
        res["why"] = "Java/Kotlin (Gradle)"
        res["expected_ports"].append({"port": 8080, "source": "Spring Boot default (check code)"})
        return res
    if os.path.isfile(os.path.join(root, "Makefile")):
        res["command"] = "make   # or: make run / make dev — see targets"
        res["why"] = "Makefile project"
        return res

    try:
        sh_files = sorted(f for f in os.listdir(root)
                          if f.endswith(".sh") and os.path.isfile(os.path.join(root, f)))
    except Exception:
        sh_files = []
    if sh_files:
        first = sh_files[0]
        res["command"] = "./%s   # check the script for required arguments" % first
        res["why"] = "shell scripts (%d found: %s)" % (len(sh_files), ", ".join(sh_files[:4]))
        return res

    # python single app?
    for cand in ("app.py", "main.py", "server.py", "run.py"):
        if os.path.isfile(os.path.join(root, cand)):
            head = read_head(os.path.join(root, cand), 20_000)
            if "flask" in head:
                res["command"] = "python %s" % cand
                res["why"] = "Flask app (no manifest)"
                res["expected_ports"].append({"port": 5000, "source": "Flask default"})
            elif "uvicorn" in head or "fastapi" in head:
                res["command"] = "uvicorn %s:app" % cand[:-3]
                res["why"] = "FastAPI app (no manifest)"
                res["expected_ports"].append({"port": 8000, "source": "uvicorn default"})
            else:
                res["command"] = "python %s" % cand
                res["why"] = "Python entry point"
            return res

    # readme commands as fallback
    readme = None
    for cand in ("README.md", "README.rst", "README.txt", "README"):
        if os.path.isfile(os.path.join(root, cand)):
            readme = os.path.join(root, cand)
            break
    if readme:
        text = read_head(readme, 100_000)
        cmds = []
        for block in re.findall(r"```[a-z]*\n(.*?)```", text, re.S):
            for line in block.splitlines():
                line = line.strip().lstrip("$ ")
                if re.match(r"^(npm|pnpm|yarn|bun|npx|pip|pip3|python|python3|uvicorn|flask|cargo|go |docker|make|gradle|bundle|uv )", line) and len(line) < 120:
                    cmds.append(line)
        if cmds:
            res["command"] = cmds[0]
            res["why"] = "from README"
            res["readme_cmds"] = cmds[:5]
            return res

    if os.path.isfile(os.path.join(root, "index.html")):
        res["command"] = "python3 -m http.server 8000   # then open http://localhost:8000"
        res["why"] = "Static web app (index.html)"
        res["expected_ports"].append({"port": 8000, "source": "http.server (suggested)"})
        return res

    res["command"] = "unknown — open the README or main file to check"
    res["why"] = "no recognizable manifest"
    return res


def detect_code_ports(root, files, cap=400):
    ports = []
    rx = re.compile(
        r"(?:listen|run|serve|port)\s*[\(\s=:,]+\s*['\"]?(\d{2,5})['\"]?|"
        r"-p\s+(\d{2,5})|port\s*:\s*(\d{2,5})|EXPOSE\s+(\d{2,5})|"
        r"['\"][0-9a-fA-F.\[\]:]+:(\d{2,5})['\"]"
    )
    for fp in files[:cap]:
        ext = os.path.splitext(fp)[1].lower()
        if ext not in {".py", ".js", ".ts", ".tsx", ".go", ".rb", ".rs", ".java", ".sh", ".yml", ".yaml", ".json", ".conf", ".env", ".toml"}:
            continue
        base = os.path.basename(fp)
        if base in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock"):
            continue
        text = read_head(fp, 100_000)
        for m in rx.finditer(text):
            g = next((x for x in m.groups() if x), None)
            if not g:
                continue
            try:
                p = int(g)
            except ValueError:
                continue
            if 1024 < p < 65535:
                ports.append({"port": p, "source": "found in " + os.path.relpath(fp, root)})
    # dockerfile EXPOSE
    for df in ("Dockerfile", "dockerfile", "Dockerfile.dev"):
        fp = os.path.join(root, df)
        if os.path.isfile(fp):
            for m in re.finditer(r"EXPOSE\s+(\d+)", read_head(fp, 50_000)):
                ports.append({"port": int(m.group(1)), "source": "Dockerfile EXPOSE"})
    seen, out = set(), []
    for p in ports:
        if p["port"] not in seen:
            seen.add(p["port"])
            out.append(p)
    return out[:15]


# ---------------------------------------------------------------------------
# project discovery
# ---------------------------------------------------------------------------

MANIFEST_FILES = {
    "package.json", "pyproject.toml", "requirements.txt", "requirements.in",
    "setup.py", "setup.cfg", "Cargo.toml", "go.mod", "Gemfile", "pom.xml",
    "build.gradle", "build.gradle.kts", "composer.json", "mix.exs", "Package.swift",
    "*.csproj", "*.sln", "CMakeLists.txt",
}
GIT_DIRS = {".git", ".hg", ".svn"}
IDE_DIRS = {".vscode", ".idea", ".cursor", ".windsurf", ".claude", ".gemini", ".cline",
            ".roo", ".aider", ".lingma", ".antigravity", ".vibe", ".copilot"}
ENTRY_FILES = {"app.py", "main.py", "server.py", "index.js", "main.js", "app.js",
               "main.go", "main.rs", "index.ts", "main.ts", "Program.cs", "main.rb",
               "manage.py", "run.py", "start.py", "index.html", "App.java"}
VIBE_FILES = {"CLAUDE.md", ".cursorrules", "cursorrules"}


def is_candidate(entries, dirpath):
    names = set(entries)
    if names & GIT_DIRS:
        return True, "version-control repo"
    for m in MANIFEST_FILES:
        if "*" in m:
            pre = m[:-2]
            if any(n.startswith(pre) for n in names):
                return True, "manifest " + m
        elif m in names:
            return True, "manifest " + m
    if names & {"Dockerfile", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml"}:
        srcs = [n for n in entries if os.path.splitext(n)[1].lower() in SOURCE_EXTS or n in ENTRY_FILES]
        if srcs:
            return True, "docker project"
    if names & IDE_DIRS or names & VIBE_FILES:
        has_src = any(os.path.splitext(n)[1].lower() in SOURCE_EXTS for n in entries)
        if has_src:
            return True, "IDE/AI workspace"
    # config file + code => app
    cfg_files = {"config.ini", "settings.ini", "config.yaml", "config.yml", "config.json",
                 "settings.json", "app.conf", "setup.cfg", "application.properties"}
    if names & cfg_files:
        n_src = sum(1 for n in entries if os.path.splitext(n)[1].lower() in SOURCE_EXTS)
        if n_src >= 1:
            return True, "config + code app"
    # script / mini app: entry + a couple of source files, no manifest
    if not any(n in names for n in MANIFEST_FILES if "*" not in n):
        if names & ENTRY_FILES:
            n_src = sum(1 for n in entries if os.path.splitext(n)[1].lower() in SOURCE_EXTS)
            if n_src >= 2:
                return True, "script / mini-app"
    return False, None


def _depth_of(dirpath, root):
    rel = os.path.relpath(dirpath, root)
    return 0 if rel == "." else len(rel.split(os.sep))


def discover_projects(root, max_depth, skip_top, progress):
    """Walk the tree; return (projects, subtree-size map)."""
    dirsize = {}   # dirpath -> size of files directly in it (incl. pruned child dirs)
    n_dirs = 0

    def _prune(dirpath, dirnames, depth):
        keep = []
        for d in dirnames:
            dp = os.path.join(dirpath, d)
            if d in CONTENT_SKIP_DIRS:
                try:
                    sz, _ = fast_dir_size(dp)
                    dirsize[dirpath] = dirsize.get(dirpath, 0) + sz
                except Exception:
                    pass
                continue
            if d in TOP_SKIP_DIRS and depth <= 1:
                continue
            keep.append(d)
        dirnames[:] = keep

    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        depth = _depth_of(dirpath, root)
        if depth > max_depth:
            dirnames[:] = []
            continue
        _prune(dirpath, dirnames, depth)
        n_dirs += 1
        if progress:
            progress["dirs"] = n_dirs
        for fn in filenames:
            try:
                st = os.lstat(os.path.join(dirpath, fn))
            except Exception:
                continue
            if st.st_size > 0:
                dirsize[dirpath] = dirsize.get(dirpath, 0) + st.st_size

    # accumulate direct sizes up the tree (deepest first)
    subtree = dict(dirsize)
    for d in sorted(dirsize, key=len, reverse=True):
        p = os.path.dirname(d)
        if p and p != d:
            subtree[p] = subtree.get(p, 0) + subtree.get(d, 0)

    # detect candidates (second cheap walk, same pruning rules)
    projects = []
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        depth = _depth_of(dirpath, root)
        if depth > max_depth:
            dirnames[:] = []
            continue
        _prune(dirpath, dirnames, depth)
        ok, why = is_candidate(set(filenames) | set(dirnames), dirpath)
        if ok:
            base = os.path.basename(dirpath.rstrip(os.sep))
            if base in CONTENT_SKIP_DIRS:
                continue
            if base.startswith(".") and base not in {".claude", ".cursor"}:
                continue
            rel = os.path.relpath(dirpath, root)
            projects.append({"path": dirpath, "why": why, "size": subtree.get(dirpath, 0),
                             "root": root, "rel": rel})
            # keep project boundaries flat: don't look for nested projects
            dirnames[:] = []

    # dedupe nested (keep shallowest)
    projects.sort(key=lambda p: (len(p["path"]), p["path"]))
    deduped = []
    for p in projects:
        if any(p["path"].startswith(q["path"] + os.sep) for q in deduped):
            continue
        deduped.append(p)
    return deduped, subtree


# ---------------------------------------------------------------------------
# detailed project analysis
# ---------------------------------------------------------------------------

def analyze_project(proj, scan_ctx):
    root = proj["path"]
    base = os.path.basename(root.rstrip("/"))
    p = dict(proj)
    p["id"] = re.sub(r"[^A-Za-z0-9_-]", "-", root)
    p["name"] = base

    files, truncated = walk_files(root)
    p["files_scanned"] = len(files)

    # languages
    ext_count = {}
    doc_count = {}
    for fp in files:
        ext = os.path.splitext(fp)[1].lower()
        if ext in EXT_LANG:
            if ext in SOURCE_EXTS:
                ext_count[ext] = ext_count.get(ext, 0) + 1
        if ext in DOC_TYPES:
            doc_count[ext] = doc_count.get(ext, 0) + 1
    langs = {}
    for ext, n in ext_count.items():
        lang = EXT_LANG[ext]
        langs[lang] = langs.get(lang, 0) + n
    p["languages"] = sorted(langs.items(), key=lambda kv: -kv[1])[:8]
    p["primary_language"] = p["languages"][0][0] if p["languages"] else None

    # documents
    docs = sorted(((DOC_TYPES[ext], ext, n) for ext, n in doc_count.items()), key=lambda x: -x[2])
    p["documents"] = docs[:10]
    # doc language
    sample = ""
    for cand in ("README.md", "README.rst", "README.txt", "README"):
        fp = os.path.join(root, cand)
        if os.path.isfile(fp):
            sample = read_head(fp, 3_000)
            break
    if not sample:
        md_files = [fp for fp in files if fp.lower().endswith(".md")][:2]
        for fp in md_files:
            sample += read_head(fp, 1_500)
    p["doc_language"] = detect_natural_lang(sample)

    # env files + secrets
    env_files = [fp for fp in files if os.path.basename(fp).startswith(".env")]
    scan_files = [fp for fp in files if os.path.splitext(fp)[1].lower() in CODE_EXT_SCAN
                  or SECRET_FILE_HINTS.search(fp)]
    secrets = scan_secrets(scan_files[:400])
    p["keys"] = [{"type": s["type"], "severity": s["severity"],
                  "file": os.path.relpath(s["file"], root), "line": s["line"],
                  "masked": s["masked"]} for s in secrets]
    p["key_count"] = len(p["keys"])

    # risks
    gi = os.path.join(root, ".gitignore")
    gi_text = read_head(gi, 30_000) if os.path.isfile(gi) else ""
    res = scan_risks(files[:500], root, os.path.isfile(gi), gi_text, env_files)
    p["risk_flags"], p["todos"], p["risk_level"], p["risk_score"] = res

    # size breakdown (top-level entries)
    breakdown = []
    try:
        with os.scandir(root) as it:
            for e in sorted(it, key=lambda x: x.name)[:60]:
                if e.name in CONTENT_SKIP_DIRS:
                    sz, _ = fast_dir_size(e.path)
                else:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            sz = fast_dir_size(e.path)[0]
                        else:
                            sz = e.stat(follow_symlinks=False).st_size
                    except Exception:
                        sz = 0
                breakdown.append({"name": e.name, "size": sz,
                                  "dir": e.is_dir(follow_symlinks=False)})
    except Exception:
        pass
    breakdown.sort(key=lambda b: -b["size"])
    p["size_breakdown"] = breakdown[:10]
    p["size"] = sum(b["size"] for b in breakdown) or p.get("size", 0)

    # git
    p["git"] = scan_git(root)

    # dependencies
    deps = []
    pj = os.path.join(root, "package.json")
    if os.path.isfile(pj):
        data = parse_package_json(pj)
        p["pkg_name"] = data.get("name")
        p["pkg_version"] = data.get("version")
        p["pkg_description"] = data.get("description")
        for n, v in (data.get("dependencies") or {}).items():
            deps.append({"name": n, "version": v, "kind": "prod", "from": "package.json"})
        for n, v in (data.get("devDependencies") or {}).items():
            deps.append({"name": n, "version": v, "kind": "dev", "from": "package.json"})
    for req in ("requirements.txt", "requirements-dev.txt", "requirements.in"):
        fp = os.path.join(root, req)
        if os.path.isfile(fp):
            for d in parse_requirements(fp):
                deps.append({"name": d["name"], "version": d.get("version"),
                             "kind": "dev" if "dev" in req else "prod", "from": req})
    if os.path.isfile(os.path.join(root, "pyproject.toml")):
        data = parse_toml_simple(os.path.join(root, "pyproject.toml"))
        proj_data = data.get("project", {}) or {}
        if proj_data.get("name") and not p.get("pkg_name"):
            p["pkg_name"] = proj_data["name"]
            p["pkg_version"] = proj_data.get("version")
            p["pkg_description"] = proj_data.get("description")
        py = data.get("tool", {}).get("poetry", {})
        for src in ((proj_data.get("dependencies") or []),
                    ((py.get("dependencies") or {}) and
                     [{"%s%s" % (k, v) if v else k for k, v in (py.get("dependencies") or {}).items()}] or [])):
            for d in src:
                if isinstance(d, str):
                    m = re.match(r"([A-Za-z0-9._-]+)(?:\s*([=<>!~]=?)\s*(.+))?", d)
                    if m:
                        deps.append({"name": m.group(1), "version": m.group(3),
                                     "kind": "prod", "from": "pyproject.toml"})
    if os.path.isfile(os.path.join(root, "Cargo.toml")):
        text = read_head(os.path.join(root, "Cargo.toml"), 100_000)
        mv = re.search(r'^version\s*=\s*"([^"]+)"', text, re.M)
        if mv and not p.get("pkg_version"):
            p["pkg_version"] = mv.group(1)
        in_deps = False
        for line in text.splitlines():
            if re.match(r"\[(deps|dependencies)\]", line.strip()):
                in_deps = True
                continue
            if line.strip().startswith("[") and in_deps:
                in_deps = False
            if in_deps:
                m = re.match(r"([A-Za-z0-9_-]+)\s*=", line)
                if m:
                    deps.append({"name": m.group(1), "version": None, "kind": "prod", "from": "Cargo.toml"})
    p["dependencies"] = deps[:120]
    p["dep_count"] = len(deps)
    p["version"] = p.get("pkg_version") or None

    # installed? (node_modules / venv)
    nm = os.path.join(root, "node_modules")
    if os.path.isdir(nm):
        try:
            p["installed_node_modules"] = len(os.listdir(nm))
        except Exception:
            pass
    for venv_name in (".venv", "venv", "env"):
        vp = os.path.join(root, venv_name)
        sp = os.path.join(vp, "lib")
        if os.path.isdir(sp):
            try:
                vers = os.listdir(sp)
                if vers:
                    site = os.path.join(sp, vers[0], "site-packages")
                    if os.path.isdir(site):
                        p["venv"] = venv_name + " (python " + vers[0] + ")"
                        p["venv_packages"] = len(os.listdir(site))
            except Exception:
                pass

    # run command + ports
    run = detect_run_command(root, {}, None)
    code_ports = detect_code_ports(root, files)
    ports = list(run.get("expected_ports") or []) + code_ports
    seen = set()
    uniq = []
    for x in ports:
        if x["port"] not in seen:
            seen.add(x["port"])
            uniq.append(x)
    p["run"] = {
        "command": run.get("command"),
        "why": run.get("why"),
        "pkg_manager": run.get("pkg_manager"),
        "readme_cmds": run.get("readme_cmds"),
        "compose_images": run.get("compose_images"),
    }
    p["expected_ports"] = uniq[:20]
    try:
        p["net_refs"] = extract_net_refs(root, files, p.get("dependencies"))
    except Exception:
        p["net_refs"] = []
    try:
        p["schedules"] = detect_project_schedules(root, files)
    except Exception:
        p["schedules"] = []

    # purpose
    readme = None
    for cand in ("README.md", "README.rst", "README.txt", "README"):
        if os.path.isfile(os.path.join(root, cand)):
            readme = os.path.join(root, cand)
            break
    purpose = p.get("pkg_description")
    if not purpose and readme:
        text = read_head(readme, 6_000)
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith(("#", "!", "<", "[", "```", ">", "|", "===")):
                purpose = line[:220]
                break
    p["purpose"] = purpose or ("no description found — name suggests: %s" % base)
    p["has_readme"] = readme is not None

    # AI / IDE traces
    tools = []
    try:
        top_entries = set(os.listdir(root))
    except Exception:
        top_entries = set()
    for marker, tool in AI_MARKERS:
        if marker in top_entries:
            tools.append({"tool": tool, "marker": marker})
    p["ai_tools"] = tools
    p["ai_names"] = sorted({t["tool"] for t in tools})

    # LLM usage
    llm = []
    claude = claude_usage_for(root)
    if claude and (claude["tokens_in"] or claude["tokens_out"] or claude["sessions"]):
        llm.append({
            "tool": "Claude Code", "model": claude.get("model"),
            "tokens_in": claude["tokens_in"], "tokens_out": claude["tokens_out"],
            "cache_read": claude["cache_read"], "cache_write": claude["cache_write"],
            "sessions": claude["sessions"], "last": claude.get("last"),
            "msgs": claude["user_msgs"] + claude["assistant_msgs"],
        })
    p["llm"] = llm
    if llm and "Claude Code (Anthropic)" not in p["ai_names"]:
        p["ai_tools"].append({"tool": "Claude Code (Anthropic)", "marker": "~/.claude session logs"})
        p["ai_names"].append("Claude Code (Anthropic)")
    p["vibe"] = (
        p["git"]["vcs"] is None
        and p["ai_tools"]
        and (p.get("pkg_name") is None and not os.path.isfile(os.path.join(root, "package.json")))
    ) or bool(top_entries & VIBE_FILES and p["git"]["vcs"] is None)

    # last activity
    activity = 0
    act_files = []
    for fp in files[:300]:
        base2 = os.path.basename(fp)
        if base2.endswith(".log") or ".pytest_cache" in fp or base2 == "BUILD_ID" or base2 in ("lastfailed",):
            act_files.append(fp)
    # quick mtime pass over likely artifacts
    for sub in ("logs", "log", "dist", "build", "out", "target", ".next", "__pycache__", "node_modules/.vite"):
        sp = os.path.join(root, sub)
        if os.path.isdir(sp):
            try:
                activity = max(activity, os.path.getmtime(sp))
            except Exception:
                pass
    for fp in act_files:
        try:
            activity = max(activity, os.path.getmtime(fp))
        except Exception:
            pass
    # any recently modified source file (cheap: first 200)
    for fp in files[:200]:
        try:
            activity = max(activity, os.path.getmtime(fp))
        except Exception:
            pass
    history = scan_shell_history(root, base)
    h_ts = max([h["ts"] for h in history if h.get("ts")], default=None)
    p["last_activity"] = activity or None
    p["history_hits"] = history[-10:]
    p["history_ts"] = h_ts
    p["last_run_ts"] = max(filter(None, [activity, h_ts]), default=None)
    p["last_run_label"] = None  # filled after process scan

    return p


# ---------------------------------------------------------------------------
# environment scan
# ---------------------------------------------------------------------------

def env_scan(root):
    env = {"os": platform.platform(), "arch": platform.machine(),
           "hostname": platform.node(), "python": sys.version.split()[0],
           "tools": {}, "globals": {}, "docker": None, "shell": {}, "ide_installed": []}

    def ver(cmd, args=None, timeout=6):
        args = args if args is not None else [cmd, "--version"]
        if cmd in ("java",):
            args = [cmd, "-version"]
        if cmd in ("node", "npm", "npx", "pnpm", "yarn", "bun", "deno"):
            args = [cmd, "-v"]
        if cmd in ("go", "rustc", "cargo", "ruby", "uv"):
            args = [cmd, "--version"] if cmd != "ruby" else [cmd, "-v"]
        if cmd in ("brew",):
            args = [cmd, "--version"]
        ok, out = run_cmd(args, timeout=timeout)
        line = out.strip().splitlines()[0].strip() if out.strip() else ""
        return {"ok": ok, "version": line[:160]}

    for tool, args in [
        ("git", None), ("python3", ["python3", "--version"]), ("pip3", ["pip3", "--version"]),
        ("node", None), ("npm", None), ("npx", None), ("pnpm", None), ("yarn", None),
        ("bun", None), ("deno", None), ("cargo", None), ("go", None), ("rustc", None),
        ("ruby", ["ruby", "-v"]), ("java", ["java", "-version"]), ("brew", None),
        ("uv", None), ("docker", ["docker", "--version"]), ("kubectl", None),
        ("gh", None), ("make", None),
    ]:
        if not shutil.which(tool):
            continue
        try:
            env["tools"][tool] = ver(tool, args)
        except Exception:
            pass

    # pip packages
    if shutil.which("pip3"):
        ok, out = run_cmd(["pip3", "list", "--format=json"], timeout=30)
        if ok:
            try:
                pkgs = json.loads(out.strip())
                env["globals"]["python_packages"] = [
                    {"name": p.get("name"), "version": p.get("version")} for p in pkgs
                ]
            except Exception:
                pass
    # npm globals
    if shutil.which("npm"):
        ok, out = run_cmd(["npm", "ls", "-g", "--depth=0", "--json"], timeout=20)
        if ok:
            try:
                data = json.loads(out.strip())
                deps = data.get("dependencies") or {}
                env["globals"]["node_globals"] = [
                    {"name": k, "version": (v or {}).get("version")} for k, v in deps.items()
                ]
            except Exception:
                pass
    # brew
    if shutil.which("brew"):
        ok, out = run_cmd(["brew", "list", "--versions"], timeout=30)
        if ok:
            rows = []
            for line in out.strip().splitlines():
                parts = line.split()
                if parts:
                    rows.append({"name": parts[0], "version": parts[1] if len(parts) > 1 else None})
            env["globals"]["brew"] = rows
    # docker
    if shutil.which("docker"):
        ok, out = run_cmd(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=10)
        d = {"ok": ok, "server_version": out.strip() if ok else None}
        ok, out = run_cmd(["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], timeout=15)
        d["containers"] = [l.split("\t") for l in out.strip().splitlines() if l.strip()]
        ok, out = run_cmd(["docker", "images", "--format", "{{.Repository}}:{{.Tag}}\t{{.Size}}"], timeout=15)
        d["images"] = [l.split("\t") for l in out.strip().splitlines() if l.strip()]
        ok, out = run_cmd(["docker", "system", "df"], timeout=15)
        d["system_df"] = out.strip()
        env["docker"] = d

    # shell
    shell = os.environ.get("SHELL") or ("bash" if OS_NAME == "Linux" else "zsh")
    env["shell"]["shell"] = shell
    env["shell"]["shell_name"] = os.path.basename(shell)
    home = os.path.expanduser("~")
    rc_files = []
    if "zsh" in shell:
        rc_files = [".zshrc", ".zprofile", ".zshenv"]
    elif "bash" in shell:
        rc_files = [".bashrc", ".bash_profile", ".profile"]
    elif "fish" in shell:
        rc_files = [os.path.join(".config", "fish", "config.fish")]
    else:
        rc_files = [".bashrc", ".profile"]
    env["shell"]["rc"] = []
    for rc in rc_files:
        fp = os.path.join(home, rc)
        if not os.path.isfile(fp):
            continue
        text = read_head(fp, 200_000)
        exports = sorted({m.group(1) for m in re.finditer(r"^\s*export\s+([A-Z_][A-Z0-9_]*)", text, re.M)})
        aliases = sorted({m.group(1) for m in re.finditer(r"^\s*alias\s+([A-Za-z0-9_\-]+)=", text, re.M)})
        paths = [m.group(1) for m in re.finditer(r'PATH=.*?:("?\$HOME/[^:"\s]+|"?\$HOME[^:"\s]+)', text)]
        sources = [l.strip() for l in text.splitlines() if re.match(r"^\s*(source|\.)\s", l)][:10]
        notes = []
        for kw, label in [("nvm", "nvm (Node version manager) initialized"),
                          ("conda", "conda initialized"), ("pyenv", "pyenv initialized"),
                          ("rustup", "rustup initialized"), ("rbenv", "rbenv initialized"),
                          ("fastfetch", "fastfetch on login"), ("starship", "starship prompt"),
                          ("zinit", "zinit plugins"), ("oh-my-zsh", "oh-my-zsh")]:
            if kw in text:
                notes.append(label)
        env["shell"]["rc"].append({
            "file": "~/" + rc, "exports": exports[:40], "aliases": aliases[:40],
            "path_adds": paths[:10], "sources": sources, "notes": notes,
        })
    for k in ("VIRTUAL_ENV", "PYTHONPATH", "NODE_ENV", "PIP_PREFIX", "CONDA_DEFAULT_ENV"):
        if os.environ.get(k):
            env["shell"].setdefault("current_env", {})[k] = os.environ[k]
    env["shell"]["path_entries"] = (os.environ.get("PATH", "").split(os.pathsep))[:25]

    # IDEs installed (best effort per OS)
    if OS_NAME == "Darwin":
        apps = []
        try:
            apps = os.listdir("/Applications")
        except Exception:
            pass
        for a in apps:
            if re.search(r"(visual studio code|cursor|windsurf|antigravity|pycharm|intellij|webstorm|clion|goland|rubymine|phpstorm|rustrover|android studio|xcode|sublime|zed|nova|replit|trae)", a, re.I):
                env["ide_installed"].append(a)
    else:
        for bin_name in ("code", "cursor", "windsurf", "antigravity", "pycharm", "idea", "webstorm", "clion", "goland", "rustrover", "subl", "zed"):
            if shutil.which(bin_name):
                env["ide_installed"].append(bin_name)

    # global caches sizes
    caches = {}
    for c in (os.path.join(home, ".npm"), os.path.join(home, ".cache", "pip"),
              os.path.join(home, ".cargo"), os.path.join(home, ".rustup"),
              os.path.join(home, "Library", "Caches") if OS_NAME == "Darwin" else None):
        if c and os.path.isdir(c):
            sz, _ = fast_dir_size(c)
            if sz > 1_000_000:
                caches[c] = sz
    env["global_caches"] = [{"path": k, "size": v} for k, v in sorted(caches.items(), key=lambda kv: -kv[1])][:8]
    return env


# ---------------------------------------------------------------------------
# scan orchestration
# ---------------------------------------------------------------------------

SCAN = {"running": False, "phase": "idle", "progress": {"dirs": 0, "projects_done": 0, "projects_total": 0},
        "error": None, "started": None, "finished": None, "roots": [], "last_error": None}


def do_scan(roots, max_depth):
    SCAN["running"] = True
    SCAN["phase"] = "walking file tree"
    SCAN["error"] = None
    SCAN["started"] = time.time()
    SCAN["finished"] = None
    SCAN["roots"] = roots
    SCAN["progress"] = {"dirs": 0, "projects_done": 0, "projects_total": 0}
    try:
        projects, subtree = [], {}
        all_subtree = {}
        for root in roots:
            root = os.path.abspath(os.path.expanduser(root))
            if not os.path.isdir(root):
                continue
            p, st = discover_projects(root, max_depth, None, SCAN["progress"])
            projects += p
            for k, v in st.items():
                all_subtree[k] = max(all_subtree.get(k, 0), v)
        SCAN["projects_total"] = len(projects)
        SCAN["phase"] = "analyzing projects"

        details = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(analyze_project, pr, SCAN): pr for pr in projects}
            for fut in concurrent.futures.as_completed(futs):
                pr = futs[fut]
                try:
                    details[pr["path"]] = fut.result()
                except Exception as e:
                    traceback.print_exc()
                    details[pr["path"]] = {**pr, "error": str(e)}
                SCAN["progress"]["projects_done"] += 1

        SCAN["phase"] = "scanning environment"
        try:
            env = env_scan(roots[0] if roots else os.path.expanduser("~"))
        except Exception as e:
            env = {"error": str(e)}

        # listeners + processes
        SCAN["phase"] = "checking ports & processes"
        try:
            if OS_NAME == "Darwin":
                listeners = get_listeners_mac()
                procs = get_processes_mac()
            elif OS_NAME == "Windows":
                listeners = get_listeners_windows()
                procs = get_processes_windows()
            else:
                listeners = get_listeners_linux()
                procs = get_processes_linux()
        except Exception as e:
            listeners, procs = [], []

        # link listeners/processes to projects
        cwd_by_pid = {}
        for x in procs:
            if x.get("pid") and x.get("cwd"):
                cwd_by_pid[x["pid"]] = x["cwd"]
        def _in_project(cwd, rpath):
            rp = rpath.rstrip(os.sep)
            return bool(cwd) and (cwd == rp or cwd.startswith(rp + os.sep))

        for p in details.values():
            rpath = p["path"]
            open_ports, running = [], []
            for l in listeners:
                if not l.get("pid"):
                    continue
                cwd = cwd_by_pid.get(l["pid"])
                if _in_project(cwd, rpath):
                    open_ports.append({"port": l["port"], "pid": l["pid"], "proc": l.get("proc"), "cwd": cwd})
            for x in procs:
                if _in_project(x.get("cwd"), rpath):
                    running.append({"pid": x["pid"], "cmd": x["cmd"], "cwd": x["cwd"]})
            # dedupe by port
            seen = set()
            uniq = []
            for o in open_ports:
                if o["port"] not in seen:
                    seen.add(o["port"])
                    uniq.append(o)
            p["open_ports"] = uniq
            p["running"] = running[:10]
            if running:
                p["last_run_label"] = "running now"
            elif p.get("last_run_ts"):
                p["last_run_label"] = fmt_ago(p["last_run_ts"])

        projects_list = sorted(details.values(), key=lambda x: -x.get("size", 0))
        SCAN["phase"] = "skills, agents & schedules"
        try:
            skills = skills_scan(projects_list)
        except Exception as e:
            traceback.print_exc()
            skills = {"error": str(e), "skills": [], "duplicates": [], "summary": {}}
        try:
            agents = agents_scan(procs, listeners, skills)
        except Exception as e:
            traceback.print_exc()
            agents = []
        try:
            sys_sched = system_schedules(projects_list)
        except Exception:
            traceback.print_exc()
            sys_sched = []
        SCAN["phase"] = "finding duplicate files"
        try:
            dupes = duplicates_scan(projects_list)
        except Exception as e:
            traceback.print_exc()
            dupes = {"error": str(e), "groups": [], "projects": []}

        # global open ports (not linked to any project)
        linked_pids = set()
        for p in details.values():
            for o in p["open_ports"]:
                linked_pids.add(o["pid"])
        global_ports = [l for l in listeners if l.get("pid") not in linked_pids]

        with STATE["lock"]:
            STATE["data"] = {
                "scanned_at": time.time(),
                "roots": roots,
                "duration": time.time() - SCAN["started"],
                "projects": sorted(details.values(), key=lambda x: -x.get("size", 0)),
                "env": env,
                "listeners": sorted(listeners, key=lambda l: l["port"]),
                "global_ports": sorted(global_ports, key=lambda l: l["port"]),
                "processes": procs[:400],
                "skills": skills,
                "agents": agents,
                "system_schedules": sys_sched,
                "duplicates": dupes,
                "version": VERSION,
                "tree": {
                    "top_dirs": top_level_sizes(roots, all_subtree),
                },
            }
        SCAN["phase"] = "done"
        SCAN["finished"] = time.time()
    except Exception as e:
        traceback.print_exc()
        SCAN["error"] = str(e)
    finally:
        SCAN["running"] = False


def top_level_sizes(roots, subtree):
    out = []
    for root in roots:
        root = os.path.abspath(root)
        try:
            entries = os.listdir(root)
        except Exception:
            continue
        for e in entries:
            fp = os.path.join(root, e)
            if not os.path.isdir(fp):
                continue
            sz = subtree.get(fp, 0)
            if sz:
                out.append({"path": fp, "size": sz, "name": e, "root": root})
    out.sort(key=lambda x: -x["size"])
    return out[:15]


STATE = {"lock": threading.Lock(), "data": None}


# ---------------------------------------------------------------------------
# actions: delete / move / rename
# ---------------------------------------------------------------------------

def _trash_dir():
    if OS_NAME == "Darwin":
        d = os.path.expanduser("~/.Trash")
        return d if os.path.isdir(d) else None
    if OS_NAME == "Windows":
        return None  # handled via recycle bin below
    d = os.path.expanduser("~/.local/share/Trash/files")
    try:
        os.makedirs(d, exist_ok=True)
        os.makedirs(os.path.join(os.path.dirname(d), "info"), exist_ok=True)
    except Exception:
        return None
    return d


def _unique_name(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists("%s (%d)%s" % (base, i, ext)):
        i += 1
    return "%s (%d)%s" % (base, i, ext)


def do_delete(path, force=False):
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(path):
        return {"ok": False, "error": "path does not exist"}
    size, _ = fast_dir_size(path) if os.path.isdir(path) else (os.path.getsize(path), 1)
    if OS_NAME == "Windows":
        if not force:
            kind = "DeleteDirectory" if os.path.isdir(path) else "DeleteFile"
            ps = ("Add-Type -AssemblyName Microsoft.VisualBasic; "
                  "[Microsoft.VisualBasic.FileIO.FileSystem]::%s($env:STACKRADAR_TARGET,"
                  "'OnlyErrorDialogs','SendToRecycleBin')" % kind)
            try:
                r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                                   env={**os.environ, "STACKRADAR_TARGET": path},
                                   capture_output=True, text=True, timeout=120)
                if r.returncode == 0 and not os.path.exists(path):
                    return {"ok": True, "method": "moved to Recycle Bin", "freed": size}
            except Exception:
                pass
            return {"ok": False, "error": "could not move to the Recycle Bin — use 'Delete permanently'"}
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            os.remove(path)
        return {"ok": True, "method": "permanently deleted", "freed": size}
    trash = _trash_dir()
    if trash and not force:
        target = _unique_name(os.path.join(trash, os.path.basename(path.rstrip("/"))))
        shutil.move(path, target)
        if OS_NAME == "Linux":  # XDG trash spec: write .trashinfo so "Restore" works
            try:
                info = os.path.join(os.path.dirname(trash), "info", os.path.basename(target) + ".trashinfo")
                with open(info, "w") as f:
                    f.write("[Trash Info]\nPath=%s\nDeletionDate=%s\n" % (
                        urllib.parse.quote(path), datetime.now().strftime("%Y-%m-%dT%H:%M:%S")))
            except Exception:
                pass
        return {"ok": True, "method": "moved to trash", "freed": size, "trash_path": target}
    if force:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            os.remove(path)
        return {"ok": True, "method": "permanently deleted", "freed": size}
    return {"ok": False, "error": "no trash available — confirm with force=true to delete permanently"}


def do_move(path, target_dir, new_name=None):
    path = os.path.abspath(os.path.expanduser(path))
    target_dir = os.path.abspath(os.path.expanduser(target_dir))
    if not os.path.exists(path):
        return {"ok": False, "error": "source does not exist"}
    if not os.path.isdir(target_dir):
        return {"ok": False, "error": "target directory does not exist"}
    name = new_name or os.path.basename(path.rstrip("/"))
    if not re.match(r"^[A-Za-z0-9._\- ]+$", name) or name in (".", ".."):
        return {"ok": False, "error": "invalid name"}
    dest = _unique_name(os.path.join(target_dir, name))
    shutil.move(path, dest)
    return {"ok": True, "moved_to": dest}


def do_rename(path, new_name):
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(path):
        return {"ok": False, "error": "path does not exist"}
    if not re.match(r"^[A-Za-z0-9._\- ]+$", new_name) or new_name in (".", ".."):
        return {"ok": False, "error": "invalid name (use letters, digits, . _ - spaces)"}
    dest = _unique_name(os.path.join(os.path.dirname(path), new_name))
    os.rename(path, dest)
    return {"ok": True, "new_path": dest}


def reclaim_items(projects):
    items = []
    CACHES = ("node_modules", ".next", ".nuxt", ".turbo", "dist", "build", "out", "target",
              "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv", ".cache")
    for p in projects:
        root = p.get("path")
        if not root:
            continue
        try:
            entries = os.listdir(root)
        except Exception:
            continue
        for e in entries:
            if e in CACHES:
                fp = os.path.join(root, e)
                if os.path.isdir(fp):
                    sz, _ = fast_dir_size(fp)
                    if sz > 0:
                        items.append({
                            "kind": "venv" if e in (".venv", "venv") else "cache",
                            "project": os.path.basename(root), "name": e, "path": fp,
                            "size": sz, "safe": e not in (".venv", "venv"),
                        })
    items.sort(key=lambda x: -x["size"])
    return items[:200]


# ---------------------------------------------------------------------------
# per-project user metadata: color, rating, notes, status
# ---------------------------------------------------------------------------

META_DIR = os.path.expanduser("~/.stackradar")
META_FILE = os.path.join(META_DIR, "projects.json")
META = {"lock": threading.RLock(), "data": None}


def meta_defaults():
    return {"color": None, "rating": 0, "notes": "", "status": "active"}


def meta_all():
    with META["lock"]:
        if META["data"] is None:
            META["data"] = {}
            try:
                with open(META_FILE) as f:
                    META["data"] = json.load(f)
            except Exception:
                META["data"] = {}
        return META["data"]


def meta_get(path):
    d = meta_all()
    return {**meta_defaults(), **(d.get(path) or {})}


def meta_set(path, patch):
    with META["lock"]:
        d = meta_all()
        cur = {**meta_defaults(), **(d.get(path) or {})}
        if isinstance(patch.get("archive"), dict):
            cur["archive"] = patch["archive"]
        for k in ("color", "rating", "notes", "status"):
            if k in patch and patch[k] is not None:
                if k == "status" and patch[k] not in ("active", "archived", "fix"):
                    continue
                if k == "rating":
                    try:
                        patch[k] = max(0, min(5, int(patch[k])))
                    except Exception:
                        continue
                cur[k] = patch[k]
        d[path] = cur
        try:
            os.makedirs(META_DIR, exist_ok=True)
            tmp = META_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(d, f, indent=1)
            os.replace(tmp, META_FILE)
        except Exception:
            pass
        return cur


# ---------------------------------------------------------------------------
# managed runs: start/stop projects from the app, live logs, port override
# ---------------------------------------------------------------------------

RUNS = {"lock": threading.Lock(), "runs": {}}   # id -> dict (includes 'proc')
RUN_LOG_KEEP = 400_000


def _forget_project(path):
    """Drop a deleted / archived project from the last scan so the UI updates without a rescan."""
    with STATE["lock"]:
        d = STATE["data"]
        if d:
            d["projects"] = [p for p in d.get("projects", []) if p.get("path") != path]


def _project_by_path(path):
    with STATE["lock"]:
        data = STATE["data"] or {}
    for p in data.get("projects", []):
        if p.get("path") == path:
            return p
    return None


def build_run_command(project, port):
    """Return (command, note). Injects a port override in a framework-aware way."""
    run = project.get("run") or {}
    base = (run.get("command") or "").split("#")[0].strip()
    why = (run.get("why") or "")
    if not base:
        return None, "No run command detected for this project."
    port = int(port or 0)

    def _already_has_port(cmd):
        return re.search(r"(\s-p\s|\s--port[\s=])", cmd) is not None

    if port <= 0:
        return base, "No port override."
    pl = str(port)

    # python3 -m http.server N  -> replace N
    m = re.match(r"^(.*-m\s+http\.server\s+)(\d+)(.*)$", base)
    if m:
        return "%s%s%s" % (m.group(1), pl, m.group(3)), "http.server port set to %s" % pl
    # manage.py runserver
    if "manage.py runserver" in base:
        if _already_has_port(base):
            return re.sub(r"(runserver\s+)(\d+)", r"\1" + pl, base), "Django port -> %s" % pl
        return base + " " + pl, "Django port -> %s" % pl
    # next dev/start
    m = re.match(r"^(next\s+(dev|start))(\s.*)?$", base)
    if m:
        cmd = base if not _already_has_port(base) else re.sub(r"-p\s+\d+", "-p " + pl, base)
        if "-p" not in base:
            cmd = base + " -p " + pl
        return cmd, "Next.js -p %s" % pl
    # npm/pnpm/yarn/bun run ...
    m = re.match(r"^(npm|pnpm|yarn|bun)\s+run\s+(\S+)(\s.*)?$", base)
    if m:
        if _already_has_port(base):
            return re.sub(r"((--port|-p)\s+)--?port\s+\d+", r"\1" + pl, base), "package script port -> %s" % pl
        if "Next" in why:
            return base + " -- -p " + pl, "Next.js via npm run dev -- -p %s" % pl
        if any(k in why for k in ("Vite", "SvelteKit", "React")):
            return base + " -- --port " + pl, "--port %s passed to the dev server" % pl
        return base + " -- --port " + pl, "best effort: --port %s passed to the script" % pl
    # flask / uvicorn / streamlit
    if base.startswith("flask ") or " flask " in " " + base:
        if "--port" in base:
            return re.sub(r"--port\s+\d+", "--port " + pl, base), "Flask --port %s" % pl
        return base + " --port " + pl, "Flask --port %s" % pl
    if base.startswith("uvicorn "):
        if "--port" in base:
            return re.sub(r"--port\s+\d+", "--port " + pl, base), "uvicorn --port %s" % pl
        return base + " --port " + pl, "uvicorn --port %s" % pl
    if base.startswith("streamlit "):
        return base + " --server.port " + pl, "Streamlit --server.port %s" % pl
    # fallback: env var PORT
    return base, "No framework-specific flag found — PORT=%s set as an env var (works only if the app reads it)" % pl


def runs_view():
    with RUNS["lock"]:
        out = []
        for r in RUNS["runs"].values():
            proc = r.get("proc")
            if r["status"] == "running" and proc is not None:
                try:
                    proc.poll()
                    if proc.poll() is not None and r["status"] == "running":
                        r["status"] = "exited" if proc.returncode == 0 else "error"
                        r["exit_code"] = proc.returncode
                except Exception:
                    pass
            v = {k: val for k, val in r.items() if k not in ("proc", "logs", "proxy_token")}
            v["log_tail"] = (r.get("logs") or "")[-1500:]
            out.append(v)
    return out


def run_start(path, port):
    project = _project_by_path(path)
    if not project:
        return {"ok": False, "error": "project not found in last scan — press Scan first"}
    # port free check
    try:
        listeners = (get_listeners_linux() if OS_NAME == "Linux"
                     else (get_listeners_mac() if OS_NAME == "Darwin" else get_listeners_windows()))
    except Exception:
        listeners = []
    for l in listeners:
        if l.get("port") == port:
            return {"ok": False, "error": "port %s already in use (pid %s, %s) — pick another or kill it" % (
                port, l.get("pid"), l.get("proc") or "?")}
    cmd, note = build_run_command(project, port)
    if not cmd:
        return {"ok": False, "error": note}
    env = dict(os.environ)
    env["PORT"] = str(port or "")
    env["STACKRADAR_RUN"] = "1"
    proxy_token = None
    if settings_get().get("guard_runs", True):
        proxy_token, genv = guard_env_for_run(None)
        env.update(genv)
    try:
        kw = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if OS_NAME == "Windows"
              else {"start_new_session": True})
        proc = subprocess.Popen(cmd, shell=True, cwd=path, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1, errors="replace", **kw)
    except Exception as e:
        return {"ok": False, "error": "failed to start: %s" % e}
    rid = "run-%d" % (int(time.time() * 1000) % 10**10)
    run = {"id": rid, "project": os.path.basename(path), "path": path, "cmd": cmd,
           "port": port, "pid": proc.pid, "started": time.time(), "status": "running",
           "exit_code": None, "logs": "", "note": note, "proc": proc, "proxy_token": proxy_token,
           "guarded": bool(proxy_token)}
    with RUNS["lock"]:
        RUNS["runs"][rid] = run
        if len(RUNS["runs"]) > 30:
            for k in sorted(RUNS["runs"], key=lambda k: RUNS["runs"][k].get("started", 0))[:len(RUNS["runs"]) - 30]:
                del RUNS["runs"][k]
    t = threading.Thread(target=_run_reader, args=(rid, proc, run), daemon=True)
    t.start()
    # if it dies instantly, mark it
    threading.Timer(1.5, lambda: _run_check_alive(rid)).start()
    return {"ok": True, "id": rid, "cmd": cmd, "note": note, "pid": proc.pid}


def _run_check_alive(rid):
    with RUNS["lock"]:
        r = RUNS["runs"].get(rid)
    if r and r["status"] == "running":
        proc = r.get("proc")
        if proc is not None:
            rc = proc.poll()
            if rc is not None:
                r["status"] = "exited" if rc == 0 else "error"
                r["exit_code"] = rc


def _run_reader(rid, proc, run):
    try:
        for line in proc.stdout:
            with RUNS["lock"]:
                r = RUNS["runs"].get(rid)
                if r is None:
                    return
                r["logs"] = (r["logs"] + line)[-RUN_LOG_KEEP:]
    except Exception:
        pass
    try:
        rc = proc.wait()
    except Exception:
        rc = -1
    with RUNS["lock"]:
        r = RUNS["runs"].get(rid)
        if r is not None:
            r["status"] = "exited" if rc == 0 else "error"
            r["exit_code"] = rc


def _terminate_tree(pid, hard=False):
    """Stop a process and its children. POSIX: signal the process group. Windows: taskkill /T."""
    if OS_NAME == "Windows":
        args = ["taskkill", "/PID", str(pid), "/T"] + (["/F"] if hard else [])
        ok, out = run_cmd(args, timeout=15)
        if not ok and not hard:
            ok, out = run_cmd(args + ["/F"], timeout=15)
        return ok, "taskkill"
    sig = signal.SIGKILL if hard else signal.SIGTERM
    try:
        os.killpg(os.getpgid(pid), sig)
        return True, "process group"
    except Exception:
        try:
            os.kill(pid, sig)
            return True, "process"
        except Exception:
            return False, "failed"


def run_stop(rid, hard=False):
    with RUNS["lock"]:
        r = RUNS["runs"].get(rid)
    if not r:
        return {"ok": False, "error": "run not found"}
    proc = r.get("proc")
    pid = (proc.pid if proc is not None else None) or r.get("pid")
    alive = proc is None or proc.poll() is None
    if pid and alive:
        _terminate_tree(pid, hard=hard)
        if not hard:
            threading.Timer(2.5, lambda: run_stop(rid, hard=True)
                            if (r.get("proc") is None or r["proc"].poll() is None) else None).start()
    r["status"] = "stopped" if r["status"] == "running" else r["status"]
    return {"ok": True, "id": rid}


def run_stop_all():
    with RUNS["lock"]:
        ids = [rid for rid, r in RUNS["runs"].items() if r["status"] == "running"]
    for rid in ids:
        run_stop(rid)
    return {"ok": True, "stopped": len(ids)}


def kill_pid(pid):
    """Kill a pid only if it belongs to a scanned project or a managed run."""
    pid = int(pid)
    # managed runs are always allowed
    with RUNS["lock"]:
        for r in RUNS["runs"].values():
            if r.get("pid") == pid:
                allowed = True
                break
        else:
            allowed = False
    if not allowed:
        cwd = None
        try:
            cwd = os.readlink("/proc/%d/cwd" % pid)
        except Exception:
            pass
        if not cwd and OS_NAME == "Darwin":
            cwd = get_cwd_mac(pid)
        with STATE["lock"]:
            data = STATE["data"] or {}
        ok = False
        for p in data.get("projects", []):
            rp = (p.get("path") or "").rstrip(os.sep)
            if cwd and (cwd == rp or cwd.startswith(rp + os.sep)):
                ok = True
                break
        if not ok:
            return {"ok": False, "error": "refusing to kill pid %d — it does not belong to a scanned project" % pid}
    ok, method = _terminate_tree(pid)
    if not ok:
        return {"ok": False, "error": "could not kill pid %d" % pid}
    return {"ok": True, "pid": pid, "method": method}


# ---------------------------------------------------------------------------
# dependency outdated check (best effort, uses the project's own tooling)
# ---------------------------------------------------------------------------

DEPS = {"lock": threading.Lock(), "cache": {}}


def deps_check(path, force=False):
    with DEPS["lock"]:
        c = DEPS["cache"].get(path)
        if c and not force and (time.time() - c["checked_at"]) < 3600:
            return c
    items, methods = [], []
    pj = os.path.join(path, "package.json")
    if os.path.isfile(pj) and os.path.isdir(os.path.join(path, "node_modules")):
        pm = "npm"
        for lockf in ("pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"):
            if os.path.isfile(os.path.join(path, lockf)):
                pm = {"pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun"}[lockf]
                break
        # npm exits non-zero *when updates are available* — that's exactly the case we want
        ok, out = run_cmd([pm, "outdated", "--json"], timeout=90, cwd=path)
        if out.strip():
            try:
                data = json.loads(out.strip())
                # npm's JSON is a flat {name: {wanted, latest, ...}} map
                for name, info in data.items():
                    if not isinstance(info, dict) or ("wanted" not in info and "latest" not in info):
                        continue
                    items.append({"name": name,
                                  "current": info.get("current") or info.get("wanted"),
                                  "latest": info.get("latest") or info.get("wanted")})
                methods.append("%s outdated" % pm)
            except Exception:
                methods.append("%s outdated (parse failed)" % pm)
    # python venv
    for venv_name in (".venv", "venv", "env"):
        vp = os.path.join(path, venv_name)
        pipbin = os.path.join(vp, "bin", "pip") if OS_NAME != "Windows" else os.path.join(vp, "Scripts", "pip.exe")
        if os.path.isfile(pipbin):
            # pip can also exit non-zero while still printing valid JSON
            ok, out = run_cmd([pipbin, "list", "--outdated", "--format=json"], timeout=120, cwd=path)
            if out.strip():
                try:
                    for p in json.loads(out.strip()):
                        items.append({"name": p.get("name"), "current": p.get("version"),
                                      "latest": p.get("latest_version")})
                    methods.append("venv pip list --outdated")
                except Exception:
                    methods.append("pip outdated (parse failed)")
            break
    res = {"path": path, "checked_at": time.time(), "items": items, "method": "; ".join(methods) or "no checkable install found (need node_modules or a venv + internet)"}
    with DEPS["lock"]:
        DEPS["cache"][path] = res
    return res


_PORT_CACHE = {"t": 0, "data": None}


def _live_listeners(max_age=2.0):
    now = time.time()
    if _PORT_CACHE["data"] is not None and now - _PORT_CACHE["t"] < max_age:
        return _PORT_CACHE["data"]
    try:
        listeners = (get_listeners_linux() if OS_NAME == "Linux"
                     else (get_listeners_mac() if OS_NAME == "Darwin" else get_listeners_windows()))
    except Exception:
        listeners = []
    _PORT_CACHE["t"] = now
    _PORT_CACHE["data"] = listeners
    return listeners


def _live_pid_cwds(pids):
    pids = [p for p in set(pids) if p]
    if not pids:
        return {}
    if OS_NAME == "Linux":
        res = {}
        for pid in pids:
            try:
                res[pid] = os.readlink("/proc/%d/cwd" % pid)
            except Exception:
                pass
        return res
    if OS_NAME == "Darwin":
        return get_all_cwd_mac()
    return {}


def port_panel_data():
    """LIVE: how many apps run, how many ports are in use, which pids are killable."""
    with STATE["lock"]:
        data = STATE["data"] or {}
    runs = runs_view()
    managed_running = [r for r in runs if r["status"] == "running"]
    managed_pids = {r["pid"] for r in managed_running if r.get("pid")}
    managed_projects = {r.get("project") for r in managed_running}

    listeners = _live_listeners()
    cwds = _live_pid_cwds([l.get("pid") for l in listeners])
    projs = [( (p.get("path") or "").rstrip(os.sep), p.get("name")) for p in data.get("projects", [])]

    killable, seen, live_projects = [], set(), set()
    self_pid = os.getpid()
    for l in listeners:
        pid = l.get("pid")
        if not pid or pid == self_pid:
            continue  # never list StackRadar itself as killable
        cwd = cwds.get(pid)
        for rp, name in projs:
            if cwd and (cwd == rp or cwd.startswith(rp + os.sep)):
                if pid not in seen:
                    seen.add(pid)
                    killable.append({"pid": pid, "port": l.get("port"),
                                     "proc": (l.get("proc") or "")[:60],
                                     "project": name, "managed": pid in managed_pids})
                live_projects.add(name)
                break
    apps_running = len(live_projects | managed_projects)
    return {"listening_count": len(listeners),
            "apps_running": apps_running,
            "managed_running": len(managed_running),
            "killable": killable}


# ---------------------------------------------------------------------------
# settings (hints on/off, feature toggles) — ~/.stackradar/settings.json
# ---------------------------------------------------------------------------

SETTINGS_FILE = os.path.join(os.path.expanduser("~/.stackradar"), "settings.json")
SETTINGS = {"lock": threading.Lock(), "data": None}
FEATURE_KEYS = ("network", "system", "schedules", "skills", "agents", "duplicates", "updates", "lineage", "runs", "reclaim")


def settings_defaults():
    return {"hints": True, "dismissed_hints": [], "theme": "dark",
            "features": {k: True for k in FEATURE_KEYS},
            "update_repo": os.environ.get("STACKRADAR_REPO", "SYasJ/StackRadar"),
            "lineage_layout": "force", "lineage_motion": True,
            "net_level": "medium", "guard_runs": True}


def settings_get():
    with SETTINGS["lock"]:
        if SETTINGS["data"] is None:
            d = settings_defaults()
            try:
                with open(SETTINGS_FILE) as f:
                    saved = json.load(f)
                feats = {**d["features"], **(saved.get("features") or {})}
                d.update(saved)
                d["features"] = feats
            except Exception:
                pass
            SETTINGS["data"] = d
        return json.loads(json.dumps(SETTINGS["data"]))


def settings_set(patch):
    cur = settings_get()
    if isinstance(patch.get("hints"), bool):
        cur["hints"] = patch["hints"]
    if patch.get("net_level") in ("low", "medium", "strict"):
        cur["net_level"] = patch["net_level"]
    if isinstance(patch.get("guard_runs"), bool):
        cur["guard_runs"] = patch["guard_runs"]
    if isinstance(patch.get("lineage_motion"), bool):
        cur["lineage_motion"] = patch["lineage_motion"]
    if patch.get("lineage_layout") in ("force", "radial", "columns"):
        cur["lineage_layout"] = patch["lineage_layout"]
    if patch.get("theme") in ("dark", "light", "auto"):
        cur["theme"] = patch["theme"]
    if isinstance(patch.get("dismissed_hints"), list):
        cur["dismissed_hints"] = [str(x)[:60] for x in patch["dismissed_hints"]][:300]
    if isinstance(patch.get("features"), dict):
        for k, v in patch["features"].items():
            if k in FEATURE_KEYS and isinstance(v, bool):
                cur["features"][k] = v
    repo = patch.get("update_repo")
    if isinstance(repo, str) and re.match(r"^[\w.-]+/[\w.-]+$", repo):
        cur["update_repo"] = repo
    with SETTINGS["lock"]:
        SETTINGS["data"] = cur
        try:
            os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
            tmp = SETTINGS_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(cur, f, indent=1)
            os.replace(tmp, SETTINGS_FILE)
        except Exception:
            pass
    return cur


# ---------------------------------------------------------------------------
# system monitor: CPU, load, memory, swap, disk, network, top processes
# ---------------------------------------------------------------------------

SYSMON = {"lock": threading.Lock(), "prev_cpu": None, "prev_net": None,
          "history": [], "procs": {"t": 0, "data": []}, "started": False}
SYSMON_KEEP = 150   # samples (2 s apart -> 5 minutes)


def _cpu_times():
    """Return (idle, total, [(idle,total) per core]) or None."""
    if OS_NAME == "Linux":
        try:
            with open("/proc/stat") as f:
                lines = f.read().splitlines()
            out, cores = None, []
            for l in lines:
                if not l.startswith("cpu"):
                    continue
                parts = l.split()
                vals = [int(x) for x in parts[1:9]]
                idle = vals[3] + vals[4]
                tot = sum(vals)
                if parts[0] == "cpu":
                    out = (idle, tot)
                else:
                    cores.append((idle, tot))
            return (out[0], out[1], cores) if out else None
        except Exception:
            return None
    if OS_NAME == "Windows":
        try:
            import ctypes

            class FT(ctypes.Structure):
                _fields_ = [("lo", ctypes.c_uint32), ("hi", ctypes.c_uint32)]
            i, k, u = FT(), FT(), FT()
            ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i), ctypes.byref(k), ctypes.byref(u))
            f = lambda t: (t.hi << 32) | t.lo
            return (f(i), f(k) + f(u), [])   # kernel time includes idle
        except Exception:
            return None
    return None


def _cpu_percent_mac():
    ok, out = run_cmd(["top", "-l", "1", "-n", "0", "-s", "0"], timeout=6)
    m = re.search(r"CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys", out or "")
    if m:
        return round(float(m.group(1)) + float(m.group(2)), 1)
    return None


def _memory():
    """Return dict(total, available, used, percent, swap_total, swap_used)."""
    res = {"total": None, "available": None, "used": None, "percent": None,
           "swap_total": None, "swap_used": None}
    try:
        if OS_NAME == "Linux":
            info = {}
            with open("/proc/meminfo") as f:
                for l in f:
                    k, v = l.split(":", 1)
                    info[k] = int(v.split()[0]) * 1024
            res["total"] = info.get("MemTotal")
            res["available"] = info.get("MemAvailable", info.get("MemFree"))
            res["swap_total"] = info.get("SwapTotal")
            res["swap_used"] = (info.get("SwapTotal") or 0) - (info.get("SwapFree") or 0)
            res["cached"] = info.get("Cached")
        elif OS_NAME == "Darwin":
            ok, out = run_cmd(["sysctl", "-n", "hw.memsize"], timeout=4)
            res["total"] = int(out.strip()) if ok and out.strip().isdigit() else None
            ok, out = run_cmd(["vm_stat"], timeout=4)
            page = 4096
            m = re.search(r"page size of (\d+)", out or "")
            if m:
                page = int(m.group(1))
            pages = {k.strip(): int(v.strip().rstrip(".")) for k, v in
                     re.findall(r"^([^:]+):\s+(\d+)\.?$", out or "", re.M)}
            avail = (pages.get("Pages free", 0) + pages.get("Pages inactive", 0)
                     + pages.get("Pages speculative", 0) + pages.get("Pages purgeable", 0)) * page
            res["available"] = avail if res["total"] else None
            ok, out = run_cmd(["sysctl", "-n", "vm.swapusage"], timeout=4)
            m = re.search(r"total = ([\d.]+)M\s+used = ([\d.]+)M", out or "")
            if m:
                res["swap_total"] = int(float(m.group(1)) * 1048576)
                res["swap_used"] = int(float(m.group(2)) * 1048576)
        elif OS_NAME == "Windows":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            ms = MS()
            ms.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))
            res["total"], res["available"] = ms.ullTotalPhys, ms.ullAvailPhys
            res["swap_total"] = max(0, ms.ullTotalPageFile - ms.ullTotalPhys)
            res["swap_used"] = max(0, (ms.ullTotalPageFile - ms.ullAvailPageFile) - (ms.ullTotalPhys - ms.ullAvailPhys))
    except Exception:
        pass
    if res["total"] and res["available"] is not None:
        res["used"] = res["total"] - res["available"]
        res["percent"] = round(100.0 * res["used"] / res["total"], 1)
    return res


def _net_bytes():
    if OS_NAME != "Linux":
        return None
    try:
        rx = tx = 0
        with open("/proc/net/dev") as f:
            for l in f.readlines()[2:]:
                name, rest = l.split(":", 1)
                if name.strip() == "lo":
                    continue
                v = rest.split()
                rx += int(v[0])
                tx += int(v[8])
        return rx, tx
    except Exception:
        return None


def _uptime():
    try:
        if OS_NAME == "Linux":
            with open("/proc/uptime") as f:
                return float(f.read().split()[0])
        if OS_NAME == "Darwin":
            ok, out = run_cmd(["sysctl", "-n", "kern.boottime"], timeout=4)
            m = re.search(r"sec = (\d+)", out or "")
            if m:
                return time.time() - int(m.group(1))
        if OS_NAME == "Windows":
            import ctypes
            return ctypes.windll.kernel32.GetTickCount64() / 1000.0
    except Exception:
        pass
    return None


def _load_avg():
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except Exception:
        return None


def sysmon_sample():
    """Take one sample and append it to the rolling history."""
    now = time.time()
    cpu, cores = None, []
    ct = _cpu_times()
    with SYSMON["lock"]:
        prev = SYSMON["prev_cpu"]
        SYSMON["prev_cpu"] = ct
    if ct and prev:
        di, dt = ct[0] - prev[0], ct[1] - prev[1]
        if dt > 0:
            cpu = round(100.0 * (1 - di / dt), 1)
        for (i1, t1), (i0, t0) in zip(ct[2], prev[2]):
            cores.append(round(100.0 * (1 - (i1 - i0) / (t1 - t0)), 1) if t1 > t0 else 0.0)
    elif OS_NAME == "Darwin":
        cpu = _cpu_percent_mac()
    mem = _memory()
    net = _net_bytes()
    rx_rate = tx_rate = None
    with SYSMON["lock"]:
        pn = SYSMON["prev_net"]
        SYSMON["prev_net"] = (now, net) if net else None
    if net and pn and pn[1]:
        dt = max(0.001, now - pn[0])
        rx_rate, tx_rate = (net[0] - pn[1][0]) / dt, (net[1] - pn[1][1]) / dt
    load = _load_avg()
    s = {"t": now, "cpu": cpu, "cores": cores, "mem": mem.get("percent"),
         "load1": load[0] if load else None, "rx": rx_rate, "tx": tx_rate}
    with SYSMON["lock"]:
        SYSMON["history"].append(s)
        del SYSMON["history"][:-SYSMON_KEEP]
    return s, mem, load


def _sysmon_loop():
    while True:
        try:
            sysmon_sample()
        except Exception:
            pass
        time.sleep(2.0)


def sysmon_start():
    with SYSMON["lock"]:
        if SYSMON["started"]:
            return
        SYSMON["started"] = True
    threading.Thread(target=_sysmon_loop, daemon=True).start()


def top_processes(limit=15):
    """Top processes by CPU (cached 3 s). Each row: pid, cpu, mem_pct, rss, name, project."""
    with SYSMON["lock"]:
        c = SYSMON["procs"]
        if time.time() - c["t"] < 3 and c["data"]:
            return c["data"]
    rows = []
    if OS_NAME == "Linux":
        ok, out = run_cmd(["ps", "-eo", "pid,pcpu,pmem,rss,comm", "--sort=-pcpu", "--no-headers"], timeout=6)
    elif OS_NAME == "Darwin":
        ok, out = run_cmd(["ps", "-Ao", "pid=,pcpu=,pmem=,rss=,comm=", "-r"], timeout=6)
    else:
        ok, out = run_cmd(["powershell", "-NoProfile", "-Command",
                           "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First %d | "
                           "ForEach-Object { \"$($_.Id) $([math]::Round($_.CPU,1)) 0 $([math]::Round($_.WorkingSet64/1024)) $($_.ProcessName)\" }" % limit],
                          timeout=12)
    for line in (out or "").splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        try:
            rows.append({"pid": int(parts[0]),
                         # Windows Get-Process only gives cumulative CPU seconds, not a live %
                         "cpu": None if OS_NAME == "Windows" else float(parts[1]), "mem_pct": float(parts[2]),
                         "rss": int(float(parts[3])) * 1024, "name": os.path.basename(parts[4].strip())[:60]})
        except Exception:
            continue
        if len(rows) >= limit:
            break
    # attribute to scanned projects (Linux/macOS cwd)
    with STATE["lock"]:
        projs = [((p.get("path") or "").rstrip(os.sep), p.get("name")) for p in (STATE["data"] or {}).get("projects", [])]
    cwds = _live_pid_cwds([r["pid"] for r in rows]) if projs else {}
    managed = {}
    with RUNS["lock"]:
        for r in RUNS["runs"].values():
            if r.get("status") == "running":
                managed[r.get("pid")] = r.get("project")
    for r in rows:
        cwd = cwds.get(r["pid"])
        r["project"] = managed.get(r["pid"])
        if not r["project"] and cwd:
            for rp, name in projs:
                if cwd == rp or cwd.startswith(rp + os.sep):
                    r["project"] = name
                    break
        r["self"] = r["pid"] == os.getpid()
    with SYSMON["lock"]:
        SYSMON["procs"] = {"t": time.time(), "data": rows}
    return rows


def _disk_rows():
    seen, rows = set(), []
    cands = [os.path.expanduser("~")]
    with STATE["lock"]:
        cands += list((STATE["data"] or {}).get("roots", []))
    if OS_NAME != "Windows":
        cands.append("/")
    for c in cands:
        try:
            st = os.stat(c)
            if st.st_dev in seen:
                continue
            seen.add(st.st_dev)
            du = shutil.disk_usage(c)
            rows.append({"path": c, "total": du.total, "used": du.used, "free": du.free,
                         "percent": round(100.0 * du.used / du.total, 1) if du.total else None})
        except Exception:
            continue
    return rows


def system_view():
    sysmon_start()
    with SYSMON["lock"]:
        hist = list(SYSMON["history"])
    if not hist:
        sysmon_sample()
        time.sleep(0.25)
        s, mem, load = sysmon_sample()
        with SYSMON["lock"]:
            hist = list(SYSMON["history"])
    else:
        mem, load = _memory(), _load_avg()
    last = hist[-1] if hist else {}
    cores = os.cpu_count() or 1
    self_rss = None
    try:
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        self_rss = r if OS_NAME == "Darwin" else r * 1024
    except Exception:
        pass
    pressure = "ok"
    if (last.get("cpu") or 0) > 85 or (mem.get("percent") or 0) > 90 or (load and load[0] > cores * 1.5):
        pressure = "high"
    elif (last.get("cpu") or 0) > 60 or (mem.get("percent") or 0) > 75 or (load and load[0] > cores):
        pressure = "elevated"
    return {"cpu": last.get("cpu"), "cores": last.get("cores") or [], "cpu_count": cores,
            "load": load, "memory": mem, "disks": _disk_rows(), "uptime": _uptime(),
            "net": {"rx": last.get("rx"), "tx": last.get("tx")},
            "history": hist, "top": top_processes(), "pressure": pressure,
            "self": {"pid": os.getpid(), "rss_peak": self_rss, "version": VERSION},
            "platform": "%s %s" % (OS_NAME, platform.release())}


# ---------------------------------------------------------------------------
# schedules: cron parsing + detection (project files, crontab, launchd,
# systemd timers, Windows Task Scheduler, AI-agent cron jobs)
# ---------------------------------------------------------------------------

CRON_ALIASES = {"@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *",
                "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
                "@hourly": "0 * * * *"}
_DOW_NAMES = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
_MON_NAMES = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _cron_field(spec, lo, hi, names=None):
    out = set()
    for part in spec.lower().split(","):
        step = 1
        if "/" in part:
            part, st = part.split("/", 1)
            step = int(st)
        if names:
            for k, v in names.items():
                part = part.replace(k, str(v))
        if part in ("*", "?"):
            a, b = lo, hi
        elif "-" in part:
            a, b = (int(x) for x in part.split("-", 1))
        else:
            a = int(part)
            b = hi if step > 1 else a
        out.update(range(a, b + 1, step))
    return {x for x in out if lo <= x <= hi} | ({0} if hi == 7 and 7 in out else set())


def cron_parse(expr):
    expr = (expr or "").strip()
    expr = CRON_ALIASES.get(expr.lower(), expr)
    f = expr.split()
    if len(f) == 6:      # with seconds (node-cron / Spring) -> drop seconds
        f = f[1:]
    if len(f) != 5:
        return None
    try:
        return {"min": _cron_field(f[0], 0, 59), "hour": _cron_field(f[1], 0, 23),
                "dom": _cron_field(f[2], 1, 31), "mon": _cron_field(f[3], 1, 12, _MON_NAMES),
                "dow": {d % 7 for d in _cron_field(f[4], 0, 7, _DOW_NAMES)},
                "dom_any": f[2] in ("*", "?"), "dow_any": f[4] in ("*", "?")}
    except Exception:
        return None


def cron_next(expr, after=None, count=1):
    """Next fire time(s) (local time) for a 5/6-field cron expression."""
    c = cron_parse(expr)
    if not c:
        return []
    from datetime import timedelta
    t = datetime.fromtimestamp(after or time.time()).replace(second=0, microsecond=0) + timedelta(minutes=1)
    out, limit = [], t + timedelta(days=400)
    while t < limit and len(out) < count:
        if t.month not in c["mon"]:
            t = (t.replace(day=1, hour=0, minute=0) + timedelta(days=32)).replace(day=1)
            continue
        dom_ok, dow_ok = t.day in c["dom"], ((t.weekday() + 1) % 7) in c["dow"]
        day_ok = (dom_ok and dow_ok) if (c["dom_any"] or c["dow_any"]) else (dom_ok or dow_ok)
        if not day_ok:
            t = t.replace(hour=0, minute=0) + timedelta(days=1)
            continue
        if t.hour not in c["hour"]:
            t = t.replace(minute=0) + timedelta(hours=1)
            continue
        if t.minute not in c["min"]:
            t += timedelta(minutes=1)
            continue
        out.append(t.timestamp())
        t += timedelta(minutes=1)
    return out


def cron_describe(expr):
    e = (expr or "").strip()
    if e.lower() in CRON_ALIASES:
        return {"@hourly": "every hour", "@daily": "every day at midnight", "@midnight": "every day at midnight",
                "@weekly": "every Sunday at midnight", "@monthly": "on the 1st of every month",
                "@yearly": "every January 1st", "@annually": "every January 1st"}[e.lower()]
    if e.lower() == "@reboot":
        return "at every boot"
    f = e.split()
    if len(f) == 6:
        f = f[1:]
    if len(f) != 5:
        return e
    mi, hr, dom, mon, dow = f
    m = re.match(r"^\*/(\d+)$", mi)
    if m and hr == dom == mon == dow == "*":
        return "every %s min" % m.group(1)
    if mi.isdigit() and hr == "*" and dom == mon == dow == "*":
        return "every hour at :%02d" % int(mi)
    m = re.match(r"^\*/(\d+)$", hr)
    if mi.isdigit() and m and dom == mon == dow == "*":
        return "every %s h at :%02d" % (m.group(1), int(mi))
    if mi.isdigit() and hr.isdigit():
        at = "%02d:%02d" % (int(hr), int(mi))
        if dom == mon == dow == "*":
            return "daily at " + at
        if dom == mon == "*" and dow in ("1-5", "mon-fri", "MON-FRI"):
            return "weekdays at " + at
        if dom == mon == "*":
            names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            try:
                days = sorted(_cron_field(dow, 0, 7, _DOW_NAMES))
                return "%s at %s" % (", ".join(names[d % 7] for d in days), at)
            except Exception:
                pass
        if dom.isdigit() and mon == dow == "*":
            return "monthly on day %s at %s" % (dom, at)
    return e


_SCHED_CODE_PATTERNS = [
    ("node-cron", re.compile(r"""cron\.schedule\(\s*['"`]([^'"`]+)['"`]""")),
    ("cron (CronJob)", re.compile(r"""new\s+CronJob\(\s*['"`]([^'"`]+)['"`]""")),
    ("Spring @Scheduled", re.compile(r"""@Scheduled\([^)]*cron\s*=\s*["']([^"']+)["']""")),
    ("APScheduler", re.compile(r"""CronTrigger\.from_crontab\(\s*['"]([^'"]+)['"]""")),
    ("Celery beat", re.compile(r"""crontab\(([^)]*)\)""")),
    ("schedule (python)", re.compile(r"""schedule\.every\(([^)]*)\)\.([\w.]+)""")),
    ("setInterval", re.compile(r"""setInterval\([^,]+,\s*(\d{4,})\s*\)""")),
    ("Go cron", re.compile(r"""\.AddFunc\(\s*"([^"]+)\"""")),
]


def detect_project_schedules(root, files):
    out = []

    def add(kind, expr, where, desc=None, cmd=None):
        nxt = cron_next(expr) if expr and not expr.startswith(("rate(", "every ")) else []
        out.append({"kind": kind, "expr": expr, "human": desc or cron_describe(expr),
                    "file": os.path.relpath(where, root) if where.startswith(root) else where,
                    "command": cmd, "next": nxt[0] if nxt else None})

    wf = os.path.join(root, ".github", "workflows")
    if os.path.isdir(wf):
        for fp in sorted(globmod.glob(os.path.join(wf, "*.y*ml")))[:40]:
            text = read_head(fp, 100_000)
            if not re.search(r"^\s*schedule\s*:", text, re.M):
                continue
            name = (re.search(r"^name\s*:\s*['\"]?(.+?)['\"]?\s*$", text, re.M) or [None, os.path.basename(fp)])[1]
            for m in re.finditer(r"""-\s*cron\s*:\s*['"]([^'"]+)['"]""", text):
                add("GitHub Actions", m.group(1), fp, cmd="workflow: %s (runs in UTC)" % name)
    vj = os.path.join(root, "vercel.json")
    if os.path.isfile(vj):
        try:
            for c in (json.loads(read_head(vj, 100_000)).get("crons") or []):
                add("Vercel Cron", c.get("schedule"), vj, cmd=c.get("path"))
        except Exception:
            pass
    for name in ("wrangler.toml", "netlify.toml"):
        fp = os.path.join(root, name)
        if os.path.isfile(fp):
            text = read_head(fp, 100_000)
            for m in re.finditer(r"""(?:crons\s*=\s*\[([^\]]*)\]|schedule\s*=\s*["']([^"']+)["'])""", text):
                exprs = re.findall(r"""["']([^"']+)["']""", m.group(1)) if m.group(1) else [m.group(2)]
                for e in exprs:
                    add("Cloudflare Cron" if name.startswith("wrangler") else "Netlify Scheduled Fn", e, fp)
    for fp in files:
        b = os.path.basename(fp)
        ext = os.path.splitext(b)[1].lower()
        if ext in (".yml", ".yaml") and "/.github/" not in fp.replace("\\", "/"):
            text = read_head(fp, 100_000)
            if re.search(r"^kind:\s*CronJob", text, re.M):
                for m in re.finditer(r"""^\s*schedule:\s*['"]?([^'"\n]+)['"]?""", text, re.M):
                    add("Kubernetes CronJob", m.group(1).strip(), fp)
            elif b.startswith("serverless"):
                for m in re.finditer(r"""schedule:\s*(cron\([^)]*\)|rate\([^)]*\))""", text):
                    add("Serverless schedule", m.group(1), fp, desc=m.group(1))
        elif ext in (".js", ".ts", ".mjs", ".cjs", ".py", ".java", ".kt", ".go"):
            text = read_head(fp, 150_000)
            if not re.search(r"cron|schedule|setInterval|Scheduled", text):
                continue
            for kind, rx in _SCHED_CODE_PATTERNS:
                for m in rx.finditer(text):
                    if kind == "Celery beat":
                        kv = {k: v.rstrip(",") for k, v in re.findall(r"(\w+)\s*=\s*['\"]?([\w*/,-]+)", m.group(1))}
                        expr = "%s %s %s %s %s" % (kv.get("minute", "*"), kv.get("hour", "*"), kv.get("day_of_month", "*"),
                                                   kv.get("month_of_year", "*"), kv.get("day_of_week", "*"))
                        add(kind, expr, fp)
                    elif kind == "schedule (python)":
                        n = m.group(1).strip() or "1"
                        add(kind, "every %s %s" % (n, m.group(2)), fp, desc="every %s %s" % (n, m.group(2).replace(".", " ")))
                    elif kind == "setInterval":
                        ms = int(m.group(1))
                        add(kind, "every %ss" % (ms // 1000), fp, desc="in-process timer every %s" % (
                            ("%d min" % (ms // 60000)) if ms >= 60000 else ("%d s" % (ms // 1000))))
                    else:
                        add(kind, m.group(1), fp)
                    if len(out) > 40:
                        return out
    return out


def _link_project(text, projs):
    """Return the name/path of the scanned project a command or path mentions."""
    if not text:
        return None
    best = None
    for path, name in projs:
        if path and path in text and (best is None or len(path) > len(best[0])):
            best = (path, name)
    return {"path": best[0], "name": best[1]} if best else None


def system_schedules(projects=()):
    """User-level schedulers. Read-only; never modifies anything."""
    projs = [(p.get("path"), p.get("name")) for p in projects]
    out = []
    home = os.path.expanduser("~")
    if shutil.which("crontab"):
        ok, text = run_cmd(["crontab", "-l"], timeout=6)
        if ok:
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or re.match(r"^\w+=", line):
                    continue
                if line.startswith("@"):
                    expr, _, cmd = line.partition(" ")
                else:
                    parts = line.split(None, 5)
                    if len(parts) < 6:
                        continue
                    expr, cmd = " ".join(parts[:5]), parts[5]
                nxt = cron_next(expr) if expr != "@reboot" else []
                out.append({"source": "crontab", "name": cmd[:80], "expr": expr, "human": cron_describe(expr),
                            "command": sanitize_cmd(cmd[:300]), "next": nxt[0] if nxt else None, "enabled": True})
    if OS_NAME == "Darwin":
        import plistlib
        for fp in sorted(globmod.glob(os.path.join(home, "Library", "LaunchAgents", "*.plist")))[:80]:
            try:
                with open(fp, "rb") as f:
                    pl = plistlib.load(f)
            except Exception:
                continue
            args = pl.get("ProgramArguments") or ([pl.get("Program")] if pl.get("Program") else [])
            cmd = " ".join(str(a) for a in args)
            human, nxt = None, None
            if pl.get("StartInterval"):
                human = "every %s s" % pl["StartInterval"]
            cal = pl.get("StartCalendarInterval")
            if isinstance(cal, dict):
                expr = "%s %s %s %s %s" % (cal.get("Minute", "*") if cal.get("Minute") is not None else "*",
                                           cal.get("Hour", "*"), cal.get("Day", "*"), cal.get("Month", "*"),
                                           cal.get("Weekday", "*"))
                human = cron_describe(expr)
                n = cron_next(expr)
                nxt = n[0] if n else None
            if not human:
                human = "at login" if pl.get("RunAtLoad") else ("keep-alive daemon" if pl.get("KeepAlive") else "on demand")
            out.append({"source": "launchd", "name": pl.get("Label") or os.path.basename(fp), "expr": None,
                        "human": human, "command": sanitize_cmd(cmd[:300]), "next": nxt,
                        "enabled": not pl.get("Disabled", False), "file": fp,
                        "cwd": pl.get("WorkingDirectory")})
    if OS_NAME == "Linux":
        d = os.path.join(home, ".config", "systemd", "user")
        for fp in sorted(globmod.glob(os.path.join(d, "*.timer")))[:60]:
            text = read_head(fp, 20_000)
            cal = re.findall(r"^\s*OnCalendar\s*=\s*(.+)$", text, re.M)
            iv = re.findall(r"^\s*On(?:UnitActiveSec|BootSec|StartupSec)\s*=\s*(.+)$", text, re.M)
            svc = os.path.join(d, os.path.basename(fp)[:-6] + ".service")
            st = read_head(svc, 20_000) if os.path.isfile(svc) else ""
            ex = (re.search(r"^\s*ExecStart\s*=\s*(.+)$", st, re.M) or [None, ""])[1]
            wd = (re.search(r"^\s*WorkingDirectory\s*=\s*(.+)$", st, re.M) or [None, None])[1]
            out.append({"source": "systemd timer", "name": os.path.basename(fp), "expr": (cal or iv or [None])[0],
                        "human": ("OnCalendar " + ", ".join(cal)) if cal else ("every " + ", ".join(iv) if iv else "?"),
                        "command": sanitize_cmd(ex[:300]), "next": None, "enabled": True, "file": fp, "cwd": wd})
    if OS_NAME == "Windows":
        ok, text = run_cmd(["schtasks", "/query", "/fo", "CSV", "/v"], timeout=30)
        if ok:
            import csv
            import io
            seen = set()
            for row in csv.DictReader(io.StringIO(text)):
                name = row.get("TaskName") or ""
                if not name or name in seen or name.startswith("\\Microsoft\\") or name == "TaskName":
                    continue
                seen.add(name)
                out.append({"source": "Task Scheduler", "name": name.strip("\\"), "expr": None,
                            "human": row.get("Schedule Type") or row.get("Scheduled Type") or "",
                            "command": sanitize_cmd((row.get("Task To Run") or "")[:300]),
                            "next_label": row.get("Next Run Time"), "next": None,
                            "enabled": (row.get("Status") or "").lower() != "disabled",
                            "cwd": row.get("Start In")})
                if len(out) > 120:
                    break
    # AI-agent cron jobs (OpenClaw / Hermes and friends keep them in JSON)
    for agent, cands in (("OpenClaw", ["~/.openclaw/cron/jobs.json", "~/.clawdbot/cron/jobs.json"]),
                         ("Hermes Agent", ["~/.hermes/cron/jobs.json", "~/.hermes/cron.json"]),
                         ("Paperclip", ["~/.paperclip/schedules.json"])):
        for c in cands:
            fp = os.path.expanduser(c)
            if not os.path.isfile(fp):
                continue
            try:
                data = json.loads(read_head(fp, 2_000_000))
            except Exception:
                continue
            jobs = data.get("jobs") if isinstance(data, dict) else data
            if isinstance(jobs, dict):
                jobs = list(jobs.values())
            for j in (jobs or [])[:100]:
                if not isinstance(j, dict):
                    continue
                sch = j.get("schedule")
                expr = j.get("cron") or j.get("expr") or (sch.get("expr") if isinstance(sch, dict) else sch)
                every = (sch.get("everyMs") if isinstance(sch, dict) else None) or j.get("everyMs")
                human = cron_describe(expr) if isinstance(expr, str) else (
                    "every %d min" % (every // 60000) if every else "?")
                n = cron_next(expr) if isinstance(expr, str) else []
                text = j.get("prompt") or j.get("message") or ((j.get("payload") or {}).get("message") if isinstance(j.get("payload"), dict) else "") or ""
                out.append({"source": agent + " cron", "name": j.get("name") or j.get("id") or "job",
                            "expr": expr if isinstance(expr, str) else None, "human": human,
                            "command": sanitize_cmd(str(text)[:200]), "next": n[0] if n else None,
                            "enabled": j.get("enabled", True) is not False, "file": fp})
    for s in out:
        s["project"] = _link_project((s.get("command") or "") + " " + (s.get("cwd") or ""), projs)
    return out


def schedules_view():
    with STATE["lock"]:
        data = STATE["data"] or {}
    rows = []
    for p in data.get("projects", []):
        for s in p.get("schedules") or []:
            nxt = cron_next(s["expr"]) if s.get("expr") and cron_parse(s["expr"]) else []
            rows.append({**s, "source": s["kind"], "name": s.get("command") or s["kind"],
                         "project": {"path": p["path"], "name": p["name"]},
                         "next": nxt[0] if nxt else None, "scope": "project", "enabled": True})
    for s in data.get("system_schedules") or []:
        nxt = cron_next(s["expr"]) if s.get("expr") and cron_parse(s["expr"]) else []
        rows.append({**s, "next": nxt[0] if nxt else s.get("next"), "scope": "system"})
    rows.sort(key=lambda r: (r.get("next") is None, r.get("next") or 0))
    upcoming = [r for r in rows if r.get("next") and r["next"] - time.time() < 86400]
    return {"schedules": rows, "next_24h": len(upcoming), "now": time.time()}


# ---------------------------------------------------------------------------
# skills: discovery across agents, usage from session logs, duplicates
# ---------------------------------------------------------------------------

# (agent label, glob pattern relative to ~, kind)
SKILL_LOCATIONS = [
    ("Claude Code", ".claude/skills/*/SKILL.md", "skill"),
    ("Claude Code", ".claude/skills/*/*/SKILL.md", "skill"),
    ("Claude Code", ".claude/skills/synced/*/*/SKILL.md", "skill"),
    ("Claude Code (plugin)", ".claude/plugins/cache/*/*/*/skills/*/SKILL.md", "skill"),
    ("Claude Code (plugin)", ".claude/plugins/marketplaces/*/plugins/*/skills/*/SKILL.md", "skill"),
    ("Claude Code (plugin)", ".claude/plugins/marketplaces/*/skills/*/SKILL.md", "skill"),
    ("Claude Code", ".claude/commands/*.md", "command"),
    ("Claude Code", ".claude/agents/*.md", "subagent"),
    ("Codex CLI", ".codex/skills/*/SKILL.md", "skill"),
    ("Codex CLI", ".codex/skills/*/*/SKILL.md", "skill"),
    ("Codex CLI", ".codex/prompts/*.md", "command"),
    ("Agents (shared)", ".agents/skills/*/SKILL.md", "skill"),
    ("Hermes Agent", ".hermes/skills/*/SKILL.md", "skill"),
    ("Hermes Agent", ".hermes/skills/*/*/SKILL.md", "skill"),
    ("OpenClaw", ".openclaw/skills/*/SKILL.md", "skill"),
    ("OpenClaw", ".openclaw/workspace/skills/*/SKILL.md", "skill"),
    ("OpenClaw", ".clawdbot/skills/*/SKILL.md", "skill"),
    ("Paperclip", ".paperclip/skills/*/SKILL.md", "skill"),
    ("Gemini CLI", ".gemini/skills/*/SKILL.md", "skill"),
    ("Gemini CLI", ".gemini/commands/*.toml", "command"),
    ("Cursor", ".cursor/skills/*/SKILL.md", "skill"),
    ("OpenCode", ".config/opencode/skill/*/SKILL.md", "skill"),
    ("OpenCode", ".config/opencode/skills/*/SKILL.md", "skill"),
    ("Goose", ".config/goose/skills/*/SKILL.md", "skill"),
    ("Copilot", ".copilot/skills/*/SKILL.md", "skill"),
]
PROJECT_SKILL_GLOBS = [
    (".claude/skills/*/SKILL.md", "skill", "Claude Code"),
    (".claude/commands/*.md", "command", "Claude Code"),
    (".claude/agents/*.md", "subagent", "Claude Code"),
    (".agents/skills/*/SKILL.md", "skill", "Agents (shared)"),
    (".codex/skills/*/SKILL.md", "skill", "Codex CLI"),
    (".cursor/skills/*/SKILL.md", "skill", "Cursor"),
    (".gemini/skills/*/SKILL.md", "skill", "Gemini CLI"),
    (".openclaw/skills/*/SKILL.md", "skill", "OpenClaw"),
    ("skills/*/SKILL.md", "skill", "repo skills"),
]


def parse_frontmatter(text):
    meta = {}
    m = re.match(r"^---\s*\n(.*?)\n---\s*(\n|$)", text, re.S)
    if not m:
        return meta
    key = None
    for line in m.group(1).splitlines():
        mm = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if mm:
            key = mm.group(1).lower()
            val = mm.group(2).strip()
            meta[key] = "" if val in (">", "|", ">-", "|-") else val.strip("'\"")
        elif key and line.startswith((" ", "\t")):
            meta[key] = (meta[key] + " " + line.strip()).strip()
    return meta


def _skill_record(fp, agent, kind, scope, project=None):
    text = read_head(fp, 200_000)
    fm = parse_frontmatter(text)
    if kind == "skill":
        name = fm.get("name") or os.path.basename(os.path.dirname(fp))
        folder = os.path.dirname(fp)
    else:
        name = fm.get("name") or os.path.splitext(os.path.basename(fp))[0]
        folder = fp
    body = re.sub(r"\s+", " ", text).strip()
    try:
        size = fast_dir_size(folder)[0] if os.path.isdir(folder) else os.path.getsize(fp)
        mtime = os.path.getmtime(fp)
    except Exception:
        size, mtime = 0, None
    return {"name": name, "description": (fm.get("description") or "")[:300], "agent": agent,
            "kind": kind, "scope": scope, "project": project, "path": fp, "folder": folder,
            "size": size, "mtime": mtime, "hash": hashlib.sha1(body.encode("utf-8", "replace")).hexdigest()[:16],
            "plugin": (re.search(r"/plugins/(?:cache|marketplaces)/([^/]+)/", fp.replace("\\", "/")) or [None, None])[1]}


def _iter_claude_logs(budget=300_000_000):
    base = os.path.expanduser(os.path.join("~", ".claude", "projects"))
    files = []
    for fp in globmod.glob(os.path.join(base, "*", "*.jsonl")) + globmod.glob(os.path.join(base, "*", "*", "subagents", "*.jsonl")):
        try:
            files.append((os.path.getmtime(fp), os.path.getsize(fp), fp))
        except Exception:
            continue
    files.sort(reverse=True)
    used = 0
    for mt, sz, fp in files:
        if used + sz > budget:
            continue
        used += sz
        yield fp, mt


def _ts_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def claude_global_usage():
    """One pass over every Claude Code transcript: skill + slash-command use, tokens, models."""
    uses = {}      # skill name -> {count, last, projects:set}
    tok = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "sessions": 0, "models": {}, "last": None,
           "tools": {}}
    cmd_rx = re.compile(r"<command-name>/?([\w:.-]+)</command-name>")
    for fp, mt in _iter_claude_logs():
        tok["sessions"] += 1
        tok["last"] = max(tok["last"] or 0, mt)
        try:
            f = open(fp, "r", encoding="utf-8", errors="replace")
        except Exception:
            continue
        with f:
            for line in f:
                has_skill = '"Skill"' in line
                has_cmd = "<command-name>" in line
                has_usage = '"usage"' in line
                if not (has_skill or has_cmd or has_usage):
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                ts = _ts_iso(obj.get("timestamp")) or mt
                cwd = obj.get("cwd")
                msg = obj.get("message") or {}
                if not isinstance(msg, dict):
                    continue
                if obj.get("type") == "assistant":
                    u = msg.get("usage") or {}
                    tok["in"] += int(u.get("input_tokens") or 0)
                    tok["out"] += int(u.get("output_tokens") or 0)
                    tok["cache_read"] += int(u.get("cache_read_input_tokens") or 0)
                    tok["cache_write"] += int(u.get("cache_creation_input_tokens") or 0)
                    if msg.get("model"):
                        tok["models"][msg["model"]] = tok["models"].get(msg["model"], 0) + 1
                content = msg.get("content")
                if isinstance(content, list):
                    for c in content:
                        if not isinstance(c, dict):
                            continue
                        if c.get("type") == "tool_use":
                            tn = c.get("name") or "?"
                            tok["tools"][tn] = tok["tools"].get(tn, 0) + 1
                            if tn == "Skill":
                                inp = c.get("input") or {}
                                sk = inp.get("skill") or inp.get("command") or inp.get("name")
                                if sk:
                                    _bump(uses, str(sk), ts, cwd, "Claude Code")
                        elif c.get("type") == "text" and has_cmd:
                            for m in cmd_rx.finditer(c.get("text") or ""):
                                _bump(uses, m.group(1), ts, cwd, "Claude Code (slash)")
                elif isinstance(content, str) and has_cmd:
                    for m in cmd_rx.finditer(content):
                        _bump(uses, m.group(1), ts, cwd, "Claude Code (slash)")
    tok["tools"] = dict(sorted(tok["tools"].items(), key=lambda kv: -kv[1])[:25])
    return uses, tok


def _bump(uses, name, ts, cwd, via):
    key = name.split(":")[-1].lower()
    u = uses.setdefault(key, {"count": 0, "last": None, "projects": set(), "via": set(), "full": name})
    u["count"] += 1
    u["last"] = max(u["last"] or 0, ts or 0) or None
    if cwd:
        u["projects"].add(cwd)
    u["via"].add(via)


def other_agent_skill_mentions(skill_dirs, budget=120_000_000):
    """Codex / Hermes / OpenClaw logs don't have a Skill tool call; they *read* SKILL.md.
    Count mentions of '<skill-folder>/SKILL.md' in their session logs (best effort)."""
    pats = []
    for d in ["~/.codex/sessions/**/*.jsonl", "~/.hermes/sessions/**/*", "~/.openclaw/agents/*/sessions/*.jsonl"]:
        pats.append(os.path.expanduser(d))
    files = []
    for p in pats:
        for fp in globmod.glob(p, recursive=True):
            if os.path.isfile(fp):
                try:
                    files.append((os.path.getmtime(fp), os.path.getsize(fp), fp))
                except Exception:
                    pass
    files.sort(reverse=True)
    names = {os.path.basename(d).lower() for d in skill_dirs if d}
    if not names or not files:
        return {}
    rx = re.compile(r"[/\\]([\w.-]+)[/\\]SKILL\.md")
    found, used = {}, 0
    for mt, sz, fp in files:
        if used + sz > budget:
            continue
        used += sz
        text = read_head(fp, sz + 1)
        for m in rx.finditer(text):
            n = m.group(1).lower()
            if n in names:
                agent = "Codex CLI" if "/.codex/" in fp.replace("\\", "/") else ("Hermes Agent" if ".hermes" in fp else "OpenClaw")
                e = found.setdefault(n, {"count": 0, "last": None, "via": set()})
                e["count"] += 1
                e["last"] = max(e["last"] or 0, mt)
                e["via"].add(agent)
    return found


def skills_scan(projects):
    home = os.path.expanduser("~")
    recs, seen = [], set()
    for agent, pat, kind in SKILL_LOCATIONS:
        for fp in globmod.glob(os.path.join(home, pat))[:800]:
            rp = os.path.realpath(fp)
            if rp in seen:
                continue
            seen.add(rp)
            recs.append(_skill_record(fp, agent, kind, "global"))
    locks = []
    for p in projects:
        root = p.get("path")
        for pat, kind, agent in PROJECT_SKILL_GLOBS:
            for fp in globmod.glob(os.path.join(root, pat))[:300]:
                rp = os.path.realpath(fp)
                if rp in seen:
                    continue
                seen.add(rp)
                recs.append(_skill_record(fp, agent, kind, "project", project=p.get("name")))
        lf = os.path.join(root, "skills-lock.json")
        if os.path.isfile(lf):
            try:
                data = json.loads(read_head(lf, 1_000_000))
                for n, info in (data.get("skills") or {}).items():
                    locks.append({"project": p.get("name"), "name": n, "source": info.get("source"),
                                  "hash": (info.get("computedHash") or "")[:12]})
            except Exception:
                pass

    uses, tok = claude_global_usage()
    other = other_agent_skill_mentions([r["folder"] for r in recs if r["kind"] == "skill"])
    for k, v in other.items():
        u = uses.setdefault(k, {"count": 0, "last": None, "projects": set(), "via": set(), "full": k})
        u["count"] += v["count"]
        u["last"] = max(u["last"] or 0, v["last"] or 0) or None
        u["via"] |= v["via"]

    by_name, by_hash = {}, {}
    for r in recs:
        key = r["name"].lower()
        u = uses.get(key) or uses.get(os.path.basename(r["folder"]).lower().replace(".md", ""))
        r["uses"] = u["count"] if u else 0
        r["last_used"] = u["last"] if u else None
        r["used_in"] = sorted(os.path.basename(x) for x in (u["projects"] if u else []))[:8]
        r["used_via"] = sorted(u["via"]) if u else []
        by_name.setdefault(key, []).append(r)
        by_hash.setdefault(r["hash"], []).append(r)
    dup_names = []
    for k, rs in by_name.items():
        if len(rs) > 1:
            dup_names.append({"name": rs[0]["name"], "count": len(rs),
                              "identical": len({r["hash"] for r in rs}) == 1,
                              "wasted": sum(r["size"] for r in rs) - max(r["size"] for r in rs),
                              "paths": [r["path"] for r in rs], "agents": sorted({r["agent"] for r in rs})})
    dup_names.sort(key=lambda d: -d["count"])
    dup_content = [{"hash": h, "names": sorted({r["name"] for r in rs}), "paths": [r["path"] for r in rs]}
                   for h, rs in by_hash.items() if len(rs) > 1 and len({r["name"].lower() for r in rs}) > 1]
    # used-but-not-installed (e.g. built-in or removed skills)
    installed = set(by_name)
    ghost = [{"name": v["full"], "uses": v["count"], "last": v["last"], "via": sorted(v["via"])}
             for k, v in uses.items() if k not in installed]
    ghost.sort(key=lambda g: -g["uses"])
    recs.sort(key=lambda r: (-r["uses"], r["name"].lower()))
    return {"skills": recs[:1500], "duplicates": dup_names[:200], "same_content": dup_content[:100],
            "ghost": ghost[:60], "locks": locks[:300], "claude_totals": tok,
            "summary": {"installed": len(recs), "used": sum(1 for r in recs if r["uses"]),
                        "unused": sum(1 for r in recs if not r["uses"]),
                        "duplicate_names": len(dup_names),
                        "total_uses": sum(v["count"] for v in uses.values())}}


# ---------------------------------------------------------------------------
# AI agents: Claude Code, Codex, Hermes, OpenClaw, Paperclip, Gemini, …
# ---------------------------------------------------------------------------

AGENT_DEFS = [
    {"id": "claude", "name": "Claude Code", "vendor": "Anthropic", "bins": ["claude"], "dirs": ["~/.claude"],
     "sessions": ["~/.claude/projects/*/*.jsonl"], "mcp": [("~/.claude.json", "json:mcpServers"), ("~/.claude/settings.json", "json:mcpServers")],
     "procs": ["claude"], "url": "https://claude.com/claude-code"},
    {"id": "codex", "name": "Codex CLI", "vendor": "OpenAI", "bins": ["codex"], "dirs": ["~/.codex"],
     "sessions": ["~/.codex/sessions/**/*.jsonl"], "mcp": [("~/.codex/config.toml", "toml:mcp_servers")],
     "procs": ["codex"], "url": "https://github.com/openai/codex"},
    {"id": "hermes", "name": "Hermes Agent", "vendor": "Nous Research", "bins": ["hermes"], "dirs": ["~/.hermes"],
     "sessions": ["~/.hermes/sessions/*"], "mcp": [("~/.hermes/config.yaml", "yaml:mcp_servers")],
     "procs": ["hermes"], "url": "https://github.com/NousResearch/hermes-agent"},
    {"id": "openclaw", "name": "OpenClaw", "vendor": "OpenClaw (ex-Clawdbot/Moltbot)", "bins": ["openclaw", "clawdbot", "moltbot"],
     "dirs": ["~/.openclaw", "~/.clawdbot", "~/.moltbot"], "sessions": ["~/.openclaw/agents/*/sessions/*.jsonl"],
     "mcp": [("~/.openclaw/openclaw.json", "json:mcpServers")], "procs": ["openclaw", "clawdbot", "moltbot"],
     "ports": [18789], "url": "https://github.com/openclaw/openclaw"},
    {"id": "paperclip", "name": "Paperclip", "vendor": "Paperclip AI", "bins": ["paperclipai", "paperclip"],
     "dirs": ["~/.paperclip"], "sessions": [], "mcp": [], "procs": ["paperclip"], "ports": [3100],
     "url": "https://github.com/paperclipai/paperclip"},
    {"id": "gemini", "name": "Gemini CLI", "vendor": "Google", "bins": ["gemini"], "dirs": ["~/.gemini"],
     "sessions": ["~/.gemini/tmp/*/chats/*.json"], "mcp": [("~/.gemini/settings.json", "json:mcpServers")],
     "procs": ["gemini"], "url": "https://github.com/google-gemini/gemini-cli"},
    {"id": "cursor", "name": "Cursor", "vendor": "Anysphere", "bins": ["cursor", "cursor-agent"], "dirs": ["~/.cursor"],
     "sessions": [], "mcp": [("~/.cursor/mcp.json", "json:mcpServers")], "procs": ["Cursor", "cursor"], "url": "https://cursor.com"},
    {"id": "windsurf", "name": "Windsurf", "vendor": "Cognition", "bins": ["windsurf"], "dirs": ["~/.codeium/windsurf"],
     "sessions": [], "mcp": [("~/.codeium/windsurf/mcp_config.json", "json:mcpServers")], "procs": ["Windsurf"], "url": "https://windsurf.com"},
    {"id": "copilot", "name": "GitHub Copilot CLI", "vendor": "GitHub", "bins": ["copilot"], "dirs": ["~/.copilot"],
     "sessions": ["~/.copilot/session-state/*"], "mcp": [("~/.copilot/mcp-config.json", "json:mcpServers")], "procs": ["copilot"],
     "url": "https://github.com/github/copilot-cli"},
    {"id": "opencode", "name": "OpenCode", "vendor": "SST", "bins": ["opencode"], "dirs": ["~/.config/opencode", "~/.local/share/opencode"],
     "sessions": ["~/.local/share/opencode/storage/session/**/*.json"], "mcp": [("~/.config/opencode/opencode.json", "json:mcp")],
     "procs": ["opencode"], "url": "https://opencode.ai"},
    {"id": "goose", "name": "Goose", "vendor": "Block", "bins": ["goose"], "dirs": ["~/.config/goose"],
     "sessions": ["~/.local/share/goose/sessions/*"], "mcp": [], "procs": ["goose"], "url": "https://github.com/block/goose"},
    {"id": "aider", "name": "Aider", "vendor": "Aider", "bins": ["aider"], "dirs": [], "files": ["~/.aider.conf.yml"],
     "sessions": [], "mcp": [], "procs": ["aider"], "url": "https://aider.chat"},
    {"id": "qwen", "name": "Qwen Code", "vendor": "Alibaba", "bins": ["qwen"], "dirs": ["~/.qwen"], "sessions": [],
     "mcp": [("~/.qwen/settings.json", "json:mcpServers")], "procs": ["qwen"], "url": "https://github.com/QwenLM/qwen-code"},
    {"id": "amp", "name": "Amp", "vendor": "Sourcegraph", "bins": ["amp"], "dirs": ["~/.config/amp"], "sessions": [],
     "mcp": [], "procs": ["amp"], "url": "https://ampcode.com"},
    {"id": "kiro", "name": "Kiro", "vendor": "AWS", "bins": ["kiro", "kiro-cli"], "dirs": ["~/.kiro"], "sessions": [],
     "mcp": [("~/.kiro/settings/mcp.json", "json:mcpServers")], "procs": ["kiro"], "url": "https://kiro.dev"},
    {"id": "continue", "name": "Continue", "vendor": "Continue", "bins": ["cn"], "dirs": ["~/.continue"], "sessions": ["~/.continue/sessions/*.json"],
     "mcp": [], "procs": [], "url": "https://continue.dev"},
    {"id": "cline", "name": "Cline / Roo (VS Code)", "vendor": "Cline", "bins": [], "dirs": [],
     "globs": ["~/.vscode/extensions/saoudrizwan.claude-dev-*", "~/.vscode/extensions/rooveterinaryinc.roo-cline-*"],
     "sessions": [], "mcp": [], "procs": [], "url": "https://cline.bot"},
    {"id": "ollama", "name": "Ollama (local LLMs)", "vendor": "Ollama", "bins": ["ollama"], "dirs": ["~/.ollama"],
     "sessions": [], "mcp": [], "procs": ["ollama"], "ports": [11434], "url": "https://ollama.com"},
    {"id": "lmstudio", "name": "LM Studio", "vendor": "LM Studio", "bins": ["lms"], "dirs": ["~/.lmstudio", "~/.cache/lm-studio"],
     "sessions": [], "mcp": [("~/.lmstudio/mcp.json", "json:mcpServers")], "procs": ["LM Studio"], "ports": [1234], "url": "https://lmstudio.ai"},
]


def _mcp_names(path, spec):
    fp = os.path.expanduser(path)
    if not os.path.isfile(fp):
        return []
    kind, key = spec.split(":", 1)
    text = read_head(fp, 3_000_000)
    names = set()
    try:
        if kind == "json":
            data = json.loads(text)
            d = data.get(key)
            if isinstance(d, dict):
                names |= set(d)
            # ~/.claude.json keeps per-project servers too
            for pv in (data.get("projects") or {}).values() if isinstance(data.get("projects"), dict) else []:
                if isinstance(pv, dict) and isinstance(pv.get(key), dict):
                    names |= set(pv[key])
        elif kind == "toml":
            names |= set(re.findall(r"^\[%s\.([\w.-]+)\]" % re.escape(key), text, re.M))
        elif kind == "yaml":
            m = re.search(r"^%s:\s*\n((?:[ \t]+.*\n?)+)" % re.escape(key), text, re.M)
            if m:
                names |= set(re.findall(r"^[ \t]{2}([\w.-]+):", m.group(1), re.M))
    except Exception:
        pass
    return sorted(names)[:40]


def _codex_tokens(files):
    tin = tout = 0
    for fp in files[:400]:
        last = None
        try:
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if "total_token_usage" in line:
                        last = line
        except Exception:
            continue
        if last:
            try:
                m = json.loads(last)
                u = (((m.get("payload") or {}).get("info") or {}).get("total_token_usage")) or {}
                tin += int(u.get("input_tokens") or 0)
                tout += int(u.get("output_tokens") or 0)
            except Exception:
                pass
    return tin, tout


def agents_scan(procs, listeners, skills=None):
    home = os.path.expanduser("~")
    out = []
    for a in AGENT_DEFS:
        binp = next((shutil.which(b) for b in a["bins"] if shutil.which(b)), None)
        dirs = [os.path.expanduser(d) for d in a.get("dirs", []) if os.path.isdir(os.path.expanduser(d))]
        files = [os.path.expanduser(f) for f in a.get("files", []) if os.path.isfile(os.path.expanduser(f))]
        ext = []
        for g in a.get("globs", []):
            ext += globmod.glob(os.path.expanduser(g))
        if not (binp or dirs or files or ext):
            continue
        rec = {"id": a["id"], "name": a["name"], "vendor": a["vendor"], "url": a["url"], "bin": binp,
               "dirs": dirs + files + ext[:3], "version": None, "size": 0, "sessions": 0, "last_active": None,
               "mcp": [], "skills": 0, "running": [], "ports": [], "tokens_in": None, "tokens_out": None,
               "notes": []}
        if binp:
            ok, outv = run_cmd([binp, "--version"], timeout=8)
            line = (outv or "").strip().splitlines()
            rec["version"] = (line[0][:80] if line else None) if ok else None
        for d in dirs:
            try:
                rec["size"] += fast_dir_size(d)[0]
            except Exception:
                pass
        sess = []
        for pat in a.get("sessions", []):
            sess += [f for f in globmod.glob(os.path.expanduser(pat), recursive=True) if os.path.isfile(f)]
        rec["sessions"] = len(sess)
        mts = []
        for f in sess[:3000]:
            try:
                mts.append(os.path.getmtime(f))
            except Exception:
                pass
        for d in dirs:
            try:
                mts.append(os.path.getmtime(d))
            except Exception:
                pass
        rec["last_active"] = max(mts) if mts else None
        for path, spec in a.get("mcp", []):
            rec["mcp"] += [n for n in _mcp_names(path, spec) if n not in rec["mcp"]]
        if a["id"] == "codex" and sess:
            rec["tokens_in"], rec["tokens_out"] = _codex_tokens(sorted(sess, key=lambda f: -os.path.getmtime(f)))
        if a["id"] == "claude":
            st = os.path.join(home, ".claude", "settings.json")
            try:
                sd = json.loads(read_head(st, 500_000)) if os.path.isfile(st) else {}
                hooks = sd.get("hooks") or {}
                n_hooks = sum(len(v) if isinstance(v, list) else 1 for v in hooks.values())
                if n_hooks:
                    rec["notes"].append("%d hook group(s) configured" % n_hooks)
                plugins = [k for k, v in (sd.get("enabledPlugins") or {}).items() if v]
                if plugins:
                    rec["notes"].append("%d plugin(s) enabled" % len(plugins))
                if sd.get("model"):
                    rec["notes"].append("default model: %s" % sd["model"])
            except Exception:
                pass
            if skills and skills.get("claude_totals"):
                t = skills["claude_totals"]
                rec["tokens_in"], rec["tokens_out"] = t["in"], t["out"]
                if t.get("models"):
                    rec["notes"].append("models: " + ", ".join("%s×%d" % kv for kv in sorted(t["models"].items(), key=lambda kv: -kv[1])[:3]))
        if a["id"] == "ollama" and dirs:
            mf = globmod.glob(os.path.join(dirs[0], "models", "manifests", "*", "*", "*", "*"))
            if mf:
                rec["notes"].append("%d local model(s): %s" % (len(mf), ", ".join(
                    "%s:%s" % (m.split(os.sep)[-2], m.split(os.sep)[-1]) for m in mf[:5])))
        if skills:
            rec["skills"] = sum(1 for s in skills.get("skills", []) if s["agent"].startswith(a["name"].split(" (")[0]))
        names = [n.lower() for n in a.get("procs", [])]
        for p in procs or []:
            cmd = (p.get("cmd") or "")
            first = os.path.basename(cmd.split()[0]).lower() if cmd.split() else ""
            if names and (first in names or any(("/" + n + " ") in (cmd.lower() + " ") or ("node_modules/" + n) in cmd.lower() for n in names)):
                if p["pid"] != os.getpid():
                    rec["running"].append({"pid": p["pid"], "cmd": sanitize_cmd(cmd[:160]), "cwd": p.get("cwd")})
        rec["running"] = rec["running"][:8]
        for l in listeners or []:
            if l.get("port") in a.get("ports", []) or (l.get("proc") or "").lower() in names:
                rec["ports"].append(l["port"])
        rec["ports"] = sorted(set(rec["ports"]))
        rec["status"] = "running" if (rec["running"] or rec["ports"]) else ("installed" if binp else "config only")
        out.append(rec)
    out.sort(key=lambda r: ({"running": 0, "installed": 1}.get(r["status"], 2), -(r["last_active"] or 0)))
    return out


# ---------------------------------------------------------------------------
# duplicate files + duplicate projects
# ---------------------------------------------------------------------------

DUP_MIN_SIZE = 4096


def _hash_file(fp, head_only=False):
    h = hashlib.sha1()
    try:
        with open(fp, "rb") as f:
            if head_only:
                h.update(f.read(65536))
            else:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
    except Exception:
        return None
    return h.hexdigest()


def duplicates_scan(projects, budget_bytes=2_000_000_000, progress=None):
    by_size = {}
    for p in projects:
        files, _ = walk_files(p["path"], cap_files=8000, cap_bytes=float("inf"))
        for fp in files:
            try:
                sz = os.path.getsize(fp)
            except Exception:
                continue
            if sz >= DUP_MIN_SIZE:
                by_size.setdefault(sz, []).append((fp, p["name"]))
    groups, hashed = [], 0
    for sz, lst in sorted(by_size.items(), key=lambda kv: -kv[0]):
        if len(lst) < 2:
            continue
        heads = {}
        for fp, proj in lst:
            hh = _hash_file(fp, head_only=True)
            if hh:
                heads.setdefault(hh, []).append((fp, proj))
        for cand in heads.values():
            if len(cand) < 2:
                continue
            full = {}
            for fp, proj in cand:
                if hashed + sz > budget_bytes:
                    break
                hashed += sz
                fh = _hash_file(fp) if sz > 65536 else "h"
                full.setdefault(fh, []).append({"path": fp, "project": proj})
            for fh, items in full.items():
                if fh and len(items) > 1:
                    # keep the "original": no copy-ish suffix, then the shortest path
                    items.sort(key=lambda i: (bool(re.search(r"\(\d+\)|copy|backup|\bold\b", os.path.basename(i["path"]), re.I)),
                                              len(i["path"]), i["path"]))
                    groups.append({"size": sz, "count": len(items), "wasted": sz * (len(items) - 1),
                                   "name": os.path.basename(items[0]["path"]), "files": items[:20],
                                   "cross_project": len({i["project"] for i in items}) > 1})
    groups.sort(key=lambda g: -g["wasted"])
    # duplicate / copied projects
    dproj = []
    by_remote, by_base = {}, {}
    for p in projects:
        r = ((p.get("git") or {}).get("remote") or "").rstrip("/").replace(".git", "")
        if r:
            by_remote.setdefault(r, []).append(p)
        base = re.sub(r"(\s*\(\d+\)|[\s_-]*(copy|old|backup|bak|v\d+|\d{4}-\d{2}-\d{2}))+$", "", p["name"], flags=re.I).lower()
        by_base.setdefault(base, []).append(p)
    for r, ps in by_remote.items():
        if len(ps) > 1:
            dproj.append({"reason": "same git remote", "key": r, "projects": [{"name": x["name"], "path": x["path"], "size": x.get("size")} for x in ps]})
    for b, ps in by_base.items():
        if len(ps) > 1 and not any(set(x["path"] for x in ps) == set(y["path"] for y in d["projects"]) for d in dproj):
            dproj.append({"reason": "looks like a copy (same base name)", "key": b, "projects": [{"name": x["name"], "path": x["path"], "size": x.get("size")} for x in ps]})
    return {"groups": groups[:300], "wasted_total": sum(g["wasted"] for g in groups),
            "group_count": len(groups), "projects": dproj[:60], "min_size": DUP_MIN_SIZE}


# ---------------------------------------------------------------------------
# package updates: check outdated (global + per project) and update as a job
# ---------------------------------------------------------------------------

JOBS = {"lock": threading.Lock(), "jobs": {}}
GLOBAL_OUTDATED = {"lock": threading.Lock(), "data": None}
PKG_NAME_RX = re.compile(r"^(@[a-z0-9][\w.-]*/)?[A-Za-z0-9][\w.\-]*$")


def _pip_cmd():
    for c in (["pip3"], ["pip"]):
        if shutil.which(c[0]):
            return c
    return [sys.executable, "-m", "pip"] if not getattr(sys, "frozen", False) else None


def global_outdated(force=False):
    with GLOBAL_OUTDATED["lock"]:
        c = GLOBAL_OUTDATED["data"]
        if c and not force and time.time() - c["checked_at"] < 3600:
            return c
    res = {"checked_at": time.time(), "managers": {}}
    if shutil.which("npm"):
        ok, out = run_cmd(["npm", "outdated", "-g", "--json"], timeout=120)
        items = []
        try:
            for n, i in (json.loads(out.strip() or "{}") or {}).items():
                if isinstance(i, dict):
                    items.append({"name": n, "current": i.get("current"), "latest": i.get("latest")})
        except Exception:
            pass
        res["managers"]["npm"] = {"label": "npm (global)", "items": items}
    pip = _pip_cmd()
    if pip:
        ok, out = run_cmd(pip + ["list", "--outdated", "--format=json", "--disable-pip-version-check"], timeout=180)
        items = []
        try:
            m = re.search(r"\[.*\]", out or "", re.S)
            for i in json.loads(m.group(0)) if m else []:
                items.append({"name": i.get("name"), "current": i.get("version"), "latest": i.get("latest_version")})
        except Exception:
            pass
        res["managers"]["pip"] = {"label": "pip (%s)" % " ".join(pip), "items": items,
                                  "note": "if pip refuses with 'externally-managed-environment', your OS Python is locked — use pipx/uv or a venv"}
    if shutil.which("brew"):
        ok, out = run_cmd(["brew", "outdated", "--json=v2"], timeout=180)
        items = []
        try:
            data = json.loads(out.strip() or "{}")
            for i in data.get("formulae", []) + data.get("casks", []):
                items.append({"name": i.get("name"), "current": ", ".join(i.get("installed_versions") or [])
                              if isinstance(i.get("installed_versions"), list) else i.get("installed_versions"),
                              "latest": i.get("current_version")})
        except Exception:
            pass
        res["managers"]["brew"] = {"label": "Homebrew", "items": items}
    with GLOBAL_OUTDATED["lock"]:
        GLOBAL_OUTDATED["data"] = res
    return res


def _project_pm(path):
    for lockf, pm in (("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun")):
        if os.path.isfile(os.path.join(path, lockf)):
            return pm
    return "npm"


def build_update_command(scope, manager, packages, path=None):
    """Return (argv, cwd) — never a shell string. Raises ValueError on bad input."""
    pk = [p for p in (packages or []) if isinstance(p, str)]
    for p in pk:
        if not PKG_NAME_RX.match(p) or len(p) > 214:
            raise ValueError("invalid package name: %r" % p)
    if scope == "global":
        if manager == "npm":
            if not pk:
                return ["npm", "update", "-g"], None
            return ["npm", "install", "-g"] + ["%s@latest" % p for p in pk], None
        if manager == "pip":
            pip = _pip_cmd()
            if not pip or not pk:
                raise ValueError("pip needs explicit package names")
            return pip + ["install", "--upgrade", "--disable-pip-version-check"] + pk, None
        if manager == "brew":
            return ["brew", "upgrade"] + pk, None
        raise ValueError("unknown manager")
    if scope == "project":
        if not path or not os.path.isdir(path):
            raise ValueError("project path missing")
        if manager == "node":
            pm = _project_pm(path)
            if not pk:
                return ({"npm": ["npm", "update"], "pnpm": ["pnpm", "update"], "yarn": ["yarn", "upgrade"],
                         "bun": ["bun", "update"]}[pm]), path
            verb = {"npm": ["npm", "install"], "pnpm": ["pnpm", "add"], "yarn": ["yarn", "add"], "bun": ["bun", "add"]}[pm]
            return verb + ["%s@latest" % p for p in pk], path
        if manager == "pip":
            for venv_name in (".venv", "venv", "env"):
                pipbin = os.path.join(path, venv_name, "Scripts" if OS_NAME == "Windows" else "bin",
                                      "pip.exe" if OS_NAME == "Windows" else "pip")
                if os.path.isfile(pipbin):
                    if not pk:
                        raise ValueError("pip needs explicit package names")
                    return [pipbin, "install", "--upgrade", "--disable-pip-version-check"] + pk, path
            raise ValueError("no virtualenv found in this project (.venv / venv / env)")
        raise ValueError("unknown manager")
    raise ValueError("unknown scope")


def job_start(title, argv, cwd=None, kind="update", after=None):
    if not shutil.which(argv[0]) and not os.path.isfile(argv[0]):
        return {"ok": False, "error": "%s is not installed / not in PATH" % argv[0]}
    jid = "job-%d" % (int(time.time() * 1000) % 10**10)
    job = {"id": jid, "title": title, "argv": argv, "cmd": " ".join(argv), "cwd": cwd, "kind": kind,
           "status": "running", "started": time.time(), "finished": None, "exit_code": None, "logs": ""}
    with JOBS["lock"]:
        JOBS["jobs"][jid] = job
        for k in sorted(JOBS["jobs"], key=lambda k: JOBS["jobs"][k]["started"])[:-25]:
            del JOBS["jobs"][k]

    def runner():
        try:
            p = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, bufsize=1, errors="replace",
                                 env={**os.environ, "CI": "1", "npm_config_yes": "true", "HOMEBREW_NO_AUTO_UPDATE": "1"})
            for line in p.stdout:
                with JOBS["lock"]:
                    job["logs"] = (job["logs"] + line)[-200_000:]
            rc = p.wait()
        except Exception as e:
            rc = -1
            job["logs"] += "\n[stackradar] failed to start: %s\n" % e
        job["exit_code"] = rc
        job["status"] = "done" if rc == 0 else "failed"
        job["finished"] = time.time()
        if after:
            try:
                after(rc)
            except Exception:
                pass
    threading.Thread(target=runner, daemon=True).start()
    return {"ok": True, "id": jid, "cmd": job["cmd"]}


def jobs_view(jid=None):
    with JOBS["lock"]:
        if jid:
            j = JOBS["jobs"].get(jid)
            return dict(j) if j else None
        return [{k: v for k, v in j.items() if k != "logs"} | {"log_tail": j["logs"][-400:]}
                for j in sorted(JOBS["jobs"].values(), key=lambda j: -j["started"])]


def _semver_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0")[:3]) or (0,)


def app_update_check(repo):
    """Opt-in: asks GitHub for the latest StackRadar release. Only runs when you click the button."""
    import urllib.request
    url = "https://api.github.com/repos/%s/releases?per_page=20" % repo
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "StackRadar/" + VERSION})
        with urllib.request.urlopen(req, timeout=10) as r:
            rels = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": "could not reach GitHub: %s" % e, "current": VERSION}
    rels = [x for x in rels if not x.get("draft") and re.search(r"stackradar|^v?\d", x.get("tag_name") or "", re.I)]
    if not rels:
        return {"ok": True, "current": VERSION, "latest": None, "update": False, "repo": repo}
    best = max(rels, key=lambda x: _semver_tuple(x.get("tag_name")))
    latest = re.sub(r"^\D*", "", best.get("tag_name") or "")
    assets = [{"name": a.get("name"), "url": a.get("browser_download_url"), "size": a.get("size")}
              for a in best.get("assets") or []]
    return {"ok": True, "current": VERSION, "latest": latest, "update": _semver_tuple(latest) > _semver_tuple(VERSION),
            "url": best.get("html_url"), "notes": (best.get("body") or "")[:2000], "assets": assets, "repo": repo}


# ---------------------------------------------------------------------------
# Network Guard: who talks to the internet, from which file, carrying what —
# with allow / deny prompts and three security levels.
#
#   * Monitor (every app): live TCP/UDP connections per process via ss / lsof /
#     netstat, bytes in/out where the OS exposes them, mapped to scanned
#     projects and to the source line that references the host.
#   * Enforce (apps started from StackRadar): runs get HTTP(S)_PROXY pointing at
#     a local egress proxy. Every new destination is checked against your rules
#     and the security level; unknown ones raise an Allow / Deny prompt.
#   * Block (any app, optional): generate + run an OS firewall rule (UAC / admin
#     prompt) for a host's IPs.
#
# HTTPS payloads are never decrypted. Sensitive-data checks cover plain-HTTP
# requests through the proxy (full inspection) and the code that builds requests.
# ---------------------------------------------------------------------------

import base64
import ipaddress
import select
import socketserver
from collections import deque

NET_RULES_FILE = os.path.join(os.path.expanduser("~/.stackradar"), "network-rules.json")
NET = {"lock": threading.RLock(), "events": deque(maxlen=400), "pending": {}, "temp": {},
       "rules": None, "proxy_port": None, "proxied": {}, "sock_prev": {}, "sock_t": 0,
       "rdns": {}, "fwd": {}, "alerts": deque(maxlen=200), "app_hist": {}, "started": False,
       "conn_cache": {"t": 0, "data": None}}
NET_LEVELS = ("low", "medium", "strict")
PROMPT_TIMEOUT = {"medium": 25, "strict": 45}

# hosts a developer machine talks to all day (auto-allowed on "medium")
TRUSTED_HOSTS = [
    "registry.npmjs.org", "registry.yarnpkg.com", "registry.npmmirror.com", "nodejs.org",
    "pypi.org", "files.pythonhosted.org", "github.com", "api.github.com", "codeload.github.com",
    "objects.githubusercontent.com", "raw.githubusercontent.com", "*.githubusercontent.com",
    "crates.io", "static.crates.io", "index.crates.io", "proxy.golang.org", "sum.golang.org",
    "rubygems.org", "repo.maven.apache.org", "dl.google.com", "deb.debian.org", "archive.ubuntu.com",
]

# host → (service, category). Categories drive colour + risk on the radar.
SERVICE_MAP = [
    ("api.openai.com", "OpenAI", "ai"), ("*.openai.com", "OpenAI", "ai"),
    ("api.anthropic.com", "Anthropic", "ai"), ("*.anthropic.com", "Anthropic", "ai"),
    ("generativelanguage.googleapis.com", "Google Gemini", "ai"), ("openrouter.ai", "OpenRouter", "ai"),
    ("api.groq.com", "Groq", "ai"), ("api.mistral.ai", "Mistral", "ai"), ("*.huggingface.co", "Hugging Face", "ai"),
    ("api.heygen.com", "HeyGen", "ai"), ("api.elevenlabs.io", "ElevenLabs", "ai"),
    ("api.stripe.com", "Stripe", "payments"), ("*.paypal.com", "PayPal", "payments"),
    ("*.amazonaws.com", "AWS", "cloud"), ("*.googleapis.com", "Google Cloud", "cloud"),
    ("*.azure.com", "Azure", "cloud"), ("*.supabase.co", "Supabase", "cloud"), ("*.firebaseio.com", "Firebase", "cloud"),
    ("*.vercel.app", "Vercel", "cloud"), ("api.vercel.com", "Vercel", "cloud"), ("*.cloudflare.com", "Cloudflare", "cloud"),
    ("*.sentry.io", "Sentry", "telemetry"), ("*.segment.io", "Segment", "telemetry"), ("api.segment.io", "Segment", "telemetry"),
    ("*.mixpanel.com", "Mixpanel", "telemetry"), ("*.posthog.com", "PostHog", "telemetry"), ("*.amplitude.com", "Amplitude", "telemetry"),
    ("*.google-analytics.com", "Google Analytics", "telemetry"), ("*.datadoghq.com", "Datadog", "telemetry"),
    ("*.doubleclick.net", "DoubleClick", "telemetry"),
    ("github.com", "GitHub", "vcs"), ("*.github.com", "GitHub", "vcs"), ("*.githubusercontent.com", "GitHub", "vcs"),
    ("gitlab.com", "GitLab", "vcs"), ("bitbucket.org", "Bitbucket", "vcs"),
    ("registry.npmjs.org", "npm", "registry"), ("pypi.org", "PyPI", "registry"), ("files.pythonhosted.org", "PyPI", "registry"),
    ("crates.io", "crates.io", "registry"), ("*.docker.io", "Docker Hub", "registry"), ("*.docker.com", "Docker", "registry"),
    ("*.cloudfront.net", "CloudFront CDN", "cdn"), ("*.akamaiedge.net", "Akamai CDN", "cdn"), ("*.fastly.net", "Fastly CDN", "cdn"),
]
# SDK in the dependency list → host it will call even if the URL isn't in the code
SDK_HOSTS = {"openai": "api.openai.com", "@anthropic-ai/sdk": "api.anthropic.com", "anthropic": "api.anthropic.com",
             "stripe": "api.stripe.com", "boto3": "*.amazonaws.com", "aws-sdk": "*.amazonaws.com",
             "@aws-sdk/client-s3": "*.amazonaws.com", "@supabase/supabase-js": "*.supabase.co",
             "firebase": "*.googleapis.com", "@sentry/node": "*.sentry.io", "@sentry/nextjs": "*.sentry.io",
             "sentry-sdk": "*.sentry.io", "posthog-js": "*.posthog.com", "posthog": "*.posthog.com",
             "mixpanel": "*.mixpanel.com", "@segment/analytics-node": "api.segment.io", "google-generativeai": "generativelanguage.googleapis.com",
             "groq": "api.groq.com", "requests": None, "axios": None}
PII_PATTERNS = [
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("card number", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("Authorization header", re.compile(r"(?im)^(authorization|proxy-authorization|x-api-key|api-key|cookie)\s*:")),
    ("password field", re.compile(r"(?i)(password|passwd|pwd)=[^&\s]{3,}")),
]
URL_RX = re.compile(r"""\b(https?|wss?)://([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?""")
SECRET_USE_RX = re.compile(r"(?i)(api[_-]?key|secret|token|passw|bearer|authorization|AKIA|sk-|sk_live)")
IGNORED_REF_HOSTS = re.compile(r"(^|\.)(w3\.org|schema\.org|json-schema\.org|example\.(com|org|net)|localhost|xmlsoap\.org|purl\.org|apache\.org/licenses|opensource\.org|mozilla\.org|creativecommons\.org)$")


def _host_match(pattern, host):
    pattern, host = (pattern or "").lower().strip(), (host or "").lower().strip().rstrip(".")
    if not pattern or pattern == "*":
        return True
    if pattern.startswith("*."):
        return host == pattern[2:] or host.endswith(pattern[1:])
    return host == pattern


def host_info(host):
    h = (host or "").lower()
    try:
        ip = ipaddress.ip_address(h)
        if ip.is_loopback:
            return {"service": "this machine", "category": "local"}
        if ip.is_private or ip.is_link_local:
            return {"service": "local network", "category": "lan"}
    except ValueError:
        pass
    if h in ("localhost",) or h.endswith(".local"):
        return {"service": "this machine" if h == "localhost" else "local network", "category": "local" if h == "localhost" else "lan"}
    for pat, svc, cat in SERVICE_MAP:
        if _host_match(pat, h):
            return {"service": svc, "category": cat}
    return {"service": None, "category": "unknown"}


def scan_sensitive(text):
    """Return a list of sensitive things found in a request (secrets + PII)."""
    found = []
    for name, rx, sev, vg in SECRET_PATTERNS:
        if name == "Generic secret assignment":
            continue
        if rx.search(text):
            found.append({"type": name, "severity": "high"})
    for name, rx in PII_PATTERNS:
        if rx.search(text):
            found.append({"type": name, "severity": "high" if "Authorization" in name or "password" in name else "medium"})
    return found[:8]


# ---------------- static map: which file talks to which host ----------------

def extract_net_refs(root, files, deps):
    refs, seen = [], set()
    secret_lines = {}
    for fp in files:
        ext = os.path.splitext(fp)[1].lower()
        b = os.path.basename(fp)
        if ext not in CODE_EXT_SCAN and not b.startswith(".env"):
            continue
        if ext in (".json", ".xml", ".lock") or b in ("package-lock.json", "yarn.lock"):
            continue
        text = read_head(fp, 200_000)
        if "://" not in text:
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if len(line) > 600 or "://" not in line:
                continue
            for m in URL_RX.finditer(line):
                scheme, host, port = m.group(1).lower(), m.group(2).lower(), m.group(3)
                if IGNORED_REF_HOSTS.search(host):
                    continue
                key = (host, fp)
                if key in seen:
                    continue
                seen.add(key)
                window = "\n".join(lines[max(0, i - 3): i + 4])
                carries = bool(SECRET_USE_RX.search(window)) or bool(re.search(r"://[^/\s:@]+:[^/\s@]+@", line))
                info = host_info(host)
                refs.append({"host": host, "port": int(port) if port else (443 if scheme in ("https", "wss") else 80),
                             "scheme": scheme, "file": os.path.relpath(fp, root), "line": i + 1,
                             "snippet": sanitize_cmd(line.strip()[:160]), "carries_secret": carries,
                             "plain": scheme in ("http", "ws") and info["category"] not in ("local", "lan"),
                             "service": info["service"], "category": info["category"], "via": "url in code"})
                if len(refs) >= 80:
                    break
    for d in deps or []:
        host = SDK_HOSTS.get(d.get("name"))
        if host and not any(_host_match(host, r["host"]) or r["host"] == host for r in refs):
            info = host_info(host.replace("*.", "x."))
            refs.append({"host": host, "port": 443, "scheme": "https", "file": d.get("from"), "line": None,
                         "snippet": "dependency %s" % d.get("name"), "carries_secret": True, "plain": False,
                         "service": info["service"], "category": info["category"], "via": "sdk dependency"})
    # risk notes
    for r in refs:
        notes = []
        if r["plain"] and r["carries_secret"]:
            notes.append("credentials over plain HTTP")
        elif r["plain"]:
            notes.append("plain HTTP (unencrypted)")
        if r["category"] == "telemetry":
            notes.append("analytics / tracking")
        if r["category"] == "unknown" and r["carries_secret"]:
            notes.append("secret sent to an unrecognised host")
        r["notes"] = notes
        r["risk"] = "high" if (r["plain"] and r["carries_secret"]) or ("unrecognised" in " ".join(notes)) else (
            "medium" if notes else "low")
    refs.sort(key=lambda r: ({"high": 0, "medium": 1, "low": 2}[r["risk"]], r["host"]))
    return refs


# ---------------- rules ----------------

def net_rules():
    with NET["lock"]:
        if NET["rules"] is None:
            try:
                with open(NET_RULES_FILE) as f:
                    NET["rules"] = json.load(f)
            except Exception:
                NET["rules"] = []
        return NET["rules"]


def _save_rules():
    try:
        os.makedirs(os.path.dirname(NET_RULES_FILE), exist_ok=True)
        tmp = NET_RULES_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(NET["rules"], f, indent=1)
        os.replace(tmp, NET_RULES_FILE)
    except Exception:
        pass


def rule_add(app, host, action, port=None, note=None):
    if action not in ("allow", "deny"):
        raise ValueError("action must be allow or deny")
    host = (host or "").strip().lower()
    if not re.match(r"^(\*|\*\.[a-z0-9.-]+|[a-z0-9.:-]+)$", host):
        raise ValueError("bad host pattern")
    with NET["lock"]:
        rules = net_rules()
        rules[:] = [r for r in rules if not (r["app"] == (app or "*") and r["host"] == host)]
        r = {"id": "r%d" % int(time.time() * 1000), "app": app or "*", "host": host, "port": port,
             "action": action, "created": time.time(), "hits": 0, "note": note}
        rules.append(r)
        _save_rules()
        return r


def rule_delete(rid):
    with NET["lock"]:
        rules = net_rules()
        rules[:] = [r for r in rules if r["id"] != rid]
        _save_rules()


def rule_lookup(app, host, port=None):
    """Most specific matching rule: app-specific beats global, exact host beats wildcard."""
    best, score = None, -1
    for r in net_rules():
        if r["app"] not in ("*", app):
            continue
        if r.get("port") and port and int(r["port"]) != int(port):
            continue
        if not _host_match(r["host"], host):
            continue
        s = (2 if r["app"] != "*" else 0) + (1 if not r["host"].startswith("*") else 0)
        if s > score:
            best, score = r, s
    return best


def net_level():
    lv = settings_get().get("net_level", "medium")
    return lv if lv in NET_LEVELS else "medium"


def _project_refs(app_path):
    p = _project_by_path(app_path) if app_path else None
    return (p or {}).get("net_refs") or []


def net_event(kind, **kw):
    e = {"t": time.time(), "kind": kind, **kw}
    if e.get("host") and "category" not in e:
        e["category"] = host_info(e["host"])["category"]
    with NET["lock"]:
        NET["events"].appendleft(e)
        if kind in ("blocked", "sensitive", "violation", "exfil"):
            NET["alerts"].appendleft(e)
    return e


def guard_decide(app, host, port, scheme, sensitive=None):
    """Return (allow: bool, reason). May block waiting for the user's answer."""
    app_path = (app or {}).get("path")
    app_name = (app or {}).get("name") or "unknown app"
    info = host_info(host)
    level = net_level()
    if info["category"] == "local":
        return True, "this machine"
    r = rule_lookup(app_path or "*", host, port)
    if r:
        r["hits"] = r.get("hits", 0) + 1
        return r["action"] == "allow", "rule: %s %s" % (r["action"], r["host"])
    if sensitive and level == "strict":
        return False, "strict: sensitive data in a plain-HTTP request"
    key = (app_path or app_name, host)
    with NET["lock"]:
        t = NET["temp"].get(key)
        if t and t[1] > time.time():
            return t[0], "remembered for this session"
    if level == "low":
        return True, "low: allow everything (logged)"
    refs = _project_refs(app_path)
    ref = next((x for x in refs if _host_match(x["host"], host) or _host_match(host, x["host"])), None)
    if level == "medium":
        if any(_host_match(h, host) for h in TRUSTED_HOSTS):
            return True, "medium: trusted developer host"
        if ref and ref["risk"] != "high":
            return True, "medium: expected — %s references it" % (ref["file"] or "the code")
    # ask the user
    with NET["lock"]:
        pend = next((p for p in NET["pending"].values() if p["key"] == key and not p["event"].is_set()), None)
        if not pend:
            pid = "p%d" % (int(time.time() * 1000) % 10**9)
            pend = {"id": pid, "key": key, "app": app_name, "app_path": app_path, "host": host, "port": port,
                    "scheme": scheme, "service": info["service"], "category": info["category"],
                    "ref": ref, "sensitive": sensitive or [], "level": level, "created": time.time(),
                    "timeout": PROMPT_TIMEOUT[level], "event": threading.Event(), "decision": None}
            NET["pending"][pid] = pend
            net_event("prompt", app=app_name, host=host, port=port, service=info["service"])
    pend["event"].wait(pend["timeout"])
    with NET["lock"]:
        NET["pending"].pop(pend["id"], None)
    d = pend["decision"]
    if d is None:
        allow = level == "medium"
        return allow, "no answer in %ds — %s by %s level" % (pend["timeout"], "allowed" if allow else "denied", level)
    return d.startswith("allow"), "you chose: %s" % d.replace("_", " ")


def guard_answer(pid, decision):
    if decision not in ("allow_once", "allow_always", "deny_once", "deny_always"):
        return {"ok": False, "error": "bad decision"}
    with NET["lock"]:
        p = NET["pending"].get(pid)
        if not p:
            return {"ok": False, "error": "prompt expired"}
        p["decision"] = decision
        allow = decision.startswith("allow")
        NET["temp"][p["key"]] = (allow, time.time() + 600)
    if decision.endswith("always"):
        rule_add(p["app_path"] or "*", p["host"], "allow" if allow else "deny", note="from prompt")
    p["event"].set()
    return {"ok": True}


def pending_view():
    with NET["lock"]:
        return [{k: v for k, v in p.items() if k not in ("event", "key")} | {"remaining": max(0, int(p["created"] + p["timeout"] - time.time()))}
                for p in NET["pending"].values() if not p["event"].is_set()]


# ---------------- the egress proxy (enforcement for StackRadar runs) ----------------

# corporate / system proxy the guard should forward through (captured at start-up)
UPSTREAM_PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")


UPSTREAM_NO_PROXY = [h.strip().lower().lstrip(".") for h in (os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or "").split(",") if h.strip() and "/" not in h]


def _bypass_upstream(host):
    h = host.lower()
    return any(h == n or h.endswith("." + n) for n in UPSTREAM_NO_PROXY)


def _upstream_connect(host, port, connect=True):
    """Open a socket to host:port, tunnelling through UPSTREAM_PROXY when one is set."""
    info = host_info(host)
    if not UPSTREAM_PROXY or info["category"] in ("local", "lan") or _bypass_upstream(host):
        return socket.create_connection((host, port), timeout=20), False
    u = urllib.parse.urlsplit(UPSTREAM_PROXY if "://" in UPSTREAM_PROXY else "http://" + UPSTREAM_PROXY)
    sock = socket.create_connection((u.hostname, u.port or 8080), timeout=20)
    auth = ""
    if u.username:
        cred = base64.b64encode(("%s:%s" % (urllib.parse.unquote(u.username), urllib.parse.unquote(u.password or ""))).encode()).decode()
        auth = "Proxy-Authorization: Basic %s\r\n" % cred
    if connect:
        sock.sendall(("CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n%s\r\n" % (host, port, host, port, auth)).encode())
        resp = b""
        while b"\r\n\r\n" not in resp and len(resp) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                break
            resp += chunk
        if not resp.split(b" ", 2)[1:2] == [b"200"]:
            sock.close()
            raise OSError("upstream proxy refused CONNECT: %s" % resp[:80])
        return sock, False
    return sock, auth or True     # plain HTTP: send absolute-URI request to the upstream proxy


def _run_for_token(tok):
    with RUNS["lock"]:
        for r in RUNS["runs"].values():
            if r.get("proxy_token") == tok:
                return {"name": r.get("project"), "path": r.get("path"), "run": r.get("id")}
    return None


class _GuardHandler(socketserver.StreamRequestHandler):
    timeout = 60

    def _deny(self, host, reason, app):
        body = ("Blocked by StackRadar Network Guard: %s -> %s (%s)\n" % (app.get("name"), host, reason)).encode()
        try:
            self.wfile.write(b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nX-StackRadar: blocked\r\n"
                             b"Content-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
        except Exception:
            pass

    def handle(self):
        try:
            first = self.rfile.readline(65537).decode("latin-1")
            parts = first.split()
            if len(parts) != 3:
                return
            method, target, version = parts
            headers, raw_headers = {}, []
            for _ in range(200):
                line = self.rfile.readline(65537).decode("latin-1")
                if line in ("\r\n", "\n", ""):
                    break
                raw_headers.append(line)
                k, _, v = line.partition(":")
                headers[k.strip().lower()] = v.strip()
            app = None
            auth = headers.get("proxy-authorization", "")
            if auth.lower().startswith("basic "):
                try:
                    user = base64.b64decode(auth[6:]).decode().split(":")[0]
                    app = _run_for_token(user)
                except Exception:
                    pass
            app = app or {"name": "unknown app (proxy)", "path": None}
            if method.upper() == "CONNECT":
                host, _, port = target.rpartition(":")
                host, port, scheme = host.strip("[]"), int(port or 443), "https"
                sensitive = None
            else:
                u = urllib.parse.urlsplit(target)
                host, port, scheme = u.hostname or "", u.port or 80, u.scheme or "http"
                body = b""
                n = int(headers.get("content-length") or 0)
                if 0 < n <= 2_000_000:
                    body = self.rfile.read(n)
                blob = first + "".join(h for h in raw_headers if not h.lower().startswith("proxy-")) + body[:65536].decode("utf-8", "replace")
                sensitive = scan_sensitive(blob) or None
                if sensitive:
                    net_event("sensitive", app=app["name"], host=host, port=port, items=[s["type"] for s in sensitive],
                              detail="unencrypted HTTP request carried: " + ", ".join(s["type"] for s in sensitive))
            allow, reason = guard_decide(app, host, port, scheme, sensitive)
            if not allow:
                net_event("blocked", app=app["name"], host=host, port=port, reason=reason, service=host_info(host)["service"])
                return self._deny(host, reason, app)
            net_event("allowed", app=app["name"], host=host, port=port, reason=reason, service=host_info(host)["service"])
            try:
                up, via_upstream = _upstream_connect(host, port, connect=method.upper() == "CONNECT")
            except Exception as e:
                net_event("error", app=app["name"], host=host, port=port, detail="could not reach destination: %s" % str(e)[:120])
                msg = ("StackRadar allowed this, but %s:%s could not be reached: %s\n" % (host, port, str(e)[:200])).encode()
                self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: "
                                 + str(len(msg)).encode() + b"\r\nConnection: close\r\n\r\n" + msg)
                return
            cid = "x%d" % (int(time.time() * 1e6) % 10**11)
            stat = {"id": cid, "app": app["name"], "app_path": app.get("path"), "host": host, "port": port,
                    "scheme": scheme, "bytes_out": 0, "bytes_in": 0, "started": time.time(), "open": True,
                    "sensitive": [s["type"] for s in (sensitive or [])]}
            with NET["lock"]:
                NET["proxied"][cid] = stat
                if len(NET["proxied"]) > 300:
                    for k in sorted(NET["proxied"], key=lambda k: NET["proxied"][k]["started"])[:50]:
                        if not NET["proxied"][k]["open"]:
                            NET["proxied"].pop(k, None)
            if method.upper() == "CONNECT":
                self.wfile.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                self.wfile.flush()
            else:
                u = urllib.parse.urlsplit(target)
                path = (u.path or "/") + ("?" + u.query if u.query else "")
                hdrs = "".join(h for h in raw_headers if not h.lower().startswith(("proxy-", "connection:", "keep-alive:")))
                if via_upstream:      # upstream proxies want the absolute URI
                    path = target
                    if isinstance(via_upstream, str):
                        hdrs += via_upstream
                req = ("%s %s %s\r\n%sConnection: close\r\n\r\n" % (method, path, version, hdrs)).encode("latin-1") + body
                up.sendall(req)
                stat["bytes_out"] += len(req)
            self._relay(self.connection, up, stat)
        except Exception:
            pass

    @staticmethod
    def _relay(client, up, stat):
        socks = [client, up]
        try:
            while True:
                r, _, x = select.select(socks, [], socks, 120)
                if x or not r:
                    break
                done = False
                for s in r:
                    data = s.recv(65536)
                    if not data:
                        done = True
                        break
                    if s is client:
                        up.sendall(data)
                        stat["bytes_out"] += len(data)
                    else:
                        client.sendall(data)
                        stat["bytes_in"] += len(data)
                if done:
                    break
        except Exception:
            pass
        finally:
            stat["open"] = False
            stat["ended"] = time.time()
            for s in socks:
                try:
                    s.close()
                except Exception:
                    pass


class _GuardServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


def guard_proxy_start():
    with NET["lock"]:
        if NET["proxy_port"]:
            return NET["proxy_port"]
        srv = _GuardServer(("127.0.0.1", 0), _GuardHandler)
        NET["proxy_port"] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return NET["proxy_port"]


def guard_env_for_run(run_id):
    """Env vars that route a managed run's HTTP(S) traffic through the guard proxy."""
    port = guard_proxy_start()
    tok = "run-" + secretsmod.token_hex(6)
    url = "http://%s:x@127.0.0.1:%d" % (tok, port)
    env = {k: url for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
                            "npm_config_proxy", "npm_config_https_proxy")}
    env.update({"NO_PROXY": "localhost,127.0.0.1,::1", "no_proxy": "localhost,127.0.0.1,::1",
                "NODE_USE_ENV_PROXY": "1", "STACKRADAR_GUARD": "1"})
    return tok, env


# ---------------- live connection monitor (every app) ----------------

def _split_addr(a):
    a = a.strip()
    if a.startswith("["):
        h, _, p = a[1:].partition("]:")
        return h, p
    h, _, p = a.rpartition(":")
    return h.split("%")[0], p


def _conns_linux():
    out = []
    if shutil.which("ss"):
        ok, text = run_cmd(["ss", "-H", "-tunpi", "state", "established"], timeout=8)
        if not ok:
            ok, text = run_cmd(["ss", "-H", "-tunp"], timeout=8)
        cur = None
        for line in text.splitlines():
            if line.startswith((" ", "\t")) and cur is not None:
                bs = re.search(r"bytes_sent:(\d+)", line)
                br = re.search(r"bytes_received:(\d+)", line)
                if bs:
                    cur["bytes_out"] = int(bs.group(1))
                if br:
                    cur["bytes_in"] = int(br.group(1))
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            # local + peer are the two address columns right before "users:" (or the line end)
            proto = parts[0]
            uidx = next((i for i, t in enumerate(parts) if t.startswith("users:")), len(parts))
            if uidx < 2:
                continue
            lh, lp = _split_addr(parts[uidx - 2])
            rh, rp = _split_addr(parts[uidx - 1])
            pm = re.search(r'users:\(\("([^"]+)",pid=(\d+)', line)
            cur = {"proto": proto, "local": "%s:%s" % (lh, lp), "remote_ip": rh, "remote_port": int(rp) if rp.isdigit() else None,
                   "pid": int(pm.group(2)) if pm else None, "proc": pm.group(1) if pm else None,
                   "bytes_in": None, "bytes_out": None, "state": "ESTAB"}
            if rh in ("*", "0.0.0.0", "::") or not cur["remote_port"]:
                cur = None
                continue
            out.append(cur)
        if out:
            return out
    return _conns_proc()


def _hex_addr(h):
    ip, port = h.split(":")
    b = bytes.fromhex(ip)
    if len(b) == 4:
        addr = socket.inet_ntop(socket.AF_INET, b[::-1])
    else:
        addr = socket.inet_ntop(socket.AF_INET6, b"".join(b[i:i + 4][::-1] for i in range(0, 16, 4)))
        if addr.startswith("::ffff:"):
            addr = addr[7:]
    return addr, int(port, 16)


def _conns_proc():
    """Linux without ss: read /proc/net/tcp{,6} (state 01 = established) + map socket inodes to pids."""
    socks = {}
    for f, proto in (("/proc/net/tcp", "tcp"), ("/proc/net/tcp6", "tcp")):
        try:
            lines = open(f).read().splitlines()[1:]
        except Exception:
            continue
        for line in lines:
            parts = line.split()
            if len(parts) < 10 or parts[3] != "01":
                continue
            try:
                la, lp = _hex_addr(parts[1])
                ra, rp = _hex_addr(parts[2])
            except Exception:
                continue
            socks[parts[9]] = {"proto": proto, "local": "%s:%d" % (la, lp), "remote_ip": ra, "remote_port": rp,
                               "pid": None, "proc": None, "bytes_in": None, "bytes_out": None, "state": "ESTAB"}
    if not socks:
        return []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            fds = os.listdir("/proc/%s/fd" % pid)
        except Exception:
            continue
        comm = None
        for fd in fds:
            try:
                link = os.readlink("/proc/%s/fd/%s" % (pid, fd))
            except Exception:
                continue
            if link.startswith("socket:[") and link[8:-1] in socks and socks[link[8:-1]]["pid"] is None:
                if comm is None:
                    try:
                        comm = open("/proc/%s/comm" % pid).read().strip()
                    except Exception:
                        comm = "?"
                socks[link[8:-1]].update(pid=int(pid), proc=comm)
    return list(socks.values())


def _conns_mac():
    out = []
    ok, text = run_cmd(["lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED", "-iUDP", "-Fpcn"], timeout=15)
    pid = proc = None
    for line in text.splitlines():
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("c"):
            proc = line[1:]
        elif line.startswith("n") and "->" in line:
            l, _, r = line[1:].partition("->")
            rh, rp = _split_addr(r.split()[0])
            out.append({"proto": "tcp", "local": l, "remote_ip": rh, "remote_port": int(rp) if rp.isdigit() else None,
                        "pid": pid, "proc": proc, "bytes_in": None, "bytes_out": None, "state": "ESTAB"})
    # per-process byte counters from nettop (no per-socket counters on macOS)
    ok, text = run_cmd(["nettop", "-P", "-L", "1", "-x", "-J", "bytes_in,bytes_out"], timeout=8)
    per = {}
    for line in text.splitlines()[1:]:
        cols = line.split(",")
        if len(cols) >= 3:
            m = re.search(r"\.(\d+)$", cols[0])
            if m:
                try:
                    per[int(m.group(1))] = (int(cols[1] or 0), int(cols[2] or 0))
                except ValueError:
                    pass
    for c in out:
        if c["pid"] in per:
            c["proc_bytes_in"], c["proc_bytes_out"] = per[c["pid"]]
    return out


def _conns_windows():
    out = []
    ok, text = run_cmd(["netstat", "-ano"], timeout=10)
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "TCP" and parts[3] == "ESTABLISHED":
            rh, rp = _split_addr(parts[2])
            out.append({"proto": "tcp", "local": parts[1], "remote_ip": rh, "remote_port": int(rp) if rp.isdigit() else None,
                        "pid": int(parts[4]) if parts[4].isdigit() else None, "proc": None,
                        "bytes_in": None, "bytes_out": None, "state": "ESTAB"})
    return out


def _rdns(ip):
    with NET["lock"]:
        if ip in NET["rdns"]:
            return NET["rdns"][ip]
        NET["rdns"][ip] = None

    def work():
        name = None
        try:
            name = socket.gethostbyaddr(ip)[0]
        except Exception:
            pass
        with NET["lock"]:
            NET["rdns"][ip] = name
    threading.Thread(target=work, daemon=True).start()
    return None


def _resolve_ref_hosts(hosts):
    """Forward-resolve hosts referenced in code so live IPs can be traced back to files."""
    def work(h):
        try:
            ips = {ai[4][0] for ai in socket.getaddrinfo(h, None)}
        except Exception:
            ips = set()
        with NET["lock"]:
            NET["fwd"][h] = ips
    for h in hosts:
        if "*" in h:
            continue
        with NET["lock"]:
            if h in NET["fwd"]:
                continue
            NET["fwd"][h] = set()
        threading.Thread(target=work, args=(h,), daemon=True).start()


def _proc_cmdline(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            return f.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
    except Exception:
        return None


def net_connections():
    with NET["lock"]:
        c = NET["conn_cache"]
        if c["data"] is not None and time.time() - c["t"] < 1.5:
            return c["data"]
    try:
        conns = _conns_linux() if OS_NAME == "Linux" else (_conns_mac() if OS_NAME == "Darwin" else _conns_windows())
    except Exception:
        conns = []
    with STATE["lock"]:
        projects = list((STATE["data"] or {}).get("projects", []))
    projs = [((p.get("path") or "").rstrip(os.sep), p) for p in projects]
    cwds = _live_pid_cwds([x["pid"] for x in conns])
    with RUNS["lock"]:
        managed = {r.get("pid"): r for r in RUNS["runs"].values() if r.get("status") == "running"}
    all_refs = [(p, r) for _, p in projs for r in (p.get("net_refs") or [])]
    _resolve_ref_hosts({r["host"] for _, r in all_refs})
    now = time.time()
    with NET["lock"]:
        prev, dt = NET["sock_prev"], max(0.5, now - (NET["sock_t"] or now - 2))
        fwd = dict(NET["fwd"])
    new_prev = {}
    for c in conns:
        ip = c["remote_ip"]
        info = host_info(ip)
        c["host"] = _rdns(ip) if info["category"] not in ("local",) else "localhost"
        hi = host_info(c["host"]) if c["host"] else info
        if hi["service"]:
            info = hi
        # app / project
        cwd = cwds.get(c["pid"])
        proj = None
        if c["pid"] in managed:
            proj = _project_by_path(managed[c["pid"]].get("path"))
        if not proj and cwd:
            for rp, p in projs:
                if cwd == rp or cwd.startswith(rp + os.sep):
                    proj = p
                    break
        c["project"] = proj["name"] if proj else None
        c["project_path"] = proj["path"] if proj else None
        c["managed"] = c["pid"] in managed
        cmd = _proc_cmdline(c["pid"]) if (c["pid"] and OS_NAME == "Linux") else None
        c["cmd"] = sanitize_cmd(cmd[:160]) if cmd else None
        c["entry"] = None
        if cmd:   # the script being run is the first "file-looking" argument
            for tok in cmd.split()[1:6]:
                if re.search(r"\.(js|mjs|cjs|ts|py|rb|go|php|jar|sh)$", tok):
                    c["entry"] = os.path.relpath(tok, proj["path"]) if proj and os.path.isabs(tok) else tok
                    break
        # which source line points at this host?
        c["ref"] = None
        cand = [r for p, r in all_refs if p is proj] if proj else []
        for r in cand:
            if (c["host"] and (_host_match(r["host"], c["host"]) or _host_match(c["host"], r["host"]))) or ip in fwd.get(r["host"], ()):
                c["ref"] = {k: r[k] for k in ("file", "line", "snippet", "carries_secret", "risk", "notes", "via")}
                break
        c["service"], c["category"] = info["service"], info["category"]
        key = (c["pid"], c["local"], ip, c["remote_port"])
        if c.get("bytes_in") is not None:
            pb = prev.get(key)
            c["rate_in"] = max(0, (c["bytes_in"] - pb[0]) / dt) if pb else 0
            c["rate_out"] = max(0, (c["bytes_out"] - pb[1]) / dt) if pb else 0
            new_prev[key] = (c["bytes_in"], c["bytes_out"])
        r = rule_lookup(c["project_path"] or "*", c["host"] or ip, c["remote_port"])
        c["rule"] = r["action"] if r else None
        if r and r["action"] == "deny":
            net_event("violation", app=c["project"] or c["proc"], host=c["host"] or ip, port=c["remote_port"],
                      detail="connected despite a deny rule (not started by StackRadar, so it can't be blocked by the proxy)")
        if c.get("rate_out", 0) > 2_000_000 and info["category"] in ("unknown",):
            net_event("exfil", app=c["project"] or c["proc"], host=c["host"] or ip, port=c["remote_port"],
                      detail="sending %s/s to an unrecognised host" % fmt_bytes(c["rate_out"]))
    with NET["lock"]:
        NET["sock_prev"], NET["sock_t"] = new_prev, now
        NET["conn_cache"] = {"t": now, "data": conns}
        # rolling per-app totals for sparklines
        agg = {}
        for c in conns:
            k = c["project"] or c["proc"] or "?"
            a = agg.setdefault(k, [0, 0])
            a[0] += c.get("rate_in") or 0
            a[1] += c.get("rate_out") or 0
        for st in NET["proxied"].values():
            if st["open"]:
                a = agg.setdefault(st["app"], [0, 0])
        for k, v in agg.items():
            h = NET["app_hist"].setdefault(k, deque(maxlen=60))
            h.append((now, v[0], v[1]))
    return conns


def os_block_command(ips, op="block"):
    """OS firewall command for blocking outbound traffic to the given IPs (needs admin)."""
    ips = [str(ipaddress.ip_address(i)) for i in ips][:16]
    if not ips:
        raise ValueError("no IP addresses")
    tag = "StackRadar-" + "-".join(ip.replace(":", "_") for ip in ips[:2])
    if OS_NAME == "Windows":
        if op == "block":
            inner = "New-NetFirewallRule -DisplayName '%s' -Direction Outbound -Action Block -RemoteAddress %s" % (tag, ",".join(ips))
        else:
            inner = "Remove-NetFirewallRule -DisplayName '%s'" % tag
        return ["powershell", "-NoProfile", "-Command",
                "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',\"%s\"" % inner.replace("'", "''")], inner
    if OS_NAME == "Darwin":
        rules = "\\n".join("block drop out quick to %s" % i for i in ips)
        inner = ("echo '%s' | pfctl -a com.stackradar -f - && pfctl -E" % rules) if op == "block" else "pfctl -a com.stackradar -F rules"
        return ["osascript", "-e", 'do shell script "%s" with administrator privileges' % inner.replace('"', '\\"')], inner
    fam = lambda i: "ip6" if ":" in i else "ip"
    if op == "block":
        inner = ("nft add table inet stackradar; nft 'add chain inet stackradar out { type filter hook output priority 0 ; }'; "
                 + "; ".join("nft add rule inet stackradar out %s daddr %s drop" % (fam(i), i) for i in ips))
    else:
        inner = "nft delete table inet stackradar"
    runner = ["pkexec"] if shutil.which("pkexec") else ["sudo", "-n"]
    return runner + ["sh", "-c", inner], inner


def network_view():
    conns = net_connections()
    with NET["lock"]:
        proxied = [dict(v) for v in NET["proxied"].values()]
        events = list(NET["events"])[:150]
        alerts = list(NET["alerts"])[:50]
        hist = {k: list(v) for k, v in NET["app_hist"].items()}
    apps = {}
    me = os.getpid()
    for c in conns:
        if c["category"] == "local" or c["pid"] == me:
            continue          # loopback-only traffic isn't "talking to the internet"
        k = c["project"] or c["proc"] or "pid %s" % c["pid"]
        a = apps.setdefault(k, {"name": k, "project": c["project"], "managed": c["managed"], "pids": set(),
                                "conns": 0, "rate_in": 0, "rate_out": 0, "hosts": set(), "flags": set(), "entry": c.get("entry")})
        a["pids"].add(c["pid"])
        a["conns"] += 1
        a["rate_in"] += c.get("rate_in") or 0
        a["rate_out"] += c.get("rate_out") or 0
        a["hosts"].add(c["host"] or c["remote_ip"])
        if c["category"] == "telemetry":
            a["flags"].add("tracking")
        if c.get("ref") and c["ref"].get("carries_secret"):
            a["flags"].add("sends credentials")
        if c["rule"] == "deny":
            a["flags"].add("deny rule")
    for st in proxied:
        if not st["open"]:
            continue
        a = apps.setdefault(st["app"], {"name": st["app"], "project": st["app"], "managed": True, "pids": set(), "conns": 0,
                                        "rate_in": 0, "rate_out": 0, "hosts": set(), "flags": set(), "entry": None})
        a["hosts"].add(st["host"])
        a["guarded"] = True
    for a in apps.values():
        a["pids"] = sorted(p for p in a["pids"] if p)
        a["hosts"] = sorted(a["hosts"])[:20]
        a["flags"] = sorted(a["flags"])
        a["history"] = hist.get(a["name"], [])[-40:]
    # static refs summary across projects
    with STATE["lock"]:
        projects = list((STATE["data"] or {}).get("projects", []))
    static = []
    for p in projects:
        for r in (p.get("net_refs") or []):
            static.append({**r, "project": p["name"], "project_path": p["path"]})
    static.sort(key=lambda r: ({"high": 0, "medium": 1, "low": 2}[r["risk"]], r["project"]))
    s = settings_get()
    return {"level": net_level(), "guard_runs": s.get("guard_runs", True), "proxy_port": NET["proxy_port"],
            "os": OS_NAME, "connections": conns, "apps": sorted(apps.values(), key=lambda a: -(a["rate_in"] + a["rate_out"] + a["conns"])),
            "proxied": sorted(proxied, key=lambda x: -x["started"])[:80], "events": events, "alerts": alerts,
            "pending": pending_view(), "rules": net_rules(), "static_refs": static[:400],
            "trusted": TRUSTED_HOSTS, "now": time.time()}


# ---------------------------------------------------------------------------
# archive = compress: archived projects become one .tar.gz / .zip in
# ~/.stackradar/archives (regenerable folders left out), verified, and the
# original can go to the Trash. Restore unpacks it back.
# ---------------------------------------------------------------------------

import tarfile
import zipfile

ARCHIVE_DIR = os.path.join(os.path.expanduser("~/.stackradar"), "archives")
ARCHIVE_SKIP = {"node_modules", ".venv", "venv", "env", "__pycache__", ".next", ".nuxt", ".turbo", ".cache",
                ".pytest_cache", ".mypy_cache", ".ruff_cache", "target", ".parcel-cache", ".gradle"}


def _thread_job(title, fn, kind="archive"):
    jid = "job-%d" % (int(time.time() * 1000) % 10**10)
    job = {"id": jid, "title": title, "argv": [], "cmd": title, "cwd": None, "kind": kind, "status": "running",
           "started": time.time(), "finished": None, "exit_code": None, "logs": "", "progress": 0, "result": None}
    with JOBS["lock"]:
        JOBS["jobs"][jid] = job

    def log(msg):
        with JOBS["lock"]:
            job["logs"] = (job["logs"] + msg + "\n")[-200_000:]

    def runner():
        try:
            job["result"] = fn(log, job)
            job["exit_code"], job["status"] = 0, "done"
        except Exception as e:
            log("[stackradar] failed: %s" % e)
            job["exit_code"], job["status"] = 1, "failed"
        job["finished"] = time.time()
    threading.Thread(target=runner, daemon=True).start()
    return {"ok": True, "id": jid, "cmd": title}


def archive_project(path, trash_original=True, exclude_regen=True):
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        return {"ok": False, "error": "folder not found"}
    name = os.path.basename(path.rstrip(os.sep))
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    use_zip = OS_NAME == "Windows"
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    out = _unique_name(os.path.join(ARCHIVE_DIR, "%s-%s.%s" % (name, stamp, "zip" if use_zip else "tar.gz")))

    def work(log, job):
        files, skipped, orig = [], 0, 0
        for dp, dns, fns in os.walk(path):
            if exclude_regen:
                keep = [d for d in dns if d not in ARCHIVE_SKIP]
                skipped += len(dns) - len(keep)
                dns[:] = keep
            for fn in fns:
                fp = os.path.join(dp, fn)
                if os.path.islink(fp):
                    continue
                try:
                    orig += os.path.getsize(fp)
                except Exception:
                    continue
                files.append(fp)
        total = fast_dir_size(path)[0]
        log("compressing %d files (%s of %s; %d regenerable folders left out)" % (len(files), fmt_bytes(orig), fmt_bytes(total), skipped))
        if use_zip:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for i, fp in enumerate(files):
                    z.write(fp, os.path.join(name, os.path.relpath(fp, path)))
                    job["progress"] = int(100 * (i + 1) / max(1, len(files)))
            with zipfile.ZipFile(out) as z:
                count = len(z.namelist())
                bad = z.testzip()
            if bad:
                raise RuntimeError("archive verification failed at %s" % bad)
        else:
            with tarfile.open(out, "w:gz", compresslevel=6) as t:
                for i, fp in enumerate(files):
                    t.add(fp, arcname=os.path.join(name, os.path.relpath(fp, path)), recursive=False)
                    job["progress"] = int(100 * (i + 1) / max(1, len(files)))
            with tarfile.open(out, "r:gz") as t:
                count = sum(1 for m in t if m.isfile())
        if count != len(files):
            raise RuntimeError("verification failed: %d of %d files in archive" % (count, len(files)))
        size = os.path.getsize(out)
        log("✓ verified %d files → %s (%s, %.0f%% smaller than the whole folder)" % (
            count, out, fmt_bytes(size), 100 * (1 - size / max(1, total))))
        info = {"file": out, "size": size, "original_size": total, "files": count, "created": time.time(),
                "excluded_regenerable": exclude_regen, "original_path": path}
        meta_set(path, {"status": "archived", "archive": info})
        if trash_original:
            r = do_delete(path, force=False)
            log(("original folder: %s" % r.get("method")) if r.get("ok") else "original kept: %s" % r.get("error"))
            info["original_removed"] = bool(r.get("ok"))
            if r.get("ok"):
                _forget_project(path)
            meta_set(path, {"archive": info})
        return info
    return _thread_job("archive %s" % name, work)


def archives_list():
    out = []
    metas = meta_all()
    by_file = {(m.get("archive") or {}).get("file"): (p, m) for p, m in metas.items() if isinstance(m, dict) and m.get("archive")}
    for fp in sorted(globmod.glob(os.path.join(ARCHIVE_DIR, "*.tar.gz")) + globmod.glob(os.path.join(ARCHIVE_DIR, "*.zip"))):
        p, m = by_file.get(fp, (None, {}))
        a = (m or {}).get("archive") or {}
        out.append({"file": fp, "name": os.path.basename(fp), "size": os.path.getsize(fp), "created": os.path.getmtime(fp),
                    "original_path": a.get("original_path") or p, "original_size": a.get("original_size"),
                    "files": a.get("files"), "original_exists": bool(p and os.path.exists(p))})
    out.sort(key=lambda a: -a["created"])
    return out


def restore_archive(fp, target_dir=None):
    fp = os.path.abspath(fp)
    if not (fp.startswith(os.path.abspath(ARCHIVE_DIR) + os.sep) and os.path.isfile(fp)):
        return {"ok": False, "error": "not a StackRadar archive"}
    a = next((x for x in archives_list() if x["file"] == fp), {})
    target_dir = os.path.abspath(os.path.expanduser(target_dir or os.path.dirname(a.get("original_path") or os.path.expanduser("~"))))
    home = os.path.expanduser("~")
    if not (target_dir == home or target_dir.startswith(home + os.sep)):
        return {"ok": False, "error": "restore target must be inside your home folder"}

    def safe(name):
        dest = os.path.abspath(os.path.join(target_dir, name))
        if not dest.startswith(target_dir + os.sep):
            raise RuntimeError("unsafe path in archive: %s" % name)
        return dest

    def work(log, job):
        os.makedirs(target_dir, exist_ok=True)
        if fp.endswith(".zip"):
            with zipfile.ZipFile(fp) as z:
                names = z.namelist()
                top = names[0].split("/")[0] if names else ""
                if os.path.exists(os.path.join(target_dir, top)):
                    raise RuntimeError("%s already exists in %s" % (top, target_dir))
                for i, n in enumerate(names):
                    safe(n)
                    z.extract(n, target_dir)
                    job["progress"] = int(100 * (i + 1) / max(1, len(names)))
        else:
            with tarfile.open(fp, "r:gz") as t:
                members = [m for m in t.getmembers() if m.isfile() or m.isdir()]
                top = members[0].name.split("/")[0] if members else ""
                if os.path.exists(os.path.join(target_dir, top)):
                    raise RuntimeError("%s already exists in %s" % (top, target_dir))
                for i, m in enumerate(members):
                    safe(m.name)
                    t.extract(m, target_dir)
                    job["progress"] = int(100 * (i + 1) / max(1, len(members)))
        dest = os.path.join(target_dir, top)
        meta_set(dest, {"status": "active"})
        log("✓ restored to %s (regenerable folders like node_modules need a fresh install)" % dest)
        return {"restored_to": dest}
    return _thread_job("restore %s" % os.path.basename(fp), work)


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "StackRadar/" + VERSION
    allow_any_host = False   # set by --host 0.0.0.0 (LAN mode)

    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):
        """Block DNS-rebinding: only answer requests addressed to localhost."""
        if Handler.allow_any_host:
            return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("localhost", "127.0.0.1", "::1", "")

    def _token_ok(self):
        return secretsmod.compare_digest(self.headers.get("X-StackRadar-Token") or "", API_TOKEN)

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, default=str)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("application") or ctype.startswith("text") else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host header"})
        u = urllib.parse.urlparse(self.path)
        p = u.path
        q = urllib.parse.parse_qs(u.query)
        if p.startswith("/api/") and p not in ("/api/health",) and not self._token_ok():
            return self._send(403, {"error": "missing or bad X-StackRadar-Token — reload the page"})
        if p in ("/", "/index.html"):
            try:
                with open(os.path.join(APP_DIR, "index.html"), encoding="utf-8") as f:
                    html = f.read()
            except Exception:
                return self._send(404, {"error": "missing index.html"})
            html = html.replace("__STACKRADAR_TOKEN__", API_TOKEN).replace("__STACKRADAR_VERSION__", VERSION)
            return self._send(200, html, "text/html")
        elif p == "/api/health":
            return self._send(200, {"ok": True, "version": VERSION, "scan": SCAN.get("phase")})
        elif p == "/api/network":
            return self._send(200, network_view())
        elif p == "/api/network/pending":
            return self._send(200, {"pending": pending_view(), "level": net_level()})
        elif p == "/api/archives":
            return self._send(200, {"archives": archives_list(), "dir": ARCHIVE_DIR})
        elif p == "/api/system":
            return self._send(200, system_view())
        elif p == "/api/schedules":
            return self._send(200, schedules_view())
        elif p == "/api/settings":
            return self._send(200, settings_get())
        elif p == "/api/jobs":
            jid = (q.get("id") or [""])[0]
            if jid:
                j = jobs_view(jid)
                return self._send(200 if j else 404, j or {"error": "no such job"})
            return self._send(200, {"jobs": jobs_view()})
        elif p == "/api/updates/global":
            return self._send(200, global_outdated(force=(q.get("refresh") or ["0"])[0] == "1"))
        elif p == "/api/cron/preview":
            expr = (q.get("expr") or [""])[0]
            return self._send(200, {"expr": expr, "human": cron_describe(expr), "valid": cron_parse(expr) is not None,
                                    "next": cron_next(expr, count=5)})
        elif p.startswith("/static/"):
            rel = urllib.parse.unquote(p[len("/static/"):])
            static_dir = os.path.join(APP_DIR, "static")
            fp = os.path.normpath(os.path.join(static_dir, rel))
            if not (fp == static_dir or fp.startswith(static_dir + os.sep)):
                return self._send(403, {"error": "forbidden"})
        elif p == "/api/state":
            with STATE["lock"]:
                data = STATE["data"]
            if not data:
                return self._send(200, {"empty": True, "scan": SCAN, "message": "no scan yet — press Scan"})
            for pr in data.get("projects", []):
                pr["meta"] = meta_get(pr.get("path", ""))
            data = dict(data)
            data["runs"] = runs_view()
            data["port_panel"] = port_panel_data()
            return self._send(200, {"scan": SCAN, **data})
        elif p == "/api/scan/progress":
            return self._send(200, SCAN)
        elif p == "/api/runs":
            rid = (q.get("id") or [""])[0]
            with RUNS["lock"]:
                r = RUNS["runs"].get(rid)
            if rid and r:
                v = {k: val for k, val in r.items() if k not in ("proc", "proxy_token")}
                v["logs"] = (r.get("logs") or "")[-20000:]
                return self._send(200, v)
            return self._send(200, {"runs": runs_view(), "port_panel": port_panel_data()})
        elif p == "/api/actions/delete/preview" or p == "/api/reclaim":
            with STATE["lock"]:
                data = STATE["data"]
            projects = (data or {}).get("projects", [])
            return self._send(200, {"items": reclaim_items(projects),
                                    "global_caches": (data or {}).get("env", {}).get("global_caches", [])})
        else:
            return self._send(404, {"error": "not found"})
        try:
            with open(fp, "rb") as f:
                body = f.read()
        except Exception:
            return self._send(404, {"error": "missing file " + p})
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                 ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}.get(
            os.path.splitext(fp)[1], "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host header"})
        if not self._token_ok():
            return self._send(403, {"error": "missing or bad X-StackRadar-Token — reload the page"})
        u = urllib.parse.urlparse(self.path)
        p = u.path
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad JSON"})

        if p == "/api/scan":
            roots = body.get("roots") or []
            roots = [os.path.expanduser(r) for r in roots if isinstance(r, str) and r.strip()]
            max_depth = int(body.get("max_depth") or 6)
            if not roots:
                return self._send(400, {"error": "no roots"})
            if SCAN["running"]:
                return self._send(409, {"error": "scan already running"})
            t = threading.Thread(target=do_scan, args=(roots, max_depth), daemon=True)
            t.start()
            return self._send(200, {"ok": True, "roots": roots})

        if p == "/api/meta":
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not (path == home or path.startswith(home + os.sep)):
                return self._send(403, {"error": "outside home"})
            cur = meta_set(path, body)
            return self._send(200, {"ok": True, "path": path, "meta": cur})

        if p == "/api/run":
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not (path == home or path.startswith(home + os.sep)):
                return self._send(403, {"error": "outside home"})
            try:
                port = int(body.get("port") or 0)
            except Exception:
                port = 0
            if port and not (1 < port < 65535):
                return self._send(400, {"error": "port out of range"})
            return self._send(200, run_start(path, port))

        if p == "/api/runs/stop":
            return self._send(200, run_stop(body.get("id") or ""))

        if p == "/api/runs/stop_all":
            return self._send(200, run_stop_all())

        if p == "/api/kill":
            try:
                pid = int(body.get("pid") or 0)
            except Exception:
                pid = 0
            if not pid:
                return self._send(400, {"error": "no pid"})
            if not body.get("confirm"):
                return self._send(400, {"error": "confirmation required"})
            return self._send(200, kill_pid(pid))

        if p == "/api/deps/check":
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not (path == home or path.startswith(home + os.sep)):
                return self._send(403, {"error": "outside home"})
            try:
                res = deps_check(path, force=bool(body.get("force")))
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            return self._send(200, {"ok": True, **res})

        if p == "/api/actions":
            action = body.get("action")
            path = body.get("path") or ""
            if not path or not os.path.isabs(path):
                path = os.path.join(os.path.expanduser("~"), path)
            # safety: only operate under home or under a scanned root
            home = os.path.expanduser("~")
            allowed = path == home or path.startswith(home + os.sep)
            if not allowed:
                return self._send(403, {"error": "refusing to operate outside your home folder"})
            if action == "delete":
                name = os.path.basename(path.rstrip("/"))
                if body.get("confirm") != name and not body.get("force"):
                    return self._send(400, {"error": "confirmation required: pass confirm=<project name>"})
                res = do_delete(path, force=bool(body.get("force")))
                if res.get("ok"):
                    _forget_project(os.path.abspath(path))
                return self._send(200, res)
            if action == "move":
                return self._send(200, do_move(path, body.get("target_dir") or "", body.get("new_name")))
            if action == "rename":
                return self._send(200, do_rename(path, body.get("new_name") or ""))
            return self._send(400, {"error": "unknown action"})

        if p == "/api/delete/cache":
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not path.startswith(home + os.sep):
                return self._send(403, {"error": "outside home"})
            name = os.path.basename(path.rstrip("/"))
            if name not in ("node_modules", ".next", ".nuxt", "dist", "build", "out", "target",
                            "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".cache") and \
               body.get("confirm") != "yes":
                return self._send(400, {"error": "confirmation required"})
            return self._send(200, do_delete(path, force=True))

        if p == "/api/settings":
            return self._send(200, settings_set(body))

        if p == "/api/update":
            scope, manager = body.get("scope"), body.get("manager")
            path = None
            if scope == "project":
                path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
                home = os.path.expanduser("~")
                if not path.startswith(home + os.sep):
                    return self._send(403, {"error": "outside home"})
            if not body.get("confirm"):
                return self._send(400, {"error": "confirmation required"})
            try:
                argv, cwd = build_update_command(scope, manager, body.get("packages") or [], path)
            except ValueError as e:
                return self._send(400, {"ok": False, "error": str(e)})

            def _after(rc, path=path, scope=scope):
                if scope == "project" and path:
                    with DEPS["lock"]:
                        DEPS["cache"].pop(path, None)
                else:
                    with GLOBAL_OUTDATED["lock"]:
                        GLOBAL_OUTDATED["data"] = None
            title = "update %s %s" % (manager, ", ".join(body.get("packages") or ["(all)"]))
            return self._send(200, job_start(title, argv, cwd, after=_after))

        if p == "/api/network/decide":
            return self._send(200, guard_answer(body.get("id") or "", body.get("decision") or ""))

        if p == "/api/network/rules":
            try:
                if body.get("op") == "delete":
                    rule_delete(body.get("id") or "")
                    return self._send(200, {"ok": True, "rules": net_rules()})
                r = rule_add(body.get("app") or "*", body.get("host") or "", body.get("action") or "", body.get("port"))
                return self._send(200, {"ok": True, "rule": r, "rules": net_rules()})
            except ValueError as e:
                return self._send(400, {"ok": False, "error": str(e)})

        if p == "/api/network/level":
            cur = settings_set({k: body[k] for k in ("net_level", "guard_runs") if k in body})
            return self._send(200, {"ok": True, "level": cur.get("net_level"), "guard_runs": cur.get("guard_runs")})

        if p == "/api/network/osblock":
            ips = [i for i in (body.get("ips") or []) if isinstance(i, str)]
            host = (body.get("host") or "").strip()
            if host and not ips:
                try:
                    ips = sorted({ai[4][0] for ai in socket.getaddrinfo(host, None)})[:16]
                except Exception:
                    return self._send(400, {"ok": False, "error": "could not resolve %s" % host})
            try:
                argv, shown = os_block_command(ips, "unblock" if body.get("op") == "unblock" else "block")
            except ValueError as e:
                return self._send(400, {"ok": False, "error": str(e)})
            if not body.get("execute"):
                return self._send(200, {"ok": True, "command": shown, "ips": ips, "needs_admin": True})
            if not body.get("confirm"):
                return self._send(400, {"ok": False, "error": "confirmation required"})
            title = "%s %s at the OS firewall" % ("unblock" if body.get("op") == "unblock" else "block", host or ", ".join(ips))
            if host and body.get("op") != "unblock":
                rule_add("*", host, "deny", note="OS firewall block")
            return self._send(200, job_start(title, argv, None, kind="firewall"))

        if p == "/api/archive":
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not path.startswith(home + os.sep):
                return self._send(403, {"error": "outside home"})
            if not body.get("confirm"):
                return self._send(400, {"error": "confirmation required"})
            return self._send(200, archive_project(path, trash_original=bool(body.get("trash_original", True)),
                                                   exclude_regen=bool(body.get("exclude_regen", True))))

        if p == "/api/archive/restore":
            return self._send(200, restore_archive(body.get("file") or "", body.get("target_dir")))

        if p == "/api/app/update-check":
            return self._send(200, app_update_check(settings_get().get("update_repo") or "SYasJ/StackRadar"))

        if p == "/api/open":
            # reveal a folder in Finder / Explorer / file manager (inside home only)
            path = os.path.abspath(os.path.expanduser(body.get("path") or ""))
            home = os.path.expanduser("~")
            if not (path == home or path.startswith(home + os.sep)) or not os.path.exists(path):
                return self._send(403, {"error": "outside home or missing"})
            opener = {"Darwin": ["open", "-R" if os.path.isfile(path) else "", path],
                      "Windows": ["explorer", path]}.get(OS_NAME, ["xdg-open", path if os.path.isdir(path) else os.path.dirname(path)])
            opener = [a for a in opener if a]
            try:
                subprocess.Popen(opener, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            return self._send(200, {"ok": True})

        if p == "/api/presets":
            home = os.path.expanduser("~")
            cands = [home] + [os.path.join(home, x) for x in
                              ("Desktop", "Documents", "Downloads", "Projects", "Code", "code",
                               "src", "dev", "work", "repos", "GitHub", "apps")]
            out = [d for d in cands if os.path.isdir(d)]
            return self._send(200, {"dirs": sorted(set(out))})

        return self._send(404, {"error": "not found"})


def migrate_legacy_config():
    """StackRadar was called DevRadar until 2.1: carry ~/.devradar over once."""
    old, new = os.path.expanduser("~/.devradar"), os.path.expanduser("~/.stackradar")
    if os.path.isdir(old) and not os.path.exists(new):
        try:
            shutil.copytree(old, new)
            print("migrated settings from ~/.devradar to ~/.stackradar")
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser(description="StackRadar — local project radar")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address. Default 127.0.0.1 (this machine only). 0.0.0.0 exposes the API to your LAN")
    ap.add_argument("--root", action="append", default=None,
                    help="folder to scan (repeatable). Default: your home folder")
    ap.add_argument("--depth", type=int, default=6)
    ap.add_argument("--open", action="store_true", help="open the dashboard in a browser")
    ap.add_argument("--no-scan", action="store_true", help="don't scan on start (press Scan in the UI)")
    ap.add_argument("--version", action="version", version="StackRadar " + VERSION)
    args = ap.parse_args()
    migrate_legacy_config()

    roots = args.root or [os.path.expanduser("~")]
    roots = [os.path.abspath(os.path.expanduser(r)) for r in roots]

    Handler.allow_any_host = args.host not in ("127.0.0.1", "localhost", "::1")
    if Handler.allow_any_host:
        print("WARNING: listening on %s — anyone on your network can open StackRadar. "
              "Delete/kill/update actions still need the per-launch token." % args.host)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    port = httpd.server_address[1]   # --port 0 picks a free port (desktop app)
    print("StackRadar %s running →  http://localhost:%d" % (VERSION, port), flush=True)
    print("STACKRADAR_READY port=%d" % port, flush=True)
    sysmon_start()
    guard_proxy_start()
    if not args.no_scan:
        print("Scanning: " + ", ".join(roots), flush=True)
        threading.Thread(target=do_scan, args=(roots, args.depth), daemon=True).start()
    if args.open:
        threading.Timer(1.2, lambda: webbrowser.open("http://localhost:%d" % port)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
