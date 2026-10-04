#!/usr/bin/env python3
"""Turn docs/wiki/*.md into GitHub-Wiki pages.

    python3 scripts/publish_wiki.py OUT_DIR

Rewrites `Page.md` links to wiki links (`Page`) and relative media paths to
files in the repository, and adds a footer. Used by .github/workflows/stackradar-wiki.yml.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.environ.get("GITHUB_REPOSITORY", "SYasJ/StackRadar")
RAW = "https://raw.githubusercontent.com/%s/main/" % REPO
BLOB = "https://github.com/%s/blob/main/" % REPO


def main(out):
    os.makedirs(out, exist_ok=True)
    for fp in sorted(glob.glob(os.path.join(ROOT, "docs", "wiki", "*.md"))):
        s = open(fp, encoding="utf-8").read()
        s = s.replace("../../media/video/", BLOB + "media/video/").replace("../../media/", RAW + "media/")
        s = re.sub(r"\]\(([A-Za-z0-9_-]+)\.md(#[^)]*)?\)", lambda m: "](%s%s)" % (m.group(1), m.group(2) or ""), s)
        with open(os.path.join(out, os.path.basename(fp)), "w", encoding="utf-8") as f:
            f.write(s)
    with open(os.path.join(out, "_Footer.md"), "w", encoding="utf-8") as f:
        f.write("StackRadar · free, open, 100%% local · [Download](https://github.com/%s/releases) · "
                "[Source](https://github.com/%s) · [Report an issue](https://github.com/%s/issues)\n" % (REPO, REPO, REPO))
    print("wiki pages written to", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_wiki")
