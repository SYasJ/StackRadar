#!/usr/bin/env python3
"""Single source of truth for StackRadar's version.

    python3 scripts/bump_version.py 2.1.0        # set an explicit version
    python3 scripts/bump_version.py patch|minor|major

Updates VERSION, desktop/package.json, every "current version" mention in the docs (README, landing page,
wiki home, roadmap) and turns CHANGELOG's [Unreleased] section into the new version. Pushing the change to
main starts the GitHub workflow that builds the .dmg / .exe / .AppImage and publishes them; the desktop
app's auto-updater picks the new release up from there.
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cur = open(os.path.join(ROOT, "VERSION")).read().strip()
    ma, mi, pa = (int(x) for x in cur.split("."))
    arg = sys.argv[1]
    new = {"major": "%d.0.0" % (ma + 1), "minor": "%d.%d.0" % (ma, mi + 1),
           "patch": "%d.%d.%d" % (ma, mi, pa + 1)}.get(arg, arg)
    if not re.match(r"^\d+\.\d+\.\d+$", new):
        sys.exit("not a semantic version: %s" % new)
    with open(os.path.join(ROOT, "VERSION"), "w") as f:
        f.write(new + "\n")
    pj = os.path.join(ROOT, "desktop", "package.json")
    with open(pj) as f:
        pkg = json.load(f)
    pkg["version"] = new
    with open(pj, "w") as f:
        f.write(json.dumps(pkg, indent=2) + "\n")
    for rel, pats in (("README.md", [r"(current version: \*\*)[\d.]+(\*\*)"]),
                      ("docs/index.html", [r'("softwareVersion": ")[\d.]+(")', r"(Current version <b>)[\d.]+(</b>)"]),
                      ("docs/wiki/Home.md", [r"(\*\*Current version: )[\d.]+(\*\*)"]),
                      ("ROADMAP.md", [r"(\*\*Current version: )[\d.]+(\*\*)"]),
                      ("docs/wiki/Roadmap.md", [r"(\*\*Current version: )[\d.]+(\*\*)"])):
        fp = os.path.join(ROOT, rel)
        if not os.path.isfile(fp):
            continue
        with open(fp, encoding="utf-8") as f:
            text = f.read()
        for pat in pats:
            text = re.sub(pat, lambda m: m.group(1) + new + m.group(2), text)
        with open(fp, "w", encoding="utf-8") as f:
            f.write(text)
    cl = os.path.join(ROOT, "CHANGELOG.md")
    with open(cl) as f:
        text = f.read()
    stub = "## [%s] — %s\n\n- …\n" % (new, datetime.date.today().isoformat())
    if "## [Unreleased]" in text:   # notes collected so far become this version
        text = text.replace("## [Unreleased]", "## [%s] — %s" % (new, datetime.date.today().isoformat()), 1)
    elif "<!-- next -->" in text:
        text = text.replace("<!-- next -->\n", "<!-- next -->\n\n" + stub, 1)
    else:
        text = stub + text
    with open(cl, "w") as f:
        f.write(text)
    print("StackRadar %s -> %s" % (cur, new))
    print("next:  edit CHANGELOG.md, then git commit -am 'StackRadar %s' && git push   (a VERSION change on main starts the release)" % new)


if __name__ == "__main__":
    main()
