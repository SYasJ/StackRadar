#!/usr/bin/env python3
"""Screenshot every StackRadar tab (used for the README, wiki and video).

    python3 demo/make_demo_workspace.py /tmp/drdemo
    HOME=/tmp/drdemo python3 stackradar.py --root /tmp/drdemo/work &
    python3 demo/shot.py [URL] [OUT_DIR]
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "media", "screenshots")
os.makedirs(OUT, exist_ok=True)
TABS = ["overview", "projects", "lineage", "network", "system", "agents", "skills", "schedules", "duplicates", "updates", "runs", "env", "reclaim"]

errors = []
with sync_playwright() as pw:
    exe = "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None
    browser = pw.chromium.launch(args=["--no-sandbox"], executable_path=exe)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="load")
    page.wait_for_selector(".cards .card", timeout=60000)
    time.sleep(4)
    for i, t in enumerate(TABS, 1):
        page.click('#nav button[data-tab="%s"]' % t)
        time.sleep(3.0 if t in ("lineage", "system", "schedules") else 1.2)
        page.screenshot(path=os.path.join(OUT, "%02d-%s.png" % (i, t)))
    # drawer
    page.click('#nav button[data-tab="projects"]')
    time.sleep(0.8)
    page.click('tr[data-path*="next-shop"]')
    time.sleep(1.0)
    page.screenshot(path=os.path.join(OUT, "13-drawer.png"))
    page.click("#drawerClose")
    # lineage: radial + flow + focus
    page.click('#nav button[data-tab="lineage"]')
    time.sleep(1.5)
    page.click('#layoutSeg button[data-layout="radial"]')
    time.sleep(2.5)
    page.screenshot(path=os.path.join(OUT, "14-lineage-radial.png"))
    page.click('#layoutSeg button[data-layout="columns"]')
    time.sleep(2.5)
    page.screenshot(path=os.path.join(OUT, "15-lineage-flow.png"))
    page.click('#layoutSeg button[data-layout="force"]')
    time.sleep(1.0)
    # settings
    page.click("#settingsBtn")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(OUT, "16-settings.png"))
    browser.close()
print("screenshots ->", os.path.abspath(OUT))
print("JS errors:", errors or "none")
