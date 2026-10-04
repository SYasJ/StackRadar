#!/usr/bin/env python3
"""Screenshot every StackRadar tab (used for the README, wiki and video).

    python3 demo/make_demo_workspace.py /tmp/srdemo
    HOME=/tmp/srdemo python3 stackradar.py --root /tmp/srdemo/work &
    python3 demo/shot.py [URL] [OUT_DIR]

Writes JPEGs (via Pillow when installed, else PNGs) and prints any JavaScript errors.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "media", "screenshots")
os.makedirs(OUT, exist_ok=True)
errors = []


def save(page, name):
    png = os.path.join(OUT, name + ".png")
    page.screenshot(path=png)
    try:
        from PIL import Image
        Image.open(png).convert("RGB").save(os.path.join(OUT, name + ".jpg"), quality=82, optimize=True)
        os.remove(png)
    except ImportError:
        pass


def tab(page, t, wait=1.5):
    page.click('#nav button[data-tab="%s"]' % t)
    time.sleep(wait)


with sync_playwright() as pw:
    exe = "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None
    browser = pw.chromium.launch(args=["--no-sandbox"], executable_path=exe)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept())
    page.goto(URL, wait_until="load")
    page.wait_for_selector(".cards .card", timeout=60000)
    time.sleep(3)
    for name, t, wait in (("01-overview", "overview", 1.5), ("02-projects", "projects", 1.5), ("03-lineage", "lineage", 3.5),
                          ("04-system", "system", 3.5), ("05-agents", "agents", 1.5), ("06-skills", "skills", 1.5),
                          ("07-schedules", "schedules", 3), ("08-duplicates", "duplicates", 1.5), ("09-updates", "updates", 1.5),
                          ("17-network", "network", 3.5), ("22-ports", "ports", 3.5), ("23-tools", "tools", 4), ("26-disk", "disk", 3)):
        tab(page, t, wait)
        save(page, name)
    tab(page, "caches", 1.5)
    if page.query_selector("#caScan"):
        page.click("#caScan")
        time.sleep(6)
        if page.query_selector("#mCancel"):
            page.click("#mCancel")
        time.sleep(1.5)
    save(page, "25-caches")
    tab(page, "duplicates", 1)
    page.click('button[data-dupv="lookalike"]')
    time.sleep(0.8)
    save(page, "29-duplicates-lookalike")
    tab(page, "projects", 1)
    page.click('tr[data-path*="next-shop"]:not([data-path*="copy"])')
    time.sleep(1.5)
    save(page, "13-drawer")
    page.click("#drawerClose")
    tab(page, "agents", 1)
    page.click(".agent-card.clickable >> nth=0")
    time.sleep(1)
    save(page, "27-agent-detail")
    page.click('[data-sact="handoff"] >> nth=0')
    time.sleep(1)
    save(page, "28-handoff")
    page.click("#mCancel")
    tab(page, "lineage", 2)
    page.eval_on_selector("#lineageSel", "(s, t) => { const o = [...s.options].find(o => o.text === t); s.value = o.value; s.dispatchEvent(new Event('change')); }", "data-etl")
    time.sleep(3.5)
    save(page, "30-lineage-drill")
    page.select_option("#lineageSel", index=0)
    for lay, name in (("radial", "14-lineage-radial"), ("columns", "15-lineage-flow")):
        page.click('#layoutSeg button[data-layout="%s"]' % lay)
        time.sleep(3)
        save(page, name)
    page.click('#layoutSeg button[data-layout="force"]')
    tab(page, "network", 3)
    page.eval_on_selector("#netScope", "(s, t) => { const o = [...s.options].find(o => o.text.startsWith(t)); s.value = o.value; s.dispatchEvent(new Event('change')); }", "phone-home")
    time.sleep(2.5)
    save(page, "33-network-scope")
    page.click("#settingsBtn")
    time.sleep(0.6)
    save(page, "16-settings")
    page.click("#setTheme")
    time.sleep(0.8)
    page.click('#thMode button[data-m="light"]')
    time.sleep(1)
    save(page, "32-theme-editor")
    page.click("#thSave")
    tab(page, "overview", 1.5)
    save(page, "31-theme-light")
    page.click("#settingsBtn")
    time.sleep(0.5)
    page.click("#setThemeToggle")       # back to dark for the next run
    browser.close()
print("screenshots ->", os.path.abspath(OUT))
print("JS errors:", errors or "none")
