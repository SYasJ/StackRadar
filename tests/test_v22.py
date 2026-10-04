"""StackRadar 2.2 tests: discovery, duplicates, ports, schedules, skills, sessions, safety.
Run:  python3 -m unittest discover -s tests -v"""
import json
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import stackradar as sr  # noqa: E402


def w(base, rel, data="x"):
    fp = os.path.join(base, rel)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "wb" if isinstance(data, bytes) else "w") as f:
        f.write(data)
    return fp


class FakeHome(unittest.TestCase):
    """Points HOME (and USERPROFILE on Windows) at a temp folder for the test."""

    def setUp(self):
        self.home = os.path.realpath(tempfile.mkdtemp())
        self._env = {k: os.environ.get(k) for k in ("HOME", "USERPROFILE")}
        os.environ["HOME"] = os.environ["USERPROFILE"] = self.home

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.home, ignore_errors=True)


class DiscoveryTests(FakeHome):
    def test_home_is_not_one_big_project(self):
        # a home folder with .claude + a script used to swallow every project
        os.makedirs(os.path.join(self.home, ".claude"))
        w(self.home, "script.py", "print(1)")
        w(self.home, "code/a/package.json", "{}")
        w(self.home, "code/b/main.go", "package main")
        os.makedirs(os.path.join(self.home, "code/b/.git"))
        projects, _ = sr.discover_projects(self.home, 6, None, {})
        rels = sorted(p["rel"] for p in projects)
        self.assertNotIn(".", rels)
        self.assertIn(os.path.join("code", "a"), rels)
        self.assertIn(os.path.join("code", "b"), rels)      # plain git repo, no manifest

    def test_nested_projects_and_fixtures(self):
        root = os.path.join(self.home, "work")
        os.makedirs(os.path.join(root, "mono/.git"))
        w(root, "mono/package.json", "{}")
        w(root, "mono/packages/web/package.json", "{}")
        w(root, "mono/packages/api/pyproject.toml", "[project]")
        w(root, "mono/tests/fixtures/app/package.json", "{}")
        w(root, "mono/src/util.py", "x = 1")           # weak signal inside a project: not separate
        projects, _ = sr.discover_projects(root, 6, None, {})
        by_rel = {p["rel"]: p for p in projects}
        self.assertIn("mono", by_rel)
        web = by_rel[os.path.join("mono", "packages", "web")]
        self.assertEqual(web["parent"], os.path.join(root, "mono"))
        self.assertNotIn(os.path.join("mono", "tests", "fixtures", "app"), by_rel)
        self.assertNotIn(os.path.join("mono", "src"), by_rel)
        self.assertEqual(len(by_rel["mono"]["children"]), 2)

    def test_unfinished_work_and_installed_copies(self):
        w(self.home, "ideas/bot/README.md", "# bot")
        w(self.home, "ideas/bot/bot.py", "x")
        for n in "abc":
            w(self.home, "ideas/loose/%s.py" % n, "x")
        w(self.home, ".vscode/extensions/ext/package.json", "{}")
        w(self.home, "Library/App/package.json", "{}")
        w(self.home, "go/pkg/mod/x@v1/go.mod", "module x")
        projects, _ = sr.discover_projects(self.home, 6, None, {})
        rels = {p["rel"] for p in projects}
        self.assertIn(os.path.join("ideas", "bot"), rels)
        self.assertIn(os.path.join("ideas", "loose"), rels)
        self.assertFalse(any(r.startswith((".vscode", "Library", "go")) for r in rels), rels)

    def test_stage(self):
        stage, reasons = sr.project_stage({"run": {}, "has_readme": False, "git": {"vcs": None}, "languages": [], "strength": "weak"})
        self.assertEqual(stage, "incomplete")
        self.assertIn("no README", reasons)
        stage, _ = sr.project_stage({"run": {"command": "npm run dev"}, "has_readme": True, "git": {"vcs": "Git", "commit_count": 40},
                                     "languages": [["TypeScript", 30]], "strength": "strong"})
        self.assertEqual(stage, "ready")

    def test_progress_view(self):
        sr.SCAN.update({"running": True, "phase": "reading projects", "started": time.time() - 10,
                        "progress": {"dirs": 900, "projects_done": 5, "projects_total": 10}})
        v = sr.scan_progress_view()
        self.assertAlmostEqual(v["pct"], 35 + 37 * 0.5, places=1)
        self.assertGreater(v["eta_s"], 0)
        self.assertIn("5 of 10", v["detail"])
        sr.SCAN.update({"running": False, "phase": "idle"})


