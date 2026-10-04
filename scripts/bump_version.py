#!/usr/bin/env python3
"""Single source of truth for StackRadar's version.

    python3 scripts/bump_version.py 2.1.0        # set an explicit version
    python3 scripts/bump_version.py patch|minor|major

Updates VERSION, desktop/package.json and adds a CHANGELOG stub, then prints the
git commands to tag the release. Pushing a tag `vX.Y.Z` triggers the GitHub
workflow that builds the .dmg / .exe / .AppImage and publishes them; the
desktop app's auto-updater picks the new release up from there.
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
    cl = os.path.join(ROOT, "CHANGELOG.md")
    with open(cl) as f:
        text = f.read()
    stub = "## [%s] — %s\n\n- …\n" % (new, datetime.date.today().isoformat())
    text = text.replace("<!-- next -->\n", "<!-- next -->\n\n" + stub, 1) if "<!-- next -->" in text else stub + text
    with open(cl, "w") as f:
        f.write(text)
    print("StackRadar %s -> %s" % (cur, new))
    print("next:  git commit -am 'StackRadar %s' && git tag v%s && git push --follow-tags" % (new, new))


if __name__ == "__main__":
    main()
