"""Fast unit + HTTP smoke tests. Run:  python3 -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import stackradar as dr  # noqa: E402


class CronTests(unittest.TestCase):
    def test_describe(self):
        self.assertEqual(dr.cron_describe("*/15 * * * *"), "every 15 min")
        self.assertEqual(dr.cron_describe("0 9 * * 1-5"), "weekdays at 09:00")
        self.assertEqual(dr.cron_describe("30 2 * * *"), "daily at 02:30")
        self.assertEqual(dr.cron_describe("@hourly"), "every hour")
        self.assertEqual(dr.cron_describe("0 17 * * 5"), "Fri at 17:00")

    def test_next_weekday(self):
        base = datetime(2026, 10, 3, 12, 0).timestamp()          # a Saturday
        nxt = datetime.fromtimestamp(dr.cron_next("0 9 * * 1-5", after=base)[0])
        self.assertEqual((nxt.weekday(), nxt.hour, nxt.minute), (0, 9, 0))   # Monday 09:00

    def test_next_step_and_count(self):
        base = datetime(2026, 1, 1, 0, 7).timestamp()
        runs = [datetime.fromtimestamp(t) for t in dr.cron_next("*/15 * * * *", after=base, count=3)]
        self.assertEqual([r.minute for r in runs], [15, 30, 45])

    def test_invalid(self):
        self.assertIsNone(dr.cron_parse("not a cron"))
        self.assertEqual(dr.cron_next("61 * * * *"), [])

    def test_six_field(self):
        self.assertIsNotNone(dr.cron_parse("0 */5 * * * *"))


class UpdateCommandTests(unittest.TestCase):
    def test_rejects_injection(self):
        for bad in ["; rm -rf /", "a b", "--global", "$(id)", "x|y"]:
            with self.assertRaises(ValueError):
                dr.build_update_command("global", "npm", [bad])

    def test_global_npm(self):
        argv, cwd = dr.build_update_command("global", "npm", ["@scope/pkg", "left-pad"])
        self.assertEqual(argv, ["npm", "install", "-g", "@scope/pkg@latest", "left-pad@latest"])
        self.assertIsNone(cwd)

    def test_project_node_uses_lockfile_pm(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "pnpm-lock.yaml"), "w").close()
            argv, cwd = dr.build_update_command("project", "node", ["react"], d)
            self.assertEqual(argv, ["pnpm", "add", "react@latest"])
            self.assertEqual(cwd, d)

    def test_project_pip_needs_venv(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                dr.build_update_command("project", "pip", ["flask"], d)


class ParsingTests(unittest.TestCase):
    def test_frontmatter(self):
        fm = dr.parse_frontmatter("---\nname: pdf\ndescription: >\n  Create and\n  edit PDFs\n---\nbody")
        self.assertEqual(fm["name"], "pdf")
        self.assertEqual(fm["description"], "Create and edit PDFs")

    def test_project_schedules(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, ".github", "workflows"))
            with open(os.path.join(d, ".github", "workflows", "n.yml"), "w") as f:
                f.write("name: Nightly\non:\n  schedule:\n    - cron: '30 2 * * *'\n")
            js = os.path.join(d, "jobs.js")
            with open(js, "w") as f:
                f.write("cron.schedule('*/5 * * * *', run)\n")
            kinds = {s["kind"]: s["human"] for s in dr.detect_project_schedules(d, [js])}
            self.assertEqual(kinds["GitHub Actions"], "daily at 02:30")
            self.assertEqual(kinds["node-cron"], "every 5 min")

    def test_secret_masking(self):
        with tempfile.TemporaryDirectory() as d:
            fp = os.path.join(d, ".env")
            with open(fp, "w") as f:
                f.write("OPENAI_API_KEY=sk-" + "A" * 40 + "\n")
            found = dr.scan_secrets([fp])
            self.assertTrue(found)
            self.assertNotIn("A" * 20, found[0]["masked"])

    def test_duplicates(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("a", "b"):
                os.makedirs(os.path.join(d, name))
                with open(os.path.join(d, name, "big.bin"), "wb") as f:
                    f.write(b"x" * 10000)
            res = dr.duplicates_scan([{"path": os.path.join(d, "a"), "name": "a"}, {"path": os.path.join(d, "b"), "name": "b"}])
            self.assertEqual(res["group_count"], 1)
            self.assertEqual(res["wasted_total"], 10000)


class HttpSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), dr.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def req(self, path, data=None, headers=None):
        r = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path),
                                   data=json.dumps(data).encode() if data is not None else None,
                                   headers=headers or {}, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_index_has_token(self):
        code, body = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn(dr.API_TOKEN, body)

    def test_api_requires_token(self):
        self.assertEqual(self.req("/api/state")[0], 403)
        self.assertEqual(self.req("/api/kill", {"pid": 1, "confirm": True})[0], 403)
        self.assertEqual(self.req("/api/state", headers={"X-StackRadar-Token": dr.API_TOKEN})[0], 200)

    def test_dns_rebinding_blocked(self):
        self.assertEqual(self.req("/", headers={"Host": "evil.example:80"})[0], 403)

    def test_cron_preview(self):
        code, body = self.req("/api/cron/preview?expr=0+9+*+*+1-5", headers={"X-StackRadar-Token": dr.API_TOKEN})
        self.assertEqual(json.loads(body)["human"], "weekdays at 09:00")

    def test_system(self):
        code, body = self.req("/api/system", headers={"X-StackRadar-Token": dr.API_TOKEN})
        d = json.loads(body)
        self.assertIn("memory", d)
        self.assertGreaterEqual(d["cpu_count"], 1)


if __name__ == "__main__":
    unittest.main()