class DuplicateTests(FakeHome):
    def test_three_kinds(self):
        a, b = os.path.join(self.home, "p1"), os.path.join(self.home, "p2")
        blob = os.urandom(9000)
        w(a, "photo.png", blob)
        w(b, "photo.png", blob)                    # exact: name + size + content
        w(b, "photo-final.png", blob)              # same content, other name
        w(a, "shot.png", os.urandom(9000))          # same name + size, different content
        w(b, "shot.png", os.urandom(9000))
        w(a, "README.md", "a" * 5000)               # boilerplate names are not look-alikes
        w(b, "README.md", "b" * 5000)
        pr = {}
        r = sr.duplicates_scan([{"path": a, "name": "p1"}, {"path": b, "name": "p2"}], progress=pr)
        self.assertEqual([g["name"] for g in r["groups"]], ["photo.png"])
        self.assertEqual(r["renamed"][0]["names"], ["photo-final.png", "photo.png"])
        looks = {g["name"]: g for g in r["lookalikes"]}
        self.assertIn("shot.png", looks)
        self.assertTrue(looks["shot.png"]["same_size"])
        self.assertNotIn("README.md", looks)
        self.assertEqual(pr["dup_done"], pr["dup_total"])

    def test_nested_project_files_counted_once(self):
        outer = os.path.join(self.home, "outer")
        inner = os.path.join(outer, "inner")
        w(inner, "big.bin", os.urandom(10000))
        r = sr.duplicates_scan([{"path": outer, "name": "outer", "children": [inner]}, {"path": inner, "name": "inner"}])
        self.assertEqual(r["group_count"], 0)

    def test_image_dims(self):
        png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + (1920).to_bytes(4, "big") + (1080).to_bytes(4, "big") + b"\x00" * 20
        fp = w(self.home, "a.png", png)
        self.assertEqual(sr.image_dims(fp), (1920, 1080))
        gif = w(self.home, "a.gif", b"GIF89a" + (64).to_bytes(2, "little") + (32).to_bytes(2, "little") + b"\x00" * 10)
        self.assertEqual(sr.image_dims(gif), (64, 32))


class PortsTests(unittest.TestCase):
    def test_mac_lsof_parse(self):
        out = "p501\ncnode\nf23\nn*:3000\nf24\nn[::1]:3000\np77\ncpostgres\nf5\nn127.0.0.1:5432\n"
        orig = sr.run_cmd
        sr.run_cmd = lambda args, timeout=15, cwd=None: (True, out)
        try:
            rows = sr.get_listeners_mac()
        finally:
            sr.run_cmd = orig
        self.assertEqual([(r["port"], r["pid"], r["proc"]) for r in rows], [(3000, 501, "node"), (5432, 77, "postgres")])
        self.assertEqual(rows[1]["addr"], "127.0.0.1")

    def test_never_stops_itself(self):
        self.assertFalse(sr.proc_stop(os.getpid())["ok"])


