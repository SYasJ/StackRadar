#!/usr/bin/env bash
# Assemble the GitHub Pages site (landing page + media + icon) into ./_site
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT" && mkdir -p "$OUT/static" "$OUT/media"
cp docs/index.html docs/robots.txt docs/sitemap.xml "$OUT/"
cp static/icon.svg "$OUT/static/"
cp -r media/screenshots media/video "$OUT/media/"
echo "site → $OUT"
