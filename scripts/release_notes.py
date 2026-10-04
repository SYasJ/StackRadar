#!/usr/bin/env python3
"""Write the GitHub Release notes for a version.

Combines the version's CHANGELOG.md section, a download table and the unsigned-install guide
(docs/wiki/Installing-Unsigned-Builds.md) into one Markdown file. electron-builder puts it on the
release (desktop/package.json → build.releaseInfo.releaseNotesFile) and the installed app shows it
when an update arrives.

    python3 scripts/release_notes.py                 # version from VERSION → desktop/build/release-notes.md
    python3 scripts/release_notes.py 2.1.0 -o notes.md
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "SYasJ/StackRadar"
WIKI = f"https://github.com/{REPO}/wiki/"


def changelog_section(version):
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.S | re.M)
    if not m:
        sys.exit(f"CHANGELOG.md has no section for {version}")
    return m.group(1).strip()


def install_guide():
    text = (ROOT / "docs" / "wiki" / "Installing-Unsigned-Builds.md").read_text(encoding="utf-8")
    text = re.sub(r"^# .*\n+", "", text, count=1)
    # wiki-relative links → absolute wiki URLs (anchors kept)
    text = re.sub(r"\]\(([A-Za-z0-9-]+)\.md(#[^)]*)?\)", lambda m: f"]({WIKI}{m.group(1)}{m.group(2) or ''})", text)
    return text.strip()


def build(version):
    v = version
    dl = f"https://github.com/{REPO}/releases/download/v{v}/"
    rows = [
        ("macOS, Apple silicon (M1–M4)", f"StackRadar-{v}-mac-arm64.dmg"),
        ("macOS, Intel", f"StackRadar-{v}-mac-x64.dmg"),
        ("Windows 10 / 11, installer (auto-updates)", f"StackRadar-{v}-win-x64.exe"),
        ("Windows 10 / 11, portable", f"StackRadar-{v}-portable.exe"),
        ("Linux, AppImage", f"StackRadar-{v}-linux-x86_64.AppImage"),
        ("Linux, Debian / Ubuntu", f"StackRadar-{v}-linux-amd64.deb"),
    ]
    table = "\n".join(f"| {os_} | [`{f}`]({dl}{f}) |" for os_, f in rows)
    return f"""# StackRadar {v}

Your whole dev stack on one local screen: repos, ports, secrets, network traffic, AI agents, skills and schedules.
100% local. Free for personal use ([PolyForm Noncommercial](https://github.com/{REPO}/blob/main/LICENSE)); commercial use needs a [license](https://github.com/{REPO}/blob/main/COMMERCIAL.md).

## Download

| For | File |
|---|---|
{table}

No Python needed, the engine is bundled. Prefer source? `git clone https://github.com/{REPO}.git && python3 stackradar.py`

> **First launch:** these builds aren't signed with an Apple Developer ID or a Windows certificate yet, so macOS and
> Windows ask you to confirm once. **macOS:** open the app, then *System Settings → Privacy & Security → Open Anyway*.
> **Windows:** *More info → Run anyway*. Full steps below.

## What's new in {v}

{changelog_section(v)}

## Installing

{install_guide()}

---
[Roadmap](https://github.com/{REPO}/blob/main/ROADMAP.md) · [Wiki]({WIKI}) · [Changelog](https://github.com/{REPO}/blob/main/CHANGELOG.md) · [Report a bug](https://github.com/{REPO}/issues)
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("version", nargs="?", default=(ROOT / "VERSION").read_text().strip())
    ap.add_argument("-o", "--out", default=str(ROOT / "desktop" / "build" / "release-notes.md"))
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(a.version.lstrip("v")), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