class SafetyTests(FakeHome):
    def test_protected_paths(self):
        self.assertTrue(sr.protected_path(self.home))
        os.makedirs(os.path.join(self.home, "Documents"))
        self.assertTrue(sr.protected_path(os.path.join(self.home, "Documents")))
        self.assertFalse(sr.protected_path(os.path.join(self.home, "Documents", "old")))
        self.assertFalse(sr.do_delete(self.home)["ok"])
        self.assertTrue(os.path.isdir(self.home))

    def test_disk_list(self):
        w(self.home, "big/a.bin", b"0" * 5000)
        w(self.home, "small.txt", "hi")
        sr.STATE["data"], sr.STATE["subtree"] = {"projects": []}, {}
        r = sr.disk_list("~")
        self.assertTrue(r["ok"])
        self.assertEqual(r["items"][0]["name"], "big")
        self.assertFalse(sr.disk_list("/")["ok"])

    def test_remove_command_validation(self):
        self.assertEqual(sr.build_remove_command("npm", "left-pad"), ["npm", "uninstall", "-g", "left-pad"])
        with self.assertRaises(ValueError):
            sr.build_remove_command("brew", "x; rm -rf /")

    def test_theme_settings_are_validated(self):
        sr.SETTINGS_FILE = os.path.join(self.home, "settings.json")
        sr.SETTINGS["data"] = sr.settings_defaults()
        cur = sr.settings_set({"theme_custom": {"dark": "nord", "overrides": {"nord": {"--bg": "#101010", "--text": "url(evil)", "color": "#fff"}}}})
        self.assertEqual(cur["theme_custom"]["overrides"]["nord"], {"--bg": "#101010"})

    def test_surface_labels(self):
        self.assertEqual(sr.surface_label("cli"), "CLI")
        self.assertEqual(sr.surface_label("claude-vscode"), "IDE")
        self.assertEqual(sr.surface_label("claude-desktop"), "Desktop app")
        self.assertEqual(sr.surface_label("remote_desktop"), "Web / cloud")


@unittest.skipIf(os.name == "nt", "uses a fake crontab shell script")
class CrontabTests(FakeHome):
    def setUp(self):
        super().setUp()
        self.bin = os.path.join(self.home, "bin")
        os.makedirs(self.bin)
        self.tab = os.path.join(self.home, "crontab.txt")
        fake = os.path.join(self.bin, "crontab")
        with open(fake, "w") as f:
            f.write('#!/bin/sh\nif [ "$1" = "-l" ]; then cat "%s"; elif [ "$1" = "-" ]; then cat > "%s"; fi\n' % (self.tab, self.tab))
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        with open(self.tab, "w") as f:
            f.write("SHELL=/bin/bash\n*/5 * * * * /usr/bin/backup.sh\n0 9 * * 1 echo hi\n")
        self._path = os.environ["PATH"]
        os.environ["PATH"] = self.bin + os.pathsep + self._path

    def tearDown(self):
        os.environ["PATH"] = self._path
        super().tearDown()

    def rows(self):
        return [r for r in sr.system_schedules([]) if r["source"] == "crontab"]

    def test_pause_reschedule_resume_delete(self):
        r = self.rows()
        self.assertTrue(sr.schedule_action(r[0], "pause")["ok"])
        self.assertFalse(self.rows()[0]["enabled"])
        self.assertTrue(sr.schedule_action(self.rows()[0], "reschedule", "15 * * * *")["ok"])
        self.assertTrue(sr.schedule_action(self.rows()[0], "resume")["ok"])
        self.assertTrue(sr.schedule_action(self.rows()[1], "delete")["ok"])
        with open(self.tab) as f:
            self.assertEqual(f.read(), "SHELL=/bin/bash\n15 * * * * /usr/bin/backup.sh\n")
        self.assertFalse(sr.schedule_action(self.rows()[0], "reschedule", "every day")["ok"])
        self.assertTrue(os.listdir(os.path.join(self.home, ".stackradar", "backups")))


@unittest.skipIf(os.name == "nt", "symlinks")
class SkillTests(FakeHome):
    def test_consolidate_duplicates_into_one_shared_copy(self):
        a = w(self.home, ".claude/skills/pdf/SKILL.md", "---\nname: pdf\n---\nv1")
        b = w(self.home, ".codex/skills/pdf/SKILL.md", "---\nname: pdf\n---\nv2")
        sr.SHARED_SKILLS = os.path.join(self.home, ".agents", "skills")
        res = sr.skills_scan([])
        dup = next(d for d in res["duplicates"] if d["name"] == "pdf")
        self.assertFalse(dup["identical"])            # different SKILL.md bodies
        sr.STATE["data"] = {"skills": res, "projects": []}
        r = sr.skill_action("consolidate", a, keep=a)
        self.assertTrue(r["ok"], r)
        shared = os.path.join(sr.SHARED_SKILLS, "pdf")
        self.assertTrue(os.path.isdir(shared) and not os.path.islink(shared))
        for d in (os.path.dirname(a), os.path.dirname(b)):
            self.assertTrue(os.path.islink(d))
            self.assertEqual(os.path.realpath(d), os.path.realpath(shared))
        with open(os.path.join(shared, "SKILL.md")) as f:
            self.assertIn("v1", f.read())

    def test_share_links_into_another_agent(self):
        a = w(self.home, ".claude/skills/review/SKILL.md", "---\nname: review\n---\nhi")
        sr.STATE["data"] = {"skills": sr.skills_scan([]), "projects": []}
        r = sr.skill_action("share", a, agent="Codex CLI")
        self.assertTrue(r["ok"], r)
        self.assertTrue(os.path.islink(os.path.join(self.home, ".codex", "skills", "review")))


class SessionTests(FakeHome):
    def make_session(self):
        lines = [{"type": "user", "cwd": "/w/app", "entrypoint": "claude-vscode", "timestamp": "2026-10-01T10:00:00Z",
                  "message": {"role": "user", "content": "Build the login page"}},
                 {"type": "assistant", "timestamp": "2026-10-01T10:00:05Z",
                  "message": {"model": "claude-opus-4-1", "usage": {"input_tokens": 100, "output_tokens": 40},
                              "content": [{"type": "text", "text": "Done, see app/login.tsx"},
                                          {"type": "tool_use", "name": "Write", "input": {"file_path": "/w/app/login.tsx"}}]}}]
        return w(self.home, ".claude/projects/-w-app/s1.jsonl", "\n".join(json.dumps(x) for x in lines) + "\n")

    def test_usage_split_by_surface_and_model(self):
        self.make_session()
        _, tok = sr.claude_global_usage()
        self.assertEqual(tok["by_surface"]["IDE"]["out"], 40)
        self.assertEqual(tok["by_model"]["claude-opus-4-1"]["in"], 100)
        self.assertEqual(tok["sessions_list"][0]["first_prompt"], "Build the login page")

    def test_tag_handoff_archive_restore(self):
        fp = self.make_session()
        sr.SESSION_META_FILE = os.path.join(self.home, ".stackradar", "sessions.json")
        sr.SESSION_ARCHIVE = os.path.join(self.home, ".stackradar", "archived-sessions")
        sr.STATE["data"] = {"agents": [], "projects": []}
        self.assertEqual(sr.session_action("claude", fp, "tag", tags=["to delete"])["tags"], ["to delete"])
        h = sr.session_action("claude", fp, "handoff")
        self.assertTrue(h["ok"])
        self.assertIn("Build the login page", h["markdown"])
        self.assertIn("/w/app/login.tsx", h["markdown"])
        a = sr.session_action("claude", fp, "archive")
        self.assertTrue(a["ok"] and not os.path.exists(fp))
        self.assertTrue(sr.session_action("claude", a["archived_to"], "restore")["ok"])
        self.assertTrue(os.path.exists(fp))
        self.assertFalse(sr.session_action("claude", "/etc/passwd", "delete")["ok"])


if __name__ == "__main__":
    unittest.main()
